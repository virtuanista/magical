import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { Book } from './book.js';
import { Arms, skinFromGltf, HAND_SPECS } from './arms.js';
import { Particles, Lightning, Flipbook } from './vfx.js';
import { LESSONS } from './lessons.js';
import { score } from './gesture.js';
import { CREDITS } from './credits.js';
import { Sound } from './audio.js';
import { Candles } from './props.js';
const sound = new Sound();
sound.prefetch();
let traceLoop = null, fireLoop = null;

const $ = (id) => document.getElementById(id);
const TOUCH = matchMedia('(pointer: coarse)').matches;
const WITH = TOUCH ? 'con el dedo' : 'con el ratón';
const NEXT = TOUCH ? 'Toca el borde de la página derecha para seguir.' : 'Haz clic en el borde de la página derecha (o pulsa →) para seguir.';
const canvas = $('c');

// ---------------- renderer ----------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// calidad: en móviles y equipos modestos se baja la resolución interna
const LOW = TOUCH || (navigator.hardwareConcurrency || 8) <= 4 || new URLSearchParams(location.search).has('low');
let pixelRatio = Math.min(devicePixelRatio, LOW ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 200);
scene.add(camera);

// ---------------- composición ----------------
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
const debugView = new URLSearchParams(location.search).get('debug');
const debugCam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 50);
const renderPass = new RenderPass(scene, debugView ? debugCam : camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.65, 1.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.31) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float ca = 0.0012 * dot(d,d) * 4.0;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + d*ca).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - d*ca).b;
      float v = smoothstep(0.95, 0.25, length(d * vec2(uRes.x/uRes.y, 1.0)) * 0.9);
      c *= mix(0.55, 1.0, v);
      c += (h(vUv*uRes) - 0.5) * 0.022;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // pantallas verticales (móvil): algo más de campo de visión
  camera.fov = w / h < 1 ? THREE.MathUtils.lerp(78, 62, THREE.MathUtils.clamp((w / h - 0.45) / 0.55, 0, 1)) : 60;
  camera.updateProjectionMatrix();
  grade.uniforms.uRes.value.set(w, h);
  particles.mat.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.5;
  window.__lightning?.setResolution(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
}

// ---------------- carga ----------------
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, l, t) => { $('bar').style.width = `${(l / t) * 100}%`; };
const texLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);
const hdrLoader = new HDRLoader(manager);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

function tex(url, srgb) {
  const t = texLoader.load(url);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });

const A = '/assets';
const [envHdr, bgHdr, armsGltf, bookGltf, paperImage, tableGltf, candleGltf] = await Promise.all([
  hdrLoader.loadAsync(`${A}/hdri/cellar_2k.hdr`),
  // fondo: foto 8K de Poly Haven (versión JPG); la luz sale del HDR 2K
  !LOW && renderer.capabilities.maxTextureSize >= 8192 ? texLoader.loadAsync(`${A}/hdri/cellar_bg_8k.jpg`) : texLoader.loadAsync(`${A}/hdri/cellar_bg_4k.jpg`),
  gltfLoader.loadAsync(`${A}/hands/fists.glb`),
  gltfLoader.loadAsync(`${A}/book/book.glb`),
  loadImage(`${A}/textures/paper_Color.jpg`),
  gltfLoader.loadAsync(`${A}/props/round_wooden_table_01/round_wooden_table_01.gltf`),
  gltfLoader.loadAsync(`${A}/props/brass_candleholders/brass_candleholders.gltf`),
  document.fonts.load('150px "IM Fell English SC"'),
  document.fonts.load('50px "IM Fell English"'),
  document.fonts.load('italic 50px "IM Fell English"'),
]);

const textures = {
  paperNormal: tex(`${A}/textures/paper_NormalGL.jpg`),
  paperImage,
};
textures.paperNormal.repeat.set(1.5, 1.5);

// ---------------- entorno ----------------
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(envHdr).texture;
envHdr.dispose();
bgHdr.mapping = THREE.EquirectangularReflectionMapping;
if (!bgHdr.isDataTexture) { bgHdr.colorSpace = THREE.SRGBColorSpace; bgHdr.generateMipmaps = false; bgHdr.minFilter = THREE.LinearFilter; }
scene.background = bgHdr;
const ENV_ROT = new THREE.Euler(0, THREE.MathUtils.degToRad(-90), 0);
scene.backgroundRotation.copy(ENV_ROT);
scene.environmentRotation.copy(ENV_ROT);
scene.backgroundIntensity = bgHdr.isDataTexture ? 0.85 : 0.42;
// la foto se proyecta sobre una cúpula con suelo: así se puede caminar un poco por la bodega
// y el suelo y las paredes cambian de perspectiva al moverse
const skybox = new GroundedSkybox(bgHdr, 1.6, 14, 96);
skybox.position.y = 1.6 - 1.6 - 0.005;
skybox.rotation.y = ENV_ROT.y;
skybox.material.color.setScalar(scene.backgroundIntensity);
scene.add(skybox);
scene.background = new THREE.Color(0x000000);
scene.environmentIntensity = 0.7;

// luz principal cálida (imita la entrada de luz de la bóveda) con sombras sobre manos y libro
const key = new THREE.DirectionalLight(0xffdcb8, 1.05);
key.position.set(0.9, 1.2, 0.5);
key.target.position.set(0, -0.1, -0.35);
key.castShadow = true;
key.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
key.shadow.camera.left = -0.4; key.shadow.camera.right = 0.4;
key.shadow.camera.top = 0.4; key.shadow.camera.bottom = -0.4;
key.shadow.camera.near = 0.1; key.shadow.camera.far = 3;
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.002;
key.shadow.radius = 4;
camera.add(key, key.target);

// ---------------- viewmodel ----------------
const rig = new THREE.Group();
camera.add(rig);

const book = new Book(bookGltf, textures, maxAniso);
const bookRig = new THREE.Group();
const BOOK_POS = new THREE.Vector3(-0.135, -0.135, -0.44);
bookRig.position.copy(BOOK_POS);
bookRig.rotation.set(-0.78, 0.38, 0.08, 'YXZ');
bookRig.add(book.group);
rig.add(bookRig);

const arms = new Arms(armsGltf, await skinFromGltf(armsGltf));
rig.add(arms.root);
// posturas de dedos capturadas de las animaciones del propio modelo
arms.capture('idle', 'Idle', 1.0);
arms.capture('fist', 'Block_Loop', 0.5);
arms.capture('open', 'Inspect', 2.0);
arms.capture('take', 'Take_Loop', 0.5);
window.__handSpec = null;

