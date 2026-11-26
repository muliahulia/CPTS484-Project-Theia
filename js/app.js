import {
  MAP_NODES,
  MAP_EDGES,
  PLACES,
  SPEECH_RATES,
  INSTRUCTION_FREQUENCIES,
  FREQUENCY_THRESHOLDS,
  TEXT_SIZES,
  TEXT_SCALE_VALUES
} from "./mapData.js";
import {
  formatDistance,
  calculatePath,
  formatStepInstruction,
  summarizeRoute
} from "./routing.js";
import {
  triggerVibration,
  announceOutput,
  renderLiveBanner,
  renderHapticIdle,
  stopHaptics,
  stopSpeech,
  createFallDetector
} from "./sensors.js";
import { renderScreen, getCurrentCoordinates } from "./ui.js";

const $ = (sel) => document.querySelector(sel);

const PROFILES = [
  "Blind - White cane user",
  "Blind - Guide dog user",
  "Deafblind - Haptic communication only",
  "Low vision - High contrast visual aid"
];

function createInitialState() {
  return {
    screen: "dest",
    showSafetyGate: true,
    destination: null,
    routeMode: "comfort",
    routes: {},
    route: null,
    nav: null,
    units: "Feet",
    speechRate: 1,
    volume: 55,
    frequency: 1,
    textSize: 1,
    highContrast: false,
    strideFeet: 0,
    hallwayClosed: false,
    highCrowd: false,
    signalAvailable: true,
    inQuietZone: false,
    cachedMaps: { sch: true },
    countdown: 10,
    alertSent: false,
    emergencyReason: "Fall detected",
    prevScreen: "dest",
    fireReturnSnapshot: null,
    autoWalkTimer: null,
    sensorsEnabled: false,
    routeDeltaFt: 0,
    rerouteReason: "",
    obstacleLabel: "Floor-level obstacle detected 3 ft ahead",
    encounteredNaturalObstacles: [],
    reportedHazards: [],
    muted: false,
    deafblindMode: false,
    isReturnTrip: false,
    pinEntry: "",
    pendingCaretakerSync: false,
    askBeforeSaving: true,
    showAddContactForm: false,
    showCalendarPrompt: false,
    mapViewFloor: null,
    liveText: "",
    disabilityProfile: PROFILES[0],
    contacts: [
      { name: "Scott - Brother", phone: "(123) 456-7890", enabled: true },
      { name: "John - Father", phone: "(123) 456-7890", enabled: true },
      { name: "Campus Security & Dispatch", phone: "WSU Police", enabled: true }
    ]
  };
}

let state = createInitialState();
let telemetryLogs = [];
let emergencyTimer = null;
let speechRecognizer = null;
let hapticPreviewTimers = [];
let lastRenderedScreen = null;
let lastScreenHtml = "";
let lastScreenPatchKey = "";
let lastHeaderHtml = "";
let lastNavHtml = "";
let lastModalHtml = "";

function clearHapticPreviews() {
  hapticPreviewTimers.forEach(clearTimeout);
  hapticPreviewTimers = [];
}

try {
  const saved = JSON.parse(localStorage.getItem("theia_v3") || "{}");
  Object.assign(state, saved);
  if (state.textSize >= TEXT_SCALE_VALUES.length || state.textSize < 0) state.textSize = 1;
} catch (e) {}

function persistPreferences() {
  try {
    localStorage.setItem(
      "theia_v3",
      JSON.stringify({
        units: state.units,
        speechRate: state.speechRate,
        volume: state.volume,
        frequency: state.frequency,
        textSize: state.textSize,
        highContrast: state.highContrast,
        deafblindMode: state.deafblindMode,
        askBeforeSaving: state.askBeforeSaving,
        strideFeet: state.strideFeet,
        contacts: state.contacts,
        disabilityProfile: state.disabilityProfile
      })
    );
  } catch (e) {}
}

function logEvent(msg) {
  const time = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  telemetryLogs.push(`${time}  ${msg}`);
  const logEl = $("#systemLog");
  logEl.innerHTML = telemetryLogs.slice(-60).join("<br>");
  logEl.scrollTop = 1e9;
}

const speak = (text) => announceOutput(text, state, logEvent, $("#liveBanner"));

function currentLocationLabel() {
  const step = state.nav && state.route?.[state.nav.stepIndex];
  const floor = step ? MAP_NODES[step.from][2] : 1;
  const landmark = step ? MAP_NODES[step.from][3] : "Main Atrium Entrance";
  return `Schweitzer Engineering Hall, Floor ${floor}, near ${landmark}`;
}

function stopAutoWalk() {
  clearInterval(state.autoWalkTimer);
  state.autoWalkTimer = null;
  if (state.pendingCaretakerSync) {
    state.pendingCaretakerSync = false;
    persistPreferences();
    logEvent("NFR-13: User stationary - queued caretaker settings applied.");
    speak("Caretaker settings updated.");
  }
}

function planRoutes() {
  state.nav = null;
  state.isReturnTrip = false;
  state.mapViewFloor = null;
  state.routes = {
    comfort: calculatePath("ENT", state.destination.node, "comfort", state),
    short: calculatePath("ENT", state.destination.node, "short", state)
  };
  state.route = state.routes[state.routeMode];
}

function beginTurnByTurn() {
  state.nav = { stepIndex: 0, feetLeft: state.route[0].feet };
  state.inQuietZone = false;
  state.mapViewFloor = null;
  state.screen = "nav";
  speak(formatStepInstruction(state.route[0], state.units));
  renderApp();
}

