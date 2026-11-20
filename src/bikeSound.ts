// Rough bike sounds, made live with Web Audio (no sound files): a single-cylinder thumper that follows the
// engine's revs and load, exhaust rasp, wind with speed, tire skid when the rear steps out or a wheel locks,
// and a thud on landings. Browsers only start audio after a click or key press on the page.
import { controls, rearWheelIndex, frontWheelIndex, state, vehicle } from './simulation.ts';

export const soundSettings = { volume: 0.5, muted: false };

type SoundNodes = {
  master: GainNode;
  thump: OscillatorNode;
  rev: OscillatorNode;
  engineFilter: BiquadFilterNode;
  engineGain: GainNode;
  limiterDepth: GainNode;
  raspDepth: GainNode;
  raspFilter: BiquadFilterNode;
  windGain: GainNode;
  skidGain: GainNode;
  noise: AudioBuffer;
};

let context: AudioContext | null = null;
let nodes: SoundNodes | null = null;
let wasInAir = false;
let airSeconds = 0;

// Call from any click or key press: the browser lets audio start then
export function unlockSound() {
  if (!context) {
    context = new AudioContext();
    nodes = buildSound(context);
  }
  if (context.state === 'suspended') void context.resume();
}

export function isSoundRunning() {
  return context?.state === 'running';
}

function noiseBuffer(audio: AudioContext) {
  const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  return buffer;
}

