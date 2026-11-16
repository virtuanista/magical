import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// Partículas aditivas con tamaño en píxeles y desvanecimiento suave.
const vert = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
    gl_FragColor = vec4(vColor.rgb * a * vColor.a, 0.0);
  }`;

export class Particles {
  constructor(max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.baseCol = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.rise = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { uScale: { value: 1 } },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  emit(p, v, color, size, life, { drag = 1.5, rise = 0 } = {}) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.baseCol.set(color, i * 3);
    this.baseSize[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.drag[i] = drag; this.rise[i] = rise;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.rise[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const fade = t * t * (3 - 2 * t);
      this.col[i * 4] = this.baseCol[i * 3];
      this.col[i * 4 + 1] = this.baseCol[i * 3 + 1] * (0.6 + 0.4 * t);
      this.col[i * 4 + 2] = this.baseCol[i * 3 + 2] * (0.4 + 0.6 * t);
      this.col[i * 4 + 3] = fade;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

// Rayo: polilínea fractal regenerada cada pocos fotogramas.
export class Lightning {
  constructor(color) {
    this.max = 4;
    this.lines = [];
    this.group = new THREE.Group();
    for (let k = 0; k < this.max; k++) {
      // líneas gruesas en píxeles: núcleo blanco y halos azulados más anchos
      const core = k === 0;
      const m = new LineMaterial({
        color: core ? new THREE.Color(5, 5.5, 7) : new THREE.Color(...color).multiplyScalar(2.5),
        linewidth: core ? 2.2 : 5 + k * 2,
        transparent: true, opacity: core ? 1 : 0.35, depthWrite: false,
        blending: THREE.AdditiveBlending, worldUnits: false,
      });
      const l = new Line2(new LineGeometry(), m);
      l.frustumCulled = false;
      this.group.add(l);
      this.lines.push(l);
    }
    this.group.visible = false;
  }
  _bolt(a, b, chaos) {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a);
    const n1 = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const n2 = dir.clone().cross(n1).normalize();
    const pts = [a.clone(), b.clone()];
    let disp = len * chaos;
    while (pts.length < 65) {
      for (let i = pts.length - 1; i > 0; i--) {
        const m = pts[i].clone().add(pts[i - 1]).multiplyScalar(0.5);
        m.addScaledVector(n1, (Math.random() - 0.5) * disp).addScaledVector(n2, (Math.random() - 0.5) * disp);
        pts.splice(i, 0, m);
      }
      disp *= 0.55;
    }
    return pts;
  }
  _set(l, pts) {
    const arr = [];
    for (const p of pts) arr.push(p.x, p.y, p.z);
    l.geometry.dispose();
    l.geometry = new LineGeometry();
    l.geometry.setPositions(arr);
    l.computeLineDistances();
  }
  strike(a, b, chaos = 0.25) {
    this.group.visible = true;
    const main = this._bolt(a, b, chaos);
    // núcleo y halos siguen el mismo camino; la última línea es una rama
    for (let k = 0; k < this.lines.length - 1; k++) this._set(this.lines[k], main);
    const from = main[16 + Math.floor(Math.random() * 24)];
    const end = from.clone().add(b.clone().sub(a).multiplyScalar(0.25 + Math.random() * 0.2)).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 0));
    this._set(this.lines[this.lines.length - 1], this._bolt(from, end, chaos * 1.3));
    this.lines.forEach((l, k) => { l.material.opacity = (k === 0 ? 0.85 : k === this.lines.length - 1 ? 0.5 : 0.18) + Math.random() * 0.15; });
    return main;
  }
  hide() { this.group.visible = false; }
  setResolution(w, h) { for (const l of this.lines) l.material.resolution.set(w, h); }
}

// Hoja animada (flipbook) orientada a cámara. Texturas de Unity Labs (CC0).
const fbVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const fbFrag = /* glsl */ `
  uniform sampler2D map; uniform vec2 grid; uniform float frame; uniform float opacity; uniform vec3 tint; uniform float additive;
  varying vec2 vUv;
  vec4 cell(float f) {
    float n = grid.x * grid.y;
    f = mod(f, n);
    vec2 c = vec2(mod(f, grid.x), grid.y - 1.0 - floor(f / grid.x));
    return texture2D(map, (c + vUv) / grid);
  }
  void main() {
    float f0 = floor(frame);
    vec4 a = mix(cell(f0), cell(f0 + 1.0), fract(frame));
    // los bordes de cada celda se desvanecen para no ver cortes
    float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
    if (additive > 0.5) gl_FragColor = vec4(a.rgb * tint * opacity * edge, 0.0);
    else gl_FragColor = vec4(a.rgb * tint, a.a * opacity * edge);
  }`;

export class Flipbook {
  constructor(texture, cols, rows, w, h, { additive = true, anchorBottom = true, fps = 30 } = {}) {
    const g = new THREE.PlaneGeometry(w, h);
    if (anchorBottom) g.translate(0, h / 2, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: fbVert, fragmentShader: fbFrag,
      uniforms: {
        map: { value: texture }, grid: { value: new THREE.Vector2(cols, rows) }, frame: { value: Math.random() * cols * rows },
        opacity: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) }, additive: { value: additive ? 1 : 0 },
      },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      ...(additive ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor } : {}),
    });
    // sin mipmaps: evitan que se cuelen las celdas vecinas
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.fps = fps;
  }
  update(dt, camera) {
    this.mat.uniforms.frame.value += dt * this.fps;
    this.mesh.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
  }
}