// base de cada mano medida en el espacio local de su hueso (en reposo)
function handBasis(s) {
  const sd = arms.side[s];
  sd.hand.updateMatrixWorld(true);
  const loc = (b) => sd.hand.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
  const F = loc(sd.fingers.f_middle[0].bone).normalize();
  const L = loc(sd.fingers.f_index[0].bone).sub(loc(sd.fingers.f_pinky[0].bone));
  L.sub(F.clone().multiplyScalar(L.dot(F))).normalize();
  const D = new THREE.Vector3().crossVectors(F, L);
  return new THREE.Matrix4().makeBasis(F, L, D).transpose();
}
const handBases = { L: handBasis('L'), R: handBasis('R') };
/** Rotación mundial de la mano para que los dedos apunten a F y la palma mire a P. */
function handQuat(s, F, P) {
  F = F.clone().normalize();
  P = P.clone().sub(F.clone().multiplyScalar(P.dot(F))).normalize();
  const L = s === 'R' ? new THREE.Vector3().crossVectors(F, P) : new THREE.Vector3().crossVectors(P, F);
  const D = new THREE.Vector3().crossVectors(F, L);
  const T = new THREE.Matrix4().makeBasis(F, L, D);
  return new THREE.Quaternion().setFromRotationMatrix(T.multiply(handBases[s]));
}

// atajos usados por los efectos
const right = { tip: arms.side.R.tip, palmBone: arms.side.R.palm };

const particles = new Particles(5000);
scene.add(particles.points);
resize();
addEventListener('resize', resize);

const tmpV = new THREE.Vector3();
const tipWorld = new THREE.Vector3();
const lastTip = new THREE.Vector3();

// ---------------- estado ----------------
let lessonIdx = 0;
const mastered = LESSONS.map(() => false);
// progreso guardado en este navegador (si el almacenamiento está disponible)
const SAVE_KEY = 'grimorio.progreso.v1';
let saved = null;
try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { saved = null; }
if (saved && Array.isArray(saved.mastered)) saved.mastered.forEach((m, i) => { if (i < mastered.length) mastered[i] = !!m; });
function saveProgress() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ mastered, found: hidden.found })); } catch { /* sin almacenamiento */ }
}
// página final del grimorio: aparece al dominar todas las runas
const BASE = LESSONS.filter((l) => !l.hidden).length;
const FINAL = { id: 'final', final: true, name: 'Epílogo', subtitle: 'Fin del primer grimorio', lessons: LESSONS.filter((l) => !l.hidden) };
const baseMastered = () => mastered.slice(0, BASE).every(Boolean);
// lecciones visibles: las cuatro básicas y, si se ha encontrado en el muro, la oculta
const visibleLessons = () => (hiddenFound() ? LESSONS.length : BASE);
const pageCount = () => visibleLessons() + (baseMastered() ? 1 : 0);
const pageAt = (i) => (i < visibleLessons() ? LESSONS[i] : FINAL);
book.showSpread(LESSONS[0], 0, BASE, mastered[0]);

const mouse = { x: 0.62, y: 0.55, down: false };
const stroke = [];

let spell = null; // efecto activo
const spellLight = new THREE.PointLight(0xffd29a, 0, 4, 2);
spellLight.castShadow = true;
spellLight.shadow.mapSize.set(1024, 1024);
spellLight.shadow.bias = -0.002;
spellLight.shadow.camera.near = 0.01;
scene.add(spellLight);
const orb = new THREE.Mesh(new THREE.SphereGeometry(0.006, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.2, 3.8) }));
orb.visible = false;
scene.add(orb);
const lightning = new Lightning([0.6, 0.75, 1]);
// llama y humo reales (flipbooks CC0 de Unity Labs)
const flameTex = texLoader.load(`${A}/vfx/flame_16x4.jpg`); flameTex.colorSpace = THREE.SRGBColorSpace;
const smokeTex = texLoader.load(`${A}/vfx/smoke_8x8.png`); smokeTex.colorSpace = THREE.SRGBColorSpace;
const flames = [0, 1].map((i) => {
  const f = new Flipbook(flameTex, 16, 4, 0.078 - i * 0.016, 0.155 - i * 0.03, { additive: true, fps: 34 - i * 6 });
  f.mesh.visible = false; scene.add(f.mesh); return f;
});
const smokes = Array.from({ length: 7 }, () => {
  const f = new Flipbook(smokeTex, 8, 8, 0.09, 0.09, { additive: false, anchorBottom: false, fps: 20 });
  f.mesh.visible = false; f.life = 0; f.vel = new THREE.Vector3(); scene.add(f.mesh); return f;
});
let smokeTimer = 0;
// el orbe de Lumen: núcleo + llama fría que ondula dentro
const wisp = new Flipbook(flameTex, 16, 4, 0.05, 0.08, { additive: true, anchorBottom: false, fps: 22 });
wisp.mesh.visible = false; scene.add(wisp.mesh);
// mesa con candelabro en la bodega; el suelo de la foto está ~1,6 m bajo los ojos
const FLOOR_Y = -1.6;
const candles = new Candles(tableGltf, candleGltf, flameTex, FLOOR_Y);
candles.group.position.set(0.95, FLOOR_Y, -2.0);
candles.group.rotation.y = -0.4;
candles.group.scale.setScalar(0.78);
candles.addTo(scene);
// suelo invisible que solo recoge sombras, para asentar la mesa en la foto
const floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.55 }));
floorShadow.rotation.x = -Math.PI / 2;
floorShadow.position.y = FLOOR_Y + 0.001;
floorShadow.receiveShadow = true;
scene.add(floorShadow);
let candleEvent = null; // { t, kind }
let sigil = null;
// runa oculta en el muro izquierdo: solo se ve con la luz de Lumen (icono de lorc, game-icons.net, CC BY 3.0)
const hidden = { mesh: null, shown: 0, found: !!(saved && saved.found) };
function hiddenFound() { return hidden.found; }
loadImage(`${A}/icons/triskelion.svg`).then((img) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, 512, 512);
  cx.globalCompositeOperation = 'source-in';
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 512, 512);
  const glow = document.createElement('canvas'); glow.width = glow.height = 512;
  const gx = glow.getContext('2d');
  gx.filter = 'blur(14px)'; gx.drawImage(cv, 0, 0); gx.filter = 'none'; gx.globalAlpha = 0.55; gx.drawImage(cv, 0, 0);
  const tex = new THREE.CanvasTexture(glow); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0, 0, 0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), mat);
  m.position.set(-1.15, 0.28, -1.85);
  m.lookAt(0, 0, 0);
  m.rotateZ(0.2);
  m.visible = false;
  scene.add(m);
  hidden.mesh = m;
});
// polvo que cae del techo tras el trueno
const dust = Array.from({ length: 8 }, () => {
  const f = new Flipbook(smokeTex, 8, 8, 0.35, 0.35, { additive: false, anchorBottom: false, fps: 14 });
  f.mesh.visible = false; f.life = 0; f.delay = 0; f.vel = new THREE.Vector3(); scene.add(f.mesh); return f;
});
function shakeCeiling() {
  dust.forEach((d, i) => {
    d.life = d.maxLife = 2.6 + Math.random() * 1.2;
    d.delay = 0.3 + i * 0.12 + Math.random() * 0.2;
    d.mesh.position.copy(camera.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 2.4, 0.9 + Math.random() * 0.4, -1.4 - Math.random() * 1.6)));
    d.vel.set((Math.random() - 0.5) * 0.04, -0.12 - Math.random() * 0.08, 0);
  });
  for (let i = 0; i < 40; i++) {
    const p = camera.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 2.2, 0.9 + Math.random() * 0.3, -1.3 - Math.random() * 1.5));
    particles.emit(p, tmpV.set((Math.random() - 0.5) * 0.1, -0.2, 0), [0.55, 0.48, 0.4], 0.006 + Math.random() * 0.005, 1.6 + Math.random(), { drag: 0.1, rise: -2.2 });
  }
  sound.play('crackle', { vol: 0.15, pan: 0, send: 1, rate: 0.5, delay: 0.4 });
}
// sombra de contacto suave bajo la mesa (oclusión ambiental falsa)
{
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d').createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.45, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  const ctx2 = cv.getContext('2d'); ctx2.fillStyle = g; ctx2.fillRect(0, 0, 128, 128);
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  ao.rotation.x = -Math.PI / 2;
  ao.position.set(candles.group.position.x, FLOOR_Y + 0.002, candles.group.position.z);
  scene.add(ao);
}
scene.add(lightning.group);
window.__lightning = lightning;
lightning.setResolution(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());

