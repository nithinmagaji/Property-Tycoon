let audioOn = true;
let audioCtx = null;
let bgOsc = null;
let bgGain = null;
let bgLfo = null;

export function setSoundEnabled(on) {
  audioOn = on;
  if (!on) stopSoundtrack();
}

export function isSoundOn() {
  return audioOn;
}

export function sfx(freq = 440, dur = 0.09, volume = 0.045) {
  if (!audioOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.frequency.value = freq;
    o.type = "sine";
    g.gain.setValueAtTime(volume, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch {
    /* audio blocked */
  }
}

export function sfxRoll() {
  sfx(220, 0.05, 0.03);
  setTimeout(() => sfx(280, 0.05, 0.03), 60);
}

export function sfxBuy() {
  sfx(660, 0.12, 0.05);
}

export function sfxBuild() {
  sfx(520, 0.08, 0.04);
  setTimeout(() => sfx(780, 0.1, 0.04), 80);
}

export function startSoundtrack(_game) {
  stopSoundtrack();
}

export function stopSoundtrack() {
  try {
    bgLfo?.stop();
    bgLfo = null;
    if (bgOsc) {
      bgOsc.stop();
      bgOsc = null;
    }
    bgGain = null;
  } catch {
    bgOsc = null;
    bgLfo = null;
    bgGain = null;
  }
}

export function resumeSoundtrackIfEnabled(_game) {
  stopSoundtrack();
}