function triggerDynamicReroute(reason) {
  const nav = state.nav;
  const currentStep = state.route[nav.stepIndex];
  const edge = MAP_EDGES[currentStep.edgeIndex];
  const currentBlocked =
    (edge.sideHallway && state.hallwayClosed) ||
    (edge.mainCorridor && state.highCrowd);

  const remainingBefore =
    nav.feetLeft +
    state.route.slice(nav.stepIndex + 1).reduce((acc, s) => acc + s.feet, 0);

  const originNode = currentBlocked ? currentStep.from : currentStep.to;
  const keptSteps = currentBlocked ? [] : [currentStep];
  const newPath = calculatePath(originNode, state.destination.node, state.routeMode, state);

  if (!newPath) {
    stopAutoWalk();
    speak("No accessible route is available. Stay in place and call for help if needed.");
    return;
  }

  state.route = keptSteps.concat(newPath);
  nav.stepIndex = 0;
  nav.feetLeft = currentBlocked ? newPath[0].feet : nav.feetLeft;
  state.routeDeltaFt = summarizeRoute(state.route).feet - remainingBefore;
  state.rerouteReason = reason;
  state.screen = "reroute";
  stopAutoWalk();

  speak(`Your route has changed. ${reason} A new accessible route was found.`);
  logEvent(`Rerouted (${reason}): new total ${formatDistance(summarizeRoute(state.route).feet, state.units)}`);
  renderApp();
}

// Unified 10-second Emergency Countdown (FR-4 / PF-6) - Highest Safety Priority
function startEmergencyCountdown(reason) {
  if (state.screen === "emg") return;
  stopAutoWalk();
  state.showSafetyGate = false;
  state.showCalendarPrompt = false;
  state.showAddContactForm = false;
  state.prevScreen = state.screen;
  state.screen = "emg";
  state.alertSent = false;
  state.emergencyReason = reason;
  state.countdown = 10;

  speak(`${reason}. Calling for help in 10 seconds. Say cancel alert if you are okay.`);
  triggerVibration([300, 100, 300], "Emergency alert");

  clearInterval(emergencyTimer);
  emergencyTimer = setInterval(() => {
    if (state.screen !== "emg" || state.alertSent) return clearInterval(emergencyTimer);
    state.countdown--;
    triggerVibration(80, `Countdown · ${state.countdown}s`);
    if (state.countdown <= 0) dispatchEmergency(`${reason} (no response)`);
    else renderApp();
  }, 1000);

  startSpeechRecognition();
  renderApp();
}

const fallDetector = createFallDetector((reason) => startEmergencyCountdown(reason), logEvent);

function dispatchEmergency(reason) {
  clearInterval(emergencyTimer);
  state.alertSent = true;
  const recipients = state.contacts
    .filter((c) => c.enabled)
    .map((c) => c.name.split(" - ")[0])
    .join(", ");

  logEvent(
    `DISPATCH (simulated) to [${recipients}]: ${reason} | Location: ${currentLocationLabel()} | Profile: ${state.disabilityProfile}`
  );
  speak("Help has been requested with your accessibility profile attached. Stay where you are.");
  renderApp();
}

function startSpeechRecognition() {
  try {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    speechRecognizer = new Recognition();
    speechRecognizer.lang = "en-US";
    speechRecognizer.onresult = (e) => handleSpokenText(e.results[0][0].transcript);
    speechRecognizer.start();
  } catch (e) {}
}

function handleSpokenText(transcript) {
  logEvent(`Heard: “${transcript}”`);
  const lower = transcript.toLowerCase();

  if (state.screen === "emg" && /cancel|okay/.test(lower)) return actions.cancelEmergency();
  if (state.screen === "nav" && /repeat/.test(lower)) return actions.repeatInstruction();
  if (state.screen === "nav" && /hazard/.test(lower)) return actions.reportHazard();
  if (/mute/.test(lower) && ["nav", "fire"].includes(state.screen)) return actions.toggleMute();

  if (state.screen === "dest" || state.screen === "voice") {
    state.heardText = transcript;
    state.voiceCandidate = /bath|restroom|accessible/.test(lower)
      ? "BATH"
      : /105/.test(lower)
      ? "R105"
      : /214|class/.test(lower)
      ? "R214"
      : null;
    state.screen = "voice";
    renderApp();
  }
}