function hint(t) { $('hint').innerHTML = t; }
function lessonHud() {
  const l = pageAt(lessonIdx);
  $('lesson').innerHTML = l.final ? `<b>Epílogo</b> · cuatro runas dominadas`
    : l.hidden ? `Lección oculta · <b>${l.name}</b>${mastered[lessonIdx] ? ' · dominada' : ''}`
    : `Lección ${lessonIdx + 1} de ${BASE} · <b>${l.name}</b>${mastered[lessonIdx] ? ' · dominada' : ''}`;
}
let toastTimer = 0;
function toast(t, fail) {
  const el = $('toast');
  el.textContent = t;
  el.className = 'show' + (fail ? ' fail' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = fail ? 'fail' : ''), 1800);
}

function turnPage(dir) {
  const to = lessonIdx + dir;
  if (to < 0 || to >= pageCount()) return;
  if (book.turn(dir, pageAt(lessonIdx), pageAt(to), lessonIdx, to, !!mastered[lessonIdx], !!mastered[to], BASE)) {
    sound.play(Math.random() < 0.5 ? 'page_1' : 'page_2', { vol: 0.9, pan: -0.35, send: 0.35 });
    lessonIdx = to;
    lessonHud();
    hint(pageAt(to).final ? 'Epílogo: traza cualquiera de las cuatro runas que has aprendido.' : mastered[to] ? 'Ya dominas esta runa. Trázala cuando quieras.' : `Lee la página y traza la runa ${WITH}.`);
  }
}

// ---------------- entrada ----------------
// ¿qué página del libro hay bajo el cursor? (0 izquierda, 1 derecha, -1 ninguna)
const pageRay = new THREE.Raycaster();
let hoverHit = null, hoverPage = -1;
function pageUnder(cx, cy) {
  pageRay.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  const hit = pageRay.intersectObjects([...book.pageMeshes, book.pagesMesh], false)[0];
  hoverHit = hit ? hit.point.clone() : null;
  if (!hit) return -1;
  if (hit.object === book.pageMeshes[0]) return 0;
  if (hit.object === book.pageMeshes[1]) return 1;
  return book.group.worldToLocal(hit.point.clone()).x < 0 ? 0 : 1;
}
/** Solo el margen exterior de cada página (o su esquina) pasa la hoja. */
function pageCorner(cx, cy) {
  const pg = pageUnder(cx, cy);
  if (pg < 0 || !hoverHit) return -1;
  const x = Math.abs(book.group.worldToLocal(hoverHit.clone()).x);
  return x > 0.13 ? pg : -1;
}
addEventListener('pointermove', (e) => {
  mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight;
  mouse.idle = 0;
  if (mouse.down) stroke.push([e.clientX, e.clientY]);
  else if (started) {
    const pg = (hoverPage = pageCorner(e.clientX, e.clientY));
    const can = (pg === 1 && lessonIdx < pageCount() - 1) || (pg === 0 && lessonIdx > 0);
    canvas.style.cursor = can ? 'pointer' : 'none';
  }
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || started === false) return;
  const pg = pageCorner(e.clientX, e.clientY);
  if ((pg === 1 && lessonIdx < pageCount() - 1) || (pg === 0 && lessonIdx > 0)) { turnPage(pg === 1 ? 1 : -1); return; }
  try { canvas.setPointerCapture(e.pointerId); } catch { /* puntero sintético o ya liberado */ }
  mouse.idle = 0;
  mouse.down = true; stroke.length = 0; stroke.push([e.clientX, e.clientY]);
});
let wheelLock = 0;
addEventListener('wheel', (e) => {
  if (!started || performance.now() < wheelLock || Math.abs(e.deltaY) < 20) return;
  wheelLock = performance.now() + 900;
  turnPage(e.deltaY > 0 ? 1 : -1);
}, { passive: true });
addEventListener('pointerup', (e) => {
  if (!mouse.down) return;
  mouse.down = false;
  evaluate();
});
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') turnPage(1);
  if (e.key === 'ArrowLeft') turnPage(-1);
  if (e.key.toLowerCase() === 'c') $('credits').classList.toggle('hidden');
  if (e.key.toLowerCase() === 'm' && sound.master) { const on = sound.master.gain.value > 0.01; sound.master.gain.setTargetAtTime(on ? 0 : 0.9, sound.ctx.currentTime, 0.05); toast(on ? 'Sonido apagado' : 'Sonido activado', true); }
});
addEventListener('contextmenu', (e) => e.preventDefault());

function evaluate() {
  const span = stroke.reduce((m, p) => Math.max(m, Math.abs(p[0] - stroke[0][0]), Math.abs(p[1] - stroke[0][1])), 0);
  if (stroke.length < 10 || span < 40) return;
  const lesson = pageAt(lessonIdx);
  const s = lesson.final ? 0 : score(stroke, lesson.stroke, lesson.variants);
  if (!lesson.final && s >= (lesson.threshold ?? 0.7)) {
    cast(lesson);
    const first = !mastered[lessonIdx];
    if (first) {
      sound.play('seal', { vol: 0.35, pan: -0.3, delay: 0.5, rate: 1.2 });
      mastered[lessonIdx] = true;
      saveProgress();
      book.showSpread(lesson, lessonIdx, BASE, true);
      lessonHud();
    }
    const all = baseMastered() && !lesson.hidden;
    toast(first && all ? 'Grimorio completado' : `¡${lesson.name}!`);
    if (all) hint(first ? 'Has dominado las cuatro runas. Pasa la página: el grimorio guarda un epílogo.' : 'Práctica libre: traza cualquier runa aprendida.');
    else if (lesson.hidden) hint(first ? 'Has aprendido el sello oculto. Vuelve a las lecciones que te falten cuando quieras.' : 'El sello responde a tu mano.');
    else if (lessonIdx >= pageCount() - 1) hint('Bien trazada.');
    else hint(first ? 'Runa dominada. ' + NEXT : 'Bien trazada. Cuando quieras, pasa a la siguiente página.');
    return;
  }
  // una runa ya dominada se puede lanzar desde cualquier página
  let best = null, bestS = 0;
  LESSONS.forEach((l, i) => {
    if (!mastered[i] || (i === lessonIdx && !lesson.final)) return;
    const si = score(stroke, l.stroke, l.variants);
    if (si > bestS) { bestS = si; best = l; }
  });
  if (best && bestS >= (best.threshold ?? 0.7) + 0.04) {
    cast(best);
    toast(`¡${best.name}!`);
    return;
  }
  fizzle();
  sound.play('fizzle', { vol: 0.8, pan: panOf(tipWorld) });
  if (lesson.final) { toast('La runa se deshace', true); hint('Traza cualquiera de las cuatro runas del índice.'); return; }
  book.showAttempt(lesson, lessonIdx, mastered[lessonIdx], stroke.slice());
  toast(`La runa se deshace · ${Math.round(s * 100)}%`, true);
  hint('Mira el libro: tu trazo aparece en rojo sobre la runa. Empieza en el punto rojo y sigue la forma sin soltar.');
}

