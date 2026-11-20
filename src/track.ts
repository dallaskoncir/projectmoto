// The track: a closed loop laid out as a centerline, with berms on the outside of corners and jumps on the
// straights, baked into one heightfield that both physics and rendering use. Pure math, no browser code.
// Each track is a fixed design (trackDesigns.ts): corner points, and for each straight the features on it
// in order. Jumps are sized from the speed their run-up gives, so they stay rideable wherever they sit.

export const mapSize = 300; // meters, square, centered on the origin
export const cellSize = 0.4;
export const cellsPerSide = Math.round(mapSize / cellSize);
export const trackHalfWidth = 4;

export const centerlineSpacing = 0.5;
const featureReach = trackHalfWidth + 10; // how far from the centerline track shaping reaches

// A feature on a straight. Jumps without sizes are sized for the speed their run-up gives; `runUp` adds
// flat ground before a feature on top of the usual spacing. `speed` sizes a tabletop or step-up for that lip
// speed instead (past the track's usual limit, for a big one), as long as the run-up can reach it.
// `landingBottomDegrees` curves a landing from landingDegrees at the knuckle to that at the bottom.
export type FeatureSpec = { runUp?: number } & (
  | { kind: 'tabletop'; lipDegrees?: number; height?: number; deck?: number; speed?: number; landingDegrees?: number; landingBottomDegrees?: number }
  | { kind: 'double'; lipDegrees?: number; takeoff?: number }
  | { kind: 'step-up'; takeoff?: number; rise?: number; deck?: number; lipDegrees?: number; speed?: number; gap?: number; landingDegrees?: number; landingBottomDegrees?: number }
  | { kind: 'step-on-off'; takeoff?: number; deckHeight?: number; deck?: number }
  | { kind: 'big double' | 'triple' | 'whip jump'; takeoff: number; lipDegrees: number; gap: number; landing: number; landingDegrees: number; landingBottomDegrees?: number }
  | { kind: 'rollers' | 'whoops'; count: number; height: number; spacing: number }
  | { kind: 'rhythm'; count: number; height: number; lipDegrees?: number; backDegrees?: number }
);

export type TrackDesign = {
  name: string;
  style: 'motocross' | 'supercross';
  // Closed loop ridden in this order, each corner of the polygon rounded off with its own radius.
  // `insideBerm` also cuts a banked lane into the inside of the turn: a shorter, tighter line than the
  // outside berm. Flag both corners of a 180 so the lane runs all the way round.
  corners: { x: number; z: number; radius: number; insideBerm?: boolean }[];
  // straights[i] runs from corner i to corner i+1
  straights: FeatureSpec[][];
  landingRoom: number; // flat ground after each feature
  cornerClearance: number; // flat ground a straight keeps at each end, where the berms ease in and out
  maxDesignSpeed: number; // meters per second; no jump is built for more than this
  maxJumpHeight: number; // meters; the tallest a self-sizing jump's landing gets
};

// ---------- Jump profiles ----------
// A profile is the height of a feature at distance u along the track from where it starts.

export type JumpKind = 'big double' | 'triple' | 'whip jump' | 'double' | 'tabletop' | 'step-up' | 'step-on-off' | 'rollers' | 'rhythm' | 'whoops';

export type Jump = {
  kind: JumpKind;
  start: number; // distance along the track
  length: number;
  height: (u: number) => number;
  edges: number[]; // distances (from start) of lips and knuckles, marked in white
  edgeHeights: number[];
  description: string;
  designSpeed: number; // lip speed (m/s) it's sized for: landing just past the knuckle
};

const degrees = Math.PI / 180;
const backsideAngle = 40 * degrees; // steep walls on the back of takeoffs and the front of landings

// Takeoff face: a circular arc starting level with the ground and curving up to the lip angle
function takeoffFace(height: number, lipAngle: number) {
  const radius = height / (1 - Math.cos(lipAngle));
  const length = radius * Math.sin(lipAngle);
  return { length, height: (u: number) => radius - Math.sqrt(Math.max(0, radius * radius - u * u)) };
}

// Landing: a straight slope from the knuckle down to the ground. With a bottom angle it curves instead,
// steep at the knuckle and flattening out toward the bottom (the angle changes evenly along it), so it's soft
// to land near the top and an overjump comes down on a flatter, harder part instead of off the end.
function landingSlope(height: number, angle: number, bottomAngle = angle) {
  if (Math.abs(bottomAngle - angle) < 1e-6) {
    const length = height / Math.tan(angle);
    return { length, height: (x: number) => (x >= length ? 0 : height * (1 - x / length)) };
  }
  // Drop over x is the integral of tan(angle along it), which comes out in log-cosines
  const logCos = (a: number) => Math.log(Math.cos(a));
  const length = (height * (bottomAngle - angle)) / (logCos(angle) - logCos(bottomAngle));
  return {
    length,
    height: (x: number) => {
      if (x >= length) return 0;
      const angleHere = angle + ((bottomAngle - angle) * x) / length;
      return Math.max(0, height - (length / (bottomAngle - angle)) * (logCos(angle) - logCos(angleHere)));
    },
  };
}

function tabletop(
  faceHeight: number,
  lipAngle: number,
  deckLength: number,
  landingAngle: number,
  designSpeed: number,
  landingBottomAngle = landingAngle,
): Omit<Jump, 'start'> {
  const kind: JumpKind = 'tabletop';
  const face = takeoffFace(faceHeight, lipAngle);
  const knuckle = face.length + deckLength;
  const landing = landingSlope(faceHeight, landingAngle, landingBottomAngle);
  return {
    kind,
    length: knuckle + landing.length,
    height: (u) => (u < face.length ? face.height(u) : u < knuckle ? faceHeight : landing.height(u - knuckle)),
    edges: [face.length, knuckle],
    edgeHeights: [faceHeight, faceHeight],
    description: `${kind} ${faceHeight.toFixed(1)} m high, ${deckLength.toFixed(0)} m deck`,
    designSpeed,
  };
}

