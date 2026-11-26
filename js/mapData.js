// Realistic topology for Schweitzer Engineering Hall (WSU Pullman, Floors 1 & 2)
// Node format: [x, y, floor, label, zoneTag]
export const MAP_NODES = {
  ENT:  [0, 0, 1, "Main Atrium Entrance", "standard"],
  LOB:  [0, -40, 1, "Atrium Lobby", "standard"],
  R105: [-40, -40, 1, "Room 105 (Lecture Hall)", "standard"],
  EL1:  [60, -40, 1, "Floor 1 Elevator", "standard"],
  ST1:  [0, -65, 1, "North Stairwell", "standard"],
  EL2:  [60, -40, 2, "Floor 2 Elevator", "standard"],
  ST2:  [0, -65, 2, "Floor 2 Stairwell", "standard"],
  MH1:  [70, -40, 2, "East Corridor", "standard"],
  MH2:  [70, -110, 2, "Quiet Study Alcove", "quiet"],
  BATH: [30, -110, 2, "Accessible Restroom", "standard"],
  R214: [110, -75, 2, "Room 214 (Design Lab)", "restricted"]
};

// Edge format with realistic facility metadata (sideHallway, mainCorridor, badgeRequired, naturalObstacle)
export const MAP_EDGES = [
  { from: "ENT", to: "LOB", type: "walk" },
  { from: "LOB", to: "R105", type: "walk", naturalObstacle: "Wet floor sign near atrium entrance" },
  { from: "LOB", to: "EL1", type: "walk" },
  { from: "LOB", to: "ST1", type: "walk" },
  { from: "EL1", to: "EL2", type: "elevator" },
  { from: "ST1", to: "ST2", type: "stairs" },
  { from: "ST2", to: "EL2", type: "walk" },
  { from: "ST2", to: "BATH", type: "walk", sideHallway: true },
  { from: "EL2", to: "BATH", type: "walk", sideHallway: true },
  { from: "EL2", to: "MH1", type: "walk", mainCorridor: true },
  { from: "MH1", to: "MH2", type: "walk", mainCorridor: true },
  { from: "MH2", to: "BATH", type: "walk" },
  { from: "MH1", to: "R214", type: "walk", badgeRequired: true }
];

export const PLACES = [
  { node: "BATH", name: "Accessible Bathroom", sub: "Schweitzer Hall, Floor 2 · Single-occupancy", facilityType: "accessible_restroom" },
  { node: "R105", name: "Room 105", sub: "Schweitzer Hall, Floor 1 · Lecture Hall", facilityType: "classroom" },
  { node: "R214", name: "Room 214", sub: "Schweitzer Hall, Floor 2 · ID Badge Required", facilityType: "lab" },
  { node: "EXT", name: "Room 1AA", sub: "Holland and Terrell Libraries", external: true },
  { node: "EXT", name: "Front Desk @ Rec", sub: "Student Recreation Center", external: true },
  { node: "EXT", name: "Room G04", sub: "The Spark: Academic Innovation Hub", external: true }
];

export const SPEECH_RATES = ["Slow", "Default", "Fast"];
export const SPEECH_RATE_VALUES = [0.65, 1.0, 1.6];

export const INSTRUCTION_FREQUENCIES = ["Minimal", "Balanced", "Frequent"];
export const FREQUENCY_THRESHOLDS = [1e9, 30, 10];

export const TEXT_SIZES = ["Default (100%)", "Large (125%)", "Extra Large (155%)", "Maximum (200%)"];
export const TEXT_SCALE_VALUES = [1.0, 1.25, 1.55, 2.0];