// Actions
const actions = {
  acceptGate() {
    stopSpeech();
    state.showSafetyGate = false;
    renderApp();
  },
  goScreen(target) {
    stopAutoWalk();
    stopSpeech();
    clearHapticPreviews();
    if (state.screen === "emg") {
      clearInterval(emergencyTimer);
      state.alertSent = false;
    }
    state.pinEntry = "";
    state.showAddContactForm = false;
    state.screen = target;
    renderApp();
  },
  startVoiceInput() {
    state.screen = "voice";
    state.heardText = "";
    state.voiceCandidate = null;
    speak("I'm listening. Say a room, place, or facility type.");
    startSpeechRecognition();
    renderApp();
  },
  retryVoice() {
    stopSpeech();
    state.heardText = "";
    state.voiceCandidate = null;
    startSpeechRecognition();
    renderApp();
  },
  simulateVoicePhrase(phrase) {
    handleSpokenText(phrase);
  },
  pickPlace(idx) {
    const place = PLACES[Number(idx)];
    if (place.external) {
      speak(`${place.name} is outside this prototype's map. Select Room 105, Room 214, or Accessible Bathroom.`);
      return;
    }
    stopSpeech();
    state.destination = { name: place.name, node: place.node };
    state.routeMode = "comfort";
    planRoutes();
    state.screen = "route";
    renderApp();
  },
  confirmVoice() {
    stopSpeech();
    const place = PLACES.find((p) => p.node === state.voiceCandidate);
    state.destination = { name: place.name, node: place.node };
    state.routeMode = "comfort";
    planRoutes();
    state.screen = "route";
    renderApp();
  },
  selectMode(mode) {
    stopSpeech();
    state.routeMode = mode;
    state.route = state.routes[mode];
    state.mapViewFloor = null;
    renderApp();
  },
  setMapFloor(floorVal) {
    state.mapViewFloor = Number(floorVal);
    renderApp();
  },
  startRoute() {
    if (!state.route) return;
    if (state.isReturnTrip) return beginTurnByTurn();
    state.screen = "entr";
    speak("You are at Schweitzer Engineering Hall. Switching to indoor navigation.");
    renderApp();
  },
  continueIndoor() {
    beginTurnByTurn();
  },
  resumeAfterReroute() {
    state.screen = "nav";
    speak(formatStepInstruction(state.route[state.nav.stepIndex], state.units));
    renderApp();
  },
  repeatInstruction() {
    const nav = state.nav;
    if (state.screen === "obs") {
      speak(`${state.obstacleLabel}. Follow the arrow around the obstacle when safe.`);
    } else if (state.screen === "reroute") {
      speak("Your route has changed. Continue on the new route.");
    } else if (state.screen === "sig") {
      speak("Please stop. Your location is inaccurate. Stay in place while THEIA reconnects.");
    } else if (nav) {
      speak(formatStepInstruction(state.route[nav.stepIndex], state.units));
    }
  },
  walk() {
    const nav = state.nav;
    if (!["nav", "fire"].includes(state.screen) || !nav) return;

    const currentStep = state.route[nav.stepIndex];
    const prevLeft = nav.feetLeft;
    const threshold = FREQUENCY_THRESHOLDS[state.frequency] ?? 30;
    nav.feetLeft = Math.max(0, nav.feetLeft - 10);

    // Trigger realistic built-in obstacle once when walking toward Room 105
    if (
      state.screen === "nav" &&
      currentStep.naturalObstacle &&
      nav.feetLeft <= 20 &&
      nav.feetLeft > 0 &&
      !state.encounteredNaturalObstacles.includes(currentStep.edgeIndex)
    ) {
      state.encounteredNaturalObstacles.push(currentStep.edgeIndex);
      state.obstacleLabel = currentStep.naturalObstacle;
      stopAutoWalk();
      state.screen = "obs";
      speak(`Obstacle ahead, 3 feet: ${state.obstacleLabel}. Follow the arrow around it when safe.`);
      triggerVibration([200, 100, 200], "Obstacle ahead");
      logEvent(`Depth sensor: ${state.obstacleLabel} (3 ft ahead)`);
      renderApp();
      return;
    }

    if (nav.feetLeft > 0 && Math.floor(nav.feetLeft / threshold) < Math.floor(prevLeft / threshold)) {
      const stepHint =
        state.strideFeet && currentStep.type === "walk"
          ? ` (about ${Math.round(nav.feetLeft / state.strideFeet)} steps)`
          : "";
      speak(`${formatDistance(nav.feetLeft, state.units)} remaining${stepHint}`);
    }

    if (nav.feetLeft <= 0) {
      const enteredQuiet = currentStep.targetZone === "quiet";
      if (enteredQuiet && !state.inQuietZone && state.screen === "nav") {
        state.inQuietZone = true;
        logEvent("FR-28: Entered quiet study zone - switching to haptic-only cues.");
      } else if (!enteredQuiet && state.inQuietZone) {
        state.inQuietZone = false;
        logEvent("FR-28: Exited quiet zone - spoken cues restored.");
      }

      nav.stepIndex++;
      if (nav.stepIndex >= state.route.length) {
        stopAutoWalk();
        state.screen = "arr";
        state.fireReturnSnapshot = null;
        state.inQuietZone = false;
        speak(`You have arrived at ${state.destination.name}.`);
        triggerVibration(400, "Arrived at destination");
      } else {
        nav.feetLeft = state.route[nav.stepIndex].feet;
        state.mapViewFloor = null;
        speak(formatStepInstruction(state.route[nav.stepIndex], state.units));
      }
    }
    renderApp();
  },
  autoWalk() {
    if (state.autoWalkTimer) {
      stopAutoWalk();
      renderApp();
    } else {
      state.autoWalkTimer = setInterval(() => {
        if (["nav", "fire"].includes(state.screen)) {
          actions.walk();
        } else {
          stopAutoWalk();
          renderApp();
        }
      }, 700);
      renderApp();
    }
  },
  triggerObstacle() {
    if (state.screen !== "nav") return;
    stopAutoWalk();
    state.showCalendarPrompt = false;
    state.obstacleLabel = "Dropped backpack on hallway floor";
    state.screen = "obs";
    speak("Obstacle ahead, 3 feet. Follow the arrow around the obstacle when safe.");
    triggerVibration([200, 100, 200], "Obstacle ahead");
    logEvent("Depth sensor: floor-level obstacle at 3 ft.");
    renderApp();
  },
  clearObstacle() {
    if (state.screen !== "obs") return;
    if (!state.signalAvailable) {
      state.screen = "sig";
      speak("Please stop. Your location is inaccurate. Stay in place while THEIA reconnects.");
      renderApp();
      return;
    }
    state.screen = "nav";
    speak(`Path clear. ${formatStepInstruction(state.route[state.nav.stepIndex], state.units)}`);
    renderApp();
  },
  toggleClosure() {
    state.hallwayClosed = !state.hallwayClosed;
    logEvent(`Facility update: side hallway ${state.hallwayClosed ? "closed" : "reopened"}`);
    if (state.screen === "fire" && state.nav) {
      const cs = state.route[state.nav.stepIndex];
      const origin = state.nav.feetLeft > cs.feet / 2 ? cs.from : cs.to;
      const safeOrigin = origin === "ENT" ? "LOB" : origin;
      const exitPath = calculatePath(safeOrigin, "ENT", "fire", state);
      if (exitPath) {
        state.route = exitPath;
        state.nav = { stepIndex: 0, feetLeft: exitPath[0].feet };
        speak(`Exit route updated. ${formatStepInstruction(exitPath[0], state.units)}`);
      }
      renderApp();
    } else if (state.nav && ["nav", "obs"].includes(state.screen) && state.hallwayClosed) {
      triggerDynamicReroute("The side hallway is closed for maintenance.");
    } else if (state.destination && state.screen === "route") {
      planRoutes();
      renderApp();
    } else {
      renderApp();
    }
  },
  toggleCrowd() {
    state.highCrowd = !state.highCrowd;
    logEvent(`Wi-Fi density: main corridor ${state.highCrowd ? "congested (FR-22)" : "normal"}`);
    if (state.screen === "fire") {
      renderApp();
    } else if (state.nav && state.screen === "nav" && state.highCrowd) {
      triggerDynamicReroute("High crowd density detected in the East Corridor.");
    } else if (state.destination && state.screen === "route") {
      planRoutes();
      renderApp();
    } else {
      renderApp();
    }
  },
  toggleSignal() {
    state.signalAvailable = !state.signalAvailable;
    logEvent(`Positioning signal ${state.signalAvailable ? "restored" : "lost"}`);
    if (!state.signalAvailable && state.screen === "nav") {
      stopAutoWalk();
      state.showCalendarPrompt = false;
      state.screen = "sig";
      speak("Please stop. Your location is inaccurate. Stay in place while THEIA reconnects.");
    } else if (state.signalAvailable && state.screen === "sig") {
      state.screen = "nav";
      speak(`Location restored. ${formatStepInstruction(state.route[state.nav.stepIndex], state.units)}`);
    }
    renderApp();
  },
  triggerFireAlarm() {
    if (state.screen === "emg") {
      logEvent("Fire alarm detected — maintaining active emergency dispatch priority.");
      return;
    }
    stopAutoWalk();
    if (state.screen !== "fire") {
      state.fireReturnSnapshot = {
        screen: state.screen,
        destination: state.destination,
        routeMode: state.routeMode,
        routes: state.routes,
        route: state.route,
        nav: state.nav ? { ...state.nav } : null,
        isReturnTrip: state.isReturnTrip,
        inQuietZone: state.inQuietZone
      };
    }
    state.showCalendarPrompt = false;
    state.showSafetyGate = false;
    state.showAddContactForm = false;
    state.pinEntry = "";

    let originNode = "MH1"; // Default to Floor 2 East Corridor if not actively navigating
    if (state.nav && state.route?.[state.nav.stepIndex]) {
      const cs = state.route[state.nav.stepIndex];
      if (cs.type === "elevator") {
        originNode = cs.from;
      } else {
        originNode = state.nav.feetLeft > cs.feet / 2 ? cs.from : cs.to;
      }
      if (originNode === "ENT") originNode = "LOB";
    }

    const exitPath = calculatePath(originNode, "ENT", "fire", state);
    state.route = exitPath || [{ edgeIndex: 0, from: "LOB", to: "ENT", type: "walk", feet: 40, turnAngle: 0 }];
    state.nav = { stepIndex: 0, feetLeft: state.route[0].feet };
    state.destination = { name: "Main Exterior Exit", node: "ENT" };
    state.isReturnTrip = false;
    state.inQuietZone = false;
    state.mapViewFloor = null;
    state.screen = "fire";

    speak(`Fire alarm detected. Rerouting to the nearest exterior exit. Elevators are disabled. ${formatStepInstruction(state.route[0], state.units)}.`);
    triggerVibration([500, 150, 500, 150, 500], "Fire alarm evacuation");
    logEvent(`FR-23 FIRE OVERRIDE: Elevator-free exit route active from ${MAP_NODES[originNode][3]}.`);
    renderApp();
  },
  dismissFireAlarm() {
    if (state.screen !== "fire") return;
    stopAutoWalk();
    stopSpeech();
    const snap = state.fireReturnSnapshot;
    state.fireReturnSnapshot = null;
    if (snap) {
      state.screen = snap.screen === "fire" ? "dest" : snap.screen;
      state.destination = snap.destination;
      state.routeMode = snap.routeMode;
      state.routes = snap.routes;
      state.route = snap.route;
      state.nav = snap.nav;
      state.isReturnTrip = snap.isReturnTrip;
      state.inQuietZone = snap.inQuietZone;
    } else {
      state.screen = "dest";
    }
    state.mapViewFloor = null;
    logEvent(`Fire alarm alert dismissed — resumed ${state.screen} screen.`);
    renderApp();
  },
  reportHazard() {
    if (state.screen !== "nav") return;
    stopAutoWalk();
    state.screen = "haz";
    speak("Temporary hazard report. Confirm dropping a pin at your current location?");
    renderApp();
  },
  confirmHazardPin() {
    state.reportedHazards.push(state.route[state.nav.stepIndex].edgeIndex);
    logEvent(`FR-30: Hazard pin dropped at ${currentLocationLabel()}.`);
    state.screen = "nav";
    speak("Hazard pinned. Future routes will avoid this segment.");
    renderApp();
  },
  cancelHazardPin() {
    stopSpeech();
    state.screen = "nav";
    renderApp();
  },
  toggleMute() {
    state.muted = !state.muted;
    if (state.muted) stopSpeech();
    logEvent(`Quick mute: audio ${state.muted ? "muted" : "resumed"}`);
    if (!state.muted) speak("Audio resumed.");
    renderApp();
  },
  toggleDeafblind() {
    state.deafblindMode = !state.deafblindMode;
    persistPreferences();
    logEvent(`Deafblind haptic mode ${state.deafblindMode ? "enabled" : "disabled"}`);
    speak(state.deafblindMode ? "Deafblind haptic mode on" : "Deafblind haptic mode off");
    renderApp();
  },
  saveHapticSettings() {
    persistPreferences();
    logEvent(`Haptic settings saved (Deafblind mode: ${state.deafblindMode ? "ON" : "OFF"}).`);
    speak("Haptic settings saved.");
    renderApp();
  },
  previewHaptics() {
    clearHapticPreviews();
    [
      ["Left turn · 2 short", [120, 80, 120]],
      ["Right turn · 1 long", [420]],
      ["Stop or hazard · 3 long", [500, 120, 500, 120, 500]]
    ].forEach(([label, pattern], i) => {
      const id = setTimeout(() => {
        triggerVibration(pattern, label);
        logEvent(`Preview haptic: ${label}`);
      }, i * 1400);
      hapticPreviewTimers.push(id);
    });
  },
  startNextClass() {
    stopSpeech();
    state.showCalendarPrompt = false;
    state.destination = { name: "Room 214", node: "R214" };
    state.routeMode = "comfort";
    planRoutes();
    state.screen = "route";
    renderApp();
  },
  triggerCalendarPrompt() {
    if (state.showSafetyGate || ["emg", "fire", "sig", "obs", "haz", "reroute"].includes(state.screen)) {
      logEvent("Calendar prompt deferred: higher-priority safety or navigation screen active.");
      return;
    }
    state.showCalendarPrompt = true;
    speak("Upcoming class in 5 minutes: Room 214. Your accessible route is ready.");
    renderApp();
  },
  dismissCalendarPrompt() {
    stopSpeech();
    state.showCalendarPrompt = false;
    renderApp();
  },
  returnToStart() {
    stopSpeech();
    const currentDest = state.destination.node;
    state.destination = { name: "Main Atrium Entrance", node: "ENT" };
    state.routeMode = "comfort";
    state.routes = {
      comfort: calculatePath(currentDest, "ENT", "comfort", state),
      short: calculatePath(currentDest, "ENT", "short", state)
    };
    state.route = state.routes.comfort;
    state.isReturnTrip = true;
    state.mapViewFloor = null;
    state.nav = null;
    state.screen = "route";
    renderApp();
  },
  requestHelp() {
    const reason = state.screen === "obs" ? "Help requested at obstacle" : "Emergency assistance requested";
    startEmergencyCountdown(reason);
  },
  sendEmergencyNow() {
    dispatchEmergency(`${state.emergencyReason} (confirmed immediately)`);
  },
  cancelEmergency() {
    clearInterval(emergencyTimer);
    try {
      speechRecognizer?.stop();
    } catch (e) {}
    logEvent("Emergency countdown cancelled by user.");
    state.alertSent = false;
    state.screen = state.prevScreen === "emg" ? "dest" : state.prevScreen;
    speak("Alert cancelled.");
    renderApp();
  },
  dismissEmergency() {
    stopSpeech();
    state.alertSent = false;
    state.screen = state.prevScreen === "emg" ? "dest" : state.prevScreen;
    renderApp();
  },
  simulateFall() {
    const walkStream = Array.from({ length: 40 }, (_, k) => 1 + 0.15 * Math.sin(k * 0.9));
    fallDetector.feedSimulatedStream([...walkStream, ...Array(15).fill(0.15), 3.2, ...Array(10).fill(1)]);
    logEvent("Simulated fall: feeding free-fall + impact telemetry.");
  },
  simulateBump() {
    const walkStream = Array.from({ length: 20 }, (_, k) => 1 + 0.15 * Math.sin(k * 0.9));
    fallDetector.feedSimulatedStream([...walkStream, 3.0, ...Array(10).fill(1)]);
    logEvent("Simulated bump: feeding impact spike without free-fall.");
  },
  async enableSensors() {
    try {
      if (DeviceMotionEvent.requestPermission && (await DeviceMotionEvent.requestPermission()) !== "granted") {
        return logEvent("Device motion permission denied.");
      }
      if (state.sensorsEnabled) return;
      state.sensorsEnabled = true;
      window.addEventListener("devicemotion", (e) => {
        const acc = e.accelerationIncludingGravity;
        if (acc) fallDetector.processSample(performance.now(), Math.hypot(acc.x, acc.y, acc.z) / 9.81);
      });
      logEvent("Live hardware accelerometer attached.");
      renderApp();
    } catch (e) {
      logEvent("Hardware motion sensor unavailable in this browser.");
    }
  },
  submitSpeech() {
    const input = $("#speechInput");
    if (input.value.trim()) handleSpokenText(input.value.trim());
    input.value = "";
  },
  resetDemo() {
    stopAutoWalk();
    stopSpeech();
    stopHaptics();
    clearHapticPreviews();
    clearInterval(emergencyTimer);
    try {
      localStorage.removeItem("theia_v3");
    } catch (e) {}
    state = createInitialState();
    state.showSafetyGate = false;
    lastRenderedScreen = null;
    lastScreenHtml = "";
    lastScreenPatchKey = "";
    telemetryLogs = [];
    renderApp();
    logEvent("Demo reset.");
  },
  cyclePref(key) {
    if (key === "units") state.units = state.units === "Feet" ? "Meters" : "Feet";
    else if (key === "highContrast") state.highContrast = !state.highContrast;
    else if (key === "textSize") state[key] = (state[key] + 1) % TEXT_SIZES.length;
    else state[key] = (state[key] + 1) % 3;
    persistPreferences();
    renderApp();
  },
  pinKey(val) {
    if (val === "Clear") state.pinEntry = "";
    else if (val === "Back") state.pinEntry = state.pinEntry.slice(0, -1);
    else if (state.pinEntry.length < 4) state.pinEntry += String(val);

    if (state.pinEntry.length === 4) {
      if (state.pinEntry === "1234") {
        state.pinEntry = "";
        state.screen = "caretaker";
        logEvent("FR-26: Caretaker PIN verified.");
      } else {
        speak("Incorrect PIN. Try 1 2 3 4.");
        state.pinEntry = "";
      }
    }
    renderApp();
  },
  toggleContact(idx) {
    state.contacts[idx].enabled = !state.contacts[idx].enabled;
    renderApp();
  },
  toggleAddContactForm() {
    state.showAddContactForm = !state.showAddContactForm;
    renderApp();
  },
  saveNewContact() {
    const nameEl = $("#newContactName");
    const phoneEl = $("#newContactPhone");
    const name = nameEl?.value.trim() || `Helper ${state.contacts.length} - Family`;
    const phone = phoneEl?.value.trim() || "(509) 555-0199";
    state.contacts.push({ name, phone, enabled: true });
    state.showAddContactForm = false;
    logEvent(`Added emergency contact: ${name}`);
    renderApp();
  },
  toggleAskBeforeSaving() {
    state.askBeforeSaving = !state.askBeforeSaving;
    renderApp();
  },
  cycleDisabilityProfile() {
    const nextIdx = (PROFILES.indexOf(state.disabilityProfile) + 1) % PROFILES.length;
    state.disabilityProfile = PROFILES[nextIdx];
    renderApp();
  },
  saveCaretakerChanges() {
    if (state.autoWalkTimer) {
      state.pendingCaretakerSync = true;
      logEvent("NFR-13: User moving - deferring caretaker sync until stationary.");
      speak("Changes queued. Will apply once you stop walking.");
    } else {
      persistPreferences();
      logEvent("Caretaker configuration saved locally.");
      speak("Caretaker configuration saved.");
    }
    renderApp();
  },
  downloadMap() {
    const nextMap = ["hol", "rec"].find((k) => !state.cachedMaps[k]);
    if (nextMap) {
      state.cachedMaps[nextMap] = true;
      logEvent(`Offline map cached locally (${nextMap.toUpperCase()}).`);
    }
    renderApp();
  },
  runCalibration() {
    const stepPeriod = 0.52;
    let steps = 0;
    let lastPeak = -1e3;
    const samples = Array.from({ length: 170 }, (_, k) => 1 + 0.35 * Math.sin((2 * Math.PI * k * 0.02) / stepPeriod));
    samples.forEach((val, k) => {
      if (val > 1.25 && val >= samples[k - 1] && val > samples[k + 1] && k * 20 - lastPeak > 300) {
        steps++;
        lastPeak = k * 20;
      }
    });
    state.strideFeet = +(10 / steps).toFixed(2);
    persistPreferences();
    logEvent(`Step calibration: ${steps} steps over 10 ft (~${state.strideFeet} ft/step).`);
    speak(`Calibration saved. Your stride is about ${state.strideFeet} feet.`);
    renderApp();
  }
};