// Gap jump: takeoff, a hole, then a landing whose top (the knuckle) is `gap` meters past the lip.
// landingDeck > 0 makes a flat plateau after the knuckle (a step-up), otherwise it slopes straight down.
function gapJump(
  kind: JumpKind,
  takeoffHeight: number,
  lipAngle: number,
  gap: number,
  landingHeight: number,
  landingAngle: number,
  designSpeed: number,
  landingDeck = 0,
  landingBottomAngle = landingAngle,
): Omit<Jump, 'start'> {
  const face = takeoffFace(takeoffHeight, lipAngle);
  const lip = face.length;
  const takeoffBackEnd = lip + takeoffHeight / Math.tan(backsideAngle);
  const knuckle = lip + gap;
  const landingWallStart = knuckle - landingHeight / Math.tan(backsideAngle);
  const deckEnd = knuckle + landingDeck;
  const landingSlopeAfterDeck = landingSlope(landingHeight, landingAngle, landingBottomAngle);
  return {
    kind,
    length: deckEnd + landingSlopeAfterDeck.length,
    height: (u) => {
      if (u < lip) return face.height(u);
      const takeoffBack = u < takeoffBackEnd ? takeoffHeight * (1 - (u - lip) / (takeoffBackEnd - lip)) : 0;
      let landing = 0;
      if (u >= landingWallStart && u < knuckle) landing = landingHeight * ((u - landingWallStart) / (knuckle - landingWallStart));
      else if (u >= knuckle && u < deckEnd) landing = landingHeight;
      else if (u >= deckEnd) landing = landingSlopeAfterDeck.height(u - deckEnd);
      return Math.max(takeoffBack, landing);
    },
    edges: [lip, knuckle],
    edgeHeights: [takeoffHeight, landingHeight],
    description: `${kind}: ${gap.toFixed(0)} m gap, ${takeoffHeight.toFixed(1)} m takeoff to ${landingHeight.toFixed(1)} m landing`,
    designSpeed,
  };
}

// Step-on, step-off: jump up onto a tall flat plateau, ride across it, then jump off a kicker at its far end,
// over a gap, down to a landing lower than the deck. Neither gap can be rolled.
function stepOnStepOff(
  takeoffHeight: number,
  lipAngle: number,
  gapOn: number,
  deckHeight: number,
  deckLength: number,
  kickHeight: number,
  kickAngle: number,
  gapOff: number,
  landingHeight: number,
  designSpeed: number,
  deckSpeed: number,
): Omit<Jump, 'start'> {
  const face = takeoffFace(takeoffHeight, lipAngle);
  const lipOn = face.length;
  const takeoffBackEnd = lipOn + takeoffHeight / Math.tan(backsideAngle);
  const knuckleOn = lipOn + gapOn;
  const plateauWallStart = knuckleOn - deckHeight / Math.tan(backsideAngle);
  const deckEnd = knuckleOn + deckLength;
  const kick = takeoffFace(kickHeight, kickAngle);
  const lipOff = deckEnd + kick.length;
  const plateauTop = deckHeight + kickHeight;
  const plateauBackEnd = lipOff + plateauTop / Math.tan(backsideAngle);
  const knuckleOff = lipOff + gapOff;
  const landingWallStart = knuckleOff - landingHeight / Math.tan(backsideAngle);
  const landing = landingSlope(landingHeight, landingAngle);
  return {
    kind: 'step-on-off',
    length: knuckleOff + landing.length,
    height: (u) => {
      if (u < lipOn) return face.height(u);
      const takeoffBack = u < takeoffBackEnd ? takeoffHeight * (1 - (u - lipOn) / (takeoffBackEnd - lipOn)) : 0;
      let plateau = 0;
      if (u >= plateauWallStart && u < knuckleOn) plateau = deckHeight * ((u - plateauWallStart) / (knuckleOn - plateauWallStart));
      else if (u >= knuckleOn && u < deckEnd) plateau = deckHeight;
      else if (u >= deckEnd && u < lipOff) plateau = deckHeight + kick.height(u - deckEnd);
      else if (u >= lipOff && u < plateauBackEnd) plateau = plateauTop * (1 - (u - lipOff) / (plateauBackEnd - lipOff));
      let landingSide = 0;
      if (u >= landingWallStart && u < knuckleOff) landingSide = landingHeight * ((u - landingWallStart) / (knuckleOff - landingWallStart));
      else if (u >= knuckleOff) landingSide = landing.height(u - knuckleOff);
      return Math.max(takeoffBack, plateau, landingSide);
    },
    edges: [lipOn, knuckleOn, lipOff, knuckleOff],
    edgeHeights: [takeoffHeight, deckHeight, plateauTop, landingHeight],
    description:
      `step-on-off: ${gapOn.toFixed(0)} m gap up onto a ${deckHeight.toFixed(1)} m deck, ${deckLength.toFixed(0)} m across, ` +
      `${gapOff.toFixed(0)} m gap off to a ${landingHeight.toFixed(1)} m landing (built for ${deckSpeed.toFixed(1)} m/s off the deck)`,
    designSpeed,
  };
}

