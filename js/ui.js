import {
  MAP_NODES,
  MAP_EDGES,
  PLACES,
  SPEECH_RATES,
  INSTRUCTION_FREQUENCIES,
  TEXT_SIZES
} from "./mapData.js";
import {
  formatDistance,
  formatStepInstruction,
  shortDirectionLabel,
  summarizeRoute,
  calculatePath
} from "./routing.js";

const ACCENT = "#ffd60a";
const ic = (name, style = "") => `<span class="icon" style="${style}" aria-hidden="true">${name}</span>`;

function renderArrowSvg(angle, size = 76) {
  return `<svg viewBox="0 0 60 60" width="${size}" height="${size}" style="transform:rotate(${angle}deg);transition:transform 0.25s ease;display:block;margin:0 auto" aria-hidden="true">
    <path d="M30 54V8M12 26L30 8l18 18" fill="none" stroke="${ACCENT}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function getCurrentCoordinates(state) {
  const nav = state.nav;
  if (!nav || !state.route?.length) return MAP_NODES[state.route[0].from];
  const step = state.route[nav.stepIndex];
  const progress = step.feet ? 1 - nav.feetLeft / step.feet : 0;
  const a = MAP_NODES[step.from];
  const b = MAP_NODES[step.to];
  return [a[0] + (b[0] - a[0]) * progress, a[1] + (b[1] - a[1]) * progress];
}

function getRouteFloors(route) {
  const floors = [];
  route.forEach((s) => {
    const f1 = MAP_NODES[s.from][2];
    const f2 = MAP_NODES[s.to][2];
    if (!floors.includes(f1)) floors.push(f1);
    if (!floors.includes(f2)) floors.push(f2);
  });
  return floors;
}

function renderFloorMapSvg(state, showObstacleMarker = false) {
  const floors = getRouteFloors(state.route);
  const currentStep = state.nav ? state.route[state.nav.stepIndex] : state.route[0];
  const currentFloor = MAP_NODES[currentStep.from][2];
  const destFloor = MAP_NODES[state.route[state.route.length - 1].to][2];
  const displayedFloor =
    state.mapViewFloor && floors.includes(state.mapViewFloor) ? state.mapViewFloor : currentFloor;

  const pos = getCurrentCoordinates(state);
  const startNode = state.route[0].from;
  const endNode = state.route[state.route.length - 1].to;
  const startCoord = MAP_NODES[startNode];
  const endCoord = MAP_NODES[endNode];

  const lines = MAP_EDGES.map((edge, idx) => {
    if (edge.type === "elevator" || edge.type === "stairs") return "";
    const f1 = MAP_NODES[edge.from][2];
    const f2 = MAP_NODES[edge.to][2];
    if (f1 !== displayedFloor || f2 !== displayedFloor) return "";
    const isClosed = edge.sideHallway && state.hallwayClosed;
    const isCrowded = edge.mainCorridor && state.highCrowd;
    const isHazard = state.reportedHazards.includes(idx);
    const color = isClosed
      ? "#ef4444"
      : isCrowded
      ? "#fb923c"
      : isHazard
      ? "#38bdf8"
      : "#3f3f46";
    const dash = isClosed ? 'stroke-dasharray="4 3"' : "";
    return `<line x1="${MAP_NODES[edge.from][0]}" y1="${MAP_NODES[edge.from][1]}" x2="${MAP_NODES[edge.to][0]}" y2="${MAP_NODES[edge.to][1]}" stroke="${color}" stroke-width="4" stroke-linecap="round" ${dash}/>`;
  }).join("");

  const routeSegments = state.route
    .filter((s) => s.type === "walk" && MAP_NODES[s.from][2] === displayedFloor && MAP_NODES[s.to][2] === displayedFloor)
    .map((s) => {
      const a = MAP_NODES[s.from];
      const b = MAP_NODES[s.to];
      return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${ACCENT}" stroke-width="3.2" stroke-linecap="round" opacity="0.95"/>`;
    })
    .join("");

  const transitionMarkers = state.route
    .filter((s) => s.type === "elevator" || s.type === "stairs")
    .map((s) => {
      const fromFloor = MAP_NODES[s.from][2];
      const toFloor = MAP_NODES[s.to][2];
      if (fromFloor !== displayedFloor && toFloor !== displayedFloor) return "";
      const coord = fromFloor === displayedFloor ? MAP_NODES[s.from] : MAP_NODES[s.to];
      const targetFloor = fromFloor === displayedFloor ? toFloor : fromFloor;
      const tag = s.type === "elevator" ? "EL" : "ST";
      const label = fromFloor === displayedFloor ? `${tag}→F${targetFloor}` : `F${targetFloor}→${tag}`;
      return `<g transform="translate(${coord[0]},${coord[1]})">
        <rect x="-17" y="-17" width="34" height="13" rx="4" fill="#182230" stroke="#38bdf8" stroke-width="1"/>
        <text x="0" y="-8" text-anchor="middle" font-size="7" font-weight="800" fill="#38bdf8">${label}</text>
      </g>`;
    })
    .join("");

  const showUserMarker = currentFloor === displayedFloor;
  const userMarker = !showUserMarker
    ? ""
    : showObstacleMarker
    ? `<g transform="translate(${pos[0]},${pos[1]})">
         <polygon points="0,-11 10,7 -10,7" fill="#ef4444" stroke="#ffffff" stroke-width="1.5"/>
         <text x="0" y="4.5" text-anchor="middle" font-size="9" font-weight="800" fill="#ffffff">!</text>
       </g>`
    : `<circle data-user-halo cx="${pos[0]}" cy="${pos[1]}" r="8" fill="rgba(255,214,10,0.25)"/>
       <circle data-user-dot cx="${pos[0]}" cy="${pos[1]}" r="4.8" fill="${ACCENT}" stroke="#0b0b0e" stroke-width="1.5"/>`;

  const floorHeader =
    floors.length > 1
      ? `<div class="map-header">
           <span class="map-floor-label">
             Floor ${displayedFloor}
             ${displayedFloor === currentFloor ? '<span class="tag-badge">You</span>' : ""}
             ${displayedFloor !== currentFloor && displayedFloor === destFloor ? '<span class="tag-badge green">Dest</span>' : ""}
             ${currentFloor !== destFloor ? `<span class="subtext"> · To Fl ${destFloor}</span>` : ""}
           </span>
           <div class="floor-switcher" role="group" aria-label="Switch map floor preview">
             ${floors
               .map(
                 (f) => `<button class="floor-pill ${f === displayedFloor ? "active" : ""}" data-action="setMapFloor" data-val="${f}">Fl ${f}</button>`
               )
               .join("")}
           </div>
         </div>`
      : `<div class="map-header">
           <span class="map-floor-label">Floor ${displayedFloor} <span class="tag-badge">You</span></span>
         </div>`;

  return `<div class="map-card">
    ${floorHeader}
    <svg viewBox="-55 -125 180 140" class="map-svg" role="img" aria-label="Indoor floor ${displayedFloor} map">
      ${lines}
      ${routeSegments}
      ${MAP_NODES[startNode][2] === displayedFloor ? `<circle cx="${startCoord[0]}" cy="${startCoord[1]}" r="3.5" fill="#71717a"/>` : ""}
      ${MAP_NODES[endNode][2] === displayedFloor ? `<circle cx="${endCoord[0]}" cy="${endCoord[1]}" r="5" fill="#4ade80" stroke="#0b0b0e" stroke-width="1.2"/>` : ""}
      ${transitionMarkers}
      ${userMarker}
    </svg>
  </div>`;
}

