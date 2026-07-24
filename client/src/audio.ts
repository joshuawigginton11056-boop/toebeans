import {
  BOOST_SPEED,
  JUMP_CHARGE_TIME,
  MAX_JUMP_VELOCITY,
  MAX_SPEED,
  MIN_JUMP_VELOCITY,
  type SkiState,
} from "@toebeans/shared";

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
  // --- Added by the lobby session (2026-07-24, settings menu) -------------
  // Smallest additive seam change (see PARALLEL.md): the settings menu needs a
  // master-volume slider and a music on/off toggle, so the audio handle grows
  // two setters. Everything above is untouched slope-session work. Slope-vis:
  // the ambient music bed below is intentionally minimal (a pad + a gentle
  // pentatonic bell loop) — real music direction is still yours to pick; see
  // the (slope-vis) note in IDEAS.md.
  /** Set master loudness, 0..1 (multiplied out by mute). */
  setVolume(volume: number): void;
  /** Turn the ambient music bed on or off. */
  setMusicEnabled(enabled: boolean): void;
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
  readonly chargeGain: GainNode;
  readonly chargeFilter: BiquadFilterNode;
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

  // Jump charge: a low snow-press noise that swells and rises in pitch as
  // the hold-to-charge load deepens — the held-breath before the release's
  // whoosh. Loudness and brightness both track the charge (see sync).
  const chargeFilter = ctx.createBiquadFilter();
  chargeFilter.type = "bandpass";
  chargeFilter.frequency.value = 250;
  chargeFilter.Q.value = 1.4;
  const chargeGain = noiseLayer(chargeFilter);

  return { ctx, master, windGain, carveGain, carveFilter, boostGain, chargeGain, chargeFilter };
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

function playJump(nodes: Nodes, launchVelocity: number): void {
  // Rising whoosh — air moving past on the way up. Bigger with the charge:
  // a full-charge launch whooshes longer and louder than a tap.
  const big = Math.max(
    0,
    Math.min(
      1,
      (launchVelocity - MIN_JUMP_VELOCITY) / (MAX_JUMP_VELOCITY - MIN_JUMP_VELOCITY),
    ),
  );
  puff(nodes, {
    when: nodes.ctx.currentTime,
    duration: 0.28 + 0.14 * big,
    peak: 0.18 + 0.1 * big,
    filterFrom: 500,
    filterTo: 2400 + 800 * big,
  });
}

function playLand(nodes: Nodes, impactVelocity: number): void {
  // A soft snow-compression thump — a touch heavier off a bigger drop.
  const big = Math.min(1, Math.abs(impactVelocity) / 14);
  const now = nodes.ctx.currentTime;
  puff(nodes, {
    when: now,
    duration: 0.14,
    peak: 0.16 + 0.12 * big,
    filterFrom: 450,
    filterTo: 250,
  });
  thud(nodes, now, 130, 80, 0.08 + 0.08 * big);
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

// --- Ambient music bed (lobby session, 2026-07-24) -------------------------
// A cozy, low ambient loop that the settings menu can switch on. Two layers:
// a soft detuned pad held under everything, and a slow pentatonic bell that
// wanders through a few notes so it breathes instead of drones. Routed through
// its own gain into master, so the volume slider and mute cover it too. Kept
// deliberately small — real music direction is the slope-vis session's call.

interface Music {
  readonly setEnabled: (enabled: boolean) => void;
}

// A warm, cozy pentatonic (A minor pentatonic, low octave) for the bell.
const BELL_NOTES = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0];

function buildMusic(ctx: AudioContext, master: GainNode): Music {
  // The music bus. Starts silent; enabling ramps it up.
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(master);

  // Pad: two slightly detuned triangle oscillators through a gentle lowpass,
  // with a slow tremolo so the held chord shimmers rather than sits flat.
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 900;
  padFilter.connect(bus);
  const padGain = ctx.createGain();
  padGain.gain.value = 0.05;
  padGain.connect(padFilter);
  for (const [freq, detune] of [
    [146.83, -4],
    [220.0, 4],
    [293.66, 0],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(padGain);
    osc.start();
  }
  const tremolo = ctx.createOscillator();
  tremolo.frequency.value = 0.12;
  const tremoloDepth = ctx.createGain();
  tremoloDepth.gain.value = 0.02;
  tremolo.connect(tremoloDepth);
  tremoloDepth.connect(padGain.gain);
  tremolo.start();

  // Bell: soft sine plucks scheduled a little ahead of the clock. A lookahead
  // timer (the standard Web Audio pattern) keeps the next couple of notes
  // queued so timing stays steady even if a frame hitches.
  const BEAT = 1.6; // seconds between bell notes — unhurried
  let nextNoteTime = 0;
  let timer: number | null = null;

  function scheduleBell(when: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const freq = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)] ?? 220;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.09, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 1.4);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(when);
    osc.stop(when + 1.5);
  }

  function tick(): void {
    // Queue every note that falls inside the next ~0.25s lookahead window.
    while (nextNoteTime < ctx.currentTime + 0.25) {
      scheduleBell(nextNoteTime);
      // Occasionally rest a beat so the melody isn't metronomic.
      nextNoteTime += Math.random() < 0.25 ? BEAT * 2 : BEAT;
    }
  }

  function setEnabled(enabled: boolean): void {
    const now = ctx.currentTime;
    bus.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.4);
    if (enabled && timer === null) {
      nextNoteTime = now + 0.1;
      timer = window.setInterval(tick, 100);
    } else if (!enabled && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  return { setEnabled };
}

