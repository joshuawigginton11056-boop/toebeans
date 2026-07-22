import { BOOST_SPEED, MAX_SPEED, type SkiState } from "@toebeans/shared";

// Slope sound effects (M2). Everything here is synthesized with the Web
// Audio API — no audio files. That keeps the repo asset-free for sound and,
// more importantly, lets the continuous layers (wind, ski carve) follow the
// skier's actual speed every frame, which a looped sample can't do.
//
// Same core rule as rendering: this module only ever *reads* game state.
// One-shot effects (jump, crash, checkpoint…) are detected by comparing the
// previous frame's state to the current one — the pure functions in /shared
// stay ignorant of audio.
//
// Music is deliberately absent: director call (2026-07-21) — effects first,
// pick the music direction after hearing them.

export type AudioMode = "bedroom" | "slope";

export interface AudioHandle {
  sync(mode: AudioMode, state: SkiState): void;
  /** Flip mute; returns true if now muted. */
  toggleMuted(): boolean;
}

// How quickly continuous layers chase their target loudness (seconds).
const LAYER_SMOOTHING = 0.08;

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

interface Nodes {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly windGain: GainNode;
  readonly carveGain: GainNode;
  readonly carveFilter: BiquadFilterNode;
  readonly boostGain: GainNode;
}

function buildNodes(ctx: AudioContext): Nodes {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const noise = makeNoiseBuffer(ctx);

  function noiseLayer(filter: BiquadFilterNode): GainNode {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    return gain;
  }

  // Wind: deep rumbly noise, always faintly there on the slope. A slow LFO
  // wobbles its loudness so it gusts instead of droning.
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 320;
  const windGain = noiseLayer(windFilter);
  const gust = ctx.createOscillator();
  gust.frequency.value = 0.35;
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 0.02;
  gust.connect(gustDepth);
  gustDepth.connect(windGain.gain);
  gust.start();

  // Ski carve: the hiss of skis on snow. Loudness *and* brightness scale
  // with speed; it cuts to silence while airborne, which is what makes a
  // jump feel like a held breath.
  const carveFilter = ctx.createBiquadFilter();
  carveFilter.type = "bandpass";
  carveFilter.frequency.value = 1600;
  carveFilter.Q.value = 0.8;
  const carveGain = noiseLayer(carveFilter);

  // Boost: an extra high rush layered on top while boosting.
  const boostFilter = ctx.createBiquadFilter();
  boostFilter.type = "bandpass";
  boostFilter.frequency.value = 2600;
  boostFilter.Q.value = 1.2;
  const boostGain = noiseLayer(boostFilter);

  return { ctx, master, windGain, carveGain, carveFilter, boostGain };
}

// --- One-shot helpers -----------------------------------------------------

/** A short pitched note (triangle wave, plucky exponential decay). */
function note(
  nodes: Nodes,
  frequency: number,
  when: number,
  peak: number,
  decay: number,
): void {
  const { ctx, master } = nodes;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = frequency;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, when + decay);
  osc.connect(gain);
  gain.connect(master);
  osc.start(when);
  osc.stop(when + decay + 0.05);
}