// Render Pipeline & Smart Simulator State
const STATUS_PILLS = {
  entr: "Route active",
  obs: "Route paused",
  reroute: "Route updated",
  sig: "Location lost",
  fire: "Fire evacuation",
  haz: "Route active",
  arr: "Route complete",
  nextClass: "Next up",
  hapt: "Accessibility",
  cal: "Calibration",
  off: "Offline maps",
  caretakerPin: "Caretaker PIN",
  caretaker: "Safety profile"
};

const BACK_TARGETS = {
  voice: "dest",
  route: "dest",
  entr: "route",
  haz: "nav",
  off: "pref",
  cal: "hapt",
  caretakerPin: "pref",
  caretaker: "pref"
};

function syncSimulatorControls() {
  const isNav = state.screen === "nav";
  const isFire = state.screen === "fire";
  const isObs = state.screen === "obs";
  const isSig = state.screen === "sig";
  const isEmg = state.screen === "emg";
  const canWalk = isNav || isFire;

  $("#btnWalk").disabled = !canWalk;
  $("#btnAutoWalk").disabled = !canWalk;
  $("#btnAutoWalk").classList.toggle("active", !!state.autoWalkTimer);

  $("#btnObstacle").disabled = !isNav;
  $("#btnClearObstacle").disabled = !isObs;
  $("#btnHazard").disabled = !isNav;

  $("#btnClosure").classList.toggle("active", !!state.hallwayClosed);
  $("#btnClosure").textContent = state.hallwayClosed ? "Reopen side hallway" : "Close side hallway";

  $("#btnCrowd").classList.toggle("active", !!state.highCrowd);
  $("#btnCrowd").textContent = state.highCrowd ? "Clear crowd density" : "High crowd density";

  $("#btnSignal").disabled = !(isNav || isSig);
  $("#btnSignal").classList.toggle("active", !state.signalAvailable);
  $("#btnSignal").textContent = state.signalAvailable ? "Drop signal" : "Restore signal";

  $("#btnFire").disabled = isFire || isEmg;
  $("#btnFire").classList.toggle("active", isFire);

  const calBlocked = state.showSafetyGate || ["emg", "fire", "sig", "obs", "haz", "reroute"].includes(state.screen);
  $("#btnCalPrompt").disabled = calBlocked;
  $("#btnCalPrompt").classList.toggle("active", !!state.showCalendarPrompt);

  $("#btnFall").disabled = isEmg;
  $("#btnBump").disabled = isEmg;
  $("#btnSensors").classList.toggle("active", !!state.sensorsEnabled);
}

