import * as THREE from 'three';
import { Flipbook } from './vfx.js';

// Atrezo de la bodega (Poly Haven, CC0): mesa redonda con un candelabro de latón.
// Las velas se encienden con Ignis y se apagan con Ventus.

export class Candles {
  constructor(tableGltf, candleGltf, flameTex, floorY) {
    this.group = new THREE.Group();
    const table = tableGltf.scene;
    table.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    this.group.add(table);
    const tb = new THREE.Box3().setFromObject(table);
    const tableTop = tb.max.y;

    // de los tres candelabros del pack usamos el de tres velas
    const src = candleGltf.scene;
    const holder = src.getObjectByName('brass_candleholder_02') || src.children[1];
    holder.removeFromParent();
    holder.position.set(0, 0, 0);
    holder.rotation.set(0, 0, 0);
    holder.updateMatrixWorld(true);
    const hb = new THREE.Box3().setFromObject(holder);
    holder.position.y = tableTop - hb.min.y;
    holder.position.x = -(hb.min.x + hb.max.x) / 2;
    holder.position.z = -(hb.min.z + hb.max.z) / 2;
    holder.rotation.y = 0.5;
    this.group.add(holder);
    holder.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      if (/flame/i.test(o.name) || /flame/i.test(o.material?.name || '')) this.modelFlame = o;
    });
    this.group.updateMatrixWorld(true);

    // puntas de las velas: los picos más altos de la malla de velas
    this.wicks = [];
    if (this.modelFlame) {
      this.modelFlame.visible = false;
      const pos = this.modelFlame.geometry.attributes.position;
      const pts = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).clone().applyMatrix4(this.modelFlame.matrixWorld));
      // agrupar por cercanía horizontal: cada grupo es una llama
      const groups = [];
      for (const p of pts) {
        let g = groups.find((g) => Math.hypot(g.c.x - p.x, g.c.z - p.z) < 0.02);
        if (!g) { g = { c: p.clone(), min: p.y, n: 1 }; groups.push(g); } else { g.c.x = (g.c.x * g.n + p.x) / (g.n + 1); g.c.z = (g.c.z * g.n + p.z) / (g.n + 1); g.n++; g.min = Math.min(g.min, p.y); }
      }
      for (const g of groups) this.wicks.push(new THREE.Vector3(g.c.x, g.min, g.c.z));
    }
    this.group.position.y = floorY;
    this.floorY = floorY;

    this.flames = this.wicks.map(() => {
      const f = new Flipbook(flameTex, 16, 4, 0.022, 0.05, { additive: true, fps: 26 + Math.random() * 8 });
      f.mesh.visible = false;
      return f;
    });
    this.light = new THREE.PointLight(0xffa860, 0, 6, 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.003;
    this.light.shadow.camera.near = 0.05;
    this.group.add(this.light);
    this.lit = 0; // 0..1
    this.target = 0;
    this.time = 0;
  }

  addTo(scene) {
    scene.add(this.group);
    for (const f of this.flames) scene.add(f.mesh);
  }

  wickWorld(i) { return this.group.localToWorld(this.wicks[i].clone()); }
  center() {
    const c = new THREE.Vector3();
    this.wicks.forEach((w) => c.add(w));
    return this.group.localToWorld(c.multiplyScalar(1 / Math.max(1, this.wicks.length)));
  }

  ignite() { this.target = 1; }
  blowOut() { this.target = 0; }

  update(dt, camera, particles) {
    this.time += dt;
    const was = this.lit;
    this.lit += (this.target - this.lit) * (1 - Math.exp(-dt * (this.target ? 3 : 8)));
    const c = new THREE.Vector3();
    this.wicks.forEach((w, i) => {
      const f = this.flames[i];
      const p = this.group.localToWorld(w.clone());
      c.add(p);
      f.mesh.visible = this.lit > 0.02;
      f.mesh.position.copy(p).y -= 0.004;
      const flick = 1 + Math.sin(this.time * (9 + i * 2.3)) * 0.06 + Math.sin(this.time * (23 + i)) * 0.04;
      f.mesh.scale.set(this.lit, this.lit * flick, this.lit);
      f.mat.uniforms.opacity.value = 1.3 * this.lit;
      f.mat.uniforms.tint.value.setRGB(1.5, 1.0, 0.7);
      f.update(dt, camera);
      // humo al apagarse
      if (was > 0.3 && this.target === 0 && particles && Math.random() < 0.5) {
        particles.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.02, 0.06, (Math.random() - 0.5) * 0.02), [0.12, 0.11, 0.1], 0.02, 1.2, { drag: 0.5, rise: 0.02 });
      }
    });
    if (this.wicks.length) {
      c.multiplyScalar(1 / this.wicks.length);
      this.light.position.copy(this.group.worldToLocal(c)).y += 0.05;
    }
    const flick = 0.85 + Math.sin(this.time * 13) * 0.06 + Math.sin(this.time * 31.7) * 0.05 + Math.random() * 0.05;
    this.light.intensity = 0.55 * this.lit * flick;
  }
}
