import * as THREE from 'three';

// Libro: «Aged Alchemical Book (mid-poly!)» de LOLIPOP (CC-BY), versión abierta.
// Sobre sus hojas se colocan dos láminas que siguen la curvatura real de las
// páginas (calculada por raycast) y llevan el contenido de cada lección.

// área útil de cada página en el espacio local de la malla OpenPages (metros)
const X0 = 0.009, X1 = 0.163, Y0 = -0.119, Y1 = 0.122;
export const PAGE_W = X1 - X0;
export const PAGE_H = Y1 - Y0;
const CANVAS_W = 1100;
const CANVAS_H = Math.round(CANVAS_W * (PAGE_H / PAGE_W));
const OPEN_ANGLE = 0;

function relMatrix(base, obj) {
  return new THREE.Matrix4().copy(base.matrixWorld).invert().multiply(obj.matrixWorld);
}

export class Book {
  constructor(gltf, textures, anisotropy) {
    this.group = new THREE.Group();
    this.tex = textures;
    this.anisotropy = anisotropy;
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const byName = (n) => { let r; scene.traverse((o) => { if (o.isMesh && o.name === n) r = o; }); return r; };
    const pages = byName('OpenPages_Books_0');
    const cover = byName('Book001_Books_0') || byName('Book.001_Books_0');
    const model = new THREE.Group();
    for (const m of [cover, pages]) {
      const mesh = new THREE.Mesh(m.geometry, m.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(relMatrix(pages, m));
      mesh.castShadow = mesh.receiveShadow = true;
      model.add(mesh);
      if (m === pages) this.pagesMesh = mesh;
    }
    const mat = cover.material;
    if (mat.map) mat.map.anisotropy = anisotropy;
    this.group.add(model);
    model.updateMatrixWorld(true);

    // láminas que siguen la superficie de las hojas
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, 0, -1);
    const sheetHeight = (x, y) => {
      ray.set(new THREE.Vector3(x, y, 0.3), down);
      const h = ray.intersectObject(this.pagesMesh, false)[0];
      return h ? h.point.z : 0.03;
    };
    this.sheetHeight = sheetHeight;

    this.pageMeshes = [];
    this.pageCanvases = [];
    const NX = 36, NY = 18;
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(1, 1, NX, NY);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5;
        // u=0 junto al lomo
        const uu = side > 0 ? u : 1 - u;
        const x = side * (X0 + uu * PAGE_W);
        const y = Y0 + v * PAGE_H;
        pos.setXYZ(i, x, y, sheetHeight(x, y) + 0.00035);
        uv.setXY(i, u, v);
      }
      g.computeVertexNormals();
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W; canvas.height = CANVAS_H;
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = anisotropy;
      const m = new THREE.MeshStandardMaterial({
        map, normalMap: textures.paperNormal, normalScale: new THREE.Vector2(0.3, 0.3),
        roughness: 0.9, transparent: true, alphaTest: 0.02,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const page = new THREE.Mesh(g, m);
      page.receiveShadow = true;
      this.group.add(page);
      this.pageMeshes.push(page);
      this.pageCanvases.push(canvas);
    }
    this.flipLift = sheetHeight(0.03, 0) + 0.001;

    // hoja que se pasa
    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = CANVAS_W; flipCanvas.height = CANVAS_H;
    this.flipCanvasFront = flipCanvas;
    const flipBack = document.createElement('canvas');
    flipBack.width = CANVAS_W; flipBack.height = CANVAS_H;
    this.flipCanvasBack = flipBack;
    const mkMat = (cv, s) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = anisotropy;
      return new THREE.MeshStandardMaterial({ map: t, normalMap: textures.paperNormal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.9, side: s });
    };
    const fg = new THREE.PlaneGeometry(PAGE_W, PAGE_H, 40, 1);
    this.flipGeo = fg;
    this.flipBase = fg.attributes.position.array.slice();
    this.flipFront = new THREE.Mesh(fg, mkMat(flipCanvas, THREE.FrontSide));
    this.flipBackMesh = new THREE.Mesh(fg, mkMat(flipBack, THREE.BackSide));
    this.flipBackMesh.material.map.wrapS = THREE.RepeatWrapping;
    this.flipBackMesh.material.map.repeat.x = -1;
    this.flipBackMesh.material.map.offset.x = 1;
    this.flipFront.castShadow = true;
    this.flipGroup = new THREE.Group();
    this.flipGroup.position.y = Y0 + PAGE_H / 2;
    this.flipGroup.add(this.flipFront, this.flipBackMesh);
    this.flipGroup.visible = false;
    this.group.add(this.flipGroup);
    this.flip = null;
  }

  // ---------- dibujo de páginas ----------
  _paper(ctx, seed, side) {
    const img = this.tex.paperImage;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, (seed * 137) % 300, (seed * 71) % 300, img.width * 0.7, img.height * 0.7, 0, 0, CANVAS_W, CANVAS_H);
    // tono de pergamino envejecido
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#f7ecd6';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // oscurecimiento de bordes y del lomo
    const g = ctx.createRadialGradient(CANVAS_W * 0.5, CANVAS_H * 0.5, CANVAS_W * 0.25, CANVAS_W * 0.5, CANVAS_H * 0.5, CANVAS_H * 0.62);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(196,160,118,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const gx = side > 0 ? 0 : CANVAS_W;
    const gs = ctx.createLinearGradient(gx, 0, gx + (side > 0 ? 1 : -1) * CANVAS_W * 0.14, 0);
    gs.addColorStop(0, 'rgba(150,115,80,1)');
    gs.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = gs;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // manchas
    let r = seed * 9301 + 49297;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 7; i++) {
      const x = rnd() * CANVAS_W, y = rnd() * CANVAS_H, rad = 30 + rnd() * 140;
      const sg = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      sg.addColorStop(0, 'rgba(190,150,100,0.35)');
      sg.addColorStop(0.85, 'rgba(200,160,110,0.12)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _ink(ctx) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(48,26,12,0.92)';
    ctx.strokeStyle = 'rgba(48,26,12,0.92)';
  }

  drawLeft(ctx, lesson, index, total) {
    if (lesson.final) return this.drawFinalLeft(ctx, index);
    this._paper(ctx, index * 2 + 1, -1);
    this._ink(ctx);
    const m = 120;
    ctx.textAlign = 'center';
    ctx.font = '50px "IM Fell English SC"';
    ctx.fillText(lesson.subtitle, CANVAS_W / 2, m + 40);
    ctx.font = '150px "IM Fell English SC"';
    ctx.fillStyle = 'rgba(120,22,14,0.9)';
    ctx.fillText(lesson.name, CANVAS_W / 2, m + 230);
    this._ink(ctx);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(m + 120, m + 290); ctx.lineTo(CANVAS_W - m - 120, m + 290); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = 'italic 56px "IM Fell English"';
    let y = m + 400;
    for (const line of lesson.lore) { ctx.fillText(line, m, y); y += 76; }
    y += 50;
    ctx.font = '54px "IM Fell English SC"';
    ctx.fillStyle = 'rgba(120,22,14,0.9)';
    ctx.fillText('Cómo se traza', m, y); y += 66;
    this._ink(ctx);
    ctx.font = '56px "IM Fell English"';
    for (const line of lesson.how) { ctx.fillText(line, m, y); y += 72; }
    ctx.textAlign = 'center';
    ctx.font = 'italic 44px "IM Fell English"';
    ctx.fillText(`— ${index * 2 + 1} —`, CANVAS_W / 2, CANVAS_H - 80);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawRight(ctx, lesson, index, mastered) {
    if (lesson.final) return this.drawFinalRight(ctx, lesson, index);
    this._paper(ctx, index * 2 + 2, 1);
    this._ink(ctx);
    const box = { x: 130, y: 210, s: CANVAS_W - 260 };
    // círculo de construcción tenue
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(box.x + box.s / 2, box.y + box.s / 2, box.s * 0.56, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(box.x + box.s / 2, box.y + box.s / 2, box.s * 0.6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // la runa, con varias pasadas de tinta ligeramente desplazadas
    const P = lesson.stroke.map(([u, v]) => [box.x + u * box.s, box.y + v * box.s]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < 4; pass++) {
      ctx.lineWidth = 12 - pass * 2.2;
      ctx.globalAlpha = 0.35 + pass * 0.12;
      ctx.beginPath();
      P.forEach(([x, y], i) => {
        const jx = (Math.sin(i * 1.7 + pass * 3) * 1.6), jy = (Math.cos(i * 1.3 + pass) * 1.6);
        i ? ctx.lineTo(x + jx, y + jy) : ctx.moveTo(x + jx, y + jy);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // punto de inicio y flecha de dirección
    ctx.fillStyle = 'rgba(140,20,12,0.95)';
    ctx.beginPath(); ctx.arc(P[0][0], P[0][1], 20, 0, Math.PI * 2); ctx.fill();
    const k = Math.min(10, P.length - 1);
    const a = Math.atan2(P[k][1] - P[0][1], P[k][0] - P[0][0]);
    const ax = P[k][0] + Math.cos(a) * 30, ay = P[k][1] + Math.sin(a) * 30;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(a) * 34, ay + Math.sin(a) * 34);
    ctx.lineTo(ax + Math.cos(a + 2.5) * 30, ay + Math.sin(a + 2.5) * 30);
    ctx.lineTo(ax + Math.cos(a - 2.5) * 30, ay + Math.sin(a - 2.5) * 30);
    ctx.closePath(); ctx.fill();
    this._ink(ctx);
    ctx.textAlign = 'center';
    ctx.font = 'italic 62px "IM Fell English"';
    ctx.fillText('Comienza en el punto rojo', CANVAS_W / 2, box.y + box.s + 150);
    ctx.font = '60px "IM Fell English SC"';
    ctx.fillText(`«${lesson.name}»`, CANVAS_W / 2, box.y - 60);
    if (mastered) {
      ctx.save();
      ctx.translate(CANVAS_W * 0.74, CANVAS_H * 0.86);
      ctx.rotate(-0.22);
      ctx.strokeStyle = 'rgba(150,25,15,0.8)';
      ctx.fillStyle = 'rgba(150,25,15,0.8)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, 105, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 92, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '40px "IM Fell English SC"';
      ctx.fillText('Dominada', 0, 14);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    this._ink(ctx);
    ctx.font = 'italic 44px "IM Fell English"';
    ctx.fillText(`— ${index * 2 + 2} —`, CANVAS_W / 2, CANVAS_H - 80);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawFinalLeft(ctx, index) {
    this._paper(ctx, 41, -1);
    this._ink(ctx);
    const m = 120;
    ctx.textAlign = 'center';
    ctx.font = '50px "IM Fell English SC"';
    ctx.fillText('Fin del primer grimorio', CANVAS_W / 2, m + 40);
    ctx.font = '140px "IM Fell English SC"';
    ctx.fillStyle = 'rgba(120,22,14,0.9)';
    ctx.fillText('Epílogo', CANVAS_W / 2, m + 220);
    this._ink(ctx);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(m + 120, m + 280); ctx.lineTo(CANVAS_W - m - 120, m + 280); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = 'italic 56px "IM Fell English"';
    const lines = [
      'Has aprendido a ver, a encender,', 'a desatar el rayo y a soltar', 'el viento. Ninguna runa es tuya',
      'hasta que la trazas sin mirar.', '', 'Practica: cualquiera de ellas', 'responderá ahora a tu mano,', 'en cualquier página.',
    ];
    let y = m + 400;
    for (const l of lines) { ctx.fillText(l, m, y); y += 76; }
    ctx.textAlign = 'center';
    ctx.font = 'italic 44px "IM Fell English"';
    ctx.fillText(`— ${index * 2 + 1} —`, CANVAS_W / 2, CANVAS_H - 80);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawFinalRight(ctx, final, index) {
    this._paper(ctx, 42, 1);
    this._ink(ctx);
    ctx.textAlign = 'center';
    ctx.font = '60px "IM Fell English SC"';
    ctx.fillText('Índice de runas', CANVAS_W / 2, 170);
    const cell = (CANVAS_W - 240) / 2;
    final.lessons.forEach((l, i) => {
      const cx = 120 + (i % 2) * cell, cy = 260 + Math.floor(i / 2) * (cell + 120);
      const s = cell * 0.7, ox = cx + (cell - s) / 2, oy = cy;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = 8; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      l.stroke.forEach(([u, v], k) => { const x = ox + u * s, y = oy + v * s; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.restore();
      this._ink(ctx);
      ctx.fillStyle = 'rgba(140,20,12,0.95)';
      ctx.beginPath(); ctx.arc(ox + l.stroke[0][0] * s, oy + l.stroke[0][1] * s, 12, 0, Math.PI * 2); ctx.fill();
      this._ink(ctx);
      ctx.font = '54px "IM Fell English SC"';
      ctx.fillText(l.name, cx + cell / 2, oy + s + 70);
    });
    ctx.font = 'italic 44px "IM Fell English"';
    ctx.fillText(`— ${index * 2 + 2} —`, CANVAS_W / 2, CANVAS_H - 80);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Superpone en lápiz rojo el trazo del jugador sobre la runa, para ver dónde se desvió. */
  showAttempt(lesson, index, mastered, points) {
    const ctx = this.pageCanvases[1].getContext('2d');
    this.drawRight(ctx, lesson, index, mastered);
    const box = { x: 130, y: 210, s: CANVAS_W - 260 };
    const bb = (pts) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
    const [tx0, ty0, tx1, ty1] = bb(lesson.stroke);
    const [px0, py0, px1, py1] = bb(points);
    const sx = (tx1 - tx0) / Math.max(1, px1 - px0), sy = (ty1 - ty0) / Math.max(1, py1 - py0);
    const map = ([x, y]) => [box.x + (tx0 + (x - px0) * sx) * box.s, box.y + (ty0 + (y - py0) * sy) * box.s];
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = 'rgba(185,30,15,0.85)';
    ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([18, 12]);
    ctx.beginPath();
    points.forEach((p, i) => { const [x, y] = map(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(175,40,25,0.8)';
    const [sx0, sy0] = map(points[0]);
    ctx.beginPath(); ctx.arc(sx0, sy0, 14, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'italic 58px "IM Fell English"';
    ctx.textAlign = 'center';
    ctx.fillText('— tu trazo —', CANVAS_W / 2, box.y + box.s + 240);
    ctx.restore();
    this.pageMeshes[1].material.map.needsUpdate = true;
    clearTimeout(this._attemptTimer);
    this._attemptTimer = setTimeout(() => {
      this.drawRight(ctx, lesson, index, mastered);
      this.pageMeshes[1].material.map.needsUpdate = true;
    }, 4500);
  }

  showSpread(lesson, index, total, mastered) {
    clearTimeout(this._attemptTimer);
    this.drawLeft(this.pageCanvases[0].getContext('2d'), lesson, index, total);
    this.drawRight(this.pageCanvases[1].getContext('2d'), lesson, index, mastered);
    for (const m of this.pageMeshes) m.material.map.needsUpdate = true;
  }

  /** Pasa la página animada. dir=+1 adelante. drawNext dibuja la doble página nueva. */
  turn(dir, fromLesson, toLesson, fromIdx, toIdx, masteredFrom, masteredTo, total) {
    if (this.flip) return false;
    clearTimeout(this._attemptTimer);
    // hoja móvil: cara frontal = página que se levanta, trasera = página que aparece
    const fc = this.flipCanvasFront.getContext('2d');
    const bc = this.flipCanvasBack.getContext('2d');
    if (dir > 0) {
      this.drawRight(fc, fromLesson, fromIdx, masteredFrom);
      this.drawLeft(bc, toLesson, toIdx, total);
    } else {
      this.drawLeft(fc, fromLesson, fromIdx, total);
      this.drawRight(bc, toLesson, toIdx, masteredTo);
    }
    this.flipFront.material.map.needsUpdate = true;
    this.flipBackMesh.material.map.needsUpdate = true;
    // debajo ya aparece la doble página nueva en el lado que se destapa
    const under = dir > 0 ? 1 : 0;
    const ctx = this.pageCanvases[under].getContext('2d');
    if (dir > 0) this.drawRight(ctx, toLesson, toIdx, masteredTo); else this.drawLeft(ctx, toLesson, toIdx, total);
    this.pageMeshes[under].material.map.needsUpdate = true;
    this.flip = { t: 0, dir, after: () => this.showSpread(toLesson, toIdx, total, masteredTo) };
    this.flipGroup.visible = true;
    return true;
  }

  update(dt) {
    if (!this.flip) return;
    const f = this.flip;
    f.t = Math.min(1, f.t + dt / 0.85);
    const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
    // ángulo de la hoja alrededor del lomo (0 = apoyada a la derecha, PI = a la izquierda)
    const start = f.dir > 0 ? -OPEN_ANGLE : Math.PI + OPEN_ANGLE;
    const end = f.dir > 0 ? Math.PI + OPEN_ANGLE : -OPEN_ANGLE;
    const theta = start + (end - start) * e;
    const bend = Math.sin(e * Math.PI) * 0.9 * (f.dir > 0 ? 1 : -1);
    const pos = this.flipGeo.attributes.position;
    const base = this.flipBase;
    for (let i = 0; i < pos.count; i++) {
      const u = (base[i * 3] + PAGE_W / 2) / PAGE_W; // 0 en el lomo
      const y = base[i * 3 + 1];
      // la hoja se curva: el canto va retrasado respecto al lomo
      const steps = 16;
      let x = Math.cos(theta) * X0, z = Math.sin(theta) * X0;
      const lift = this.flipLift;
      for (let s = 0; s < steps; s++) {
        const uu = (s + 0.5) / steps * u;
        const a = theta - bend * uu * uu;
        x += Math.cos(a) * (u * PAGE_W / steps) ;
        z += Math.sin(a) * (u * PAGE_W / steps);
      }
      pos.setXYZ(i, x, y, z + lift);
    }
    pos.needsUpdate = true;
    this.flipGeo.computeVertexNormals();
    if (f.t >= 1) {
      this.flip = null;
      this.flipGroup.visible = false;
      f.after();
    }
  }
}

export function pageCanvasSize() { return [CANVAS_W, CANVAS_H]; }