function renderApp() {
  const frame = $("#phoneFrame");
  const scale = TEXT_SCALE_VALUES[state.textSize] || 1;
  frame.style.setProperty("--font-scale", scale);
  frame.classList.toggle("high-contrast", !!state.highContrast);
  frame.classList.toggle("fire-mode", state.screen === "fire");

  const pillText =
    state.screen === "nav"
      ? `Indoors · Floor ${MAP_NODES[state.route[state.nav.stepIndex].from][2]}`
      : state.screen === "emg"
      ? state.alertSent
        ? "Help requested"
        : "Countdown active"
      : STATUS_PILLS[state.screen] || "";

  const pillClass =
    state.screen === "fire" || state.screen === "obs" || state.screen === "emg" || state.screen === "sig"
      ? "danger"
      : state.screen === "arr"
      ? "success"
      : "";

  const backTarget = BACK_TARGETS[state.screen];
  const isFire = state.screen === "fire";
  const canExitActive = ["nav", "obs", "reroute", "sig"].includes(state.screen);
  const showSos = state.screen !== "emg" && state.screen !== "haz" && !canExitActive && !isFire;

  const nextHeaderHtml = `
    <div style="display:flex;align-items:center;gap:8px;min-width:0">
      ${
        backTarget
          ? `<button class="icon-btn" data-action="goScreen" data-val="${backTarget}" aria-label="Go back"><span class="icon">arrow_back</span></button>`
          : ""
      }
      <span class="brand">THEIA</span>
    </div>
    ${pillText ? `<span class="status-pill ${pillClass}">${pillText}</span>` : ""}
    ${
      isFire
        ? `<button class="icon-btn" data-action="dismissFireAlarm" aria-label="Dismiss fire alert"><span class="icon">close</span></button>`
        : canExitActive
        ? `<button class="icon-btn" data-action="goScreen" data-val="dest" aria-label="Exit active mode"><span class="icon">close</span></button>`
        : showSos
        ? `<button class="icon-btn sos-btn" data-action="requestHelp" aria-label="Emergency help"><span class="icon">sos</span></button>`
        : `<span style="width:40px" aria-hidden="true"></span>`
    }
  `;
  if (nextHeaderHtml !== lastHeaderHtml) {
    $("#appHeader").innerHTML = nextHeaderHtml;
    lastHeaderHtml = nextHeaderHtml;
  }

  const appScreen = $("#appScreen");
  const screenChanged = state.screen !== lastRenderedScreen;
  let patchedInPlace = false;

  if (!screenChanged && (state.screen === "nav" || state.screen === "fire") && state.nav) {
    const step = state.route[state.nav.stepIndex];
    const navKey = `${state.screen}|${state.nav.stepIndex}|${state.muted}|${state.inQuietZone}|${state.mapViewFloor}|${state.hallwayClosed}|${state.highCrowd}|${state.units}|${state.textSize}|${state.strideFeet}`;
    if (navKey === lastScreenPatchKey) {
      const metricEl = appScreen.querySelector("[data-nav-metric]");
      if (metricEl) {
        metricEl.textContent = step.type !== "elevator" ? formatDistance(state.nav.feetLeft, state.units) : "Elevator";
      }
      const stepsEl = appScreen.querySelector("[data-nav-steps]");
      if (stepsEl && state.strideFeet && state.nav.feetLeft && step.type === "walk") {
        stepsEl.textContent = `~${Math.round(state.nav.feetLeft / state.strideFeet)} steps`;
      }
      const pos = getCurrentCoordinates(state);
      const dotEl = appScreen.querySelector("[data-user-dot]");
      const haloEl = appScreen.querySelector("[data-user-halo]");
      if (dotEl) {
        dotEl.setAttribute("cx", pos[0]);
        dotEl.setAttribute("cy", pos[1]);
      }
      if (haloEl) {
        haloEl.setAttribute("cx", pos[0]);
        haloEl.setAttribute("cy", pos[1]);
      }
      patchedInPlace = true;
    }
  } else if (!screenChanged && state.screen === "emg" && !state.alertSent) {
    const emgKey = `emg|${state.alertSent}|${state.emergencyReason}|${state.disabilityProfile}|${state.textSize}`;
    if (emgKey === lastScreenPatchKey) {
      const ringEl = appScreen.querySelector("[data-emg-ring]");
      if (ringEl) {
        ringEl.textContent = state.countdown;
        patchedInPlace = true;
      }
    }
  }

  if (!patchedInPlace) {
    const nextScreenHtml = renderScreen(state, currentLocationLabel(), screenChanged);
    const compareHtml = nextScreenHtml.replace('class="screen-animate"', 'class="screen-body"');
    const activeInApp = appScreen.contains(document.activeElement) && ["INPUT", "SELECT"].includes(document.activeElement?.tagName);
    if (screenChanged || (compareHtml !== lastScreenHtml && !activeInApp)) {
      const prevScroll = appScreen.scrollTop;
      appScreen.innerHTML = nextScreenHtml;
      appScreen.scrollTop = screenChanged ? 0 : prevScroll;
      lastScreenHtml = compareHtml;
    }
    lastScreenPatchKey =
      state.screen === "nav" || state.screen === "fire"
        ? `${state.screen}|${state.nav?.stepIndex}|${state.muted}|${state.inQuietZone}|${state.mapViewFloor}|${state.hallwayClosed}|${state.highCrowd}|${state.units}|${state.textSize}|${state.strideFeet}`
        : state.screen === "emg"
        ? `emg|${state.alertSent}|${state.emergencyReason}|${state.disabilityProfile}|${state.textSize}`
        : "";
  }
  lastRenderedScreen = state.screen;

  renderLiveBanner(state, $("#liveBanner"));

  // Show clean 4-tab bottom nav on non-critical screens
  const showTabs = ["dest", "route", "nextClass", "hapt", "cal", "pref", "off", "caretakerPin", "caretaker", "arr"].includes(state.screen);
  const nextNavHtml = showTabs
    ? [
        ["dest", "explore", "Navigate"],
        ["nextClass", "event", "Schedule"],
        ["hapt", "vibration", "Haptics"],
        ["pref", "settings", "Settings"]
      ]
        .map(([scr, iconName, label]) => {
          const isActive =
            state.screen === scr ||
            (scr === "dest" && ["route", "voice", "arr"].includes(state.screen)) ||
            (scr === "hapt" && state.screen === "cal") ||
            (scr === "pref" && ["off", "caretakerPin", "caretaker"].includes(state.screen));
          return `<button class="nav-tab ${isActive ? "active" : ""}" data-action="goScreen" data-val="${scr}">
            <span class="icon">${iconName}</span><span>${label}</span>
          </button>`;
        })
        .join("")
    : "";
  if (nextNavHtml !== lastNavHtml) {
    $("#bottomNav").innerHTML = nextNavHtml;
    lastNavHtml = nextNavHtml;
  }

  let nextModalHtml = "";
  if (state.showSafetyGate) {
    nextModalHtml = `
      <div class="hero-icon-box"><span class="icon" style="font-size:2em">shield</span></div>
      <div class="eyebrow text-center">Prototype Notice</div>
      <h2 class="text-center">Before you start</h2>
      <p class="subtext text-center">THEIA is a student-built demo prototype—<b>not a real app, medical device, or emergency dispatch service</b>. No real calls or alerts are ever sent.</p>
      <div class="notice-banner neutral">
        <span class="icon" style="color:#38bdf8">privacy_tip</span>
        <div><b>Not HIPAA-Covered</b><br>This prototype is not covered by HIPAA or medical privacy laws. Do not enter real health or personal data. Demo settings stay locally in your browser.</div>
      </div>
      <div class="notice-banner warning">
        <span class="icon" style="color:#fb923c">warning</span>
        <div><b>Safety Reminder</b><br>Always continue using your white cane or guide dog. Floor-level obstacles and indoor tracking are simulated.</div>
      </div>
      <button class="btn-primary" data-action="acceptGate">I Understand</button>
    `;
  } else if (state.showCalendarPrompt) {
    nextModalHtml = `
      <div class="eyebrow text-center">Upcoming Class · In 5 Min</div>
      <h2 class="text-center">Room 214</h2>
      <p class="subtext text-center">Your accessible indoor route is ready.</p>
      <div class="info-card">
        <div class="eyebrow" style="margin-bottom:0">Route</div>
        <b>Room 214 · Schweitzer Engineering Hall</b>
        <div class="subtext">Stair-free elevator path · Campus ID badge required</div>
      </div>
      <button class="btn-primary" style="min-height:76px;font-size:1.1em" data-action="startNextClass">
        <span class="icon">navigation</span> Start Navigation
      </button>
      <button class="btn-secondary" data-action="dismissCalendarPrompt">Dismiss</button>
    `;
  }
  if (nextModalHtml !== lastModalHtml) {
    $("#modalOverlay").innerHTML = nextModalHtml;
    lastModalHtml = nextModalHtml;
  }

  syncSimulatorControls();
}

