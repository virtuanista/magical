// Sonido: grabaciones reales (FilmCow, NOX Sound, Helton Yan) mezcladas con Web Audio.
// Todo pasa por una reverberación de bodega de piedra para que suene en la sala.

const FILES = [
  'amb_drips', 'amb_drone', 'trace_air', 'fire_loop', 'page_1', 'page_2', 'book_open', 'ignite',
  'fizzle', 'lumen', 'seal', 'gust', 'cast', 'crackle', 'thunder', 'wind_whistle', 'step_1', 'step_2', 'step_3', 'step_4',
];

function impulse(ctx, seconds = 2.6, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // primeras reflexiones densas y cola que se oscurece
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 1200 ? 0.4 : 1);
    }
  }
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ready = false;
    this.raw = null;
  }

  /** Descarga los sonidos durante la pantalla de carga (el AudioContext espera al clic). */
  prefetch() {
    this.raw ??= Object.fromEntries(FILES.map((n) => [n, fetch(`/assets/audio/${n}.mp3`).then((r) => r.arrayBuffer())]));
    return this.raw;
  }

  async init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 5200;
    this.reverb.connect(tone).connect(wet).connect(this.master);
    const raw = this.prefetch();
    await Promise.all(FILES.map(async (n) => {
      this.buffers[n] = await ctx.decodeAudioData(await raw[n]);
    }));
    this.ready = true;
  }

  _chain(vol, pan, send) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.master);
    if (send > 0) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(this.reverb);
    }
    return g;
  }

  play(name, { vol = 1, rate = 1, pan = 0, send = 0.6, delay = 0, jitter = 0.04 } = {}) {
    if (!this.ready || !this.buffers[name]) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this._chain(vol, pan, send);
    src.connect(g);
    src.start(this.ctx.currentTime + delay);
    return { src, gain: g };
  }

  loop(name, { vol = 0, pan = 0, send = 0.5, rate = 1 } = {}) {
    if (!this.ready) return null;
    const src = this.ctx.createBufferSource();
    const buf = this.buffers[name];
    src.buffer = buf;
    src.loop = true;
    // evita el silencio de relleno del mp3 al cerrar el bucle
    src.loopStart = 0.06; src.loopEnd = buf.duration - 0.06;
    src.playbackRate.value = rate;
    const g = this._chain(vol, pan, send);
    src.connect(g);
    src.start(0, 0.06);
    const ctx = this.ctx;
    return {
      src, gain: g,
      set(v, time = 0.15) { g.gain.setTargetAtTime(v, ctx.currentTime, time); },
      rate(r, time = 0.1) { src.playbackRate.setTargetAtTime(r, ctx.currentTime, time); },
      stop(fade = 0.5) { g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); src.stop(ctx.currentTime + fade * 2); },
    };
  }
}