// Rhythm section: a row of small jumps, each a curved takeoff face and a straight downslope that is the
// landing for the one before. Slow it rolls; with speed you single or double them.
function rhythmSection(count: number, height: number, lipAngle: number, backAngle: number, designSpeed: number): Omit<Jump, 'start'> {
  const face = takeoffFace(height, lipAngle);
  const back = height / Math.tan(backAngle);
  const spacing = face.length + back;
  const edges = Array.from({ length: count }, (_, index) => index * spacing + face.length);
  return {
    kind: 'rhythm',
    length: count * spacing,
    height: (u) => {
      const along = u % spacing;
      return along < face.length ? face.height(along) : height * (1 - (along - face.length) / back);
    },
    edges,
    edgeHeights: edges.map(() => height),
    description: `rhythm: ${count} jumps, ${height.toFixed(1)} m high, ${spacing.toFixed(1)} m apart`,
    designSpeed,
  };
}

// Rollers and whoops (short and close, for skimming) are rounded bumps
function rollers(kind: JumpKind, count: number, height: number, spacing: number, designSpeed: number): Omit<Jump, 'start'> {
  return {
    kind,
    length: count * spacing,
    height: (u) => (height * (1 - Math.cos((2 * Math.PI * u) / spacing))) / 2,
    edges: [],
    edgeHeights: [],
    description: `${count} ${kind}, ${height.toFixed(1)} m high, ${spacing.toFixed(1)} m apart`,
    designSpeed,
  };
}

// Speed needed to carry from a lip at takeoffHeight to a knuckle `gap` meters on at landingHeight
function speedToClear(gap: number, lipAngle: number, takeoffHeight: number, landingHeight: number, gravity = 9.81) {
  const rise = gap * Math.tan(lipAngle) + takeoffHeight - landingHeight;
  if (rise <= 0) return Infinity;
  return Math.sqrt((gravity * gap * gap) / (2 * Math.cos(lipAngle) ** 2 * rise));
}

// Horizontal distance flown from a lip to where the bike comes back down to landingHeight
function flightDistance(speed: number, lipAngle: number, takeoffHeight: number, landingHeight: number, gravity = 9.81) {
  const horizontalSpeed = speed * Math.cos(lipAngle);
  const upwardSpeed = speed * Math.sin(lipAngle);
  const discriminant = upwardSpeed * upwardSpeed + 2 * gravity * (takeoffHeight - landingHeight);
  return discriminant < 0 ? 0 : (horizontalSpeed * (upwardSpeed + Math.sqrt(discriminant))) / gravity;
}

// How tall a landing at this angle has to be so its slope reaches out to where a rider 20% over the design
// speed comes down. Flight grows with the square of speed, so faster sections get bigger jumps, like a
// real track. Capped (per track) so jumps stay a sensible size; past the cap a big overjump lands flat.
const landingAngle = 17 * degrees;
function landingHeightFor(designSpeed: number, lipAngle: number, takeoffHeight: number, knuckle: number, maxLandingHeight: number) {
  let height = takeoffHeight;
  // The far landing point depends on the landing's height, so settle it in a few passes
  for (let pass = 0; pass < 4; pass++) {
    const farthest = flightDistance(designSpeed * 1.2, lipAngle, takeoffHeight, height * 0.3);
    height = Math.min(maxLandingHeight, Math.max(Math.min(takeoffHeight, maxLandingHeight), (farthest - knuckle) * Math.tan(landingAngle)));
  }
  return height;
}

// Rough speed the bike reaches over a run-up on full throttle, starting from corner-exit speed: a fit to the
// bike's acceleration through the gears, a little under what it really does flat out.
export function speedAfterRunUp(distance: number, startSpeed = 8, engineAcceleration = 7, topSpeed = 25) {
  let speed = startSpeed;
  for (let traveled = 0; traveled < distance; traveled += 0.5) {
    speed += ((engineAcceleration * (1 - speed / topSpeed)) / speed) * 0.5;
  }
  return speed;
}