function renderSelectCard(label, subtitle, key, options, selectedVal) {
  const opts = options
    .map((opt, idx) => {
      const val = typeof selectedVal === "string" ? opt : idx;
      const isSelected = val === selectedVal;
      return `<option value="${val}" ${isSelected ? "selected" : ""}>${opt}</option>`;
    })
    .join("");
  return `<div class="setting-card">
    <div class="card-content">
      <div class="card-title">${label}</div>
      <div class="subtext">${subtitle}</div>
    </div>
    <div class="select-wrap">
      <select class="pref-select" data-pref="${key}" aria-label="${label}">${opts}</select>
      ${ic("expand_more", "font-size:1.25em")}
    </div>
  </div>`;
}

export function renderScreen(state, locationLabel, animate = true) {
  const localPlaces = PLACES.filter((p) => !p.external);
  const externalPlaces = PLACES.filter((p) => p.external);

  const screens = {
    dest: () => `
      <div class="eyebrow">Where to?</div>
      <h2>Choose your destination</h2>
      <div class="search-bar">
        ${ic("search", "color:#8e8e98")}
        <input id="placeSearch" aria-label="Search places" placeholder="Say or type a room" autocomplete="off">
        <button class="mic-btn" data-action="startVoiceInput" aria-label="Voice input">${ic("mic")}</button>
      </div>
      <div class="eyebrow" style="margin-top:2px">Frequent places</div>
      ${localPlaces
        .map((p) => {
          const idx = PLACES.indexOf(p);
          return `<button class="card place-item" data-action="pickPlace" data-val="${idx}">
            <div class="card-content">
              <div class="card-title">${p.name}</div>
              <div class="subtext">${p.sub}</div>
            </div>
            <span class="card-chevron">${ic("arrow_forward")}</span>
          </button>`;
        })
        .join("")}
      <div id="noPlacesMsg" class="notice-banner neutral" style="display:none">
        ${ic("search_off", "color:#a1a1aa")}
        <div>No matching rooms found. Try <b>105</b>, <b>214</b>, or <b>Bathroom</b>.</div>
      </div>
      <details class="secondary-section" id="otherBuildingsSection">
        <summary>
          <span>Other Campus Buildings (Preview)</span>
          ${ic("expand_more", "font-size:1.4em")}
        </summary>
        <div class="secondary-list">
          ${externalPlaces
            .map((p) => {
              const idx = PLACES.indexOf(p);
              return `<button class="card card-muted place-item" data-action="pickPlace" data-val="${idx}">
                <div class="card-content">
                  <div class="card-title">${p.name} <span class="tag-badge muted">Outside map</span></div>
                  <div class="subtext">${p.sub}</div>
                </div>
                <span class="card-chevron" style="color:#71717a">${ic("info")}</span>
              </button>`;
            })
            .join("")}
        </div>
      </details>
    `,

    voice: () => `
      <div class="eyebrow">Voice Destination</div>
      <h2>${state.heardText ? "Confirm destination" : "I'm listening"}</h2>
      <p class="subtext">Say a room, place, or facility type.</p>
      <div class="voice-ring" aria-hidden="true">
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
      </div>
      ${
        state.heardText
          ? `<div class="info-card">
               <div class="eyebrow" style="margin-bottom:0">I Heard</div>
               <div style="font-size:1.1em;font-weight:700">“${state.heardText}”</div>
               <div class="subtext">${
                 state.voiceCandidate
                   ? `${PLACES.find((p) => p.node === state.voiceCandidate)?.name} · Schweitzer Engineering Hall`
                   : "No matching room found. Try one of the quick options below."
               }</div>
             </div>`
          : ""
      }
      ${
        !state.voiceCandidate
          ? `<div>
               <div class="subtext" style="margin-bottom:8px">Tap a sample phrase or use your microphone:</div>
               <div class="chip-row">
                 <button class="chip-btn" data-action="simulateVoicePhrase" data-val="Accessible Bathroom">“Accessible Bathroom”</button>
                 <button class="chip-btn" data-action="simulateVoicePhrase" data-val="Room 105">“Room 105”</button>
                 <button class="chip-btn" data-action="simulateVoicePhrase" data-val="Room 214">“Room 214”</button>
               </div>
             </div>`
          : ""
      }
      ${state.voiceCandidate ? `<button class="btn-primary" data-action="confirmVoice">${ic("check")} Confirm Location</button>` : ""}
      <button class="btn-secondary" data-action="retryVoice">${ic("refresh")} Try again</button>
    `,

    route: () => {
      if (!state.routes.comfort) {
        return `<div class="notice-banner danger">${ic("error", "color:#ef4444")}<div><b>No accessible route found</b><br>Hallway closures block all paths to this room.</div></div>
                <button class="btn-secondary" data-action="goScreen" data-val="dest">${ic("arrow_back")} Choose another destination</button>`;
      }
      const renderOption = (modeKey, title, routeArr) => {
        const stats = summarizeRoute(routeArr);
        const isSelected = state.routeMode === modeKey;
        return `<button class="card ${isSelected ? "card-selected" : ""}" role="radio" aria-checked="${isSelected}" data-action="selectMode" data-val="${modeKey}">
          <div class="card-content">
            <div class="card-title">${title} ${modeKey === "comfort" ? `<span class="tag-badge">Stair-free</span>` : ""}</div>
            <div class="subtext">${stats.minutes} min · ${formatDistance(stats.feet, state.units)} · ${stats.hasStairs ? "stairs" : stats.hasElevator ? "elevator" : "level"}</div>
          </div>
          <span class="card-chevron">${ic(isSelected ? "radio_button_checked" : "radio_button_unchecked")}</span>
        </button>`;
      };
      const activeStats = summarizeRoute(state.route);
      return `
        <div class="eyebrow">Route Options</div>
        <h2>To ${state.destination.name}</h2>
        ${renderFloorMapSvg(state)}
        <div role="radiogroup" aria-label="Select route type" style="display:flex;flex-direction:column;gap:10px">
          ${renderOption("comfort", "Comfortable", state.routes.comfort)}
          ${renderOption("short", "Shortest", state.routes.short)}
        </div>
        ${
          activeStats.hasBadgeDoor
            ? `<div class="notice-banner warning" role="note">
                 ${ic("badge", "color:#fb923c")}
                 <div><b>Campus ID Badge Required</b><br>This room is behind a restricted door. Have your ID card ready.</div>
               </div>`
            : ""
        }
        <div class="notice-banner neutral" role="note">
          ${ic("info", "color:#38bdf8")}
          <div>Routes avoid known closures${state.highCrowd ? ", congested corridors" : ""}${state.reportedHazards.length ? `, and ${state.reportedHazards.length} reported hazard(s)` : ""}.</div>
        </div>
        <button class="btn-primary" data-action="startRoute">
          ${ic("navigation")} ${activeStats.hasBadgeDoor ? "Acknowledge & Start" : `Start ${state.routeMode} route`}
        </button>
      `;
    },

    entr: () => `
      <div class="hero-icon-box">${ic("meeting_room", "font-size:2em")}</div>
      <div class="eyebrow text-center">Arrived at Entrance</div>
      <h2 class="text-center">You are at Schweitzer Engineering Hall.</h2>
      <p class="subtext text-center">Switching to indoor navigation.</p>
      <div class="info-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>Next</b>
          <span class="tag-badge">Indoor Route</span>
        </div>
        <div class="subtext">${formatStepInstruction(state.route[0], state.units)}</div>
      </div>
      <button class="btn-primary" data-action="continueIndoor">${ic("arrow_forward")} Continue</button>
    `,

    nav: () => {
      const nav = state.nav;
      const step = state.route[nav.stepIndex];
      const nextStep = state.route[nav.stepIndex + 1];
      return `
        ${state.muted ? `<div class="notice-banner warning" style="padding:9px 12px">${ic("volume_off", "color:#fb923c")}<b>Audio Muted</b></div>` : ""}
        ${state.inQuietZone ? `<div class="notice-banner" style="padding:9px 12px">${ic("do_not_disturb_on", "color:#38bdf8")}<b>Quiet Zone · Haptic Cues Only</b></div>` : ""}
        ${renderArrowSvg(step.turnAngle)}
        <div class="hero-metric" data-nav-metric>${step.type !== "elevator" ? formatDistance(nav.feetLeft, state.units) : "Elevator"}</div>
        <div class="nav-direction-label">${shortDirectionLabel(step)}</div>
        ${state.strideFeet && nav.feetLeft && step.type === "walk" ? `<div class="subtext text-center" data-nav-steps style="margin-top:-8px">~${Math.round(nav.feetLeft / state.strideFeet)} steps</div>` : ""}
        ${renderFloorMapSvg(state)}
        <div class="info-card" style="flex-direction:row;align-items:center;justify-content:space-between;gap:12px">
          <div style="min-width:0">
            <b>Next turn</b>
            <div class="subtext">${nextStep ? formatStepInstruction(nextStep, state.units) : `Arrive at ${state.destination.name}`}</div>
          </div>
          ${ic("turn_right", "color:#ffd60a;font-size:1.6em")}
        </div>
        <div id="quickMuteZone" class="quick-mute-zone ${state.muted ? "is-muted" : ""}" role="button" tabindex="0" aria-label="Double-tap or two-finger tap to mute or resume spoken audio">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span style="width:36px;height:36px;border-radius:50%;background:rgba(255,214,10,0.14);color:${ACCENT};display:grid;place-items:center;flex-shrink:0">
              ${ic(state.muted ? "play_arrow" : "pause")}
            </span>
            <div style="min-width:0">
              <div style="font-weight:700;font-size:0.88em">${state.muted ? "Audio Paused" : "Quick Mute Zone"}</div>
              <div class="subtext" style="font-size:0.78em">Double-tap or 2-finger tap to ${state.muted ? "resume" : "mute"}</div>
            </div>
          </div>
          <button class="chip-btn" data-action="toggleMute" style="flex-shrink:0">${state.muted ? "Resume" : "Mute"}</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px">
          <button class="btn-primary" data-action="repeatInstruction">${ic("replay")} Repeat Instruction</button>
          <button class="btn-secondary" data-action="reportHazard" aria-label="Report temporary hazard" style="width:auto;padding:0 14px" title="Report hazard">${ic("add_location_alt", "color:#ffd60a")}</button>
        </div>
      `;
    },

    obs: () => `
      <div style="display:flex;align-items:center;justify-content:center;gap:16px;padding:4px 0">
        ${renderArrowSvg(-40, 62)}
        <div class="hero-metric">3 ft</div>
      </div>
      <div class="notice-banner danger" role="alert">
        ${ic("warning", "color:#ef4444")}
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <b>Obstacle Ahead</b>
            <span class="status-pill danger">STOP</span>
          </div>
          <div>${state.obstacleLabel}. Follow the arrow around the obstacle when safe.</div>
        </div>
      </div>
      ${renderFloorMapSvg(state, true)}
      <div class="info-card">
        <b>Obstacle Detection</b>
        <div class="subtext">THEIA detects floor-level obstacles only. Overhead hazards are not detected.</div>
      </div>
      <button class="btn-primary" data-action="clearObstacle">${ic("check_circle")} Path Clear · Resume</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn-secondary" data-action="repeatInstruction">${ic("replay")} Repeat</button>
        <button class="btn-secondary btn-danger" data-action="requestHelp">${ic("sos")} Call Help</button>
      </div>
    `,

    reroute: () => `
      <div class="eyebrow">Pathway Closure</div>
      <h2>Your route has changed</h2>
      <p class="subtext" style="margin-top:-4px">${state.rerouteReason} THEIA located a new accessible route.</p>
      <div class="info-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>New Route</b>
          <span class="tag-badge green">OPEN</span>
        </div>
        <div class="subtext">${state.routeDeltaFt > 0 ? `Add ${formatDistance(state.routeDeltaFt, state.units)}` : "Optimal detour"} · ${summarizeRoute(state.route).hasElevator ? "Elevator accessible" : "Level path"}</div>
      </div>
      ${renderFloorMapSvg(state)}
      <button class="btn-primary" data-action="resumeAfterReroute">${ic("navigation")} Continue on new route</button>
      <button class="btn-secondary" data-action="repeatInstruction">${ic("replay")} Repeat Change</button>
    `,

    sig: () => `
      <div class="hero-icon-box danger">${ic("wifi_off", "font-size:2em")}</div>
      <h2 class="text-center">Please STOP</h2>
      <p class="subtext text-center" style="margin-top:-6px">Your location is inaccurate. Stay in place while THEIA reconnects.</p>
      <div class="info-card" style="flex-direction:row;align-items:center;justify-content:space-between">
        <div>
          <b>Finding your location</b>
          <div class="subtext">Listening for nearby connection</div>
        </div>
        <span class="spinner" aria-hidden="true"></span>
      </div>
      <div class="voice-ring" style="width:76px;height:76px" aria-hidden="true">
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
      </div>
      <div class="info-card text-center">
        <div class="subtext">Guidance will resume when THEIA establishes a secure connection.</div>
      </div>
      <button class="btn-primary btn-danger" data-action="requestHelp">${ic("sos")} Call for help</button>
      <button class="btn-secondary" data-action="repeatInstruction">${ic("replay")} Repeat Status</button>
    `,

    fire: () => {
      const nav = state.nav;
      const step = state.route[nav.stepIndex];
      return `
        <div class="notice-banner danger" role="alert" style="justify-content:center;font-weight:800;letter-spacing:0.05em">
          EMERGENCY ROUTE ACTIVE
        </div>
        <div class="hero-icon-box danger">${ic("priority_high", "font-size:2.2em")}</div>
        <h2 class="text-center" style="letter-spacing:0.02em">FIRE ALARM DETECTED</h2>
        <div class="text-center" style="color:${ACCENT};font-weight:800;font-size:0.9em;letter-spacing:0.06em">REROUTING TO EXIT</div>
        <div class="info-card text-center" style="border-color:rgba(239,68,68,0.6)">
          ${renderArrowSvg(step.turnAngle, 68)}
          <div class="hero-metric" data-nav-metric style="font-size:2.4em">${formatDistance(nav.feetLeft, state.units)}</div>
          <div style="font-weight:700">${formatStepInstruction(step, state.units)}</div>
        </div>
        <div class="info-card text-center">
          <div class="subtext">Keep moving calmly toward the marked exit. Elevators are disabled.</div>
        </div>
        <button class="btn-primary" data-action="repeatInstruction">${ic("replay")} Repeat Exit Instruction</button>
        <button class="btn-secondary" data-action="dismissFireAlarm">${ic("close")} Dismiss Fire Alert</button>
      `;
    },

    haz: () => `
      <div class="hazard-card">
        <div class="hero-icon-box circle">${ic("pin_drop", "font-size:2em")}</div>
        <div class="eyebrow text-center">Voice Report</div>
        <h2 class="text-center">Temporary Hazard Reported</h2>
        <p class="subtext text-center">You said: “Report a hazard here.”<br>Confirm dropping a pin at <b>${locationLabel}</b>?</p>
        <button class="btn-primary" data-action="confirmHazardPin">${ic("check")} Confirm Pin</button>
        <button class="btn-secondary" data-action="cancelHazardPin">Cancel</button>
      </div>
    `,

    emg: () => {
      const activeContacts = state.contacts.filter((c) => c.enabled).map((c) => c.name.split(" - ")[0]).join(", ");
      const timeNow = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `
        <div class="countdown-ring" data-emg-ring>${state.alertSent ? ic("check", "font-size:1em;color:#4ade80") : state.countdown}</div>
        <h2 class="text-center">${state.alertSent ? "Help Requested" : "Calling for Help"}</h2>
        <p class="subtext text-center" style="margin-top:-6px">${
          state.alertSent
            ? `Alert sent to ${activeContacts || "emergency contacts"} with your accessibility profile.`
            : `${state.emergencyReason}. Cancel if you are safe and do not need assistance.`
        }</p>
        <div class="info-card">
          <b>Alert From:</b>
          <div class="subtext">${locationLabel} · ${timeNow}</div>
          <div class="subtext">Profile: ${state.disabilityProfile}</div>
        </div>
        ${
          state.alertSent
            ? `<button class="btn-secondary btn-success-outline" data-action="dismissEmergency">${ic("check")} I am okay</button>`
            : `<button class="btn-secondary btn-success-outline" data-action="cancelEmergency">${ic("cancel")} I am okay - Cancel Alert</button>
               <button class="btn-primary btn-danger" data-action="sendEmergencyNow">${ic("sos")} Call for help now</button>
               <div class="subtext text-center" style="font-size:0.78em">Voice: “Cancel Alert” · Haptic Countdown</div>`
        }
      `;
    },

    nextClass: () => {
      const stats = summarizeRoute(calculatePath("ENT", "R214", "comfort", state));
      return `
        <div style="display:flex;align-items:center;gap:8px">
          <span class="icon" style="color:${ACCENT}">${"calendar_today"}</span>
          <span class="eyebrow" style="margin:0">Next Class</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <h2>Room 214</h2>
          <span class="tag-badge">5 MIN</span>
        </div>
        <p class="subtext" style="margin-top:-8px">Starts soon · Your accessible route is ready.</p>
        <div class="info-card">
          <div class="eyebrow" style="margin-bottom:0">Route</div>
          <b>Room 214 · Schweitzer Engineering Hall</b>
          <div class="subtext">About ${stats.minutes} min · Indoor · Campus ID badge required</div>
        </div>
        <div class="subtext text-center">Tap to begin turn-by-turn guidance.</div>
        <button class="btn-primary" style="min-height:92px;font-size:1.15em;flex-direction:column;gap:6px" data-action="startNextClass">
          ${ic("navigation", "font-size:1.5em")}
          <span>Start Navigation</span>
        </button>
      `;
    },

    arr: () => `
      <div class="text-center" style="margin-top:4px">
        <span class="status-pill success">ARRIVED</span>
      </div>
      <div class="hero-icon-box circle">${ic("location_on", "font-size:2em")}</div>
      <div class="text-center" style="color:${ACCENT};font-weight:800;font-size:1.15em">${state.destination.name}</div>
      <h2 class="text-center">You have arrived at your destination</h2>
      <div class="info-card">
        <div class="eyebrow" style="margin-bottom:0">Destination</div>
        <b>${state.destination.name}</b>
        <div class="subtext">Navigation ended safely.</div>
      </div>
      ${
        state.destination.node === "ENT"
          ? ""
          : `<div class="subtext text-center">Begin a guided trip back to your start point.</div>
             <button class="btn-primary" style="min-height:68px;font-size:1.08em" data-action="returnToStart">${ic("u_turn_left")} Return to Start</button>`
      }
      <button class="btn-secondary" data-action="goScreen" data-val="dest">${ic("home")} Done</button>
    `,

    hapt: () => `
      <div class="eyebrow">Accessibility</div>
      <h2>Haptic settings</h2>
      <button class="card ${state.deafblindMode ? "card-selected" : ""}" data-action="toggleDeafblind" role="switch" aria-checked="${!!state.deafblindMode}">
        <div class="card-content">
          <div class="card-title">
            Deafblind Haptic Mode
            ${state.deafblindMode ? `<span class="tag-badge green">ON</span>` : ""}
          </div>
          <div class="subtext">${
            state.deafblindMode
              ? "Spoken audio is off. Directions and alerts use structured vibrations."
              : "Switch from spoken audio to structured directional vibrations."
          }</div>
        </div>
        <span class="toggle-pill ${state.deafblindMode ? "on" : ""}" aria-hidden="true"><span class="toggle-knob"></span></span>
      </button>
      <div class="info-card">
        <div class="eyebrow" style="margin-bottom:2px">Haptic Cues</div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:0.9em;font-weight:600">
          <span>← Left (2 short)</span>
          <span>→ Right (1 long)</span>
          <span>! Stop (3 long)</span>
        </div>
      </div>
      <button class="card" data-action="previewHaptics">
        <div class="card-content">
          <div class="card-title">Preview vibration pattern</div>
          <div class="subtext">Feel &amp; see directional pulses</div>
        </div>
        <span class="card-chevron">${ic("play_arrow")}</span>
      </button>
      <button class="card" data-action="goScreen" data-val="cal">
        <div class="card-content">
          <div class="card-title">Step Calibration</div>
          <div class="subtext">${state.strideFeet ? `Saved stride: ~${state.strideFeet} ft/step` : "Optional pace-based step estimates"}</div>
        </div>
        <span class="card-chevron">${ic("arrow_forward")}</span>
      </button>
      <button class="btn-primary" data-action="saveHapticSettings">${ic("save")} Save Settings</button>
    `,

    cal: () => `
      <div class="eyebrow">Optional Calibration</div>
      <h2>Personalize your distance cues</h2>
      <p class="subtext" style="margin-top:-4px">THEIA always gives distance in feet or meters. Calibration adds an estimate based on your usual pace.</p>
      <div class="cal-track">
        <div class="cal-endpoints"><span>START</span><span>FINISH</span></div>
        <div class="cal-bar">
          <span class="cal-dot" style="left:0%"></span>
          <span class="cal-dot" style="left:100%"></span>
        </div>
        <div class="text-center" style="font-weight:800;color:${ACCENT};font-size:1.1em">10 ft / 3 m</div>
        ${state.strideFeet ? `<div class="subtext text-center" style="margin-top:4px">Current saved stride: <b>~${state.strideFeet} ft/step</b></div>` : ""}
      </div>
      <div class="info-card" style="gap:10px">
        <div class="step-row"><span class="step-num">1</span><span class="subtext" style="color:#e4e4e7">Choose a familiar, clear path. Mark the distance.</span></div>
        <div class="step-row"><span class="step-num">2</span><span class="subtext" style="color:#e4e4e7">Walk at your regular pace while THEIA calibrates.</span></div>
        <div class="step-row"><span class="step-num">3</span><span class="subtext" style="color:#e4e4e7">Review and save your personal estimate.</span></div>
      </div>
      <div class="notice-banner danger">
        ${ic("warning", "color:#ef4444")}
        <div><b>Safety First.</b> Only start calibration in known, obstacle-free locations.</div>
      </div>
      <button class="btn-primary" data-action="runCalibration">${ic("directions_walk")} ${state.strideFeet ? "Recalibrate" : "Start Calibration"}</button>
      <button class="btn-secondary" data-action="goScreen" data-val="hapt">Skip for now</button>
    `,

    pref: () => `
      <div class="eyebrow">Settings</div>
      <h2>Customize THEIA to you</h2>
      <div class="info-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <b>Voice Volume</b>
          <b data-volume-label style="color:${ACCENT}">${state.volume}%</b>
        </div>
        <input type="range" min="0" max="100" value="${state.volume}" data-input="volume" aria-label="Voice volume" style="width:100%;accent-color:${ACCENT}">
      </div>
      ${renderSelectCard("Speech rate", "Narration speed", "speechRate", SPEECH_RATES, state.speechRate)}
      ${renderSelectCard("Instruction Frequency", "Distance update cadence", "frequency", INSTRUCTION_FREQUENCIES, state.frequency)}
      ${renderSelectCard("Text Size", "Scale up to 200%", "textSize", TEXT_SIZES, state.textSize)}
      <button class="card ${state.highContrast ? "card-selected" : ""}" data-action="cyclePref" data-val="highContrast" role="switch" aria-checked="${!!state.highContrast}">
        <div class="card-content">
          <div class="card-title">Maximum Contrast (7:1+)</div>
          <div class="subtext">${state.highContrast ? "Pure black & white high-contrast" : "Standard dark theme"}</div>
        </div>
        <span class="toggle-pill ${state.highContrast ? "on" : ""}" aria-hidden="true"><span class="toggle-knob"></span></span>
      </button>
      ${renderSelectCard("Distance Units", "Measurement system", "units", ["Feet", "Meters"], state.units)}
      <button class="card" data-action="goScreen" data-val="off">
        <div class="card-content"><div class="card-title">Offline Maps</div><div class="subtext">Download building floor plans</div></div>
        <span class="card-chevron">${ic("download_for_offline")}</span>
      </button>
      <button class="card" data-action="goScreen" data-val="caretakerPin" style="border-color:rgba(255,214,10,0.5)">
        <div class="card-content"><div class="card-title">Caretaker &amp; Emergency Contacts</div><div class="subtext">PIN-protected safety profile (Demo: 1234)</div></div>
        <span class="card-chevron">${ic("lock")}</span>
      </button>
    `,

    off: () => {
      const buildings = [
        ["sch", "Schweitzer Engineering Hall", "Floors G–3 · Updated Today", "75 MB"],
        ["hol", "Holland and Terrell Libraries", "Floors B–4 · Campus Core", "62 MB"],
        ["rec", "Student Recreation Center", "Floors 1–2 · Fitness Wing", "48 MB"]
      ];
      const allCached = buildings.every((b) => state.cachedMaps[b[0]]);
      return `
        <div class="eyebrow">Offline Maps</div>
        <h2>Ready without internet</h2>
        <p class="subtext" style="margin-top:-4px">Downloaded maps support indoor guidance when connection drops.</p>
        ${buildings
          .map(([id, name, desc, size]) => {
            const cached = !!state.cachedMaps[id];
            return `<div class="info-card" style="border-color:${cached ? "rgba(74,222,128,0.45)" : "var(--card-border)"}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
                <div>
                  <b>${name}</b>
                  <div class="subtext">${desc}</div>
                </div>
                ${ic(cached ? "check" : "cloud_download", cached ? "color:#4ade80" : "color:#71717a")}
              </div>
              ${
                cached
                  ? `<div class="progress-track"><div class="progress-fill" style="width:100%"></div></div>
                     <div style="font-size:0.78em;color:${ACCENT};font-weight:700">Map Saved · ${size}</div>`
                  : `<div class="subtext" style="font-size:0.78em">Not downloaded · ${size}</div>`
              }
            </div>`;
          })
          .join("")}
        <div class="notice-banner warning">
          ${ic("wifi_off", "color:#fb923c")}
          <div><b>Offline Limitation</b><br>Temporary closures and hazards may be out of date without a connection.</div>
        </div>
        <button class="btn-primary" data-action="downloadMap" ${allCached ? "disabled" : ""}>
          ${ic(allCached ? "check_circle" : "download")} ${allCached ? "All Maps Downloaded" : "Download Next Map"}
        </button>
      `;
    },

    caretakerPin: () => `
      <div class="eyebrow">Caretaker Portal</div>
      <h2>Enter 4-Digit PIN</h2>
      <div class="notice-banner neutral">
        ${ic("lock", "color:#38bdf8")}
        <div>Protects emergency contacts and accessibility profiles. Demo PIN: <b>1234</b></div>
      </div>
      <div class="pin-display">${state.pinEntry.padEnd(4, "•")}</div>
      <div class="pin-grid">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, "Clear", 0, "Back"]
          .map((k) => `<button class="pin-key" data-action="pinKey" data-val="${k}">${k}</button>`)
          .join("")}
      </div>
      <button class="btn-secondary" data-action="goScreen" data-val="pref">Cancel</button>
    `,

    caretaker: () => `
      <div class="eyebrow">Safety Profile</div>
      <h2>Emergency Contacts</h2>
      <p class="subtext" style="margin-top:-4px">Select who would receive alerts in emergency situations.</p>
      ${
        state.pendingCaretakerSync
          ? `<div class="notice-banner warning">${ic("hourglass_top", "color:#fb923c")}<div><b>Update Queued</b><br>Changes apply once you stop walking.</div></div>`
          : ""
      }
      ${state.contacts
        .map(
          (c, i) => `<button class="card" data-action="toggleContact" data-val="${i}" aria-pressed="${!!c.enabled}">
            <div class="card-content">
              <div class="card-title">${c.name}</div>
              <div class="subtext">${c.phone}</div>
            </div>
            <span class="card-chevron" style="color:${c.enabled ? "var(--success)" : "#71717a"}">${ic(c.enabled ? "check" : "radio_button_unchecked")}</span>
          </button>`
        )
        .join("")}
      ${
        state.showAddContactForm
          ? `<div class="inline-form">
               <b>Add Trusted Contact</b>
               <input id="newContactName" placeholder="Name & relationship (e.g. Maya - Sister)" aria-label="Contact name">
               <input id="newContactPhone" placeholder="Phone number (e.g. (509) 555-0142)" aria-label="Contact phone">
               <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                 <button class="btn-primary" data-action="saveNewContact">Add</button>
                 <button class="btn-secondary" data-action="toggleAddContactForm">Cancel</button>
               </div>
             </div>`
          : `<button class="card" data-action="toggleAddContactForm">
               <div class="card-content"><div class="card-title">Add a Contact</div></div>
               <span class="card-chevron">${ic("person_add")}</span>
             </button>`
      }
      <button class="card" data-action="toggleAskBeforeSaving" role="switch" aria-checked="${!!state.askBeforeSaving}">
        <div class="card-content">
          <div class="card-title">Caretaker Changes</div>
          <div class="subtext">${state.askBeforeSaving ? "Ask user before saving" : "Apply immediately"}</div>
        </div>
        <span class="toggle-pill ${state.askBeforeSaving ? "on" : ""}" aria-hidden="true"><span class="toggle-knob"></span></span>
      </button>
      <button class="card" data-action="cycleDisabilityProfile">
        <div class="card-content">
          <div class="card-title">Accessibility Profile</div>
          <div class="subtext">${state.disabilityProfile}</div>
        </div>
        <span class="card-chevron">${ic("sync")}</span>
      </button>
      <button class="btn-primary" data-action="saveCaretakerChanges">${ic("save")} Save Contacts</button>
    `
  };

  const content = (screens[state.screen] || screens.dest)();
  return animate ? `<div class="screen-animate">${content}</div>` : `<div class="screen-body">${content}</div>`;
}