function fizzle() {
  right.tip.getWorldPosition(tipWorld);
  for (let i = 0; i < 40; i++) {
    particles.emit(tipWorld, tmpV.randomDirection().multiplyScalar(0.05 + Math.random() * 0.15), [0.6, 0.5, 0.45], 0.02, 0.5 + Math.random() * 0.6, { drag: 3, rise: -0.05 });
  }
}

function panOf(world) {
  const v = camera.worldToLocal(world.clone());
  return THREE.MathUtils.clamp(v.x / 0.35, -1, 1) * 0.7;
}

function castSound(id) {
  const pan = panOf(arms.side.R.palm.getWorldPosition(new THREE.Vector3()));
  sound.play('cast', { vol: 0.55, pan, send: 0.4 });
  if (fireLoop) { fireLoop.stop(0.4); fireLoop = null; }
  if (id === 'lumen') sound.play('lumen', { vol: 0.75, pan: 0.1, send: 0.9, rate: 1.0 });
  if (id === 'ignis') {
    sound.play('ignite', { vol: 0.9, pan });
    fireLoop = sound.loop('fire_loop', { vol: 0, pan, send: 0.4 });
    fireLoop?.set(0.75, 0.3);
  }
  if (id === 'fulgur') {
    sound.play('crackle', { vol: 0.8, pan, send: 0.5, rate: 1.1 });
    sound.play('thunder', { vol: 0.9, pan: 0, send: 1.0, delay: 0.25 });
  }
  if (id === 'vinculum') {
    sound.play('lumen', { vol: 0.7, pan, send: 1, rate: 0.75 });
    sound.play('seal', { vol: 0.5, pan, send: 1, rate: 0.6, delay: 0.35 });
    sound.play('wind_whistle', { vol: 0.25, pan: 0, send: 0.9, rate: 0.7 });
  }
  if (id === 'ventus') {
    sound.play('gust', { vol: 0.9, pan, send: 0.6 });
    sound.play('wind_whistle', { vol: 0.55, pan: 0.2, send: 0.7, delay: 0.1 });
  }
}

function cast(lesson) {
  castSound(lesson.id);
  if (sigil) sigil.visible = false;
  wisp.mesh.visible = false;
  if (lesson.id === 'ignis') candleEvent = { t: 0, kind: 'light', done: false };
  if (lesson.id === 'ventus') candleEvent = { t: 0, kind: 'blow', done: false };
  if (lesson.id === 'fulgur') shakeCeiling();
  flames.forEach((f) => (f.mesh.visible = false));
  spell = { id: lesson.id, t: 0, color: lesson.color };
  orb.visible = false;
  lightning.hide();
  spellLight.color.setRGB(...lesson.color);
  right.tip.getWorldPosition(tipWorld);
  for (let i = 0; i < 70; i++) {
    particles.emit(tipWorld, tmpV.randomDirection().multiplyScalar(0.08 + Math.random() * 0.3), lesson.color.map((c) => c * 1.4), 0.014 + Math.random() * 0.01, 0.5 + Math.random() * 0.7, { drag: 2.5 });
  }
  if (lesson.id === 'lumen') {
    orb.position.copy(tipWorld);
    orb.visible = true;
  }
}

// ---------------- bucle ----------------
const clock = new THREE.Timer();
let time = 0;
const lookTarget = new THREE.Euler(0, 0, 0, 'YXZ');
// caminar: WASD (o flechas arriba/abajo) y mirar alrededor con el botón derecho
const player = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vel: new THREE.Vector3(), phase: 0, lastStep: 0 };
const keys = new Set();
let looking = false;
addEventListener('keydown', (e) => { keys.add(e.code); });
addEventListener('keyup', (e) => { keys.delete(e.code); });
addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', (e) => { if (e.button === 2) { looking = true; try { canvas.setPointerCapture(e.pointerId); } catch {} } });
addEventListener('pointerup', (e) => { if (e.button === 2) looking = false; });
addEventListener('pointermove', (e) => {
  if (!looking) return;
  player.yaw -= e.movementX * 0.0035;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0025, -0.5, 0.45);
});
const TABLE_R = 0.62;
function updatePlayer(dt) {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const turn = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
  player.yaw += turn * dt * 1.6;
  const dir = new THREE.Vector3(r, 0, -f);
  if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw).multiplyScalar(1.15);
  player.vel.lerp(dir, 1 - Math.exp(-dt * 8));
  const next = player.pos.clone().addScaledVector(player.vel, dt);
  // límites: dentro de la bodega y sin atravesar la mesa
  if (next.length() > 2.6) next.setLength(2.6);
  const tp = new THREE.Vector3(candles.group.position.x, 0, candles.group.position.z);
  const dt2 = new THREE.Vector3(next.x, 0, next.z).sub(tp);
  if (dt2.length() < TABLE_R) next.copy(tp.add(dt2.setLength(TABLE_R)));
  player.pos.copy(next);
  const speed = player.vel.length();
  if (speed > 0.15) {
    player.phase += dt * speed * 7.5;
    if (Math.floor(player.phase / Math.PI) !== player.lastStep) {
      player.lastStep = Math.floor(player.phase / Math.PI);
      sound.play(`step_${1 + Math.floor(Math.random() * 4)}`, { vol: 0.45, pan: (player.lastStep % 2 ? 0.15 : -0.15), send: 0.7 });
    }
  }
  return speed;
}
const drawPlaneZ = -0.42;
const rightTarget = new THREE.Vector3();
const REST_TIP = new THREE.Vector3(0.16, -0.24, -0.4);
let restBlend = 0;
const rightCur = new THREE.Vector3(0.12, -0.12, -0.4);
const ndc = new THREE.Vector3();
const shoulder = new THREE.Vector3(0.2, -0.32, 0.05);
const tipLocal = new THREE.Vector3();

// mismo mapeo pantalla → espacio de la mano que usa el cursor
function screenToHandSpace(mx, my, out) {
  ndc.set(mx * 2 - 1, -(my * 2 - 1), 0.5).applyMatrix4(camera.projectionMatrixInverse).normalize();
  out.copy(ndc).multiplyScalar(drawPlaneZ / ndc.z);
  out.x = 0.06 + (out.x - 0.06) * 0.82;
  out.y = -0.06 + (out.y + 0.06) * 0.72;
  return out;
}