/** A filtered noise puff — the basis of whooshes and snow thumps. */
function puff(
  nodes: Nodes,
  opts: {
    when: number;
    duration: number;
    peak: number;
    filterFrom: number;
    filterTo: number;
  },
): void {
  const { ctx, master } = nodes;
  const source = ctx.createBufferSource();
  source.buffer = makeNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(opts.filterFrom, opts.when);
  filter.frequency.linearRampToValueAtTime(opts.filterTo, opts.when + opts.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, opts.when);
  gain.gain.linearRampToValueAtTime(opts.peak, opts.when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, opts.when + opts.duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(opts.when);
  source.stop(opts.when + opts.duration + 0.05);
}

/** A falling-pitch sine thud — soft, snowy, not violent. */
function thud(nodes: Nodes, when: number, fromHz: number, toHz: number, peak: number): void {
  const { ctx, master } = nodes;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(fromHz, when);
  osc.frequency.exponentialRampToValueAtTime(toHz, when + 0.3);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
  osc.connect(gain);
  gain.connect(master);
  osc.start(when);
  osc.stop(when + 0.4);
}

// --- The one-shots themselves ---------------------------------------------

function playJump(nodes: Nodes): void {
  // Rising whoosh — air moving past on the way up.
  puff(nodes, {
    when: nodes.ctx.currentTime,
    duration: 0.28,
    peak: 0.18,
    filterFrom: 500,
    filterTo: 2400,
  });
}

function playLand(nodes: Nodes): void {
  // A soft snow-compression thump.
  const now = nodes.ctx.currentTime;
  puff(nodes, { when: now, duration: 0.14, peak: 0.22, filterFrom: 450, filterTo: 250 });
  thud(nodes, now, 130, 80, 0.12);
}

function playCrash(nodes: Nodes): void {
  // Bigger, lower thump plus a slow snow poof. Soft-bodied on purpose —
  // crashing in Toebeans is a flop into powder, not a car wreck.
  const now = nodes.ctx.currentTime;
  thud(nodes, now, 150, 50, 0.32);
  puff(nodes, { when: now, duration: 0.4, peak: 0.26, filterFrom: 500, filterTo: 150 });
}

function playCheckpoint(nodes: Nodes): void {
  // Two quick plucks going up — "progress banked."
  const now = nodes.ctx.currentTime;
  note(nodes, 660, now, 0.12, 0.4);
  note(nodes, 880, now + 0.12, 0.12, 0.5);
}

function playRespawn(nodes: Nodes): void {
  // One small pluck — "back on your feet."
  note(nodes, 520, nodes.ctx.currentTime, 0.1, 0.3);
}

function playForfeit(nodes: Nodes): void {
  // Three gentle falling notes. Sad, but cozy-sad.
  const now = nodes.ctx.currentTime;
  note(nodes, 523, now, 0.12, 0.5);
  note(nodes, 415, now + 0.22, 0.12, 0.5);
  note(nodes, 330, now + 0.44, 0.12, 0.9);
}

// --- Public handle ---------------------------------------------------------

export function createAudio(initiallyMuted = false): AudioHandle {
  let nodes: Nodes | null = null;
  let muted = initiallyMuted;
  let prev: SkiState | null = null;
  let prevOnSlope = false;

  // Browsers only allow sound after a user gesture. Everything in the game
  // is keyboard-driven, so the first keydown is the earliest sound could
  // ever be wanted — build (or resume) the audio graph there.
  function ensureContext(): void {
    if (!nodes) {
      nodes = buildNodes(new AudioContext());
      nodes.master.gain.value = muted ? 0 : 0.9;
    }
    if (nodes.ctx.state === "suspended") {
      void nodes.ctx.resume();
    }
  }
  window.addEventListener("keydown", ensureContext);

  function setLayerTargets(mode: AudioMode, state: SkiState): void {
    if (!nodes) return;
    const { ctx, windGain, carveGain, carveFilter, boostGain } = nodes;
    const now = ctx.currentTime;

    let wind = 0;
    let carve = 0;
    let boost = 0;
    if (mode === "slope") {
      // Magnitude: speed is signed now (negative = riding switch), and a
      // fast switch run sounds as fast as it is.
      const speedNorm = Math.min(1, Math.abs(state.speed) / BOOST_SPEED);
      const airborne = state.height > 0;
      if (state.status === "skiing") {
        wind = 0.04 + 0.1 * speedNorm + (airborne ? 0.05 : 0);
        carve = airborne ? 0 : 0.05 + 0.18 * speedNorm;
        boost = Math.abs(state.speed) > MAX_SPEED ? 0.12 : 0;
      } else {
        // Crashed or forfeited: just a low ambient wind.
        wind = 0.04;
      }
      carveFilter.frequency.setTargetAtTime(1200 + 1600 * speedNorm, now, LAYER_SMOOTHING);
    }
    windGain.gain.setTargetAtTime(wind, now, LAYER_SMOOTHING);
    carveGain.gain.setTargetAtTime(carve, now, LAYER_SMOOTHING);
    boostGain.gain.setTargetAtTime(boost, now, LAYER_SMOOTHING);
  }

  function fireTransitions(state: SkiState): void {
    if (!nodes || !prev) return;

    if (prev.status === "skiing" && state.status === "crashed") {
      playCrash(nodes);
    } else if (prev.status === "crashed" && state.status === "skiing") {
      playRespawn(nodes);
    } else if (prev.status !== "forfeited" && state.status === "forfeited") {
      playForfeit(nodes);
    } else if (prev.status === "skiing" && state.status === "skiing") {
      if (prev.height <= 0 && state.height > 0) {
        playJump(nodes);
      } else if (prev.height > 0 && state.height <= 0) {
        playLand(nodes);
      }
      if (state.lastCheckpoint > prev.lastCheckpoint) {
        playCheckpoint(nodes);
      }
    }
  }

  function sync(mode: AudioMode, state: SkiState): void {
    const onSlope = mode === "slope";
    // Only compare frames when both are on the slope — otherwise the
    // fresh-run state reset (Enter) would read as fake transitions.
    if (onSlope && prevOnSlope) {
      fireTransitions(state);
    }
    setLayerTargets(mode, state);
    prev = state;
    prevOnSlope = onSlope;
  }

  function toggleMuted(): boolean {
    muted = !muted;
    if (nodes) {
      nodes.master.gain.setTargetAtTime(muted ? 0 : 0.9, nodes.ctx.currentTime, 0.05);
    }
    return muted;
  }

  return { sync, toggleMuted };
}
