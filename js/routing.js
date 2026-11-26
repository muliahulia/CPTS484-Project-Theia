import { MAP_NODES, MAP_EDGES } from "./mapData.js";

export function edgeDistanceFt(edge) {
  if (edge.type === "elevator") return 0;
  if (edge.type === "stairs") return 30;
  const a = MAP_NODES[edge.from];
  const b = MAP_NODES[edge.to];
  return Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
}

export function formatDistance(feet, units) {
  return units === "Feet"
    ? `${Math.round(feet)} ft` : `${Math.round(feet * 0.3048)} m`;
}

export function calculatePath(fromNode, toNode, mode, env) {
  const dist = {};
  const prev = {};
  const unvisited = new Set(Object.keys(MAP_NODES));

  unvisited.forEach((k) => (dist[k] = 1e9));
  dist[fromNode] = 0;

  while (unvisited.size) {
    let current = null;
    unvisited.forEach((k) => {
      if (current === null || dist[k] < dist[current]) current = k;
    });
    unvisited.delete(current);

    if (current === toNode || dist[current] >= 1e9) break;

    MAP_EDGES.forEach((edge, idx) => {
      const neighbor =
        edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!neighbor) return;

      if (edge.sideHallway && env.hallwayClosed) return;
      if (mode === "comfort" && edge.type === "stairs") return;
      if (mode === "fire" && edge.type === "elevator") return;

      const crowdPenalty = edge.mainCorridor && env.highCrowd ? 95 : 0;
      const hazardPenalty = env.reportedHazards.includes(idx) ? 80 : 0;
      const baseCost = edge.type === "elevator" ? 20 : edgeDistanceFt(edge);
      const totalCost = dist[current] + baseCost + crowdPenalty + hazardPenalty;

      if (totalCost < dist[neighbor]) {
        dist[neighbor] = totalCost;
        prev[neighbor] = [current, idx];
      }
    });
  }

  if (dist[toNode] >= 1e9) return null;

  const steps = [];
  let cursor = toNode;
  while (cursor !== fromNode) {
    const [parentNode, edgeIndex] = prev[cursor];
    steps.unshift({ edgeIndex, from: parentNode, to: cursor });
    cursor = parentNode;
  }

  let prevHeading = 0;
  return steps.map((step) => {
    const edge = MAP_EDGES[step.edgeIndex];
    step.type = edge.type;
    step.feet = edgeDistanceFt(edge);
    step.badgeRequired = !!edge.badgeRequired;
    step.naturalObstacle = edge.naturalObstacle || null;
    step.targetZone = MAP_NODES[step.to][4];
    step.turnAngle = 0;

    if (step.type === "walk") {
      const a = MAP_NODES[step.from];
      const b = MAP_NODES[step.to];
      const heading = (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI;
      step.turnAngle = ((heading - prevHeading + 540) % 360) - 180;
      prevHeading = heading;
    } else {
      prevHeading = 0;
    }
    return step;
  });
}

export function formatStepInstruction(step, units) {
  if (step.type === "elevator") {
    return `Take the elevator to floor ${MAP_NODES[step.to][2]}`;
  }
  if (step.type === "stairs") {
    const dir = MAP_NODES[step.to][2] > MAP_NODES[step.from][2] ? "up" : "down";
    return `Take the stairs ${dir} to floor ${MAP_NODES[step.to][2]}`;
  }
  const distStr = formatDistance(step.feet, units);
  if (Math.abs(step.turnAngle) < 25) {
    return `Continue straight for ${distStr}`;
  }
  const side = step.turnAngle > 0 ? "right" : "left";
  const sharp = Math.abs(step.turnAngle) > 110 ? " sharply" : "";
  return `Turn ${side}${sharp} for ${distStr}`;
}

export function shortDirectionLabel(step) {
  if (step.type === "elevator") {
    return `ELEVATOR TO FLOOR ${MAP_NODES[step.to][2]}`;
  }
  if (step.type === "stairs") {
    const dir = MAP_NODES[step.to][2] > MAP_NODES[step.from][2] ? "UP" : "DOWN";
    return `STAIRS ${dir} TO FLOOR ${MAP_NODES[step.to][2]}`;
  }
  if (Math.abs(step.turnAngle) < 25) return "CONTINUE STRAIGHT";
  const side = step.turnAngle > 0 ? "RIGHT" : "LEFT";
  return Math.abs(step.turnAngle) > 110 ? `SHARP ${side}` : `TURN ${side}`;
}

export function summarizeRoute(route) {
  const feet = route.reduce((acc, s) => acc + s.feet, 0);
  const hasElevator = route.some((s) => s.type === "elevator");
  const hasStairs = route.some((s) => s.type === "stairs");
  const hasBadgeDoor = route.some((s) => s.badgeRequired);
  const minutes =
    Math.round(
      feet / 180 +
        route.filter((s) => s.type === "elevator").length * 0.75 +
        route.filter((s) => s.type === "stairs").length * 0.5
    ) || 1;
  return { feet, hasElevator, hasStairs, hasBadgeDoor, minutes };
}