function smoothstep(value: number, edge0: number, edge1: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------- Track ----------

export type Track = {
  design: TrackDesign;
  heights: Float32Array; // (cellsPerSide+1)^2, Rapier's layout: index = zIndex + xIndex * (cellsPerSide+1)
  onTrack: Float32Array; // same layout, 1 on the riding surface fading to 0 off it, for coloring
  centerlineX: Float32Array;
  centerlineZ: Float32Array;
  tangentX: Float32Array;
  tangentZ: Float32Array;
  cornerStrength: Float32Array; // 0 on straights, 1 in tight corners
  insideBermStrength: Float32Array; // 0 to 1 where a corner has an inside berm, eased in and out
  straights: { start: number; end: number }[]; // straights[i] runs from corner i's arc to corner i+1's
  length: number;
  jumps: Jump[];
  heightAt: (x: number, z: number) => number;
  nearestCenterlineIndex: (x: number, z: number) => number;
  spawnIndex: number;
};

export function buildTrack(design: TrackDesign, withJumps = true): Track {
  const centerline = buildCenterline(design.corners);
  const sampleCount = centerline.x.length;
  const length = sampleCount * centerlineSpacing;
  const { cornerStrength, turnDirection } = measureCorners(centerline.tangentX, centerline.tangentZ);
  const insideBermStrength = markInsideBerms(design.corners, centerline.straights, cornerStrength);

  const jumps = withJumps ? placeFeatures(design, centerline.straights, length) : [];
  // Start just out of the first corner, on the first straight
  const spawnIndex = Math.round((centerline.straights[0].start + 3) / centerlineSpacing) % sampleCount;

  // Bake the heightfield. Each centerline sample stamps the grid points around it, keeping whichever
  // sample is nearest, then the nearest point is refined onto the centerline segment for smooth slopes.
  const pointsPerSide = cellsPerSide + 1;
  const pointCount = pointsPerSide * pointsPerSide;
  const nearestDistanceSquared = new Float32Array(pointCount).fill(Infinity);
  const nearestSample = new Int32Array(pointCount).fill(-1);
  const reachInCells = Math.ceil(featureReach / cellSize);
  const toIndex = (coordinate: number) => Math.round((coordinate + mapSize / 2) / cellSize);
  for (let sample = 0; sample < sampleCount; sample++) {
    const centerX = centerline.x[sample];
    const centerZ = centerline.z[sample];
    const xIndexCenter = toIndex(centerX);
    const zIndexCenter = toIndex(centerZ);
    for (let xIndex = Math.max(0, xIndexCenter - reachInCells); xIndex <= Math.min(cellsPerSide, xIndexCenter + reachInCells); xIndex++) {
      const x = xIndex * cellSize - mapSize / 2;
      for (let zIndex = Math.max(0, zIndexCenter - reachInCells); zIndex <= Math.min(cellsPerSide, zIndexCenter + reachInCells); zIndex++) {
        const z = zIndex * cellSize - mapSize / 2;
        const distanceSquared = (x - centerX) ** 2 + (z - centerZ) ** 2;
        const pointIndex = zIndex + xIndex * pointsPerSide;
        if (distanceSquared < nearestDistanceSquared[pointIndex]) {
          nearestDistanceSquared[pointIndex] = distanceSquared;
          nearestSample[pointIndex] = sample;
        }
      }
    }
  }

  const heights = new Float32Array(pointCount);
  const onTrack = new Float32Array(pointCount);
  for (let xIndex = 0; xIndex <= cellsPerSide; xIndex++) {
    const x = xIndex * cellSize - mapSize / 2;
    for (let zIndex = 0; zIndex <= cellsPerSide; zIndex++) {
      const z = zIndex * cellSize - mapSize / 2;
      const pointIndex = zIndex + xIndex * pointsPerSide;
      // A bank around the edge of the map keeps the bike from riding off it
      let height = 4 * Math.max(smoothstep(Math.abs(x), mapSize / 2 - 12, mapSize / 2 - 2), smoothstep(Math.abs(z), mapSize / 2 - 12, mapSize / 2 - 2));
      const sample = nearestSample[pointIndex];
      if (sample >= 0 && nearestDistanceSquared[pointIndex] <= featureReach * featureReach) {
        const { along, across } = projectOntoCenterline(centerline, sample, x, z);
        height += shapeHeight(along, across, length, jumps, cornerStrength, turnDirection, insideBermStrength);
        onTrack[pointIndex] = 1 - smoothstep(Math.abs(across), trackHalfWidth, trackHalfWidth + 0.8);
      }
      heights[pointIndex] = height;
    }
  }

  const heightAt = (x: number, z: number) => {
    const xCell = Math.min(cellsPerSide - 1e-6, Math.max(0, (x + mapSize / 2) / cellSize));
    const zCell = Math.min(cellsPerSide - 1e-6, Math.max(0, (z + mapSize / 2) / cellSize));
    const xIndex = Math.floor(xCell);
    const zIndex = Math.floor(zCell);
    const xFraction = xCell - xIndex;
    const zFraction = zCell - zIndex;
    const at = (xi: number, zi: number) => heights[zi + xi * pointsPerSide];
    return (
      at(xIndex, zIndex) * (1 - xFraction) * (1 - zFraction) +
      at(xIndex + 1, zIndex) * xFraction * (1 - zFraction) +
      at(xIndex, zIndex + 1) * (1 - xFraction) * zFraction +
      at(xIndex + 1, zIndex + 1) * xFraction * zFraction
    );
  };

  const nearestCenterlineIndex = (x: number, z: number) => {
    let best = 0;
    let bestDistanceSquared = Infinity;
    for (let sample = 0; sample < sampleCount; sample++) {
      const distanceSquared = (centerline.x[sample] - x) ** 2 + (centerline.z[sample] - z) ** 2;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        best = sample;
      }
    }
    return best;
  };

  return {
    design,
    heights,
    onTrack,
    centerlineX: centerline.x,
    centerlineZ: centerline.z,
    tangentX: centerline.tangentX,
    tangentZ: centerline.tangentZ,
    cornerStrength,
    insideBermStrength,
    straights: centerline.straights,
    length,
    jumps,
    heightAt,
    nearestCenterlineIndex,
    spawnIndex,
  };
}