function cursorToCameraSpace(out) {
  ndc.set(mouse.x * 2 - 1, -(mouse.y * 2 - 1), 0.5);
  ndc.applyMatrix4(camera.projectionMatrixInverse);
  ndc.normalize();
  const t = drawPlaneZ / ndc.z;
  return out.copy(ndc).multiplyScalar(t);
}

const camQ = new THREE.Quaternion();
const toWorldDir = (v) => v.applyQuaternion(camera.getWorldQuaternion(camQ));
const rightWrist = new THREE.Vector3(0.1, -0.2, -0.35);
const leftWrist = new THREE.Vector3(-0.2, -0.2, -0.4);
const rightQ = new THREE.Quaternion();
let rightQInit = false;
window.__tune = { leftGrip: [-0.172, -0.095, -0.012], leftF: [0.35, 1, -0.25], leftP: [1, -0.15, 0.2], leftFingers: 'grip', rightF: [-0.25, 0.55, -0.8], rightP: [0, -0.4, -1], bookPos: [-0.125, -0.105, -0.44], bookRot: [-0.78, 0.38, 0.08] };

function updateArms(dt) {
  arms.update(dt);
  const T = window.__tune;

  // ----- brazo izquierdo: sujeta el canto del libro -----
  const grip = book.group.localToWorld(new THREE.Vector3(...T.leftGrip));
  const bq = book.group.getWorldQuaternion(new THREE.Quaternion());
  const lF = new THREE.Vector3(...T.leftF).applyQuaternion(bq);
  const lP = new THREE.Vector3(...T.leftP).applyQuaternion(bq);
  const lq = handQuat('L', lF, lP);
  const poleL = camera.localToWorld(new THREE.Vector3(-0.6, -0.9, 0.0));
  // la palma (no la muñeca) debe quedar en el punto de agarre
  // al pasar página el pulgar se levanta un poco de la hoja
  const leftSpec = window.__handSpecL || (book.flip ? HAND_SPECS.gripLift : HAND_SPECS[T.leftFingers]);
  arms.driveFingers('L', leftSpec, dt, 8, time, 0.5);
  for (let it = 0; it < 2; it++) {
    arms.reach('L', leftWrist, lq, poleL);
    const palm = arms.side.L.palm.getWorldPosition(new THREE.Vector3());
    const wr = arms.side.L.hand.getWorldPosition(new THREE.Vector3());
    leftWrist.copy(grip).sub(palm.sub(wr));
  }
  arms.reach('L', leftWrist, lq, poleL);

  // ----- brazo derecho: la punta del índice sigue al cursor -----
  cursorToCameraSpace(rightTarget);
  // si el jugador no mueve el ratón un rato, la mano baja a descansar
  const resting = !mouse.down && !spell && mouse.idle > 4;
  restBlend += ((resting ? 1 : 0) - restBlend) * (1 - Math.exp(-dt * (resting ? 0.9 : 6)));
  if (restBlend > 0.001) rightTarget.lerp(REST_TIP, restBlend);
  // la mano recorre una zona algo menor que la pantalla: así no tapa la vista al subir
  rightTarget.x = 0.06 + (rightTarget.x - 0.06) * 0.82;
  rightTarget.y = -0.06 + (rightTarget.y + 0.06) * 0.72;
  // si el libro está delante del punto de trazado, el dedo se queda justo delante del papel
  pageUnder(mouse.x * innerWidth, mouse.y * innerHeight);
  if (hoverHit) {
    const p = camera.worldToLocal(hoverHit.clone());
    const d = p.length() - 0.035;
    if (d < rightTarget.length()) rightTarget.copy(p.multiplyScalar(d / p.length()));
  }
  rightTarget.x = Math.max(rightTarget.x, -0.02);
  rightTarget.y = THREE.MathUtils.clamp(rightTarget.y, -0.22, 0.09);
  const k = 1 - Math.exp(-dt * (mouse.down ? 26 : 11));
  rightCur.lerp(rightTarget, k);
  const tipW = camera.localToWorld(rightCur.clone());

  let F = new THREE.Vector3(...T.rightF), P = new THREE.Vector3(...T.rightP);
  if (spell && spell.id === 'ignis' && spell.t < 7) { F.set(-0.3, 0.15, -1); P.set(0.15, 1, 0.1); }
  else if (spell && spell.id === 'fulgur' && spell.t < 2.6) { F.set(-0.05, 0.6, -1); P.set(0, -0.3, -1); }
  else if (spell && spell.id === 'ventus' && spell.t < 4) { F.set(-0.4, 0.2, -1); P.set(-1, 0.1, -0.2); }
  // giro anatómico: si la palma tiene que darse la vuelta (p. ej. de mirar abajo a mirar arriba),
  // pasa por la posición neutra «de saludo» (pulgar arriba, palma hacia dentro) en vez de
  // torcer la muñeca por el lado imposible
  {
    const sd = arms.side.R;
    const wp = (b) => camera.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
    const h = wp(sd.hand);
    const fC = wp(sd.fingers.f_middle[0].bone).sub(h);
    const lC = wp(sd.fingers.f_index[0].bone).sub(wp(sd.fingers.f_pinky[0].bone));
    const palmNow = new THREE.Vector3().crossVectors(fC, lC).normalize().negate();
    const Pn = P.clone().normalize();
    if (rightQInit && palmNow.dot(Pn) < -0.15) P = new THREE.Vector3(-1, 0.05, 0).lerp(Pn, 0.15);
  }
  const q = handQuat('R', toWorldDir(F), toWorldDir(P));
  if (!rightQInit) { rightQ.copy(q); rightQInit = true; }
  rightQ.slerp(q, 1 - Math.exp(-dt * 9));

  let specName = mouse.down ? 'draw' : restBlend > 0.6 ? 'relaxed' : 'point';
  if (spell && spell.id === 'ignis' && spell.t < 7) specName = 'cup';
  else if (spell && spell.id === 'fulgur' && spell.t < 2.6) specName = 'open';
  else if (spell && spell.id === 'ventus' && spell.t < 4) specName = 'open';
  else if (spell && spell.t < 0.7) specName = 'open';
  arms.driveFingers('R', window.__handSpec || HAND_SPECS[specName], dt, 12, time, mouse.down ? 0.2 : 1);
  const poleR = camera.localToWorld(new THREE.Vector3(0.7, -0.9, 0.1));
  for (let it = 0; it < 2; it++) {
    arms.reach('R', rightWrist, rightQ, poleR);
    const tip = arms.side.R.tip.getWorldPosition(new THREE.Vector3());
    const wr = arms.side.R.hand.getWorldPosition(new THREE.Vector3());
    rightWrist.copy(tipW).sub(tip.sub(wr));
  }
  arms.reach('R', rightWrist, rightQ, poleR);
}