// Global Event Delegation
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (btn && !btn.disabled && actions[btn.dataset.action]) {
    actions[btn.dataset.action](btn.dataset.val);
  }
});

document.addEventListener("dblclick", (e) => {
  if (e.target.closest("#quickMuteZone") && ["nav", "fire"].includes(state.screen)) {
    actions.toggleMute();
  }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.input === "volume") {
    state.volume = Number(e.target.value);
    const label = document.querySelector("[data-volume-label]");
    if (label) label.textContent = `${state.volume}%`;
    renderLiveBanner(state, $("#liveBanner"));
    persistPreferences();
  }
  if (e.target.id === "placeSearch") {
    const query = e.target.value.trim().toLowerCase();
    let visibleCount = 0;
    let externalMatches = 0;
    const otherSection = $("#otherBuildingsSection");
    document.querySelectorAll(".place-item").forEach((el) => {
      const match = !query || el.textContent.toLowerCase().includes(query);
      el.style.display = match ? "" : "none";
      if (match) {
        visibleCount++;
        if (el.closest("#otherBuildingsSection")) externalMatches++;
      }
    });
    if (otherSection) {
      otherSection.open = Boolean(query && externalMatches > 0);
    }
    const noMsg = $("#noPlacesMsg");
    if (noMsg) noMsg.style.display = visibleCount === 0 ? "flex" : "none";
  }
});