// Straight lines between the polygon corners, each corner replaced by a circular arc of its radius,
// resampled every centerlineSpacing meters. Also returns where each straight (corner i's arc end to
// corner i+1's arc start) lies along the track.
function buildCenterline(designCorners: TrackDesign['corners']) {
  // Shift the layout a fraction of a cell. A straight on a round coordinate sits exactly on a heightfield
  // grid line, where Rapier's wheel rays slip between the triangles and the bike sinks to its frame.
  const gridDodge = 0.137;
  const corners = designCorners.map((corner) => ({ ...corner, x: corner.x + gridDodge, z: corner.z + gridDodge }));
  const denseX: number[] = [];
  const denseZ: number[] = [];
  const arcBounds: { startDense: number; endDense: number }[] = [];
  const cornerCount = corners.length;
  for (let index = 0; index < cornerCount; index++) {
    const previous = corners[(index - 1 + cornerCount) % cornerCount];
    const corner = corners[index];
    const next = corners[(index + 1) % cornerCount];
    const inLength = Math.hypot(corner.x - previous.x, corner.z - previous.z);
    const outLength = Math.hypot(next.x - corner.x, next.z - corner.z);
    const inX = (corner.x - previous.x) / inLength;
    const inZ = (corner.z - previous.z) / inLength;
    const outX = (next.x - corner.x) / outLength;
    const outZ = (next.z - corner.z) / outLength;
    const turnSide = Math.sign(inX * outZ - inZ * outX); // +1 right-hander
    const turnAngle = Math.acos(Math.max(-1, Math.min(1, inX * outX + inZ * outZ)));
    const tangentLength = corner.radius * Math.tan(turnAngle / 2);
    const arcStartX = corner.x - inX * tangentLength;
    const arcStartZ = corner.z - inZ * tangentLength;
    // The straight leading into this corner is drawn by the dense points between arcs; the arc itself:
    const centerX = arcStartX + turnSide * -inZ * corner.radius;
    const centerZ = arcStartZ + turnSide * inX * corner.radius;
    const startAngle = Math.atan2(arcStartZ - centerZ, arcStartX - centerX);
    const arcSteps = Math.max(4, Math.ceil((turnAngle * corner.radius) / 0.1));
    if (tangentLength > inLength / 2 + 0.01 || tangentLength > outLength / 2 + 0.01) {
      throw new Error(`corner ${index} at (${corner.x}, ${corner.z}): radius ${corner.radius} is too big for the straights beside it`);
    }
    arcBounds.push({ startDense: denseX.length, endDense: denseX.length + arcSteps });
    for (let step = 0; step <= arcSteps; step++) {
      const angle = startAngle + (turnSide * turnAngle * step) / arcSteps;
      denseX.push(centerX + corner.radius * Math.cos(angle));
      denseZ.push(centerZ + corner.radius * Math.sin(angle));
    }
  }

  // Resample at even spacing along the curve
  const cumulative = [0];
  for (let index = 1; index <= denseX.length; index++) {
    const previous = index - 1;
    const current = index % denseX.length;
    cumulative.push(cumulative[previous] + Math.hypot(denseX[current] - denseX[previous], denseZ[current] - denseZ[previous]));
  }
  const totalLength = cumulative[denseX.length];
  const sampleCount = Math.floor(totalLength / centerlineSpacing);
  const x = new Float32Array(sampleCount);
  const z = new Float32Array(sampleCount);
  let denseIndex = 0;
  for (let sample = 0; sample < sampleCount; sample++) {
    const target = (sample * totalLength) / sampleCount;
    while (cumulative[denseIndex + 1] < target) denseIndex++;
    const fraction = (target - cumulative[denseIndex]) / (cumulative[denseIndex + 1] - cumulative[denseIndex]);
    const next = (denseIndex + 1) % denseX.length;
    x[sample] = denseX[denseIndex] + (denseX[next] - denseX[denseIndex]) * fraction;
    z[sample] = denseZ[denseIndex] + (denseZ[next] - denseZ[denseIndex]) * fraction;
  }
  const tangentX = new Float32Array(sampleCount);
  const tangentZ = new Float32Array(sampleCount);
  for (let sample = 0; sample < sampleCount; sample++) {
    const next = (sample + 1) % sampleCount;
    const previous = (sample - 1 + sampleCount) % sampleCount;
    const dx = x[next] - x[previous];
    const dz = z[next] - z[previous];
    const size = Math.hypot(dx, dz);
    tangentX[sample] = dx / size;
    tangentZ[sample] = dz / size;
  }
  // Distances along the resampled track (it is very slightly shorter than the dense curve)
  const toTrackDistance = (denseIndex: number) => (cumulative[denseIndex] * sampleCount * centerlineSpacing) / totalLength;
  const straights = arcBounds.map((arc, index) => {
    const nextArc = arcBounds[(index + 1) % cornerCount];
    const start = toTrackDistance(arc.endDense);
    let end = toTrackDistance(nextArc.startDense);
    if (end < start) end += sampleCount * centerlineSpacing;
    return { start, end };
  });
  return { x, z, tangentX, tangentZ, straights };
}

// Curvature along the track, smoothed so berms ramp in and out. Positive turnDirection is a right-hander.
function measureCorners(tangentX: Float32Array, tangentZ: Float32Array) {
  const sampleCount = tangentX.length;
  const curvature = new Float32Array(sampleCount);
  for (let sample = 0; sample < sampleCount; sample++) {
    const next = (sample + 1) % sampleCount;
    const previous = (sample - 1 + sampleCount) % sampleCount;
    // Rate the heading turns per meter; turning from +X toward +Z (right) is positive
    const cross = tangentX[previous] * tangentZ[next] - tangentZ[previous] * tangentX[next];
    curvature[sample] = Math.asin(Math.max(-1, Math.min(1, cross))) / (2 * centerlineSpacing);
  }
  const window = Math.round(8 / centerlineSpacing);
  const cornerStrength = new Float32Array(sampleCount);
  const turnDirection = new Float32Array(sampleCount);
  for (let sample = 0; sample < sampleCount; sample++) {
    let sum = 0;
    for (let offset = -window; offset <= window; offset++) sum += curvature[(sample + offset + sampleCount) % sampleCount];
    const smoothed = sum / (2 * window + 1);
    cornerStrength[sample] = smoothstep(Math.abs(smoothed), 1 / 50, 1 / 20);
    turnDirection[sample] = Math.sign(smoothed);
  }
  // Ease the berms in and out over about 16 m of track. A berm that rises abruptly along the track is a
  // bump that throws the bike up and off its tires right where the rider leans in.
  const easeWindow = Math.round(8 / centerlineSpacing);
  const eased = new Float32Array(sampleCount);
  for (let sample = 0; sample < sampleCount; sample++) {
    let sum = 0;
    for (let offset = -easeWindow; offset <= easeWindow; offset++) sum += cornerStrength[(sample + offset + sampleCount) % sampleCount];
    eased[sample] = smoothstep(sum / (2 * easeWindow + 1), 0, 1);
  }
  return { cornerStrength: eased, turnDirection };
}

