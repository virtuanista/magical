// Reconocedor de trazos tipo $1 (Wobbrock et al.), sensible a la orientación:
// las runas se distinguen por su forma y dirección, así que no rotamos.

const N = 64;

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

export function resample(points, n = N) {
  const pts = points.map((p) => [p[0], p[1]]);
  const I = pathLength(pts) / (n - 1);
  if (!isFinite(I) || I === 0) return null;
  let D = 0;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (D + d >= I) {
      const t = (I - D) / d;
      const q = [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else D += d;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out.slice(0, n);
}

function normalize(pts) {
  // escala no uniforme al cuadrado unidad (como $1): un círculo algo achatado sigue siendo círculo
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  const m = Math.max(sx, sy);
  // no estirar más de 1.6x un eje: así una Z alargada no se confunde con otra cosa
  const fx = Math.min(m / sx, 1.6) / m, fy = Math.min(m / sy, 1.6) / m;
  let cx = 0, cy = 0;
  const q = pts.map(([x, y]) => [(x - minX) * fx, (y - minY) * fy]);
  for (const [x, y] of q) { cx += x; cy += y; }
  cx /= q.length; cy /= q.length;
  return q.map(([x, y]) => [x - cx, y - cy]);
}

function distance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  return d / a.length;
}

export function prepare(points) {
  const r = resample(points);
  return r ? normalize(r) : null;
}

function isClosed(t) {
  const a = t[0], b = t[t.length - 1];
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;
}

function bestDistance(a, template) {
  const t = prepare(template);
  if (!t) return Infinity;
  const cands = [t, [...t].reverse()];
  // en figuras cerradas da igual por dónde se empiece
  if (isClosed(template)) {
    const base = resample(template);
    for (let k = 4; k < N; k += 4) {
      const shifted = base.slice(k).concat(base.slice(1, k + 1));
      const n = normalize(resample(shifted));
      cands.push(n, [...n].reverse());
    }
  }
  return Math.min(...cands.map((c) => distance(a, c)));
}

/** Devuelve una puntuación 0..1 de parecido entre el trazo y la runa (o sus variantes). */
export function score(points, template, variants = []) {
  if (points.length < 8) return 0;
  const a = prepare(points);
  if (!a) return 0;
  const d = Math.min(...[template, ...variants].map((t) => bestDistance(a, t)));
  const halfDiag = 0.5 * Math.SQRT2;
  return Math.max(0, 1 - d / (halfDiag * 0.5));
}
