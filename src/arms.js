import * as THREE from 'three';

// Brazos en primera persona: «Fists (2025) | First Person Animations» de 1Matzh
// (CC-BY). Rig Rigify: la malla se deforma con los huesos DEF-*. Se reproduce la
// animación Idle para dar vida (respiración, hombros) y encima se resuelve por
// código la IK de cada brazo y la postura de los dedos.

const FINGERS = ['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'];

function finder(root) {
  const map = new Map();
  root.traverse((o) => map.set(o.name, o));
  return (prefix) => {
    for (const [n, o] of map) if (n === prefix || n.startsWith(prefix + '_')) return o;
    throw new Error('Hueso no encontrado: ' + prefix);
  };
}

export async function skinFromGltf(gltf) {
  // el material original (spec-gloss) se convirtió a metal-rough con gltf-transform;
  // tomamos sus texturas y montamos una piel propia
  let src;
  gltf.scene.traverse((o) => { if (o.isMesh && !/Background/.test(o.name)) src = src || o.material; });
  const map = src.map, normal = src.normalMap;
  const spec = src.specularIntensityMap || src.specularColorMap || null;
  map.colorSpace = THREE.SRGBColorSpace;
  if (spec) spec.colorSpace = THREE.NoColorSpace;
  normal.colorSpace = THREE.NoColorSpace;
  const m = new THREE.MeshPhysicalMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 0.5,
    specularIntensity: 0.6,
    specularIntensityMap: spec || null,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0.8, 0.45, 0.38),
    side: THREE.DoubleSide,
  });
  // dispersión subsuperficial aproximada: luz envolvente rojiza en el terminador
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
       {
         vec3 sss = vec3(0.0);
         #if NUM_DIR_LIGHTS > 0
           for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
             float nl = dot(normal, directionalLights[i].direction);
             float w = max(0.0, (nl + 0.6) / 1.6) - max(0.0, nl);
             sss += directionalLights[i].color * w;
           }
         #endif
         #if NUM_POINT_LIGHTS > 0
           for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
             vec3 L = pointLights[i].position - geometryPosition;
             float d = length(L);
             float nl = dot(normal, L / d);
             float w = max(0.0, (nl + 0.6) / 1.6) - max(0.0, nl);
             sss += pointLights[i].color * w * getDistanceAttenuation(d, pointLights[i].distance, pointLights[i].decay);
           }
         #endif
         reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.9, 0.22, 0.12) * sss * 0.35;
       }`
    );
  };
  return m;
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function worldQuat(o, out) { return o.getWorldQuaternion(out); }

/** Aplica una rotación en espacio mundo a un hueso. */
function rotateWorld(bone, rot) {
  const qw = worldQuat(bone, _q1);
  const qp = worldQuat(bone.parent, _q2).invert();
  bone.quaternion.copy(qp.multiply(rot.clone().multiply(qw)));
  bone.updateMatrixWorld(true);
}

/** Orienta un hueso para que su rotación mundial sea q. */
function setWorldQuat(bone, q) {
  const qp = worldQuat(bone.parent, _q2).invert();
  bone.quaternion.copy(qp.multiply(q));
  bone.updateMatrixWorld(true);
}

function angleBetween(a, b) { return a.angleTo(b); }

/** IK analítica de dos huesos con vector polar para el codo. */
function solveTwoBone(upper, lower, end, target, pole) {
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  const c = end.getWorldPosition(new THREE.Vector3());
  const lab = a.distanceTo(b), lcb = b.distanceTo(c);
  const lat = THREE.MathUtils.clamp(a.distanceTo(target), 0.05, lab + lcb - 0.002);

  const ac = c.clone().sub(a), ab = b.clone().sub(a), ba = a.clone().sub(b), bc = c.clone().sub(b);
  const acab0 = angleBetween(ac, ab), babc0 = angleBetween(ba, bc);
  const acab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const babc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  let axis = new THREE.Vector3().crossVectors(ac, ab);
  if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0);
  axis.normalize();
  rotateWorld(upper, new THREE.Quaternion().setFromAxisAngle(axis, acab1 - acab0));
  rotateWorld(lower, new THREE.Quaternion().setFromAxisAngle(axis, babc1 - babc0));

  // alinear muñeca con el objetivo
  const c2 = end.getWorldPosition(new THREE.Vector3());
  rotateWorld(upper, new THREE.Quaternion().setFromUnitVectors(c2.sub(a).normalize(), target.clone().sub(a).normalize()));

  // girar el plano del brazo alrededor del eje hombro-objetivo para llevar el codo hacia el polo
  if (pole) {
    const ax = target.clone().sub(a).normalize();
    const e = lower.getWorldPosition(new THREE.Vector3()).sub(a);
    const p = pole.clone().sub(a);
    e.sub(ax.clone().multiplyScalar(e.dot(ax)));
    p.sub(ax.clone().multiplyScalar(p.dot(ax)));
    if (e.lengthSq() > 1e-8 && p.lengthSq() > 1e-8) {
      const ang = Math.atan2(new THREE.Vector3().crossVectors(e, p).dot(ax), e.dot(p));
      rotateWorld(upper, new THREE.Quaternion().setFromAxisAngle(ax, ang));
    }
  }
}

export class Arms {
  constructor(gltf, material) {
    this.root = new THREE.Group();
    const scene = gltf.scene;
    scene.traverse((o) => {
      if (o.isMesh) {
        if (/Background/.test(o.name)) { o.visible = false; return; }
        o.material = material;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    const find = finder(scene);
    // la cámara del modelo está en los ojos y mira hacia +Z
    scene.updateMatrixWorld(true);
    const eyes = find('MCH-eyes_parent').getWorldPosition(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.PI;
    pivot.add(scene);
    scene.position.copy(eyes).negate();
    this.root.add(pivot);

    this.mixer = new THREE.AnimationMixer(scene);
    const idle = gltf.animations.find((a) => /\|Idle$/.test(a.name));
    // solo usamos la animación en tronco/hombros: quitamos pistas de brazos y dedos
    const keep = idle.clone();
    keep.tracks = keep.tracks.filter((t) => !/(arm|hand|f_|thumb|palm|forearm)/i.test(t.name));
    this.mixer.clipAction(keep).play();

    this.side = {};
    for (const s of ['L', 'R']) {
      const fingers = {};
      for (const f of FINGERS) {
        fingers[f] = [1, 2, 3].map((n) => {
          const b = find(`DEF-${f}0${n}${s}`);
          return { bone: b, rest: b.quaternion.clone() };
        });
      }
      this.side[s] = {
        upper: find(`DEF-upper_arm${s}`),
        upperTwist: find(`DEF-upper_arm${s}001`),
        lower: find(`DEF-forearm${s}`),
        lowerTwist: find(`DEF-forearm${s}001`),
        hand: find(`DEF-hand${s}`),
        tip: find(`DEF-f_index03${s}_end`),
        palm: find(`DEF-palm02${s}`),
        fingers,
      };
      const sd = this.side[s];
      // ejes de flexión por falange, calculados en reposo: perpendiculares al hueso
      // y a la normal de la palma, para que un ángulo positivo cierre hacia la palma
      const wp = (o) => o.getWorldPosition(new THREE.Vector3());
      const hp = wp(sd.hand);
      const F = wp(fingers.f_middle[0].bone).sub(hp);
      const Lt = wp(fingers.f_index[0].bone).sub(wp(fingers.f_pinky[0].bone));
      const palmN = new THREE.Vector3().crossVectors(F, Lt).normalize();
      if (s === 'R') palmN.negate();
      sd.palmNormalWorldRest = palmN.clone();
      for (const f of FINGERS) {
        for (const j of fingers[f]) {
          const child = j.bone.children.find((c) => c.isBone) || j.bone.children[0];
          const d = wp(child).sub(wp(j.bone));
          const axisW = new THREE.Vector3().crossVectors(d, palmN).normalize();
          const qi = j.bone.getWorldQuaternion(new THREE.Quaternion()).invert();
          j.curlAxis = axisW.applyQuaternion(qi);
        }
      }
      sd.rest = {};
      for (const k of ['upper', 'upperTwist', 'lower', 'lowerTwist', 'hand']) sd.rest[k] = sd[k].quaternion.clone();
    }
    this.scene = scene;
    this.clips = gltf.animations;
    this.palms = {};
    for (const s of ['L', 'R']) this.palms[s] = [1, 2, 3, 4].map((n) => { const b = find(`DEF-palm0${n}${s}`); return { bone: b, rest: b.quaternion.clone() }; });
    this.library = {};
  }

  resetArm(s) {
    const sd = this.side[s];
    for (const k of ['upper', 'upperTwist', 'lower', 'lowerTwist', 'hand']) sd[k].quaternion.copy(sd.rest[k]);
    sd.upper.updateMatrixWorld(true);
  }

  /**
   * Coloca la muñeca en `target` (mundo) con orientación de mano `handQuat` (mundo).
   * pole: punto hacia el que apunta el codo.
   */
  reach(s, target, handQuat, pole) {
    const sd = this.side[s];
    this.resetArm(s);
    solveTwoBone(sd.upper, sd.lower, sd.hand, target, pole);
    // repartir la torsión del antebrazo: primero la mano, luego parte al hueso de giro
    if (handQuat) {
      setWorldQuat(sd.hand, handQuat);
      const local = sd.hand.quaternion.clone();
      // torsión alrededor del eje Y del hueso (a lo largo del antebrazo)
      const twist = new THREE.Quaternion(0, local.y, 0, local.w).normalize();
      const half = new THREE.Quaternion().slerp(twist, 0.5);
      sd.lowerTwist.quaternion.multiply(half);
      sd.lowerTwist.updateMatrixWorld(true);
      setWorldQuat(sd.hand, handQuat);
    }
  }

  /** Captura la postura de dedos y palma de un clip del artista en el instante t. */
  capture(key, clipName, t) {
    const clip = this.clips.find((c) => c.name.endsWith('|' + clipName));
    const mixer = new THREE.AnimationMixer(this.scene);
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(t);
    const pose = {};
    for (const s of ['L', 'R']) {
      const sd = this.side[s];
      pose[s] = { palm: this.palms[s].map((p) => p.bone.quaternion.clone()) };
      for (const f of FINGERS) pose[s][f] = sd.fingers[f].map((j) => j.bone.quaternion.clone());
    }
    action.stop();
    mixer.uncacheRoot(this.scene);
    // restaurar el reposo de todo lo que haya tocado el clip
    for (const s of ['L', 'R']) {
      for (const f of FINGERS) for (const j of this.side[s].fingers[f]) j.bone.quaternion.copy(j.rest);
      for (const p of this.palms[s]) p.bone.quaternion.copy(p.rest);
      this.resetArm(s);
    }
    this.library[key] = pose;
    return pose;
  }

  /**
   * Lleva los dedos de forma suave hacia una postura compuesta,
   * con un leve movimiento vivo para que la mano nunca esté congelada.
   */
  driveFingers(s, spec, dt, speed = 10, time = 0, life = 1) {
    const sd = this.side[s];
    this.cur = this.cur || {};
    const first = !this.cur[s];
    const cur = (this.cur[s] = this.cur[s] || {});
    const get = (k) => this.library[k][s];
    const k = first ? 1 : 1 - Math.exp(-dt * speed);
    const seed = s === 'L' ? 1.7 : 0;
    [...FINGERS, 'palm'].forEach((f, fi) => {
      const [a, b, t = 0] = spec[f] || spec.default;
      const qa = get(a)[f], qb = b ? get(b)[f] : null;
      const bones = f === 'palm' ? this.palms[s] : sd.fingers[f];
      cur[f] = cur[f] || bones.map((j) => j.bone.quaternion.clone());
      bones.forEach((j, i) => {
        _q2.copy(qa[i]);
        if (qb) _q2.slerp(qb[i], t);
        cur[f][i].slerp(_q2, k);
        j.bone.quaternion.copy(cur[f][i]);
        if (f !== 'palm' && life) {
          const n = Math.sin(time * (0.9 + fi * 0.23) + seed + fi * 1.3) * 0.5 + Math.sin(time * 2.1 + fi * 2.7 + seed) * 0.25;
          j.bone.quaternion.multiply(_q1.setFromAxisAngle(j.curlAxis, n * 0.035 * life * (i === 0 ? 1 : 0.6)));
        }
      });
    });
    sd.hand.updateMatrixWorld(true);
  }

  update(dt) {
    this.mixer.update(dt);
    this.scene.updateMatrixWorld(true);
  }
}

// posturas compuestas a partir de las capturadas del propio modelo
// (idle = puño relajado, fist = puño cerrado, open = mano abierta, take = agarre)
export const HAND_SPECS = {
  point: { default: ['fist', 'idle', 0.25], f_index: ['open', 'idle', 0.12], thumb: ['fist', 'idle', 0.3], palm: ['idle'] },
  draw: { default: ['fist'], f_index: ['open', 'idle', 0.05], thumb: ['fist'], palm: ['idle'] },
  relaxed: { default: ['idle', 'open', 0.35] },
  open: { default: ['open'], thumb: ['open', 'idle', 0.2] },
  cup: { default: ['open', 'idle', 0.45], thumb: ['open', 'idle', 0.3] },
  grip: { default: ['open', 'idle', 0.55], thumb: ['open', 'idle', 0.25], palm: ['open', 'idle', 0.5] },
  gripLift: { default: ['open', 'idle', 0.55], thumb: ['open'], palm: ['open', 'idle', 0.5] },
};
