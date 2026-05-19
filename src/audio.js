// Retro chiptune audio for the game.
// Everything here is SYNTHESIZED with the Web Audio API — no sound files.
// Square/triangle waves give that classic 8-bit arcade feel.

let ctx = null; // the Web Audio "engine"
let sfxGain = null; // volume knob for sound effects
let bgmGain = null; // volume knob for background music
let muted = false;
let bgmStarted = false;

// Note name → frequency in Hz. Used by the music below.
const NOTE = {
  A2: 110.0, C3: 130.81, E3: 164.81, F3: 174.61, G3: 196.0,
  A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99,
};

// Browsers block audio until the user interacts with the page.
// We create the audio engine on the first click.
function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    sfxGain = ctx.createGain();
    bgmGain = ctx.createGain();
    sfxGain.gain.value = 1;
    bgmGain.gain.value = 1;
    sfxGain.connect(ctx.destination);
    bgmGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Play a single beep. `dest` decides if it's a sound effect or music.
function playNote(freq, start, dur, type, vol, dest) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // Quick fade in, then fade out — avoids clicks and sounds retro.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

// ---- Sound effects ----
export function sfx(name) {
  getCtx();
  const t = ctx.currentTime;
  const beep = (freq, dur, type, vol) =>
    playNote(freq, t, dur, type, vol, sfxGain);

  switch (name) {
    case "click": // button press
      playNote(330, t, 0.07, "square", 0.25, sfxGain);
      break;
    case "tick": // countdown "3", "2", "1"
      beep(660, 0.12, "square", 0.3);
      break;
    case "shoot": // countdown "SHOOT!"
      playNote(440, t, 0.05, "square", 0.3, sfxGain);
      playNote(990, t + 0.05, 0.2, "square", 0.32, sfxGain);
      break;
    case "win": // you win a round — happy rising arpeggio
      [523, 659, 784, 1047].forEach((f, i) =>
        playNote(f, t + i * 0.09, 0.16, "square", 0.28, sfxGain)
      );
      break;
    case "lose": // app wins a round — sad falling tones
      [392, 330, 262, 196].forEach((f, i) =>
        playNote(f, t + i * 0.12, 0.2, "sawtooth", 0.24, sfxGain)
      );
      break;
    case "tie": // tie — two flat beeps
      playNote(440, t, 0.13, "square", 0.22, sfxGain);
      playNote(440, t + 0.2, 0.13, "square", 0.22, sfxGain);
      break;
    case "matchWin": // you win the match — fanfare
      [523, 523, 784, 784, 1047, 1319].forEach((f, i) =>
        playNote(f, t + i * 0.13, 0.22, "square", 0.3, sfxGain)
      );
      break;
    case "matchLose": // app wins the match — descending "game over"
      [440, 392, 330, 262, 196].forEach((f, i) =>
        playNote(f, t + i * 0.18, 0.3, "sawtooth", 0.26, sfxGain)
      );
      break;
  }
}

// ---- Background music: a looping chiptune ----
// The song is 16 short steps (eighth notes). Two layers: a square-wave
// lead melody and a triangle-wave bassline. 0 means "rest" (silence).
const LEAD = [
  NOTE.E5, 0, NOTE.C5, NOTE.E5, NOTE.G5, 0, NOTE.E5, NOTE.C5,
  NOTE.D5, 0, NOTE.A4, NOTE.C5, NOTE.E5, 0, NOTE.D5, 0,
];
const BASS = [
  NOTE.A2, 0, 0, 0, NOTE.A2, 0, 0, 0,
  NOTE.F3, 0, 0, 0, NOTE.G3, 0, 0, 0,
];
const STEP = 0.214; // seconds per step (~140 bpm)
const LOOP_LEN = LEAD.length * STEP;

// Queue up one full pass of the song starting at `startTime`.
function scheduleLoop(startTime) {
  LEAD.forEach((freq, i) => {
    if (freq) playNote(freq, startTime + i * STEP, STEP * 0.9, "square", 0.09, bgmGain);
  });
  BASS.forEach((freq, i) => {
    if (freq) playNote(freq, startTime + i * STEP, STEP * 3.5, "triangle", 0.14, bgmGain);
  });
}

// Start the music. It schedules loops slightly ahead of time, forever.
export function startBgm() {
  if (bgmStarted) return;
  getCtx();
  bgmStarted = true;
  let nextLoopTime = ctx.currentTime + 0.15;

  function scheduler() {
    // Keep the next ~1.5s of music queued up.
    while (nextLoopTime < ctx.currentTime + 1.5) {
      scheduleLoop(nextLoopTime);
      nextLoopTime += LOOP_LEN;
    }
    setTimeout(scheduler, 300);
  }
  scheduler();
}

// ---- Mute toggle ----
// Muting just turns the volume knobs to 0 — the music keeps running
// silently so it's in sync the moment you unmute.
export function toggleMute() {
  muted = !muted;
  getCtx();
  const level = muted ? 0 : 1;
  sfxGain.gain.value = level;
  bgmGain.gain.value = level;
  return muted;
}

export function isMuted() {
  return muted;
}