// Where the corners flagged with an inside berm are along the track: each one's arc plus a few meters either
// side, eased in and out like the berms, and never more than the corner's own strength.
function markInsideBerms(corners: TrackDesign['corners'], straights: { start: number; end: number }[], cornerStrength: Float32Array) {
  const sampleCount = cornerStrength.length;
  const flagged = new Float32Array(sampleCount);
  corners.forEach((corner, index) => {
    if (!corner.insideBerm) return;
    // Corner i's arc runs from the end of straight i-1 to the start of straight i
    const arcStart = straights[(index - 1 + corners.length) % corners.length].end;
    let arcEnd = straights[index].start;
    while (arcEnd < arcStart) arcEnd += sampleCount * centerlineSpacing;
    for (let distance = arcStart - 6; distance <= arcEnd + 6; distance += centerlineSpacing) {
      flagged[(((Math.round(distance / centerlineSpacing)) % sampleCount) + sampleCount) % sampleCount] = 1;
    }
  });
  const easeWindow = Math.round(8 / centerlineSpacing);
  const strength = new Float32Array(sampleCount);
  for (let sample = 0; sample < sampleCount; sample++) {
    let sum = 0;
    for (let offset = -easeWindow; offset <= easeWindow; offset++) sum += flagged[(sample + offset + sampleCount) % sampleCount];
    strength[sample] = Math.min(smoothstep(sum / (2 * easeWindow + 1), 0, 1), cornerStrength[sample]);
  }
  return strength;
}

// Speed a fast rider carries out of a corner, roughly. A gentle bend can be straightened by using the
// width of the track, so the line's radius grows as the turn gets smaller; sweepers are taken nearly flat out.
// Corners the same way with only a short straight between (two 90s making a 180) count as one turn.
function cornerExitSpeed(corners: TrackDesign['corners'], index: number) {
  const count = corners.length;
  const at = (i: number) => corners[((i % count) + count) % count];
  const signedTurn = (i: number) => {
    const before = at(i - 1), corner = at(i), after = at(i + 1);
    const inX = corner.x - before.x, inZ = corner.z - before.z, outX = after.x - corner.x, outZ = after.z - corner.z;
    return Math.atan2(inX * outZ - inZ * outX, inX * outX + inZ * outZ);
  };
  let turn = signedTurn(index);
  let radius = at(index).radius;
  for (let back = 1; back < count; back++) {
    const previous = at(index - back), next = at(index - back + 1);
    const between = Math.hypot(next.x - previous.x, next.z - previous.z) - previous.radius - next.radius;
    const previousTurn = signedTurn(index - back);
    if (between > 20 || Math.sign(previousTurn) !== Math.sign(turn)) break;
    turn += previousTurn;
    radius = Math.min(radius, previous.radius);
  }
  const lineRadius = radius + (trackHalfWidth * 0.75) / Math.max(0.05, 1 - Math.cos(Math.min(Math.PI, Math.abs(turn)) / 2));
  return Math.min(18, Math.sqrt(lineRadius * 9.81 * 0.85));
}

// Lays each straight's features out in order from the corner, each sized for the speed a fast rider has
// at its lip on full throttle out of the corner. At that speed a scrubbed jump reaches the knuckle and an
// unscrubbed one lands down the landing, which is long enough for some more speed on top.
function placeFeatures(design: TrackDesign, straights: { start: number; end: number }[], trackLength: number) {
  const jumps: Jump[] = [];
  design.straights.forEach((specs, straightIndex) => {
    const straight = straights[straightIndex];
    const where = `${design.name}, straight ${straightIndex}`;
    if (!straight) throw new Error(`${where}: the track has only ${straights.length} straights`);
    const cornerClearance = design.cornerClearance;
    let cursor = straight.start + cornerClearance;
    let runUp = cornerClearance;
    let entrySpeed = cornerExitSpeed(design.corners, straightIndex);
    for (const spec of specs) {
      cursor += spec.runUp ?? 0;
      runUp += spec.runUp ?? 0;
      const runUpSpeed = speedAfterRunUp(runUp, entrySpeed);
      const feature = buildFeature(spec, Math.min(design.maxDesignSpeed, runUpSpeed), runUpSpeed, design.maxJumpHeight, where);
      if (cursor + feature.length > straight.end - cornerClearance) {
        throw new Error(`${where}: ${feature.description} needs ${(cursor + feature.length - (straight.end - cornerClearance)).toFixed(1)} m more room`);
      }
      jumps.push({ ...feature, start: cursor % trackLength });
      cursor += feature.length + design.landingRoom;
      runUp = design.landingRoom;
      entrySpeed = feature.designSpeed;
    }
  });
  return jumps.sort((a, b) => a.start - b.start);
}

// A jump sized for a set lip speed has to be reachable from its run-up (within a little)
function sizedSpeed(speed: number | undefined, designSpeed: number, runUpSpeed: number, where: string) {
  if (speed === undefined) return designSpeed;
  if (speed > runUpSpeed + 0.5) throw new Error(`${where}: a jump sized for ${speed.toFixed(1)} m/s, but the run-up gives ${runUpSpeed.toFixed(1)}`);
  return speed;
}

