import { SPEECH_RATE_VALUES } from "./mapData.js";

let hapticResetTimer = null;
let lastVoiceKey = "";

function renderHapticBars(pattern) {
  if (!Array.isArray(pattern)) {
    const width = Math.max(16, Math.min(48, Math.round((Number(pattern) || 120) / 8)));
    return `<span class="haptic-pulse" style="width:${width}px"></span>`;
  }
  return pattern
    .filter((_, idx) => idx % 2 === 0)
    .map((ms) => {
      const width = Math.max(12, Math.min(48, Math.round(ms / 10)));
      return `<span class="haptic-pulse" style="width:${width}px" title="${ms}ms vibration"></span>`;
    })
    .join("");
}

function getPatternDurationMs(pattern) {
  if (!Array.isArray(pattern)) return Number(pattern) || 120;
  return pattern.reduce((sum, ms) => sum + ms, 0);
}

export function renderHapticIdle(hapticEl = document.querySelector("#hapticIndicator")) {
  if (!hapticEl) return;
  hapticEl.classList.remove("active");
  hapticEl.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px">
      <span class="icon" style="font-size:1.15em">vibration</span>
      <span>HAPTIC IDLE</span>
    </span>
    <span style="font-weight:600;opacity:0.75">Ready</span>
  `;
}

export function triggerVibration(pattern, label = "Vibration pulse") {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {}

  const hapticEl = document.querySelector("#hapticIndicator");
  if (!hapticEl) return;

  clearTimeout(hapticResetTimer);
  hapticEl.classList.add("active");
  hapticEl.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px;min-width:0">
      <span class="icon" style="font-size:1.15em;color:#38bdf8">vibration</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
    </span>
    <span class="haptic-blocks">${renderHapticBars(pattern)}</span>
  `;

  const holdMs = Math.max(1100, getPatternDurationMs(pattern) + 600);
  hapticResetTimer = setTimeout(() => renderHapticIdle(hapticEl), holdMs);
}

export function stopHaptics() {
  clearTimeout(hapticResetTimer);
  hapticResetTimer = null;
  try {
    if (navigator.vibrate) navigator.vibrate(0);
  } catch (e) {}
  renderHapticIdle();
}

function getHapticCueForText(text) {
  if (/left/i.test(text)) return [[120, 80, 120], "Left turn · 2 short"];
  if (/right/i.test(text)) return [[420], "Right turn · 1 long"];
  if (/obstacle|stop|hazard|fire|fall|help/i.test(text)) return [[500, 120, 500, 120, 500], "Alert · 3 long"];
  return [[90], "Nav cue · short pulse"];
}

export function renderLiveBanner(state, liveEl, force = false) {
  if (!liveEl) return;
  const text = state.liveText || "Select a destination or tap the mic to begin.";
  const modeKey = state.deafblindMode
    ? "deafblind"
    : state.inQuietZone
    ? "quiet"
    : state.muted
    ? "muted"
    : `voice:${state.volume}`;
  const key = `${modeKey}|${text}`;
  if (!force && key === lastVoiceKey) return;
  lastVoiceKey = key;

  const modeBadge = state.deafblindMode
    ? `<span class="icon" style="color:#38bdf8">volume_off</span><span style="color:#38bdf8">AUDIO OFF · DEAFBLIND MODE</span>`
    : state.inQuietZone
    ? `<span class="icon" style="color:#38bdf8">volume_off</span><span style="color:#38bdf8">QUIET ZONE · AUDIO OFF</span>`
    : state.muted
    ? `<span class="icon" style="color:#fb923c">volume_mute</span><span style="color:#fb923c">MUTED · VISUAL CAPTIONS</span>`
    : `<span class="icon" style="color:#ffd60a">volume_up</span><span style="color:#ffd60a">VOICE (${state.volume}%)</span>`;

  liveEl.innerHTML = `
    <div class="sensory-meter">${modeBadge}</div>
    <div style="color:${state.liveText ? "#ffffff" : "#a1a1aa"};font-weight:${state.liveText ? "500" : "400"}">${text}</div>
  `;
}

let audioCtx = null;

export function playEarcon(type, state) {
  if (state?.audioChimes === false || state?.deafblindMode || state?.inQuietZone || state?.muted) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const vol = Math.max(0.03, Math.min(0.22, ((state?.volume ?? 55) / 100) * 0.2));
    const patterns = {
      turn: [
        [523.25, 0, 0.08],
        [659.25, 0.09, 0.09]
      ],
      alert: [
        [349.23, 0, 0.11],
        [349.23, 0.14, 0.12]
      ],
      arrived: [
        [523.25, 0, 0.08],
        [659.25, 0.09, 0.08],
        [783.99, 0.18, 0.14]
      ],
      confirm: [[587.33, 0, 0.05]]
    };
    const notes = patterns[type] || patterns.confirm;
    const now = audioCtx.currentTime;

    notes.forEach(([freq, offset, dur]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type === "alert" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(vol, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + dur + 0.02);
    });
  } catch (e) {}
}