// --- Public handle ---------------------------------------------------------

export function createAudio(initiallyMuted = false): AudioHandle {
  let nodes: Nodes | null = null;
  let music: Music | null = null;
  let muted = initiallyMuted;
  // Base loudness the master runs at when unmuted — was the hardcoded 0.9;
  // the settings slider (lobby session) now drives it. Mute multiplies it to 0.
  let baseVolume = 0.9;
  // Desired music state, remembered until the context exists (music can be
  // toggled from the settings menu before the first keypress builds the graph).
  let musicEnabled = false;
  let prev: SkiState | null = null;
  let prevOnSlope = false;

  function masterTarget(): number {
    return muted ? 0 : baseVolume;
  }

  // Browsers only allow sound after a user gesture. Everything in the game
  // is keyboard-driven, so the first keydown is the earliest sound could
  // ever be wanted — build (or resume) the audio graph there.
  function ensureContext(): void {
    if (!nodes) {
      nodes = buildNodes(new AudioContext());
      nodes.master.gain.value = masterTarget();
      // Music shares the graph; reflect whatever the settings said so far.
      music = buildMusic(nodes.ctx, nodes.master);
      music.setEnabled(musicEnabled);
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
    let charge = 0;
    if (mode === "slope") {
      // Magnitude: speed is signed now (negative = riding switch), and a
      // fast switch run sounds as fast as it is.
      const speedNorm = Math.min(1, Math.abs(state.speed) / BOOST_SPEED);
      const airborne = state.height > 0;
      if (state.status === "skiing") {
        wind = 0.04 + 0.1 * speedNorm + (airborne ? 0.05 : 0);
        carve = airborne ? 0 : 0.05 + 0.18 * speedNorm;
        boost = Math.abs(state.speed) > MAX_SPEED ? 0.12 : 0;
        charge = state.jumpCharge / JUMP_CHARGE_TIME;
      } else {
        // Crashed or forfeited: just a low ambient wind.
        wind = 0.04;
      }
      carveFilter.frequency.setTargetAtTime(1200 + 1600 * speedNorm, now, LAYER_SMOOTHING);
      nodes.chargeFilter.frequency.setTargetAtTime(250 + 450 * charge, now, LAYER_SMOOTHING);
    }
    windGain.gain.setTargetAtTime(wind, now, LAYER_SMOOTHING);
    carveGain.gain.setTargetAtTime(carve, now, LAYER_SMOOTHING);
    boostGain.gain.setTargetAtTime(boost, now, LAYER_SMOOTHING);
    nodes.chargeGain.gain.setTargetAtTime(0.08 * charge, now, LAYER_SMOOTHING);
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
        // The takeoff frame's verticalVelocity IS the launch speed — the
        // whoosh scales with how charged the jump was.
        playJump(nodes, state.verticalVelocity);
      } else if (prev.height > 0 && state.height <= 0) {
        // …and the last airborne frame's fall speed sizes the touchdown.
        playLand(nodes, prev.verticalVelocity);
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
      nodes.master.gain.setTargetAtTime(masterTarget(), nodes.ctx.currentTime, 0.05);
    }
    return muted;
  }

  function setVolume(volume: number): void {
    baseVolume = Math.max(0, Math.min(1, volume));
    if (nodes) {
      nodes.master.gain.setTargetAtTime(masterTarget(), nodes.ctx.currentTime, 0.05);
    }
  }

  function setMusicEnabled(enabled: boolean): void {
    musicEnabled = enabled;
    music?.setEnabled(enabled);
  }

  return { sync, toggleMuted, setVolume, setMusicEnabled };
}