// designSpeed sizes the jumps that size themselves; a fixed-size gap only has to be clearable from runUpSpeed
function buildFeature(spec: FeatureSpec, designSpeed: number, runUpSpeed: number, maxHeight: number, where: string): Omit<Jump, 'start'> {
  switch (spec.kind) {
    case 'tabletop': {
      // A tabletop's landing is as tall as its deck, so the whole jump grows to what the landing needs
      const speed = sizedSpeed(spec.speed, designSpeed, runUpSpeed, where);
      const lipAngle = (spec.lipDegrees ?? 26) * degrees;
      const height = spec.height ?? 1.9;
      const deck = spec.deck ?? Math.max(3, 0.75 * flightDistance(speed, lipAngle, height, height));
      const faceHeight = spec.height ?? landingHeightFor(speed, lipAngle, Math.min(1.9, maxHeight), deck, maxHeight);
      const topAngle = spec.landingDegrees === undefined ? landingAngle : spec.landingDegrees * degrees;
      const bottomAngle = spec.landingBottomDegrees === undefined ? topAngle : spec.landingBottomDegrees * degrees;
      return tabletop(faceHeight, lipAngle, deck, topAngle, speed, bottomAngle);
    }
    case 'double': {
      // Sized so a full scrub at the design speed still clears it, and without a scrub it lands well down
      // the landing; the landing is as tall as it needs to be (at least the takeoff), and the gap is
      // re-measured for that height
      const takeoffHeight = spec.takeoff ?? 1.8;
      const lipAngle = (spec.lipDegrees ?? 28) * degrees;
      let landingHeight = takeoffHeight;
      let gap = 0;
      for (let pass = 0; pass < 3; pass++) {
        gap = 0.7 * flightDistance(designSpeed, lipAngle, takeoffHeight, landingHeight);
        landingHeight = Math.min(takeoffHeight + 1.6, landingHeightFor(designSpeed, lipAngle, takeoffHeight, gap, maxHeight));
      }
      if (gap < (takeoffHeight + landingHeight) / Math.tan(backsideAngle) + 1.5) {
        throw new Error(`${where}: a double needs more speed than ${designSpeed.toFixed(1)} m/s`);
      }
      return gapJump('double', takeoffHeight, lipAngle, gap, landingHeight, landingAngle, designSpeed);
    }
    case 'step-up': {
      const takeoffHeight = spec.takeoff ?? 1.3;
      const lipAngle = (spec.lipDegrees ?? 29) * degrees;
      const landingHeight = takeoffHeight + (spec.rise ?? 0.75);
      // A set gap only has to be clearable from the run-up; otherwise the gap is sized for the lip speed
      let speed: number;
      let gap: number;
      if (spec.gap !== undefined) {
        const clearSpeed = speedToClear(spec.gap, lipAngle, takeoffHeight, landingHeight);
        if (clearSpeed > runUpSpeed + 0.5) {
          throw new Error(`${where}: the step-up needs ${clearSpeed.toFixed(1)} m/s but the run-up gives ${runUpSpeed.toFixed(1)}`);
        }
        gap = spec.gap;
        speed = clearSpeed * 1.04;
      } else {
        speed = sizedSpeed(spec.speed, designSpeed, runUpSpeed, where);
        gap = 0.7 * flightDistance(speed, lipAngle, takeoffHeight, landingHeight);
      }
      if (gap < (takeoffHeight + landingHeight) / Math.tan(backsideAngle) + 1) {
        throw new Error(`${where}: a step-up needs more speed than ${speed.toFixed(1)} m/s`);
      }
      const topAngle = spec.landingDegrees === undefined ? landingAngle : spec.landingDegrees * degrees;
      const bottomAngle = spec.landingBottomDegrees === undefined ? topAngle : spec.landingBottomDegrees * degrees;
      return gapJump('step-up', takeoffHeight, lipAngle, gap, landingHeight, topAngle, speed, spec.deck ?? 6.5, bottomAngle);
    }
    case 'step-on-off': {
      // Step on: like a step-up, sized so the design speed lands on the deck past the knuckle. The deck is
      // long enough that a big overjump still comes down on it. Step off: the rider lands the step-on
      // carrying most of their speed forward and gets back on the gas across the deck; the gap off is sized
      // for that speed, with a landing lower than the deck. Too slow across the top and it cases.
      const takeoffHeight = spec.takeoff ?? 1.5;
      const deckHeight = Math.min(spec.deckHeight ?? 3, maxHeight);
      const lipAngle = 30 * degrees;
      const gapOn = 0.7 * flightDistance(designSpeed, lipAngle, takeoffHeight, deckHeight);
      if (gapOn < (takeoffHeight + deckHeight) / Math.tan(backsideAngle) + 1.5) {
        throw new Error(`${where}: a step-on needs more speed than ${designSpeed.toFixed(1)} m/s`);
      }
      const deckLength = spec.deck ?? Math.max(12, flightDistance(designSpeed * 1.15, lipAngle, takeoffHeight, deckHeight) - gapOn + 3);
      const deckSpeed = speedAfterRunUp(deckLength, 0.8 * designSpeed);
      const kickHeight = 0.4;
      const kickAngle = 20 * degrees;
      let landingHeight = deckHeight - 1;
      let gapOff = 0;
      for (let pass = 0; pass < 3; pass++) {
        gapOff = 0.7 * flightDistance(deckSpeed, kickAngle, deckHeight + kickHeight, landingHeight);
        landingHeight = Math.min(deckHeight - 0.6, Math.max(deckHeight - 1.2, landingHeightFor(deckSpeed, kickAngle, deckHeight + kickHeight, gapOff, maxHeight)));
      }
      const minimumGapOff = (deckHeight + kickHeight + landingHeight) / Math.tan(backsideAngle) + 1;
      if (gapOff < minimumGapOff) throw new Error(`${where}: a step-off needs more speed than ${deckSpeed.toFixed(1)} m/s`);
      return stepOnStepOff(takeoffHeight, lipAngle, gapOn, deckHeight, deckLength, kickHeight, kickAngle, gapOff, landingHeight, designSpeed, deckSpeed);
    }
    case 'big double':
    case 'triple':
    case 'whip jump': {
      const lipAngle = spec.lipDegrees * degrees;
      const clearSpeed = speedToClear(spec.gap, lipAngle, spec.takeoff, spec.landing);
      if (clearSpeed > runUpSpeed + 0.5) {
        throw new Error(`${where}: the ${spec.kind} needs ${clearSpeed.toFixed(1)} m/s but the run-up gives ${runUpSpeed.toFixed(1)}`);
      }
      const landingAngle = spec.landingDegrees * degrees;
      const landingBottomAngle = (spec.landingBottomDegrees ?? spec.landingDegrees) * degrees;
      const jump = gapJump(spec.kind, spec.takeoff, lipAngle, spec.gap, spec.landing, landingAngle, clearSpeed * 1.04, 0, landingBottomAngle);
      jump.description = `${spec.kind}: ${spec.gap.toFixed(0)} m gap, needs ${clearSpeed.toFixed(1)} m/s at the lip, run-up gives ${runUpSpeed.toFixed(1)}`;
      return jump;
    }
    case 'rollers':
    case 'whoops':
      return rollers(spec.kind, spec.count, spec.height, spec.spacing, designSpeed);
    case 'rhythm':
      return rhythmSection(spec.count, spec.height, (spec.lipDegrees ?? 22) * degrees, (spec.backDegrees ?? 10) * degrees, designSpeed);
  }
}