function loopingNoise(audio: AudioContext, buffer: AudioBuffer) {
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

// Soft clipping, which gives the oscillators a gritty, mechanical edge
function distortionCurve(amount: number) {
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index++) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

function buildSound(audio: AudioContext): SoundNodes {
  const master = audio.createGain();
  master.gain.value = 0;
  const compressor = audio.createDynamicsCompressor();
  master.connect(compressor).connect(audio.destination);

  // Engine: a sawtooth at the firing rate (one bang every two turns of the crank) under a stronger, detuned
  // one at the crank rate, driven into soft clipping, through a lowpass that opens up with revs and throttle
  const thump = audio.createOscillator();
  thump.type = 'sawtooth';
  const rev = audio.createOscillator();
  rev.type = 'sawtooth';
  const thumpLevel = audio.createGain();
  thumpLevel.gain.value = 0.45;
  const revLevel = audio.createGain();
  revLevel.gain.value = 0.65;
  const shaper = audio.createWaveShaper();
  shaper.curve = distortionCurve(4);
  const engineFilter = audio.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.Q.value = 2;
  // Cut the deep rumble under about 300 Hz so it sounds like a small, high-revving 250 rather than a big twin
  const rumbleCut = audio.createBiquadFilter();
  rumbleCut.type = 'highpass';
  rumbleCut.frequency.value = 300;
  rumbleCut.Q.value = 0.7;
  const engineGain = audio.createGain();
  engineGain.gain.value = 0;
  thump.connect(thumpLevel).connect(shaper);
  rev.connect(revLevel).connect(shaper);
  shaper.connect(rumbleCut).connect(engineFilter).connect(engineGain).connect(master);

  // Rev limiter: a fast on-off chop of the engine's level
  const limiterLfo = audio.createOscillator();
  limiterLfo.type = 'square';
  limiterLfo.frequency.value = 24;
  const limiterDepth = audio.createGain();
  limiterDepth.gain.value = 0;
  limiterLfo.connect(limiterDepth).connect(engineGain.gain);

  const noise = noiseBuffer(audio);

  // Exhaust rasp: band-passed noise pulsed by the firing rate
  const raspFilter = audio.createBiquadFilter();
  raspFilter.type = 'bandpass';
  raspFilter.Q.value = 0.9;
  const raspGain = audio.createGain();
  raspGain.gain.value = 0;
  const raspDepth = audio.createGain();
  raspDepth.gain.value = 0;
  thump.connect(raspDepth).connect(raspGain.gain);
  loopingNoise(audio, noise).connect(raspFilter).connect(raspGain).connect(master);

  // Wind: low rumble of noise that builds with speed
  const windFilter = audio.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 500;
  const windGain = audio.createGain();
  windGain.gain.value = 0;
  loopingNoise(audio, noise).connect(windFilter).connect(windGain).connect(master);

  // Tire skid: a narrower hiss
  const skidFilter = audio.createBiquadFilter();
  skidFilter.type = 'bandpass';
  skidFilter.frequency.value = 1400;
  skidFilter.Q.value = 1.5;
  const skidGain = audio.createGain();
  skidGain.gain.value = 0;
  loopingNoise(audio, noise).connect(skidFilter).connect(skidGain).connect(master);

  for (const oscillator of [thump, rev, limiterLfo]) oscillator.start();
  return { master, thump, rev, engineFilter, engineGain, limiterDepth, raspDepth, raspFilter, windGain, skidGain, noise };
}

// A short low thump of filtered noise, louder the longer the bike was in the air
function playLanding(audio: AudioContext, sound: SoundNodes, strength: number) {
  const source = audio.createBufferSource();
  source.buffer = sound.noise;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  const gain = audio.createGain();
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0.9 * strength, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  source.connect(filter).connect(gain).connect(sound.master);
  source.start(now);
  source.stop(now + 0.4);
}

// Once per rendered frame
export function updateBikeSound(frameSeconds: number) {
  if (!context || !nodes || context.state !== 'running') return;
  const audio = context;
  const sound = nodes;
  const now = audio.currentTime;
  const glide = 0.03;
  const isCrashed = state.crashTimeRemaining > 0;

  sound.master.gain.setTargetAtTime(soundSettings.muted ? 0 : soundSettings.volume, now, 0.05);

  // Engine: pitch from the revs, loudness and brightness from how hard it's working
  const rpm = isCrashed ? 1800 : Math.max(1500, state.engineRpm);
  const throttle = isCrashed ? 0 : controls.throttle;
  const firingHz = rpm / 120;
  sound.thump.frequency.setTargetAtTime(firingHz, now, glide);
  sound.rev.frequency.setTargetAtTime((rpm / 60) * 1.006, now, glide);
  sound.engineFilter.frequency.setTargetAtTime(450 + rpm * 0.15 + 2200 * throttle, now, glide);
  const engineLevel = isCrashed ? 0.025 : 0.05 + 0.02 * (rpm / 14000) + 0.085 * throttle;
  const limiterChop = state.isOnRevLimiter && !isCrashed ? 0.5 * engineLevel : 0;
  sound.engineGain.gain.setTargetAtTime(engineLevel - limiterChop, now, glide);
  sound.limiterDepth.gain.setTargetAtTime(limiterChop, now, glide);
  sound.raspFilter.frequency.setTargetAtTime(600 + rpm * 0.15, now, glide);
  sound.raspDepth.gain.setTargetAtTime(0.008 + 0.04 * throttle, now, glide);

  const speed = Math.abs(vehicle.currentVehicleSpeed());
  sound.windGain.gain.setTargetAtTime(Math.min(0.35, 0.35 * (speed / 30) ** 2), now, 0.1);

  // Skid: the rear stepped out, or a locked wheel dragging, on the ground and moving
  const isLocked = state.wheelLocked[rearWheelIndex] || state.wheelLocked[frontWheelIndex];
  const skid = state.isInAir || speed < 2 ? 0 : Math.max(state.rearSlideAmount, isLocked ? 0.8 : 0);
  sound.skidGain.gain.setTargetAtTime(0.18 * skid, now, 0.05);

  if (state.isInAir) airSeconds += frameSeconds;
  if (wasInAir && !state.isInAir && airSeconds > 0.25) playLanding(audio, sound, Math.min(1, airSeconds / 1.5));
  if (!state.isInAir) airSeconds = 0;
  wasInAir = state.isInAir;
}
