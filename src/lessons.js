// Lecciones del grimorio. Cada runa es un trazo único definido en coordenadas
// normalizadas (x a la derecha, y hacia abajo, 0..1). El libro la dibuja en tinta
// y el reconocedor compara el trazo del jugador con la misma forma.

function circle(n = 48) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 - (i / n) * Math.PI * 2; // empieza arriba, sentido antihorario
    p.push([0.5 + Math.cos(a) * 0.42, 0.5 + Math.sin(a) * 0.42]);
  }
  return p;
}

function poly(pts, stepsPerSeg = 16) {
  const p = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    for (let s = 0; s < stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      p.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  p.push(pts[pts.length - 1]);
  return p;
}

function spiral(n = 90, turns = 2.1) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * Math.PI * 2 * turns;
    const r = 0.05 + t * 0.4;
    p.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
  }
  return p;
}

function infinity(n = 80) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    p.push([0.5 + Math.sin(t) * 0.44, 0.5 + Math.sin(2 * t) * 0.24]);
  }
  return p;
}

export const LESSONS = [
  {
    id: 'lumen',
    name: 'Lumen',
    subtitle: 'Primera lección · La luz',
    color: [1.0, 0.86, 0.6],
    stroke: circle(),
    lore: [
      'Toda magia empieza por ver.',
      'El círculo cerrado encierra la',
      'voluntad del mago y la devuelve',
      'convertida en luz.',
    ],
    how: [
      'Traza un círculo en el aire,',
      'empezando por arriba, sin',
      'levantar el dedo.',
    ],
  },
  {
    id: 'ignis',
    name: 'Ignis',
    subtitle: 'Segunda lección · El fuego',
    color: [1.0, 0.45, 0.12],
    stroke: poly([[0.5, 0.08], [0.9, 0.86], [0.1, 0.86], [0.5, 0.08]]),
    lore: [
      'El fuego pide forma y límite.',
      'Tres lados para tres virtudes:',
      'calor, luz y hambre. Contenlo',
      'en la palma y obedecerá.',
    ],
    how: [
      'Traza un triángulo desde la',
      'cúspide, hacia la derecha,',
      'y ciérralo en la cúspide.',
    ],
  },
  {
    id: 'fulgur',
    name: 'Fulgur',
    subtitle: 'Tercera lección · El rayo',
    color: [0.55, 0.75, 1.0],
    stroke: poly([[0.18, 0.1], [0.82, 0.1], [0.18, 0.9], [0.82, 0.9]]),
    lore: [
      'El rayo no se invoca: se libera.',
      'Es la línea más corta entre el',
      'cielo y la tierra, quebrada',
      'por la prisa.',
    ],
    how: [
      'Traza una Z: arriba de izquierda',
      'a derecha, diagonal hacia abajo',
      'y remata hacia la derecha.',
    ],
  },
  {
    id: 'ventus',
    name: 'Ventus',
    subtitle: 'Cuarta lección · El viento',
    color: [0.75, 0.95, 0.85],
    stroke: spiral(),
    threshold: 0.62,
    variants: [spiral(80, 1.5), spiral(100, 2.7)],
    lore: [
      'El aire nunca va en línea recta.',
      'Gira, se abre y se escapa.',
      'Quien lo dibuja desde dentro',
      'lo deja salir.',
    ],
    how: [
      'Traza una espiral que nazca en',
      'el centro y se abra hacia fuera',
      'durante dos vueltas.',
    ],
  },
  {
    id: 'vinculum',
    hidden: true,
    name: 'Vinculum',
    subtitle: 'Lección oculta · El sello',
    color: [0.95, 0.75, 1.0],
    stroke: infinity(),
    lore: [
      'Escrita a la luz del muro, no',
      'a la de la vela. El sello une',
      'lo que se ha aprendido: luz,',
      'fuego, rayo y viento en uno.',
    ],
    how: [
      'Traza un ocho tumbado desde el',
      'centro, primero hacia la derecha',
      'y abajo, sin levantar el dedo.',
    ],
  },
];