// Distance along the track and signed distance across it (positive = right of the riding direction),
// refined from the nearest sample onto the neighboring centerline segments
function projectOntoCenterline(centerline: ReturnType<typeof buildCenterline>, sample: number, x: number, z: number) {
  const sampleCount = centerline.x.length;
  let bestAlong = sample * centerlineSpacing;
  let bestAcross = 0;
  let bestDistanceSquared = Infinity;
  for (const from of [sample - 1, sample]) {
    const a = (from + sampleCount) % sampleCount;
    const b = (from + 1 + sampleCount) % sampleCount;
    const segmentX = centerline.x[b] - centerline.x[a];
    const segmentZ = centerline.z[b] - centerline.z[a];
    const segmentLengthSquared = segmentX * segmentX + segmentZ * segmentZ;
    const fraction = Math.min(1, Math.max(0, ((x - centerline.x[a]) * segmentX + (z - centerline.z[a]) * segmentZ) / segmentLengthSquared));
    const closestX = centerline.x[a] + segmentX * fraction;
    const closestZ = centerline.z[a] + segmentZ * fraction;
    const distanceSquared = (x - closestX) ** 2 + (z - closestZ) ** 2;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestAlong = (from + fraction) * centerlineSpacing;
      // Right of the riding direction (tx, tz) is (-tz, tx)
      const segmentLength = Math.sqrt(segmentLengthSquared);
      bestAcross = ((x - closestX) * -segmentZ + (z - closestZ) * segmentX) / segmentLength;
    }
  }
  const trackLength = sampleCount * centerlineSpacing;
  return { along: (bestAlong + trackLength) % trackLength, across: bestAcross };
}

// Height of the track shaping at a point: jumps across the riding surface (sloping off at the sides)
// plus a berm on the outside of corners. The inside of a corner stays flat for inside lines.
function shapeHeight(
  along: number,
  across: number,
  trackLength: number,
  jumps: Jump[],
  cornerStrength: Float32Array,
  turnDirection: Float32Array,
  insideBermStrength: Float32Array,
) {
  let height = 0;
  const sideTaper = 1 - smoothstep(Math.abs(across), trackHalfWidth + 0.5, trackHalfWidth + 3.5);
  if (sideTaper > 0) {
    for (const jump of jumps) {
      const u = (along - jump.start + trackLength) % trackLength;
      if (u < jump.length) height = Math.max(height, jump.height(u) * sideTaper);
    }
  }

  const sample = Math.round(along / centerlineSpacing) % cornerStrength.length;
  const strength = cornerStrength[sample];
  if (strength > 0) {
    // Berm: rises from just off center toward the outside of the turn, banked about 23 degrees 3 m out,
    // 28 degrees at the track edge and 33 at its top 1.5 m past the edge, then rolls off behind
    const outward = -turnDirection[sample] * across;
    const bermHeight = 2;
    const faceStart = 0.5;
    const faceEnd = trackHalfWidth + 1.5;
    let berm = 0;
    if (outward > faceStart && outward <= faceEnd) berm = bermHeight * ((outward - faceStart) / (faceEnd - faceStart)) ** 1.6;
    else if (outward > faceEnd) berm = bermHeight * (1 - smoothstep(outward, faceEnd, faceEnd + 4));
    height = Math.max(height, berm * strength);
  }

  // Inside berm: a lane cut into the inside of the turn. From a rounded rim just inside the middle of the
  // track the ground drops to a floor near the inside edge, then climbs gently back up off the track. Like the
  // outside berm it's steepest high up (about 31 degrees a meter below the rim, easing to flat at the floor),
  // so carrying more speed up the face finds more bank. The middle of the track stays flat for the outside line.
  const inside = insideBermStrength[sample];
  if (inside > 0) {
    const inward = turnDirection[sample] * across;
    const depth = 1;
    const rim = 0.4;
    const floor = trackHalfWidth - 0.6;
    const floorEnd = trackHalfWidth + 0.2;
    // Behind the floor the ground climbs back gently, off the track: turning tighter than the lane runs you
    // onto the infield rather than into a wall
    const wallTop = trackHalfWidth + 4.5;
    let cut = 0;
    if (inward > rim && inward <= floor) {
      // Slope shaped s(1-s)^2 across the face: zero at the rim, steepest a third of the way down, flat at the floor
      const s = (inward - rim) / (floor - rim);
      cut = depth * (6 * s * s - 8 * s * s * s + 3 * s * s * s * s);
    } else if (inward > floor) cut = depth * (1 - smoothstep(inward, floorEnd, wallTop));
    height -= cut * inside;
  }
  return height;
}