let speakTimer = null;
let speechDonePromise = Promise.resolve();
let resolveSpeechDone = null;
let speechFallbackTimer = null;

function finishSpeechTracking() {
  clearTimeout(speechFallbackTimer);
  speechFallbackTimer = null;
  if (resolveSpeechDone) {
    const res = resolveSpeechDone;
    resolveSpeechDone = null;
    res();
  }
}

export function stopSpeech() {
  clearTimeout(speakTimer);
  speakTimer = null;
  finishSpeechTracking();
  try {
    speechSynthesis.cancel();
  } catch (e) {}
}

export function waitForSpeech(maxWaitMs = 6500) {
  return Promise.race([
    speechDonePromise,
    new Promise((resolve) => setTimeout(resolve, maxWaitMs))
  ]);
}

function toSpokenPhrase(text) {
  return text
    .replace(/\b(\d+(?:\.\d+)?)\s*m\b/g, (_, n) => `${n} ${Number(n) === 1 ? "meter" : "meters"}`)
    .replace(/\b(\d+(?:\.\d+)?)\s*ft\b/g, (_, n) => `${n} ${Number(n) === 1 ? "foot" : "feet"}`);
}

export function announceOutput(text, state, logFn, liveEl) {
  state.liveText = text;
  const useHaptic = state.deafblindMode || state.inQuietZone;

  stopSpeech();
  renderLiveBanner(state, liveEl, true);
  logFn((useHaptic ? "Haptic: " : "Speak: ") + text);

  if (useHaptic) {
    const [pattern, label] = getHapticCueForText(text);
    triggerVibration(pattern, label);
    return;
  }
  if (state.muted) return;

  const spokenText = toSpokenPhrase(text);
  const volume = Math.max(0, Math.min(1, state.volume / 100));
  const rate = SPEECH_RATE_VALUES[Number(state.speechRate)] ?? 1.0;

  if (volume > 0 && typeof SpeechSynthesisUtterance !== "undefined") {
    speechDonePromise = new Promise((resolve) => {
      resolveSpeechDone = resolve;
    });
    const estMs = Math.max(1600, Math.min(8000, Math.round((spokenText.split(/\s+/).length * 420) / rate)));
    speechFallbackTimer = setTimeout(finishSpeechTracking, estMs);
  }

  speakTimer = setTimeout(() => {
    try {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.volume = volume;
      utterance.rate = rate;
      utterance.onend = finishSpeechTracking;
      utterance.onerror = finishSpeechTracking;
      if (speechSynthesis.paused) speechSynthesis.resume();
      speechSynthesis.speak(utterance);
    } catch (e) {
      finishSpeechTracking();
    }
  }, 25);
}

export function createFallDetector(onFallDetected, logFn) {
  let freeFallStart = 0;
  let freeFallEnd = 0;

  function processSample(timestampMs, gForce) {
    let triggered = false;
    if (gForce < 0.4) {
      if (!freeFallStart) freeFallStart = timestampMs;
    } else {
      if (freeFallStart && timestampMs - freeFallStart >= 100) {
        freeFallEnd = timestampMs;
      }
      freeFallStart = 0;
    }

    if (freeFallEnd && gForce > 2.5 && timestampMs - freeFallEnd < 1000) {
      freeFallEnd = 0;
      triggered = true;
      logFn(`Fall pattern confirmed: free-fall + ${gForce.toFixed(1)}g impact`);
      onFallDetected("Fall detected");
    }

    if (freeFallEnd && timestampMs - freeFallEnd >= 1000) {
      freeFallEnd = 0;
    }

    if (!triggered && !freeFallEnd && gForce > 2.5) {
      logFn(`Impact spike (${gForce.toFixed(1)}g) ignored (no free-fall phase)`);
    }
  }

  function feedSimulatedStream(samples) {
    freeFallStart = 0;
    freeFallEnd = 0;
    let idx = 0;
    const timer = setInterval(() => {
      if (idx >= samples.length) return clearInterval(timer);
      processSample(idx * 20, samples[idx++]);
    }, 20);
  }

  return { processSample, feedSimulatedStream };
}
