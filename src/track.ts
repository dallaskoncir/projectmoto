// The track: a closed loop laid out as a centerline, with berms on the outside of corners and jumps on the
// straights, baked into one heightfield that both physics and rendering use. Pure math, no browser code.
// The jumps (other than the big double) come from a seed, so a layout can be shared and rebuilt.

export const mapSize = 300; // meters, square, centered on the origin
export const cellSize = 0.4;
export const cellsPerSide = Math.round(mapSize / cellSize);
export const trackHalfWidth = 4;

export const centerlineSpacing = 0.5;
const featureReach = trackHalfWidth + 10; // how far from the centerline track shaping reaches

// Closed centerline, ridden clockwise seen from above (heading +X, a right turn goes toward +Z).
// Corners of a polygon, each rounded off with its own radius. Seven right-handers, three left-handers
// (the S through the middle and the back section) and a hairpin made of two tight rights.
const corners: { x: number; z: number; radius: number }[] = [
  { x: -106, z: -106, radius: 14 }, // right onto the long top straight (big double)
  { x: 100, z: -106, radius: 12 }, // right
  { x: 106, z: 25, radius: 9 }, // right
  { x: 31, z: 28, radius: 10 }, // left
  { x: 30, z: 112, radius: 8 }, // hairpin, first half
  { x: 5, z: 112, radius: 8 }, // hairpin, second half
  { x: 0, z: 56, radius: 10 }, // left
  { x: -69, z: 56, radius: 10 }, // right
  { x: -69, z: -25, radius: 10 }, // left
  { x: -106, z: -25, radius: 10 }, // right
];

// ---------- Jump profiles ----------
// A profile is the height of a feature at distance u along the track from where it starts.

export type JumpKind = 'big double' | 'double' | 'tabletop' | 'step-up' | 'rollers';

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

// Landing: a straight slope from the knuckle down to the ground
function landingSlope(height: number, angle: number) {
  const length = height / Math.tan(angle);
  return { length, height: (x: number) => (x >= length ? 0 : height * (1 - x / length)) };
}