function updateSpell(dt) {
  particles.update(dt);
  candles.update(dt, camera, particles);
  for (const d of dust) {
    if (d.life <= 0) { d.mesh.visible = false; continue; }
    if (d.delay > 0) { d.delay -= dt; continue; }
    d.life -= dt;
    const k = 1 - d.life / d.maxLife;
    d.mesh.visible = true;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.scale.setScalar(0.6 + k * 1.4);
    d.mat.uniforms.opacity.value = Math.sin(Math.min(1, k) * Math.PI) * 0.45;
    d.mat.uniforms.tint.value.setRGB(0.85, 0.78, 0.68);
    d.update(dt, camera);
  }
  if (hidden.mesh) {
    const lit = orb.visible && spell && spell.id === 'lumen' ? THREE.MathUtils.clamp(orb.scale.x, 0, 1) : 0;
    hidden.shown += (lit - hidden.shown) * (1 - Math.exp(-dt * (lit ? 0.8 : 2)));
    const g = hidden.shown * (0.85 + Math.sin(time * 2.3) * 0.08);
    hidden.mesh.material.color.setRGB(0.75 * g, 0.5 * g, 0.22 * g);
    hidden.mesh.visible = hidden.shown > 0.005;
    if (!hidden.found && hidden.shown > 0.5) {
      // la página final se desplaza: la lección oculta ocupa su sitio
      const onFinal = pageAt(lessonIdx).final;
      hidden.found = true;
      saveProgress();
      if (onFinal) lessonIdx = visibleLessons();
      toast('Una runa oculta brilla en el muro');
      hint('El grimorio ha ganado una página: busca la lección oculta al final del libro.');
      sound.play('seal', { vol: 0.4, pan: -0.6, send: 1, rate: 0.8 });
      lessonHud();
    }
  }
  if (candleEvent) {
    const ce = candleEvent;
    ce.t += dt;
    if (ce.kind === 'light' && ce.t > 1.2 && ce.t < 2.2) {
      // una chispa salta de la palma a las mechas describiendo un arco
      const k = (ce.t - 1.2) / 1.0;
      const from = arms.side.R.palm.getWorldPosition(new THREE.Vector3());
      const to = candles.center();
      const p = from.clone().lerp(to, k);
      p.y += Math.sin(k * Math.PI) * 0.25;
      for (let i = 0; i < 3; i++) particles.emit(p, tmpV.randomDirection().multiplyScalar(0.03), [3, 1.4, 0.35], 0.02, 0.4, { drag: 2 });
    }
    if (ce.kind === 'light' && ce.t > 2.2 && !ce.done) {
      ce.done = true;
      if (candles.target === 0) toast('Las velas se encienden');
      candles.ignite();
      sound.play('ignite', { vol: 0.5, pan: 0.5, send: 0.9, rate: 1.1 });
    }
    if (ce.kind === 'blow' && ce.t > 0.6 && !ce.done) {
      ce.done = true;
      if (candles.target > 0) { toast('El viento apaga las velas'); candles.blowOut(); sound.play('gust', { vol: 0.4, pan: 0.5, send: 1, rate: 0.8 }); }
    }
    if (ce.t > 3) candleEvent = null;
  }
  for (const sm of smokes) {
    if (sm.life <= 0) { sm.mesh.visible = false; continue; }
    sm.life -= dt;
    const k = 1 - sm.life / sm.maxLife;
    sm.mesh.visible = true;
    sm.mesh.position.addScaledVector(sm.vel, dt);
    sm.mesh.scale.setScalar(0.6 + k * 1.6);
    sm.mat.uniforms.opacity.value = Math.sin(Math.min(1, k) * Math.PI) * sm.peak;
    sm.mat.uniforms.tint.value.setRGB(...sm.tint);
    sm.update(dt, camera);
  }
  right.tip.getWorldPosition(tipWorld);

  // demostración: si el jugador no se atreve a trazar, una estela fantasma dibuja la runa en el aire
  const cur = pageAt(lessonIdx);
  ghost.wait += dt;
  if (!started || mouse.down || spell || cur.final || mastered[lessonIdx] || book.flip) ghost.wait = 0;
  if (ghost.wait > 7) {
    const T = 3.2, k = ((ghost.wait - 7) % (T + 1.2)) / T;
    if (k <= 1) {
      const st = cur.stroke;
      const f = k * (st.length - 1), i = Math.floor(f), fr = f - i;
      const a = st[i], b = st[Math.min(i + 1, st.length - 1)];
      const u = a[0] + (b[0] - a[0]) * fr, v = a[1] + (b[1] - a[1]) * fr;
      const p = camera.localToWorld(screenToHandSpace(0.6 + u * 0.22, 0.2 + v * 0.42, new THREE.Vector3()));
      const c = cur.color;
      particles.emit(p, tmpV.set(0, 0, 0), [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], 0.014, 1.2, { drag: 4 });
      if (k < 0.03) particles.emit(p, tmpV.set(0, 0, 0), [1.2, 0.25, 0.15], 0.03, 0.6, { drag: 4 });
    }
    if (!ghost.told) { ghost.told = true; hint(`Mira la estela: así se traza la runa. Repítela ${TOUCH ? 'sin levantar el dedo' : 'manteniendo pulsado el botón'}.`); }
  }

  // estela al trazar
  if (mouse.down) {
    const c = pageAt(lessonIdx).color || [1, 0.85, 0.6];
    // rellenar el hueco entre fotogramas para que la estela sea continua
    const from = lastTip.lengthSq() ? lastTip : tipWorld;
    const steps = Math.min(24, Math.max(1, Math.ceil(from.distanceTo(tipWorld) / 0.003)));
    const p = new THREE.Vector3();
    for (let k = 1; k <= steps; k++) {
      p.lerpVectors(from, tipWorld, k / steps);
      particles.emit(p, tmpV.randomDirection().multiplyScalar(0.005), [c[0] * 2.2, c[1] * 2.2, c[2] * 2.2], 0.02, 1.6 + Math.random() * 0.4, { drag: 4 });
      particles.emit(p, tmpV.set(0, 0, 0), [2.6, 2.3, 1.8], 0.01, 1.2, { drag: 8 });
    }
    const speed = from.distanceTo(tipWorld) / Math.max(dt, 1e-3);
    if (traceLoop) { traceLoop.set(Math.min(0.9, speed * 1.1), 0.05); traceLoop.rate(0.8 + Math.min(0.6, speed * 0.6)); }
    lastTip.copy(tipWorld);
  } else { lastTip.set(0, 0, 0); traceLoop?.set(0, 0.12); }

  if (!spell) { spellLight.intensity *= Math.exp(-dt * 4); return; }
  spell.t += dt;
  const t = spell.t;
  const c = spell.color;

  if (spell.id === 'lumen') {
    const home = tmpV.set(0.02, 0.07, -0.62);
    camera.localToWorld(home);
    orb.position.lerp(home, 1 - Math.exp(-dt * 2.5));
    orb.position.y += Math.sin(t * 2) * 0.0004;
    const fade = THREE.MathUtils.clamp((30 - t) / 3, 0, 1);
    spellLight.position.copy(orb.position);
    spellLight.intensity = (0.09 + Math.sin(t * 9) * 0.004) * fade * Math.min(1, t * 2);
    orb.scale.setScalar(fade);
    wisp.mesh.visible = orb.visible;
    wisp.mesh.position.copy(orb.position);
    wisp.mesh.scale.setScalar(fade * (1 + Math.sin(t * 5) * 0.05));
    wisp.mat.uniforms.opacity.value = 0.9 * fade;
    wisp.mat.uniforms.tint.value.setRGB(1.0, 1.05, 1.2);
    wisp.update(dt, camera);
    if (Math.random() < 0.6 * fade) particles.emit(orb.position, tmpV.randomDirection().multiplyScalar(0.01), [c[0] * 1.6, c[1] * 1.6, c[2] * 1.4], 0.05, 0.8, { drag: 1 });
    if (fade <= 0) { orb.visible = false; wisp.mesh.visible = false; spell = null; }
  } else if (spell.id === 'ignis') {
    // centro de la palma: entre la base del metacarpo y los nudillos
    const palm = right.palmBone.getWorldPosition(new THREE.Vector3())
      .lerp(arms.side.R.fingers.f_middle[0].bone.getWorldPosition(new THREE.Vector3()), 0.55)
      .lerp(arms.side.R.fingers.f_ring[0].bone.getWorldPosition(new THREE.Vector3()), 0.2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    palm.addScaledVector(up, 0.02);
    const live = t < 7;
    // la llama crece al encenderse y se apaga al final
    const grow = Math.min(1, t * 2.5) * (live ? 1 : Math.max(0, 1 - (t - 7) * 2));
    flames.forEach((f, i) => {
      f.mesh.visible = grow > 0.01;
      f.mesh.position.copy(palm).addScaledVector(up, -0.012 + i * 0.004);
      f.mesh.scale.setScalar(grow * (1 + Math.sin(t * (7 + i * 3)) * 0.04));
      f.mat.uniforms.opacity.value = (i ? 0.8 : 1.4) * grow;
      f.mat.uniforms.tint.value.setRGB(1.6, 1.0, 0.75);
      f.update(dt, camera);
    });
    if (live) {
      // ascuas que saltan
      if (Math.random() < 0.15) particles.emit(palm.clone().addScaledVector(up, 0.04), up.clone().multiplyScalar(0.08).add(tmpV.randomDirection().multiplyScalar(0.04)), [3, 1.5, 0.4], 0.005, 0.6 + Math.random() * 0.6, { drag: 0.6, rise: 0.04 });
      // brillo en la base de la llama
      particles.emit(palm.clone().add(tmpV.randomDirection().multiplyScalar(0.005)), tmpV.set(0, 0, 0), [0.22, 0.09, 0.02], 0.035, 0.12, { drag: 0 });
      smokeTimer -= dt;
      if (smokeTimer <= 0 && t > 0.6) {
        smokeTimer = 0.35;
        const sm = smokes.find((x) => x.life <= 0);
        if (sm) { sm.life = sm.maxLife = 2.6; sm.tint = [0.55, 0.45, 0.38]; sm.peak = 0.22; sm.mesh.position.copy(palm).addScaledVector(up, 0.11); sm.vel.copy(up).multiplyScalar(0.05).add(tmpV.randomDirection().multiplyScalar(0.01)); }
      }
    }
    spellLight.position.copy(palm).addScaledVector(up, 0.07);
    const flick = 0.75 + Math.sin(t * 23) * 0.1 + Math.sin(t * 37.3) * 0.08 + Math.random() * 0.12;
    spellLight.intensity = live ? 0.028 * flick * Math.min(1, t * 3) : spellLight.intensity * Math.exp(-dt * 5);
    if (t > 7 && fireLoop) { fireLoop.stop(0.8); fireLoop = null; }
    if (t > 8.5) { spell = null; flames.forEach((f) => (f.mesh.visible = false)); }
  } else if (spell.id === 'fulgur') {
    const live = t < 2.4;
    if (live) {
      if (Math.random() < 0.5) {
        const far = tmpV.set((Math.random() - 0.15) * 1.5, (Math.random() - 0.1) * 0.9, -4 - Math.random() * 3);
        camera.localToWorld(far);
        const bolt = lightning.strike(tipWorld.clone(), far.clone(), 0.11);
        // halo luminoso a lo largo del rayo (las líneas WebGL miden 1 px)
        for (let i = 0; i < bolt.length; i++) {
          const near = 1 - i / bolt.length;
          particles.emit(bolt[i], tmpV.set(0, 0, 0), [0.5 * near + 0.2, 0.65 * near + 0.25, 1.2 * near + 0.4], 0.02 + 0.09 * (i / bolt.length), 0.09, { drag: 0 });
        }
        spellLight.intensity = 0.4 + Math.random() * 0.4;
        for (let i = 0; i < 8; i++) particles.emit(tipWorld, tmpV.randomDirection().multiplyScalar(0.3 + Math.random() * 0.5), [2, 2.6, 4], 0.012, 0.25 + Math.random() * 0.3, { drag: 2, rise: -0.4 });
      } else {
        spellLight.intensity *= 0.6;
        if (Math.random() < 0.4) lightning.hide();
      }
      spellLight.position.copy(tipWorld);
    } else {
      lightning.hide();
      spellLight.intensity *= Math.exp(-dt * 8);
      if (t > 3) spell = null;
    }
  } else if (spell.id === 'vinculum') {
    // el sello: la runa del muro aparece girando delante de la palma
    const live = t < 4.5;
    if (!sigil && hidden.mesh) {
      sigil = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), hidden.mesh.material.clone());
      sigil.material.blending = THREE.AdditiveBlending;
      scene.add(sigil);
    }
    if (sigil) {
      const palmP = arms.side.R.palm.getWorldPosition(new THREE.Vector3());
      const fwd = toWorldDir(new THREE.Vector3(0, 0.15, -1));
      sigil.visible = true;
      sigil.position.copy(palmP).addScaledVector(fwd, 0.12 + Math.min(1, t) * 0.05);
      sigil.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
      sigil.rotateZ(-t * 1.6);
      const a = Math.min(1, t * 2) * (live ? 1 : Math.max(0, 1 - (t - 4.5) * 2));
      sigil.scale.setScalar(0.4 + Math.min(1, t * 1.5) * 0.8 + Math.sin(t * 6) * 0.03);
      sigil.material.color.setRGB(1.6 * a, 1.1 * a, 1.9 * a);
      spellLight.position.copy(sigil.position);
      spellLight.intensity = 0.05 * a;
      if (live && Math.random() < 0.5) particles.emit(sigil.position.clone().add(tmpV.randomDirection().multiplyScalar(0.05)), tmpV.randomDirection().multiplyScalar(0.02), [1.2, 0.9, 1.5], 0.01, 0.8, { drag: 1 });
      if (!live && a <= 0) { sigil.visible = false; spell = null; }
    }
    // la runa del muro responde
    if (hidden.mesh) hidden.shown = Math.max(hidden.shown, live ? 0.8 : 0);
  } else if (spell.id === 'ventus') {
    const live = t < 4;
    const center = camera.localToWorld(new THREE.Vector3(0.1, -0.02, -0.5));
    if (live) {
      // ráfagas de polvo arrastradas por el viento
      smokeTimer -= dt;
      if (smokeTimer <= 0) {
        smokeTimer = 0.22;
        const sm = smokes.find((x) => x.life <= 0);
        if (sm) {
          sm.life = sm.maxLife = 1.8; sm.tint = [0.75, 0.8, 0.78]; sm.peak = 0.2;
          sm.mesh.position.copy(arms.side.R.palm.getWorldPosition(new THREE.Vector3()));
          sm.vel.copy(toWorldDir(new THREE.Vector3((Math.random() - 0.6) * 0.5, 0.15 + Math.random() * 0.2, -1))).multiplyScalar(0.55);
        }
      }
      // remolino: motas finas que giran alrededor de un eje que avanza hacia delante
      const fwd = toWorldDir(new THREE.Vector3(0, 0, -1));
      const upv = toWorldDir(new THREE.Vector3(0, 1, 0));
      const side = new THREE.Vector3().crossVectors(fwd, upv);
      for (let i = 0; i < 5; i++) {
        const a = time * 9 + Math.random() * 0.6 + i * 1.256;
        const r = 0.03 + t * 0.025;
        const along = Math.random() * 0.15;
        const p = center.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).addScaledVector(fwd, along);
        const v = side.clone().multiplyScalar(-Math.sin(a) * 0.5).addScaledVector(upv, Math.cos(a) * 0.5).addScaledVector(fwd, 0.6);
        particles.emit(p, v, [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45], 0.006 + Math.random() * 0.006, 0.6 + Math.random() * 0.5, { drag: 0.4 });
      }
    }
    spellLight.position.copy(center);
    spellLight.intensity = live ? 0.12 : spellLight.intensity * Math.exp(-dt * 4);
    if (t > 5.5) spell = null;
  }
}