document.addEventListener("change", (e) => {
  const key = e.target.dataset.pref;
  if (!key) return;
  state[key] = key === "units" ? e.target.value : Number(e.target.value);
  persistPreferences();
  renderApp();
  const labels = {
    speechRate: `Speech rate set to ${SPEECH_RATES[state.speechRate]}`,
    frequency: `Instruction frequency set to ${INSTRUCTION_FREQUENCIES[state.frequency]}`,
    textSize: `Text size set to ${TEXT_SIZES[state.textSize]}`,
    units: `Distance units set to ${state.units}`
  };
  if (labels[key]) {
    logEvent(labels[key]);
    speak(labels[key]);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "speechInput") actions.submitSpeech();
});

$("#appScreen").addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 2 && ["nav", "fire"].includes(state.screen)) {
      e.preventDefault();
      actions.toggleMute();
    }
  },
  { passive: false }
);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAutoWalk();
    stopSpeech();
    stopHaptics();
    clearHapticPreviews();
  }
});

window.addEventListener("pagehide", () => {
  stopSpeech();
  stopHaptics();
});
window.addEventListener("beforeunload", () => {
  stopSpeech();
  stopHaptics();
});

renderHapticIdle();
renderApp();
logEvent("THEIA v3 modular prototype initialized.");