function tabletop(faceHeight: number, lipAngle: number, deckLength: number, landingAngle: number, designSpeed: number): Omit<Jump, 'start'> {
  const kind: JumpKind = 'tabletop';
  const face = takeoffFace(faceHeight, lipAngle);
  const knuckle = face.length + deckLength;
  const landing = landingSlope(faceHeight, landingAngle);
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
): Omit<Jump, 'start'> {
  const face = takeoffFace(takeoffHeight, lipAngle);
  const lip = face.length;
  const takeoffBackEnd = lip + takeoffHeight / Math.tan(backsideAngle);
  const knuckle = lip + gap;
  const landingWallStart = knuckle - landingHeight / Math.tan(backsideAngle);
  const deckEnd = knuckle + landingDeck;
  const landingSlopeAfterDeck = landingSlope(landingHeight, landingAngle);
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

function rollers(count: number, height: number, spacing: number, designSpeed: number): Omit<Jump, 'start'> {
  return {
    kind: 'rollers',
    length: count * spacing,
    height: (u) => (height * (1 - Math.cos((2 * Math.PI * u) / spacing))) / 2,
    edges: [],
    edgeHeights: [],
    description: `${count} rollers, ${height.toFixed(1)} m high, ${spacing.toFixed(1)} m apart`,
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
// real track. Capped so jumps stay a sensible size; past the cap a big overjump still lands flat.
const landingAngle = 17 * degrees;
const maxLandingHeight = 3;
function landingHeightFor(designSpeed: number, lipAngle: number, takeoffHeight: number, knuckle: number) {
  let height = takeoffHeight;
  // The far landing point depends on the landing's height, so settle it in a few passes
  for (let pass = 0; pass < 4; pass++) {
    const farthest = flightDistance(designSpeed * 1.2, lipAngle, takeoffHeight, height * 0.3);
    height = Math.min(maxLandingHeight, Math.max(takeoffHeight, (farthest - knuckle) * Math.tan(landingAngle)));
  }
  return height;
}

// Rough top speed the bike can reach over a run-up, starting from corner-exit speed. Matches the engine
// (force fading to zero at top speed) with some margin for the rider not being flat out.
function speedAfterRunUp(distance: number, startSpeed = 8, engineAcceleration = 7, topSpeed = 25) {
  let speed = startSpeed;
  for (let traveled = 0; traveled < distance; traveled += 0.5) {
    speed += ((engineAcceleration * (1 - speed / topSpeed)) / speed) * 0.5;
  }
  return speed;
}

// Small seeded random generator (mulberry32) so a layout number always builds the same track
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(value: number, edge0: number, edge1: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------- Track ----------

export type Track = {
  seed: number;
  heights: Float32Array; // (cellsPerSide+1)^2, Rapier's layout: index = zIndex + xIndex * (cellsPerSide+1)
  onTrack: Float32Array; // same layout, 1 on the riding surface fading to 0 off it, for coloring
  centerlineX: Float32Array;
  centerlineZ: Float32Array;
  tangentX: Float32Array;
  tangentZ: Float32Array;
  cornerStrength: Float32Array; // 0 on straights, 1 in tight corners
  length: number;
  jumps: Jump[];
  heightAt: (x: number, z: number) => number;
  nearestCenterlineIndex: (x: number, z: number) => number;
  spawnIndex: number;
};

export function buildTrack(seed: number, withJumps = true): Track {
  const centerline = buildCenterline();
  const sampleCount = centerline.x.length;
  const length = sampleCount * centerlineSpacing;
  const { cornerStrength, sharpness, turnDirection } = measureCorners(centerline.tangentX, centerline.tangentZ);

  // Straights are measured between the corners themselves; the run-up margin covers the berms easing out
  const straights = findStraights(sharpness);
  const jumps = withJumps ? placeJumps(straights, seed) : [];
  const spawnIndex = Math.round(straights[0].start / centerlineSpacing + 6 / centerlineSpacing) % sampleCount;

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
        height += shapeHeight(along, across, length, jumps, cornerStrength, turnDirection);
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
    seed,
    heights,
    onTrack,
    centerlineX: centerline.x,
    centerlineZ: centerline.z,
    tangentX: centerline.tangentX,
    tangentZ: centerline.tangentZ,
    cornerStrength,
    length,
    jumps,
    heightAt,
    nearestCenterlineIndex,
    spawnIndex,
  };
}

// Straight lines between the polygon corners, each corner replaced by a circular arc of its radius,
// resampled every centerlineSpacing meters
function buildCenterline() {
  const denseX: number[] = [];
  const denseZ: number[] = [];
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
  return { x, z, tangentX, tangentZ };
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
  return { cornerStrength: eased, sharpness: cornerStrength, turnDirection };
}

// Stretches of track with no corner, longest first, as [start, end) distances along the track
function findStraights(cornerStrength: Float32Array) {
  const sampleCount = cornerStrength.length;
  const isStraight = (sample: number) => cornerStrength[(sample + sampleCount) % sampleCount] < 0.02;
  // Start scanning just after a corner so no straight wraps around the start
  let firstCorner = 0;
  while (isStraight(firstCorner)) firstCorner++;
  const straights: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let offset = 0; offset <= sampleCount; offset++) {
    const sample = firstCorner + offset;
    if (isStraight(sample) && offset < sampleCount) {
      if (runStart < 0) runStart = sample;
    } else if (runStart >= 0) {
      straights.push({ start: runStart * centerlineSpacing, end: sample * centerlineSpacing });
      runStart = -1;
    }
  }
  const trackLength = sampleCount * centerlineSpacing;
  return straights
    .map(({ start, end }) => ({ start: start % trackLength, end: start % trackLength + (end - start) }))
    .sort((a, b) => b.end - b.start - (a.end - a.start));
}

function placeJumps(straights: { start: number; end: number }[], seed: number) {
  const random = seededRandom(seed);
  const between = (low: number, high: number) => low + (high - low) * random();
  const jumps: Jump[] = [];
  const runUpFromCorner = 10;
  const landingRoom = 8;

  // The big double goes on the longest straight with plenty of run-up
  const longest = straights[0];
  const bigDoubleLip = 30 * degrees;
  // Same height as its takeoff (about 15 m/s to clear) with a long 13 degree landing that still catches it
  // at full throttle from the start
  const bigDoubleLandingHeight = 2.6;
  const bigDouble = {
    ...gapJump('big double', 2.6, bigDoubleLip, 21, bigDoubleLandingHeight, 13 * degrees, 16),
    start: longest.start + 45,
  };
  bigDouble.description = `big double: 21 m gap, needs about ${speedToClear(21, bigDoubleLip, 2.6, bigDoubleLandingHeight).toFixed(0)} m/s at the lip`;
  jumps.push(bigDouble);
  const fillAfterBigDouble = { start: bigDouble.start + bigDouble.length + landingRoom, end: longest.end };

  for (const straight of [fillAfterBigDouble, ...straights.slice(1)]) {
    let cursor = straight.start + (straight === fillAfterBigDouble ? 0 : runUpFromCorner);
    let runUp = straight === fillAfterBigDouble ? 10 : runUpFromCorner;
    // Speed a rider carries into the run-up: off a corner, or off the previous jump's landing
    let entrySpeed = straight === fillAfterBigDouble ? bigDouble.designSpeed : 8.5;
    let previousKind: JumpKind | undefined;
    for (;;) {
      const room = straight.end - landingRoom - cursor;
      if (room < 10) break;
      // Each kind is sized for the lip speed this run-up gives at a steady (not flat-out) throttle, so at
      // that speed it lands just past the knuckle, slower lands on the deck or short, faster lands further
      // down a landing long enough for about 25% more speed. Returns nothing if it can't fit the room.
      const designSpeed = Math.min(16, speedAfterRunUp(runUp, entrySpeed, 5));
      const candidates: { weight: number; build: () => Omit<Jump, 'start'> | undefined }[] = [
        {
          weight: 3,
          build: () => {
            // A tabletop's landing is as tall as its deck, so the whole jump grows to what the landing needs
            const lipAngle = between(22, 30) * degrees;
            let faceHeight = between(1.4, 2.4);
            const deck = Math.max(3, 0.75 * flightDistance(designSpeed, lipAngle, faceHeight, faceHeight));
            faceHeight = landingHeightFor(designSpeed, lipAngle, faceHeight, deck);
            return tabletop(faceHeight, lipAngle, deck, landingAngle, designSpeed);
          },
        },
        {
          weight: 3,
          build: () => {
            const takeoffHeight = between(1.3, 2.3);
            const lipAngle = between(24, 32) * degrees;
            // Cleared from about 90% of the design speed; the landing is as tall as it needs to be (at least
            // the takeoff), and the gap is re-measured for that height
            let landingHeight = takeoffHeight;
            let gap = 0;
            for (let pass = 0; pass < 3; pass++) {
              gap = 0.8 * flightDistance(designSpeed, lipAngle, takeoffHeight, landingHeight);
              landingHeight = Math.min(takeoffHeight + 1, landingHeightFor(designSpeed, lipAngle, takeoffHeight, gap));
            }
            if (gap < (takeoffHeight + landingHeight) / Math.tan(backsideAngle) + 1.5) return undefined;
            return gapJump('double', takeoffHeight, lipAngle, gap, landingHeight, landingAngle, designSpeed);
          },
        },
        {
          weight: 2,
          build: () => {
            const takeoffHeight = between(1.0, 1.6);
            const lipAngle = between(26, 32) * degrees;
            const landingHeight = takeoffHeight + between(0.5, 1.0);
            const gap = 0.7 * flightDistance(designSpeed, lipAngle, takeoffHeight, landingHeight);
            if (gap < (takeoffHeight + landingHeight) / Math.tan(backsideAngle) + 1) return undefined;
            const deck = between(5, 8);
            return gapJump('step-up', takeoffHeight, lipAngle, gap, landingHeight, landingAngle, designSpeed, deck);
          },
        },
        {
          weight: 1.2,
          build: () => {
            const spacing = between(6, 8);
            const count = Math.min(Math.round(between(3, 5)), Math.floor(room / spacing));
            return count >= 2 ? rollers(count, between(0.4, 0.7), spacing, designSpeed) : undefined;
          },
        },
      ];
      const options = candidates
        .map((candidate) => ({ weight: candidate.weight, feature: candidate.build() }))
        .filter((option) => option.feature && option.feature.kind !== previousKind && option.feature.length <= room);
      if (options.length === 0) break;
      let pick = random() * options.reduce((sum, option) => sum + option.weight, 0);
      const chosen = options.find((option) => (pick -= option.weight) <= 0) ?? options[options.length - 1];
      const feature = chosen.feature!;
      jumps.push({ ...feature, start: cursor });
      previousKind = feature.kind;
      cursor += feature.length + landingRoom;
      runUp = landingRoom;
      entrySpeed = feature.designSpeed;
    }
  }
  return jumps.sort((a, b) => a.start - b.start);
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
  return height;
}