let started = false;
const ghost = { wait: 0, told: false };
const perf = { t: 0, n: 0 };
function frame() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  mouse.idle = (mouse.idle || 0) + dt;
  // si va lento, se baja la resolución interna (nunca por debajo de 1)
  if (started) {
    perf.t += clock.getDelta(); perf.n++;
    if (perf.t > 2.5) {
      const fps = perf.n / perf.t;
      if (fps < 42 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); composer.setPixelRatio(pixelRatio); resize(); }
      perf.t = 0; perf.n = 0;
    }
  }
  time += dt;

  // cabeza: ligero giro siguiendo al ratón y respiración
  const walkSpeed = started ? updatePlayer(dt) : 0;
  lookTarget.y = player.yaw - (mouse.x - 0.5) * 0.18;
  lookTarget.x = player.pitch - (mouse.y - 0.5) * 0.1 + Math.sin(time * 0.8) * 0.004;
  camera.rotation.order = 'YXZ';
  const lk = 1 - Math.exp(-dt * (looking ? 14 : 2));
  camera.rotation.y += (lookTarget.y - camera.rotation.y) * lk;
  camera.rotation.x += (lookTarget.x - camera.rotation.x) * lk;
  // balanceo de la cabeza al andar
  const bob = Math.min(1, walkSpeed / 1.1);
  camera.position.set(player.pos.x + Math.cos(player.phase * 0.5) * 0.008 * bob, Math.abs(Math.sin(player.phase)) * -0.014 * bob, player.pos.z);
  // el libro se mece un poco
  const TB = window.__tune;
  // en pantallas estrechas el libro se centra y se aleja un poco para caber entero
  const narrow = THREE.MathUtils.clamp((1.5 - camera.aspect) / 1.0, 0, 1);
  bookRig.position.set(TB.bookPos[0] * (1 - 0.55 * narrow), TB.bookPos[1] - 0.03 * narrow + Math.sin(time * 1.3 + 0.6) * 0.0018, TB.bookPos[2] - 0.14 * narrow);
  bookRig.rotation.set(TB.bookRot[0], TB.bookRot[1], TB.bookRot[2] + Math.sin(time * 0.9) * 0.006, 'YXZ');

  camera.updateMatrixWorld(true);
  updateArms(dt);
  book.update(dt);
  updateSpell(dt);

  // shake al lanzar el rayo
  if (spell && spell.id === 'fulgur' && spell.t < 2.4) {
    camera.position.x += (Math.random() - 0.5) * 0.002;
    camera.position.y += (Math.random() - 0.5) * 0.002;
  }

  if (debugView) {
    const V = {
      side: [[-0.65, -0.05, -0.3], book.group], back: [[-0.25, 0.1, -0.85], book.group], below: [[-0.2, -0.55, -0.35], book.group],
      rhand: [[-0.05, 0.05, -0.62], arms.side.R.palm], rhand2: [[0.35, -0.02, -0.5], arms.side.R.palm], rhand3: [[0.12, -0.28, -0.4], arms.side.R.palm],
      lhand: [[-0.45, -0.25, -0.3], arms.side.L.palm], lhand2: [[-0.22, -0.12, -0.75], arms.side.L.palm],
    }[debugView] || [[-0.65, -0.05, -0.3], book.group];
    debugCam.position.copy(camera.localToWorld(new THREE.Vector3(...V[0])));
    debugCam.lookAt(V[1].getWorldPosition(new THREE.Vector3()));
    debugCam.fov = /hand/.test(debugView) ? 30 : 45;
    debugCam.aspect = camera.aspect; debugCam.updateProjectionMatrix();
  }
  grade.uniforms.uTime.value = time;
  composer.render(dt);
  requestAnimationFrame(frame);
}

// ---------------- arranque ----------------
$('creditsBody').innerHTML = CREDITS;
if (mastered.some(Boolean)) {
  const n = mastered.filter(Boolean).length;
  $('go').textContent = 'Continuar';
  $('reset').classList.remove('hidden');
  $('reset').onclick = () => { try { localStorage.removeItem(SAVE_KEY); } catch {} location.reload(); };
  hint(`Llevas ${n} ${n === 1 ? 'runa dominada' : 'runas dominadas'}. Pasa las páginas para seguir donde lo dejaste.`);
}
if (TOUCH) {
  const ps = document.querySelectorAll('#start p');
  ps[0].textContent = 'Sostienes un libro de hechizos. Lee la página y traza la runa en el aire con el dedo, sin levantarlo de la pantalla.';
  ps[1].innerHTML = 'Toca el borde de una página para pasarla';
}
lessonHud();
if (!mastered.some(Boolean)) hint(`Lee la página y traza la runa ${WITH}.`);
$('loading').classList.add('gone');
// la portada aparece cuando la pantalla de carga ya se ha ido, sin solaparse
setTimeout(() => { if (started) return; $('start').classList.remove('hidden'); requestAnimationFrame(() => $('start').classList.add('shown')); }, 750);
$('go').onclick = async () => {
  $('start').classList.add('hidden');
  started = true;
  try {
    await sound.init();
    sound.loop('amb_drips', { vol: 0.5, send: 0.2 })?.set(0.55, 1.5);
    sound.loop('amb_drone', { vol: 0, send: 0.1 })?.set(0.16, 3);
    traceLoop = sound.loop('trace_air', { vol: 0, pan: 0.3, send: 0.5 });
    sound.play('book_open', { vol: 0.9, pan: -0.4, send: 0.4 });
  } catch (e) { console.warn('Sin audio:', e); }
};
frame();

window.__game = { scene, camera, book, arms, bookRig, turnPage, cast: (i) => cast(LESSONS[i]), LESSONS };
window.__dbg = { mouse, rightCur, rightTarget, rightWrist, leftWrist };
window.__sound = sound;
window.__candles = candles;
