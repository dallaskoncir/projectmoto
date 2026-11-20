// Bike physics, track and riding rules. No rendering or browser code, so it also runs headless in Node.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildTrack, cellsPerSide, centerlineSpacing, mapSize, speedAfterRunUp, type Track } from './track.ts';
import { trackDesigns } from './trackDesigns.ts';

// Every value that affects feel. Edited live by the panel; "copy settings" exports this as JSON.
export const settings = {
  suspensionStiffness: 55, // Rapier scales this by bike mass, so sag stays the same if mass changes
  suspensionCompressionDamping: 8,
  suspensionReboundDamping: 10,
  suspensionTravel: 0.3,
  suspensionRestLength: 0.35,

  engineForce: 1500,
  topSpeed: 25, // meters per second; engine force fades to zero here
  engineBrakingForce: 150,
  // Brakes. LT is the front brake and RB the rear, which builds up while held. Combined: LT works both,
  // split by combinedFrontShare, and RB does nothing.
  frontBrakeForce: 1500, // newtons at full LT; about all the front tire can take braking upright on flat dirt
  rearBrakeForce: 1000, // newtons at full rear brake
  rearBrakeButtonStrength: 0.5, // share of the rear brake force RB holds: a drag, not a stomp
  rearBrakeRampSeconds: 0.25, // how long RB takes to build to its full strength
  combinedBrakes: true,
  combinedFrontShare: 0.75, // front/rear balance when combined; the wheel with more brake gets all of LT
  lockedTireGrip: 0.8, // share of its grip a locked tire drags with; ease the brake under this to unlock it
  lockedTireSideGrip: 0.5, // share of its sideways grip a locked tire keeps (knobs plowing the dirt)

  frontGrip: 1.32, // lower than the rear: the front washes out first in a flat turn, so weight forward plants it
  rearGrip: 1.87,
  pressGripBonus: 0.25, // extra grip with the bike fully pressed down into a turn (side knobs dig into the dirt)

  // Cornering. Bike and rider together balance like an inverted pendulum: gravity pulls the lean over,
  // the tires' cornering force pushes it back up. The left stick asks for a lean and the rider's balance
  // steers the bars (countersteering first) to get there. The turn comes from the lean.
  throttleRearGripUse: 2, // how much of the rear's grip the engine's drive uses up (1 = all of it, the friction circle); more = the rear steps out on the gas sooner
  fullStickOverLeanDegrees: 8, // how much more lean than the tires hold a full left stick asks for; about 85% stick is right at the limit
  bermNoSlideBankDegrees: 10, // a berm banked this much holds a full stick without the rear stepping out
  overLeanRangeDegrees: 8, // lean past what the tires hold over which the rear steps all the way out
  overLeanRearGripLoss: 0.5, // share of its sideways grip the rear gives up when stepped all the way out
  overLeanSlideDrag: 0.6, // drag of the stepped-out rear, as a share of its load: a slide scrubs speed, which tightens the turn
  slideHoldSeconds: 1.2, // how long the rider can hold a full stick slide before it falls in and low-sides; easing off resets it
  leanGripUse: 0.8, // scales the tires' estimated cornering grip to what they really hold; sets where the rear starts stepping out
  leanResponse: 6, // how quickly the bike gets to the lean the stick asks for
  leanPendulumHeight: 0.9, // meters from tires to the bike-and-rider center of mass; higher = lean changes more slowly
  steeringLockDegrees: 30, // handlebar limit; caps how tight a slow turn can be
  feetDownSpeed: 2, // meters per second; below about this the rider puts both feet down and steers the bars directly
  footDabSpeed: 6, // meters per second; below this the inside foot (fully out at half this) stops the bike falling in past the lean you asked for
  countersteerLimitG: 0.3, // most sideways push away from the turn the balance uses to start a lean; the rider's hips do the rest
  riderLeanInitiation: 8, // radians/s^2 of lean the rider's hips can add when the countersteer is capped
  riderSaveStrength: 9, // radians/s^2; how hard the rider can catch a sliding bike when you ease off the stick
  lowSideLeanDegrees: 60, // bike-and-rider lean past which the rider can't save it (not at foot-dab speeds)
  bikePressDegrees: 30, // how far a full right stick lays the bike over past the bike-and-rider lean (the rider's body moves the other way)

  riderPitchTorqueAir: 500,
  airPitchDamping: 75,
  riderWeightShiftTorqueGround: 250, // about a real rider moving their body fore and aft; moves roughly 15% of the weight between the tires
  riderBodyResponse: 8, // how fast the rider moves around on the bike
  wheelInertia: 0.6, // per wheel, kg m^2; sets how much brake taps and throttle blips pitch the bike in the air (real MX rear wheel is about 0.6)
  scrubFullLeanDegrees: 30, // bike lean at the lip for a full scrub (a full right stick on its own gets there)
  scrubHeightAbsorb: 0.25, // share of upward takeoff speed a full scrub removes
  // Preload: right stick back on the ground loads the suspension, a flick forward at the lip springs off it
  preloadPopSpeed: 0.8, // meters per second of extra upward speed a full preload adds at the lip
  preloadChargeSeconds: 0.35, // how long the stick has to be held back to fully load the suspension
  preloadEarlySeconds: 0.3, // how long before the bike leaves the ground the forward flick still counts
  preloadLateSeconds: 0.1, // and how long after
  maxWhipLeanDegrees: 85, // how far the rider lays the bike over in the air
  leftStickWhipShare: 0.5, // share of the full whip the left stick gives on its own; the right stick adds the rest and swings it further
  whipLeanResponse: 7,
  whipYawTorque: 550,
  whipYawReturn: 600, // pulls the bike back in line with its direction of travel in the air
  airYawDamping: 140,

  uprightAssistStrength: 4000,
  uprightAssistDamping: 400,

  bikeMass: 180,
  centerOfMassHeight: -0.15, // relative to the chassis box center; lower = harder to wheelie or loop
  gravity: 9.81,

  trackIndex: 0, // which of trackDesigns (trackDesigns.ts) is loaded

  cameraDistance: 6,
  cameraHeight: 2.2,
  cameraSmoothing: 6,
  stickDeadzone: 0.12,

  // Landing judged at touchdown: below the bobble angle is clean, between bobble and crash is a bobble
  // that gets worse toward the crash angle, past the crash angle the rider goes down
  landingLeanBobbleDegrees: 25, // bike still laid over (whip or scrub not brought back)
  landingLeanCrashDegrees: 50,
  landingSidewaysBobbleDegrees: 20, // bike pointing away from the direction of travel
  landingSidewaysCrashDegrees: 45,
  landingPitchBobbleDegrees: 30, // bike angle against the landing surface (nose too high or too low)
  landingPitchCrashDegrees: 60,
  landingImpactBobbleSpeed: 7, // meters per second into the landing surface
  landingImpactCrashSpeed: 14,
  bobbleSpeedLoss: 0.2, // share of speed lost by the worst bobble
  bobbleSeconds: 0.8,
  crashRespawnSeconds: 2.5,
};

// Written by the input code. Sticks are -1..1 after the deadzone, triggers 0..1.
export const controls = {
  throttle: 0,
  frontBrake: 0, // LT, 0..1
  rearBrake: 0, // RB, 1 while held (the rear brake builds up from it)
  steering: 0, // left stick X, +1 = lean right
  riderForwardLean: 0, // right stick Y, +1 = rider forward
  riderSideLean: 0, // right stick X, +1 = rider's body to the right, which lays the bike over to the left (on the ground and in the air)
};

await RAPIER.init();

export const physicsTimestep = 1 / 120;
export const chassisHalfLength = 0.7;
export const chassisHalfHeight = 0.25;
export const chassisHalfWidth = 0.2;
export const wheelRadius = 0.33;
const wheelAttachHeight = -0.15;
const rearWheelX = -0.7;
const frontWheelX = 0.75;
const wheelbase = frontWheelX - rearWheelX;
const maxBikeLean = THREE.MathUtils.degToRad(65);
// Share of a turn's sideways force each tire carries, set by how far each axle is from the center of mass
const frontCorneringShare = -rearWheelX / wheelbase;
const rearCorneringShare = frontWheelX / wheelbase;
export const rearWheelIndex = 0;
export const frontWheelIndex = 1;

// ---------- Physics world ----------

export const world = new RAPIER.World({ x: 0, y: -settings.gravity, z: 0 });
world.timestep = physicsTimestep;

// The track is one heightfield (see track.ts). Loading another replaces it; trackVersion tells the renderer.
export let track: Track = buildTrack(trackDesigns[settings.trackIndex]);
let terrainCollider = createTerrainCollider(track);

function createTerrainCollider(newTrack: Track) {
  return world.createCollider(
    RAPIER.ColliderDesc.heightfield(
      cellsPerSide,
      cellsPerSide,
      newTrack.heights,
      { x: mapSize, y: 1, z: mapSize },
      RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES, // no phantom bumps at the seams between triangles
    ),
  );
}

export function loadTrack(trackIndex: number, withJumps = true) {
  settings.trackIndex = (trackIndex + trackDesigns.length) % trackDesigns.length;
  world.removeCollider(terrainCollider, false);
  track = buildTrack(trackDesigns[settings.trackIndex], withJumps);
  terrainCollider = createTerrainCollider(track);
  state.trackVersion++;
  resetBike();
}

// Chassis: bike local axes are +X forward, +Y up, +Z to the rider's right
export const chassisBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setCanSleep(false),
);
const chassisCollider = world.createCollider(
  RAPIER.ColliderDesc.cuboid(chassisHalfLength, chassisHalfHeight, chassisHalfWidth).setFriction(0.5),
  chassisBody,
);

export const vehicle = world.createVehicleController(chassisBody);
const wheelDirection = { x: 0, y: -1, z: 0 };
const wheelAxle = { x: 0, y: 0, z: 1 };
vehicle.addWheel({ x: rearWheelX, y: wheelAttachHeight, z: 0 }, wheelDirection, wheelAxle, settings.suspensionRestLength, wheelRadius);
vehicle.addWheel({ x: frontWheelX, y: wheelAttachHeight, z: 0 }, wheelDirection, wheelAxle, settings.suspensionRestLength, wheelRadius);

export function applySettings() {
  world.gravity = { x: 0, y: -settings.gravity, z: 0 };

  // Explicit mass properties so the center of mass can sit below the box center.
  // Inertia uses rough radii of gyration for a bike plus rider (0.3 m roll, 0.55 m pitch and yaw).
  chassisCollider.setMassProperties(
    settings.bikeMass,
    { x: 0, y: settings.centerOfMassHeight, z: 0 },
    { x: settings.bikeMass * 0.09, y: settings.bikeMass * 0.3, z: settings.bikeMass * 0.3 },
    { x: 0, y: 0, z: 0, w: 1 },
  );

  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    vehicle.setWheelSuspensionStiffness(wheelIndex, settings.suspensionStiffness);
    vehicle.setWheelSuspensionCompression(wheelIndex, settings.suspensionCompressionDamping);
    vehicle.setWheelSuspensionRelaxation(wheelIndex, settings.suspensionReboundDamping);
    vehicle.setWheelMaxSuspensionTravel(wheelIndex, settings.suspensionTravel);
    vehicle.setWheelSuspensionRestLength(wheelIndex, settings.suspensionRestLength);
    vehicle.setWheelMaxSuspensionForce(wheelIndex, 100000); // high cap so big landings never punch through
  }
  // Grip is set every step because it depends on lean
}
applySettings();

// ---------- Bike state ----------

// What the renderer, readout and tests look at. Lean angles are positive with the top toward the rider's right.
export const state = {
  bikeLeanRadians: 0, // the bike's own lean, what you see
  bodyLeanRadians: 0, // lean of the bike-and-rider center of mass, what the balance works with
  bodyLeanRate: 0,
  bikePressAmount: 0, // -1..1, how hard the rider is laying the bike over (positive = to the right), follows the right stick
  handlebarRadians: 0, // positive = bars turned right
  lateralAcceleration: 0, // m/s^2 toward the bike's right, smoothed
  verticalSupport: 9.81, // gravity plus the bike's upward acceleration (m/s^2), smoothed: how hard the ground is pushing up
  groundBankRadians: 0, // how the ground under the wheels is banked, positive = holds a right-hand turn
  wobbleRadians: 0, // visual shake during a bobble
  isInAir: false,
  crashTimeRemaining: 0,
  resetCount: 0, // goes up on every reset so the camera knows to snap
  trackVersion: 0, // goes up when a new track layout is loaded
  wheelSpinRates: [0, 0], // radians per second, positive when rolling forward
  wheelSpinAngles: [0, 0],
  brakeLevers: [0, 0], // 0..1 per wheel (rear, front) after combining and the RB build-up
  brakeForces: [0, 0], // newtons each tire is actually braking with
  wheelLocked: [false, false], // braked past the tire's grip: not turning, sliding
  rearSlideAmount: 0, // 0..1, how far past what the tires hold the bike is leaned: the rear steps out
  slideTime: 0, // seconds the rider has been holding the bike in a slide; the hold fades out toward slideHoldSeconds
  preloadCharge: 0, // 0..1, how loaded the suspension is from the rider pushing down (right stick back)
  lastJump: { distance: 0, airTime: 0, scrubPercent: 0, preloadPercent: 0, landingLoad: 0, result: '' },
  statusMessage: '',
  statusTimeRemaining: 0,
};

const worldUp = new THREE.Vector3(0, 1, 0);
const bikeQuaternion = new THREE.Quaternion();
const bikeForwardAxis = new THREE.Vector3();
const bikeSideAxis = new THREE.Vector3();
const bikeAngularVelocity = new THREE.Vector3();
const controlTorque = new THREE.Vector3();
const bikeFlatHeading = new THREE.Vector3();
const travelFlatHeading = new THREE.Vector3();
const flatSideAxis = new THREE.Vector3();
const previousVelocity = new THREE.Vector3();
const slideVelocity = new THREE.Vector3();
let wasInAir = false;
let currentAirTime = 0;
let takeoffScrubPercent = 0;
let takeoffPreloadPercent = 0;
// A forward flick releases the preload: it springs the bike up if the wheels leave the ground soon after
let preloadRelease = 0;
let preloadReleaseTimeRemaining = 0;
let timeSinceTakeoff = Infinity;
const takeoffPosition = new THREE.Vector3();
let landingLoadTimeRemaining = 0;
const bikeUpAxis = new THREE.Vector3();
const landingSurfaceNormal = new THREE.Vector3();
const leanTransferRotation = new THREE.Quaternion();
let bobbleTimeRemaining = 0;
let bobbleSeverity = 0;
// Rapier's contact list still describes the old position until a step runs after a teleport
let contactsAreStale = false;
// Suspension force on each wheel, smoothed so bumps don't jerk the rider's sense of grip around
const smoothedWheelLoads = [0, 0];
// Each tire's grip coefficient this step (grip setting with the press bonus), before braking takes its share
const tireGrips = [settings.rearGrip, settings.frontGrip];
let rearBrakeButtonLevel = 0;
// How far each wheel has been braked below road speed (radians per second) on its way to locking
const wheelSpinDeficits = [0, 0];

function showStatus(message: string, seconds: number) {
  state.statusMessage = message;
  state.statusTimeRemaining = seconds;
}

// Puts the bike on the track, pointing the way the track runs: at the start, or (after a crash) at the
// centerline a few meters back from a given spot
const gapJumpKinds = new Set(['double', 'triple', 'big double', 'step-up']);

export function resetBike(nearX?: number, nearZ?: number) {
  contactsAreStale = true;
  state.crashTimeRemaining = 0;
  bobbleTimeRemaining = 0;
  wasInAir = false;
  state.statusTimeRemaining = 0;
  const sampleCount = track.centerlineX.length;
  const backUpSamples = 16; // 8 m
  let spawnIndex =
    nearX === undefined || nearZ === undefined
      ? track.spawnIndex
      : (track.nearestCenterlineIndex(nearX, nearZ) - backUpSamples + sampleCount) % sampleCount;
  // Never on a jump with no speed: if that spot is on one (or just before it), go to just past its landing
  for (const jump of track.jumps) {
    const intoJump = (spawnIndex * centerlineSpacing - (jump.start - 5) + track.length) % track.length;
    if (intoJump < jump.length + 5) spawnIndex = Math.round((jump.start + jump.length + 3) / centerlineSpacing) % sampleCount;
  }
  // Nor in front of a gap that can't be cleared from a standstill: start past its landing instead. The
  // estimate from rest is cut by 12 m for dropping in, settling and climbing the face.
  for (let pass = 0; pass < 3; pass++) {
    for (const jump of track.jumps) {
      if (!gapJumpKinds.has(jump.kind)) continue;
      const toLip = (jump.start + jump.edges[0] - spawnIndex * centerlineSpacing + track.length) % track.length;
      if (toLip < 80 && speedAfterRunUp(Math.max(0, toLip - 12), 3) < jump.designSpeed * 0.95) {
        spawnIndex = Math.round((jump.start + jump.length + 3) / centerlineSpacing) % sampleCount;
      }
    }
  }
  const spawnX = track.centerlineX[spawnIndex];
  const spawnZ = track.centerlineZ[spawnIndex];
  chassisBody.setTranslation({ x: spawnX, y: track.heightAt(spawnX, spawnZ) + 1, z: spawnZ }, true);
  // Turn the bike's +X onto the track direction: a yaw of atan2(-tz, tx) around +Y
  const yaw = Math.atan2(-track.tangentZ[spawnIndex], track.tangentX[spawnIndex]);
  chassisBody.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  previousVelocity.set(0, 0, 0);
  state.preloadCharge = 0;
  state.rearSlideAmount = 0;
  state.slideTime = 0;
  preloadRelease = 0;
  preloadReleaseTimeRemaining = 0;
  timeSinceTakeoff = Infinity;
  smoothedWheelLoads.fill((settings.bikeMass * settings.gravity) / 2);
  state.bikeLeanRadians = 0;
  state.bodyLeanRadians = 0;
  state.bodyLeanRate = 0;
  state.lateralAcceleration = 0;
  state.verticalSupport = settings.gravity;
  state.groundBankRadians = 0;
  state.wheelSpinRates.fill(0);
  state.wheelLocked.fill(false);
  wheelSpinDeficits.fill(0);
  rearBrakeButtonLevel = 0;
  state.resetCount++;
}

// Signed angle from where the bike points to where it is travelling, around world up. Heading comes from
// the side axis so it stays correct through flips. Zero when nearly stopped.
function yawFromTravelRadians() {
  bikeFlatHeading.set(bikeSideAxis.x, 0, bikeSideAxis.z);
  bikeFlatHeading.crossVectors(worldUp, bikeFlatHeading);
  const velocity = chassisBody.linvel();
  travelFlatHeading.set(velocity.x, 0, velocity.z);
  if (bikeFlatHeading.lengthSq() < 0.01 || travelFlatHeading.lengthSq() < 1) return 0;
  bikeFlatHeading.normalize();
  travelFlatHeading.normalize();
  const crossUp = bikeFlatHeading.z * travelFlatHeading.x - bikeFlatHeading.x * travelFlatHeading.z;
  return Math.atan2(crossUp, bikeFlatHeading.dot(travelFlatHeading));
}

// How far the rear tire is sliding sideways: the angle between the bike's heading and the way the rear
// contact patch is moving, positive when it moves toward the bike's left (the same sense as
// yawFromTravelRadians). Near zero while the tire grips.
function rearSlipRadians() {
  const contactPoint = vehicle.wheelIsInContact(rearWheelIndex) ? vehicle.wheelContactPoint(rearWheelIndex) : null;
  if (!contactPoint) return 0;
  const pointVelocity = chassisBody.velocityAtPoint(contactPoint);
  const forward = pointVelocity.x * bikeForwardAxis.x + pointVelocity.z * bikeForwardAxis.z;
  const towardRight = pointVelocity.x * flatSideAxis.x + pointVelocity.z * flatSideAxis.z;
  if (Math.abs(forward) < 1) return 0;
  return Math.atan2(-towardRight, Math.abs(forward));
}

function chassisTouchesGround() {
  let isTouching = false;
  world.contactPair(chassisCollider, terrainCollider, (manifold) => {
    // Rapier also reports predicted contacts a few centimeters away, so only count real touches
    for (let contactIndex = 0; contactIndex < manifold.numContacts(); contactIndex++) {
      if (manifold.contactDist(contactIndex) <= 0.005) isTouching = true;
    }
  });
  return isTouching;
}

function crash(reason: string) {
  // Hand the simulated lean over to the physics body so the fall continues from what the player saw
  leanTransferRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), state.bikeLeanRadians);
  bikeQuaternion.multiply(leanTransferRotation);
  chassisBody.setRotation(bikeQuaternion, true);
  state.bikeLeanRadians = 0;
  state.bodyLeanRadians = 0;
  state.bodyLeanRate = 0;
  bobbleTimeRemaining = 0;
  state.crashTimeRemaining = settings.crashRespawnSeconds;
  state.lastJump.result = 'crash';
  showStatus(`Crash: ${reason}`, settings.crashRespawnSeconds);
}

// 0 at or below the bobble angle, 1 at the crash angle, above 1 is a crash
function landingSeverity(errorDegrees: number, bobbleDegrees: number, crashDegrees: number) {
  if (errorDegrees <= bobbleDegrees) return 0;
  return (errorDegrees - bobbleDegrees) / Math.max(crashDegrees - bobbleDegrees, 0.001);
}

function judgeLanding() {
  const leanDegrees = Math.abs(THREE.MathUtils.radToDeg(state.bikeLeanRadians));
  const sidewaysDegrees = Math.abs(THREE.MathUtils.radToDeg(yawFromTravelRadians()));
  // Pitch: angle between the bike's up axis and the surface under the wheel that touched down
  const touchingWheelIndex = vehicle.wheelIsInContact(rearWheelIndex) ? rearWheelIndex : frontWheelIndex;
  const contactNormal = vehicle.wheelContactNormal(touchingWheelIndex);
  bikeUpAxis.set(0, 1, 0).applyQuaternion(bikeQuaternion);
  if (contactNormal) landingSurfaceNormal.set(contactNormal.x, contactNormal.y, contactNormal.z);
  const pitchDegrees = contactNormal ? THREE.MathUtils.radToDeg(bikeUpAxis.angleTo(landingSurfaceNormal)) : 0;
  // Impact: how fast the bike is moving into the landing surface. Overjumping onto the flat is high,
  // landing on a downslope that matches the jump is low.
  const velocity = chassisBody.linvel();
  const impactSpeed = contactNormal
    ? Math.max(0, -(velocity.x * landingSurfaceNormal.x + velocity.y * landingSurfaceNormal.y + velocity.z * landingSurfaceNormal.z))
    : 0;

  const landingChecks = [
    { description: `${leanDegrees.toFixed(0)}° leaned`, amount: leanDegrees, bobble: settings.landingLeanBobbleDegrees, crash: settings.landingLeanCrashDegrees },
    { description: `${sidewaysDegrees.toFixed(0)}° sideways`, amount: sidewaysDegrees, bobble: settings.landingSidewaysBobbleDegrees, crash: settings.landingSidewaysCrashDegrees },
    { description: `${pitchDegrees.toFixed(0)}° off the landing angle`, amount: pitchDegrees, bobble: settings.landingPitchBobbleDegrees, crash: settings.landingPitchCrashDegrees },
    { description: `too hard (${impactSpeed.toFixed(1)} m/s into the ground)`, amount: impactSpeed, bobble: settings.landingImpactBobbleSpeed, crash: settings.landingImpactCrashSpeed },
  ].map((check) => ({ ...check, severity: landingSeverity(check.amount, check.bobble, check.crash) }));
  const worstCheck = landingChecks.reduce((worst, check) => (check.severity > worst.severity ? check : worst));
  const description = `landed ${worstCheck.description}`;

  if (worstCheck.severity >= 1) {
    crash(description);
  } else if (worstCheck.severity > 0) {
    bobbleSeverity = worstCheck.severity;
    bobbleTimeRemaining = settings.bobbleSeconds;
    const velocity = chassisBody.linvel();
    const speedKept = 1 - settings.bobbleSpeedLoss * bobbleSeverity;
    chassisBody.setLinvel({ x: velocity.x * speedKept, y: velocity.y, z: velocity.z * speedKept }, true);
    state.lastJump.result = `bobble ${(bobbleSeverity * 100).toFixed(0)}%`;
    showStatus(`Bobble: ${description}`, 1.2);
  } else {
    state.lastJump.result = 'clean';
  }
}

// How the ground under the wheels is banked across the bike, positive when it tilts to hold a right-hand
// turn (the surface rises to the bike's left)
function groundBankRadians() {
  let bankSum = 0;
  let wheelsDown = 0;
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    const normal = vehicle.wheelIsInContact(wheelIndex) ? vehicle.wheelContactNormal(wheelIndex) : null;
    if (!normal) continue;
    bankSum += Math.asin(THREE.MathUtils.clamp(normal.x * flatSideAxis.x + normal.z * flatSideAxis.z, -1, 1));
    wheelsDown++;
  }
  return wheelsDown > 0 ? bankSum / wheelsDown : 0;
}

// The rider feels the bank through the bike over a moment, not wheel by wheel as they skip over the berm's
// curved face, so smooth it (about 0.15 s)
function smoothGroundBank() {
  state.groundBankRadians += (groundBankRadians() - state.groundBankRadians) * (1 - Math.exp(-physicsTimestep / 0.15));
  return state.groundBankRadians;
}

// Rapier's wheels push the bike straight up the suspension even on a slope. Real ground pushes along its
// surface normal, so on a bank part of that push is sideways, into the turn: add it. (Only across the
// bike; fore and aft is left alone so jump faces keep the takeoffs they were tuned with.)
function applyGroundSidePush() {
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    const normal = vehicle.wheelIsInContact(wheelIndex) ? vehicle.wheelContactNormal(wheelIndex) : null;
    if (!normal) continue;
    const suspensionForce = vehicle.wheelSuspensionForce(wheelIndex) ?? 0;
    const across = normal.x * flatSideAxis.x + normal.z * flatSideAxis.z;
    // The suspension force holds up the vertical part of the normal push; the sideways part is that times
    // the slope across the bike
    const sidewaysImpulse = ((suspensionForce * across) / Math.max(normal.y, 0.5)) * physicsTimestep;
    chassisBody.applyImpulse({ x: flatSideAxis.x * sidewaysImpulse, y: 0, z: flatSideAxis.z * sidewaysImpulse }, true);
  }
}

// Brakes and engine, per wheel. A rolling tire brakes as hard as asked, up to its grip, and whatever grip
// the brake takes is gone from cornering (friction circle): dragging a little costs almost nothing, a
// handful mid-corner stands the bike up or pushes the front. Ask for more than the tire's whole grip and
// the wheel locks and slides. It rolls again once the brake is eased under what the sliding tire pulls.
function updateBrakesAndEngine(throttle: number, engineTaper: number, forwardSpeed: number) {
  // RB builds the rear brake up while held and lets it off quickly
  const rampStep = physicsTimestep / Math.max(settings.rearBrakeRampSeconds, 0.01);
  const rearButtonTarget = controls.rearBrake * settings.rearBrakeButtonStrength;
  rearBrakeButtonLevel += THREE.MathUtils.clamp(rearButtonTarget - rearBrakeButtonLevel, -4 * rampStep, rampStep);
  if (settings.combinedBrakes) {
    const frontShare = settings.combinedFrontShare;
    state.brakeLevers[frontWheelIndex] = controls.frontBrake * Math.min(1, 2 * frontShare);
    state.brakeLevers[rearWheelIndex] = controls.frontBrake * Math.min(1, 2 * (1 - frontShare));
  } else {
    state.brakeLevers[frontWheelIndex] = controls.frontBrake;
    state.brakeLevers[rearWheelIndex] = rearBrakeButtonLevel;
  }

  const engineDrive = throttle * settings.engineForce * engineTaper;
  const engineBraking = (1 - throttle) * settings.engineBrakingForce;
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    const isRear = wheelIndex === rearWheelIndex;
    const brakeRequest = state.brakeLevers[wheelIndex] * (isRear ? settings.rearBrakeForce : settings.frontBrakeForce);
    // On the gas the rear brake drags against the engine
    const drive = isRear ? engineDrive - brakeRequest : 0;
    const brakeForce = drive > 0 ? 0 : Math.max(brakeRequest - (isRear ? engineDrive : 0), isRear ? engineBraking : 0);

    // Judged on the smoothed load so a single bump doesn't flicker the wheel between locked and rolling.
    // Braking harder than the tire grips slows the wheel below road speed (how fast depends on the wheel's
    // inertia) and it locks once it stops, so a quick squeeze past the limit is fine and holding it isn't,
    // and at low speed it locks sooner. Easing off lets the ground spin it back up.
    const grip = vehicle.wheelIsInContact(wheelIndex) ? tireGrips[wheelIndex] * smoothedWheelLoads[wheelIndex] : 0;
    // Cornering already uses part of the grip (last step's sideways force), leaving less for braking
    const corneringForce = Math.min(Math.abs(vehicle.wheelSideImpulse(wheelIndex) ?? 0) / physicsTimestep, 0.95 * grip);
    const brakingGrip = Math.sqrt(Math.max(0, grip * grip - corneringForce * corneringForce));
    if (grip <= 0) {
      state.wheelLocked[wheelIndex] = false;
      wheelSpinDeficits[wheelIndex] = 0;
    } else if (state.wheelLocked[wheelIndex]) {
      if (brakeForce < settings.lockedTireGrip * grip) {
        state.wheelLocked[wheelIndex] = false;
        wheelSpinDeficits[wheelIndex] = 0;
      }
    } else {
      const spinDeficitChange = ((brakeForce - brakingGrip) * wheelRadius * physicsTimestep) / settings.wheelInertia;
      wheelSpinDeficits[wheelIndex] = Math.max(0, wheelSpinDeficits[wheelIndex] + spinDeficitChange);
      if (wheelSpinDeficits[wheelIndex] >= Math.abs(forwardSpeed) / wheelRadius) state.wheelLocked[wheelIndex] = true;
    }

    const isLocked = state.wheelLocked[wheelIndex];
    const deliveredBrakeForce = isLocked ? settings.lockedTireGrip * grip : grip > 0 ? Math.min(brakeForce, brakingGrip) : brakeForce;
    // Rapier's wheel brake is an impulse cap per step, so convert from newtons
    vehicle.setWheelBrake(wheelIndex, isLocked ? 0 : deliveredBrakeForce * physicsTimestep);
    if (isRear) vehicle.setWheelEngineForce(rearWheelIndex, isLocked ? 0 : Math.max(0, drive));
    state.brakeForces[wheelIndex] = deliveredBrakeForce;
  }
}

// A locked tire drags at the locked grip against the way it's rolling. Sideways it keeps only its plowing
// grip (set as its Rapier grip), so a locked front pushes wide and a locked rear steps out.
function applyLockedTireSlide() {
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    if (!state.wheelLocked[wheelIndex] || !vehicle.wheelIsInContact(wheelIndex)) continue;
    const contactPoint = vehicle.wheelContactPoint(wheelIndex);
    const normal = vehicle.wheelContactNormal(wheelIndex);
    if (!contactPoint || !normal) continue;
    const pointVelocity = chassisBody.velocityAtPoint(contactPoint);
    // The bike's forward direction along the ground
    const alongNormal = bikeForwardAxis.x * normal.x + bikeForwardAxis.y * normal.y + bikeForwardAxis.z * normal.z;
    slideVelocity.set(bikeForwardAxis.x - normal.x * alongNormal, bikeForwardAxis.y - normal.y * alongNormal, bikeForwardAxis.z - normal.z * alongNormal);
    slideVelocity.normalize();
    const slideSpeed = Math.abs(pointVelocity.x * slideVelocity.x + pointVelocity.y * slideVelocity.y + pointVelocity.z * slideVelocity.z);
    if (slideSpeed < 0.05) continue;
    slideVelocity.multiplyScalar(Math.sign(pointVelocity.x * slideVelocity.x + pointVelocity.y * slideVelocity.y + pointVelocity.z * slideVelocity.z) * slideSpeed);
    const load = vehicle.wheelSuspensionForce(wheelIndex) ?? 0;
    // Never more than it takes to stop the slide (about a third of the bike's mass at the contact patch)
    const impulse = Math.min(settings.lockedTireGrip * tireGrips[wheelIndex] * load * physicsTimestep, 0.3 * settings.bikeMass * slideSpeed);
    slideVelocity.multiplyScalar(-impulse / slideSpeed);
    chassisBody.applyImpulseAtPoint(slideVelocity, contactPoint, true);
  }
}

// A rear stepped out past its grip (leaned further than the tires hold) is dragging sideways through the
// dirt, which scrubs speed. Rapier's rolling tire only resists the sideways part, so the drag is added here,
// against the way the rear contact patch is moving.
function applyRearSlideDrag() {
  if (state.rearSlideAmount <= 0 || !vehicle.wheelIsInContact(rearWheelIndex)) return;
  const contactPoint = vehicle.wheelContactPoint(rearWheelIndex);
  if (!contactPoint) return;
  const pointVelocity = chassisBody.velocityAtPoint(contactPoint);
  slideVelocity.set(pointVelocity.x, 0, pointVelocity.z);
  const speed = slideVelocity.length();
  if (speed < 0.5) return;
  const load = vehicle.wheelSuspensionForce(rearWheelIndex) ?? 0;
  const impulse = Math.min(settings.overLeanSlideDrag * state.rearSlideAmount * load * physicsTimestep, 0.3 * settings.bikeMass * speed);
  slideVelocity.multiplyScalar(-impulse / speed);
  chassisBody.applyImpulseAtPoint(slideVelocity, contactPoint, true);
}

// The rider's balance on the ground: turn the left stick into a handlebar angle, and move the
// bike-and-rider lean by what the tires actually did. Returns the steering angle on the ground, positive right.
function balanceAndSteer(forwardSpeed: number, groundBank: number) {
  const gravity = settings.gravity;
  // What the lean balances against is the ground's push, not gravity on its own: light over a bump the
  // bike barely tips, compressed into a berm or a landing it's held up harder
  const support = state.verticalSupport;
  const pendulumHeight = settings.leanPendulumHeight;
  const bodyLean = state.bodyLeanRadians;

  // Below walking pace the rider puts a foot down: no balancing, the bars follow the stick directly
  const balanceWeight = THREE.MathUtils.smoothstep(forwardSpeed, settings.feetDownSpeed * 0.5, settings.feetDownSpeed * 1.5);

  // A leaned bike turns tighter for the same handlebar angle, so the lock allows more steering on the ground
  const handlebarLock = THREE.MathUtils.degToRad(settings.steeringLockDegrees);
  const bikeLeanCosine = Math.max(Math.cos(state.bikeLeanRadians), 0.34);
  const groundSteeringLock = Math.atan(Math.tan(handlebarLock) / bikeLeanCosine);

  // The rider doesn't ask for more lean than the lock can hold at this speed, so slow turns are limited
  // by the bars, not by falling in. Holding a lean needs lateral acceleration g*tan(lean) = speed^2 * curvature.
  const speedSquared = Math.max(forwardSpeed, 0.5) ** 2;
  const lockLimitedLean = Math.atan((speedSquared * Math.tan(groundSteeringLock)) / (wheelbase * gravity));
  // Pressing the bike into the turn (right stick toward the outside) digs the side knobs in for more grip
  const pressIntoStick = Math.max(0, state.bikePressAmount * Math.sign(controls.steering));
  // A berm banked into the turn holds the bike up, so it can lean further over
  const turnSide = Math.sign(controls.steering) || Math.sign(bodyLean);
  const bankIntoTurn = groundBank * turnSide;
  // How far the tires can hold the bike over. Holding a lean takes g*tan(lean) of sideways force, which the bike's
  // geometry splits between the tires by where the center of mass sits, so whichever tire runs out first
  // sets the limit. Each tire's grip grows with the load on it, so the rider's weight matters: forward
  // plants the front (the one that washes out first), back lightens it. Throttle and brakes use up part
  // of each tire's grip first: brakes pick the bike up, and too much gas leaned over steps the rear out.
  const pressedGrip = 1 + settings.pressGripBonus * pressIntoStick;
  const totalWeight = settings.bikeMass * gravity;
  const frontLoad = Math.max(smoothedWheelLoads[frontWheelIndex], 50);
  const rearLoad = Math.max(smoothedWheelLoads[rearWheelIndex], 50);
  const frontPull = state.brakeForces[frontWheelIndex] / frontLoad;
  const rearPull = Math.max((vehicle.wheelEngineForce(rearWheelIndex) ?? 0) * settings.throttleRearGripUse, state.brakeForces[rearWheelIndex]) / rearLoad;
  // A locked tire only has its plowing grip sideways
  const sidewaysGripLeft = (wheelIndex: number, grip: number, pull: number) =>
    state.wheelLocked[wheelIndex]
      ? grip * pressedGrip * settings.lockedTireSideGrip
      : Math.sqrt(Math.max(0, (grip * pressedGrip) ** 2 - pull * pull));
  const frontCorneringGrip = (sidewaysGripLeft(frontWheelIndex, settings.frontGrip, frontPull) * frontLoad) / (frontCorneringShare * totalWeight);
  const rearCorneringGrip = (sidewaysGripLeft(rearWheelIndex, settings.rearGrip, rearPull) * rearLoad) / (rearCorneringShare * totalWeight);
  const flatCorneringGrip = Math.min(frontCorneringGrip, rearCorneringGrip);
  // Off the gas: what the stick works from, so the gas doesn't quietly stand the bike up for the rider.
  // Drive also squats the bike, taking weight off the front, which is put back for this.
  const driveWeightTransfer = (Math.max(0, vehicle.wheelEngineForce(rearWheelIndex) ?? 0) * 0.6) / wheelbase;
  const coastingFrontLoad = frontLoad + driveWeightTransfer;
  const coastingRearLoad = Math.max(50, rearLoad - driveWeightTransfer);
  const frontCoastingGrip = (sidewaysGripLeft(frontWheelIndex, settings.frontGrip, frontPull) * coastingFrontLoad) / (frontCorneringShare * totalWeight);
  const rearCoastingGrip =
    (sidewaysGripLeft(rearWheelIndex, settings.rearGrip, state.brakeForces[rearWheelIndex] / coastingRearLoad) * coastingRearLoad) /
    (rearCorneringShare * totalWeight);
  const coastingCorneringGrip = Math.min(frontCoastingGrip, rearCoastingGrip);
  // On a bank the ground itself pushes the bike into the turn by tan(bank) of its weight, on top of the
  // tires' grip. Off-camber (negative bank) takes it away.
  const corneringGrip = Math.max(0, flatCorneringGrip + Math.tan(bankIntoTurn));
  // The estimate above reads high against what Rapier's tires deliver, so it's scaled down; the berm's push is solid
  const gripLimitedLean = Math.atan(Math.max(0, settings.leanGripUse * flatCorneringGrip + Math.tan(bankIntoTurn)));
  const coastingGripLimitedLean = Math.atan(Math.max(0, settings.leanGripUse * coastingCorneringGrip + Math.tan(bankIntoTurn)));
  // Full stick asks for a set amount more lean than the tires hold (pressed in, weight forward and on the
  // gas all move that limit): past it the rear steps out. Easing off a little keeps it at the limit. A good
  // berm holds the bike, so the margin fades out as the bank steepens and full stick there is just the limit.
  // Never within a few degrees of the low-side, and at low speed no more than the bars can hold.
  const bermHold = THREE.MathUtils.clamp(bankIntoTurn / THREE.MathUtils.degToRad(settings.bermNoSlideBankDegrees), 0, 1);
  const fullStickLean = Math.min(
    THREE.MathUtils.degToRad(settings.lowSideLeanDegrees - 6) + Math.max(0, bankIntoTurn),
    coastingGripLimitedLean + (1 - bermHold) * THREE.MathUtils.degToRad(settings.fullStickOverLeanDegrees),
  );
  const reachableLean = Math.min(fullStickLean, 0.9 * lockLimitedLean);
  const overLean = Math.abs(bodyLean) - gripLimitedLean;
  state.rearSlideAmount = balanceWeight * THREE.MathUtils.clamp(overLean / THREE.MathUtils.degToRad(settings.overLeanRangeDegrees), 0, 1);
  const targetBodyLean = controls.steering * reachableLean;

  // Critically damped approach to the target lean. To get that lean acceleration the tires have to push
  // sideways by (g sin(lean) - h * leanAcceleration) / cos(lean). Leaning in from upright needs a push the
  // wrong way first, which is countersteering.
  const response = settings.leanResponse;
  const desiredLeanAcceleration = response * response * (targetBodyLean - bodyLean) - 2 * response * state.bodyLeanRate;
  let neededLateralAcceleration = (support * Math.sin(bodyLean) - pendulumHeight * desiredLeanAcceleration) / Math.cos(bodyLean);

  // At low speed a pure countersteer would need the bars at full lock the wrong way, and the bike would
  // visibly swerve out of the turn. Cap the push away from the side the bike is leaning (or about to lean)
  // and let the rider's hips start the lean instead.
  const leanSide = Math.abs(bodyLean) > 0.05 ? Math.sign(bodyLean) : Math.sign(targetBodyLean);
  let riderLeanAcceleration = 0;
  const countersteerLimit = settings.countersteerLimitG * gravity;
  if (neededLateralAcceleration * leanSide < -countersteerLimit) {
    neededLateralAcceleration = -leanSide * countersteerLimit;
    const tireLeanAcceleration = (support * Math.sin(bodyLean) - neededLateralAcceleration * Math.cos(bodyLean)) / pendulumHeight;
    riderLeanAcceleration = THREE.MathUtils.clamp(
      desiredLeanAcceleration - tireLeanAcceleration,
      -settings.riderLeanInitiation,
      settings.riderLeanInitiation,
    );
  }

  // Asking the tires for more than they have just plows the front sideways, so don't
  const maxCorneringAcceleration = corneringGrip * gravity;
  neededLateralAcceleration = THREE.MathUtils.clamp(neededLateralAcceleration, -maxCorneringAcceleration, maxCorneringAcceleration);

  const balanceSteering = THREE.MathUtils.clamp(
    Math.atan((wheelbase * neededLateralAcceleration) / speedSquared),
    -groundSteeringLock,
    groundSteeringLock,
  );
  const directSteering = controls.steering * handlebarLock;
  const groundSteering = THREE.MathUtils.lerp(directSteering, balanceSteering, balanceWeight);

  // Move the lean: gravity against what the tires really delivered. If they slide, the lean falls in.
  // With a foot down the lean is just held near upright.
  const pendulumLeanAcceleration =
    (support * Math.sin(bodyLean) - state.lateralAcceleration * Math.cos(bodyLean)) / pendulumHeight + riderLeanAcceleration;
  const feetDownLeanAcceleration = -response * response * bodyLean - 2 * response * state.bodyLeanRate;
  let leanAcceleration = THREE.MathUtils.lerp(feetDownLeanAcceleration, pendulumLeanAcceleration, balanceWeight);

  // Rider save: when the bike is leaned further than the rider wants (they eased off the stick, or the
  // ground stopped holding that much lean: off the end of a berm, gas on, a light front) and the tires can't
  // stand it up, the rider gets a leg out and catches it, with limited strength. Pushing for full lean
  // right at the limit isn't saved, and a big enough overload is more than the rider can catch.
  // With the rear stepped well out (too much lean or too much gas) the rider holds the slide, but only for
  // so long: the hold fades and the bike falls in. Easing the stick or the gas brings the rear back in,
  // which gives the rider their strength back.
  if (state.rearSlideAmount > 0.5) state.slideTime += physicsTimestep;
  else state.slideTime = Math.max(0, state.slideTime - 2 * physicsTimestep);
  const slideHold = 1 - THREE.MathUtils.smoothstep(state.slideTime, 0.5 * settings.slideHoldSeconds, settings.slideHoldSeconds);
  const fallingInBeyondWanted = (leanAcceleration - desiredLeanAcceleration) * Math.sign(bodyLean);
  if (fallingInBeyondWanted > 0) {
    leanAcceleration -= Math.sign(bodyLean) * balanceWeight * Math.min(settings.riderSaveStrength * slideHold, fallingInBeyondWanted);
  }

  // Inside foot: in a slow, tight turn the bars or the tires run out and the bike starts falling in past
  // the lean the rider wants. The rider has the inside foot out and holds it there instead of going down.
  const footWeight = 1 - THREE.MathUtils.smoothstep(forwardSpeed, settings.footDabSpeed * 0.5, settings.footDabSpeed);
  const wantedLeanOnThisSide = Math.min(Math.max(0, targetBodyLean * Math.sign(bodyLean)), lockLimitedLean);
  const leanBeyondWanted = Math.abs(bodyLean) - wantedLeanOnThisSide;
  if (footWeight > 0 && leanBeyondWanted > 0) {
    const fallingInRate = Math.max(0, state.bodyLeanRate * Math.sign(bodyLean));
    leanAcceleration -= Math.sign(bodyLean) * footWeight * (response * response * leanBeyondWanted + 2 * response * fallingInRate);
  }

  state.bodyLeanRate += leanAcceleration * physicsTimestep;
  state.bodyLeanRadians += state.bodyLeanRate * physicsTimestep;

  state.handlebarRadians = Math.atan(Math.tan(groundSteering) * bikeLeanCosine);
  return { groundSteering, balanceWeight, footWeight, bankIntoTurn };
}

export function physicsStep() {
  const rotation = chassisBody.rotation();
  bikeQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  bikeForwardAxis.set(1, 0, 0).applyQuaternion(bikeQuaternion);
  bikeSideAxis.set(0, 0, 1).applyQuaternion(bikeQuaternion);
  const angularVelocity = chassisBody.angvel();
  bikeAngularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z);

  // Sideways acceleration over the last step, flat on the ground, toward the bike's right.
  // Lightly smoothed so suspension chatter doesn't shake the lean.
  const velocity = chassisBody.linvel();
  flatSideAxis.set(bikeSideAxis.x, 0, bikeSideAxis.z);
  if (flatSideAxis.lengthSq() > 0.01) {
    flatSideAxis.normalize();
    const measuredLateralAcceleration =
      ((velocity.x - previousVelocity.x) * flatSideAxis.x + (velocity.z - previousVelocity.z) * flatSideAxis.z) / physicsTimestep;
    state.lateralAcceleration += (measuredLateralAcceleration - state.lateralAcceleration) * (1 - Math.exp(-physicsTimestep / 0.02));
  }
  const measuredSupport = THREE.MathUtils.clamp(settings.gravity + (velocity.y - previousVelocity.y) / physicsTimestep, 0, 3 * settings.gravity);
  state.verticalSupport += (measuredSupport - state.verticalSupport) * (1 - Math.exp(-physicsTimestep / 0.04));
  previousVelocity.set(velocity.x, velocity.y, velocity.z);
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    const load = vehicle.wheelIsInContact(wheelIndex) ? (vehicle.wheelSuspensionForce(wheelIndex) ?? 0) : 0;
    smoothedWheelLoads[wheelIndex] += (load - smoothedWheelLoads[wheelIndex]) * (1 - Math.exp(-physicsTimestep / 0.08));
  }

  // Crashed: the rider is off, so no engine, no assists. The bike falls over and slides to a stop.
  if (state.crashTimeRemaining > 0) {
    vehicle.setWheelEngineForce(rearWheelIndex, 0);
    vehicle.setWheelSteering(frontWheelIndex, 0);
    vehicle.setWheelBrake(frontWheelIndex, settings.frontBrakeForce * physicsTimestep);
    vehicle.setWheelBrake(rearWheelIndex, settings.rearBrakeForce * physicsTimestep);
    vehicle.setWheelFrictionSlip(frontWheelIndex, settings.frontGrip);
    vehicle.setWheelFrictionSlip(rearWheelIndex, settings.rearGrip);
    state.wheelLocked.fill(false);
    chassisBody.resetTorques(true);
    state.wobbleRadians = 0;
    vehicle.updateVehicle(physicsTimestep);
    world.step();
    state.crashTimeRemaining -= physicsTimestep;
    if (state.crashTimeRemaining <= 0) {
      const crashPosition = chassisBody.translation();
      resetBike(crashPosition.x, crashPosition.z);
    }
    return;
  }

  const forwardSpeed = vehicle.currentVehicleSpeed();
  const isInAir = !vehicle.wheelIsInContact(frontWheelIndex) && !vehicle.wheelIsInContact(rearWheelIndex);
  state.isInAir = isInAir;

  // Landing: record jump stats and judge it. Short hops off bumps are ignored.
  if (!isInAir && wasInAir && currentAirTime > 0.3) {
    const position = chassisBody.translation();
    state.lastJump.distance = takeoffPosition.distanceTo(new THREE.Vector3(position.x, 0, position.z));
    state.lastJump.airTime = currentAirTime;
    state.lastJump.scrubPercent = takeoffScrubPercent;
    state.lastJump.preloadPercent = takeoffPreloadPercent;
    state.lastJump.landingLoad = 0;
    landingLoadTimeRemaining = 0.3;
    judgeLanding();
    if (state.crashTimeRemaining > 0) return;
  }
  // The frame hitting the ground before the wheels (an upside-down landing, casing onto an edge) is a crash.
  // With the wheels down it is just the suspension bottoming out, which the landing impact check covers.
  if (isInAir && !contactsAreStale && chassisTouchesGround()) {
    crash('the bike hit the ground');
    return;
  }

  // A bobble cuts the throttle while the rider recovers, fading out over its duration
  let throttle = controls.throttle;
  state.wobbleRadians = 0;
  if (bobbleTimeRemaining > 0) {
    const bobbleFade = bobbleTimeRemaining / settings.bobbleSeconds;
    throttle *= 1 - bobbleSeverity * bobbleFade;
    state.wobbleRadians = Math.sin(bobbleTimeRemaining * 30) * THREE.MathUtils.degToRad(15) * bobbleSeverity * bobbleFade;
    bobbleTimeRemaining -= physicsTimestep;
  }

  // Engine force fades linearly to zero at top speed
  const engineTaper = THREE.MathUtils.clamp(1 - forwardSpeed / settings.topSpeed, 0, 1);
  updateBrakesAndEngine(throttle, engineTaper, forwardSpeed);

  // The right stick moves the rider's body the way it points, and the bike goes over the other way, on the
  // ground and in the air (the opposite of the left stick). On the ground the body and bike balance out, so
  // the bike-and-rider lean (and the turn) stays the same: body to the inside stands the bike up on more
  // grip, body to the outside presses it down onto its side knobs, and on a straight it sets up a scrub.
  const bikeLayOver = -controls.riderSideLean; // +1 = bike laid over to the right
  const riderBlend = 1 - Math.exp(-settings.riderBodyResponse * physicsTimestep);
  state.bikePressAmount += (bikeLayOver - state.bikePressAmount) * riderBlend;
  const bikePressLean = THREE.MathUtils.degToRad(settings.bikePressDegrees) * state.bikePressAmount;

  // Whip: in the air the left stick keeps meaning "lean", so held through the lip it lays the bike over and
  // starts a whip on its own. The right stick (body the other way) lays it over the rest of the way and
  // swings it further. Together they can ask for more swing than either alone; the lay-over tops out.
  const whipAmount = controls.steering * settings.leftStickWhipShare + bikeLayOver; // +1 = bike over to the right
  if (isInAir) {
    // Nothing to balance against in the air, so the bike goes straight to the lay-over asked for
    const whipLean = THREE.MathUtils.clamp(whipAmount, -1, 1) * THREE.MathUtils.degToRad(settings.maxWhipLeanDegrees);
    state.bikeLeanRadians += (whipLean - state.bikeLeanRadians) * (1 - Math.exp(-settings.whipLeanResponse * physicsTimestep));
    state.bodyLeanRadians = state.bikeLeanRadians - bikePressLean;
    state.bodyLeanRate = 0;
    state.handlebarRadians = 0;
    vehicle.setWheelSteering(frontWheelIndex, 0);
    state.rearSlideAmount = 0;
  } else {
    const { groundSteering: balanceSteering, balanceWeight, footWeight, bankIntoTurn } = balanceAndSteer(forwardSpeed, smoothGroundBank());
    // When braking steps the rear out (locked, or light under hard front braking), the rider steers into the
    // slide: the bars turn toward where the rear is going, so the front stops dragging the nose further around
    let groundSteering = balanceSteering;
    const isBraking = state.brakeLevers[frontWheelIndex] > 0.02 || state.brakeLevers[rearWheelIndex] > 0.02;
    const rearSlide = isBraking || state.wheelLocked[rearWheelIndex] || state.rearSlideAmount > 0 ? rearSlipRadians() : 0;
    const slideBeyondGrip = Math.sign(rearSlide) * Math.max(0, Math.abs(rearSlide) - THREE.MathUtils.degToRad(2));
    if (slideBeyondGrip !== 0 && forwardSpeed > settings.feetDownSpeed) {
      const handlebarLock = THREE.MathUtils.degToRad(settings.steeringLockDegrees);
      groundSteering = THREE.MathUtils.clamp(balanceSteering - slideBeyondGrip, -handlebarLock, handlebarLock);
      state.handlebarRadians = Math.atan(Math.tan(groundSteering) * Math.max(Math.cos(state.bikeLeanRadians), 0.34));
    }
    // Positive Rapier steering turns left
    vehicle.setWheelSteering(frontWheelIndex, -groundSteering);
    // The bike can't lie flatter than where the pegs and bars touch the ground
    state.bikeLeanRadians = THREE.MathUtils.clamp(state.bodyLeanRadians + bikePressLean, -maxBikeLean, maxBikeLean);
    const isLowSide =
      Math.abs(state.bodyLeanRadians) > THREE.MathUtils.degToRad(settings.lowSideLeanDegrees) + Math.max(0, bankIntoTurn);
    if (balanceWeight > 0.5 && footWeight < 0.5 && isLowSide) {
      crash('low-side, leaned past what the tires could hold');
      return;
    }
  }

  // Pressing the bike down into a turn digs the side knobs into the dirt for extra grip.
  // Only counts while actually leaned into a turn, so pressing it over on a straight does nothing.
  const pressIntoTurn =
    Math.max(0, state.bikePressAmount * Math.sign(state.bodyLeanRadians)) *
    Math.min(1, Math.abs(state.bodyLeanRadians) / THREE.MathUtils.degToRad(10));
  const pressGrip = isInAir ? 1 : 1 + settings.pressGripBonus * pressIntoTurn;
  tireGrips[frontWheelIndex] = settings.frontGrip * pressGrip;
  tireGrips[rearWheelIndex] = settings.rearGrip * pressGrip;
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    // A rolling tire keeps its grip in Rapier, whose own friction circle lets braking take only a little of
    // the cornering grip; the full cost shows up in how far the rider can lean (balanceAndSteer). Charging
    // it here too lets the rear step out under braking and high-side the bike. A locked tire keeps only its
    // plowing grip sideways and drags fore and aft on its own (applyLockedTireSlide).
    const overLeanGrip = wheelIndex === rearWheelIndex && !isInAir ? 1 - settings.overLeanRearGripLoss * state.rearSlideAmount : 1;
    const grip = tireGrips[wheelIndex] * (state.wheelLocked[wheelIndex] ? settings.lockedTireSideGrip : 1) * overLeanGrip;
    vehicle.setWheelFrictionSlip(wheelIndex, grip);
  }

  controlTorque.set(0, 0, 0);

  // Wheel spin and its reaction on the bike. On the ground a wheel spins at road speed. In the air nothing
  // holds it there, so the engine revs the rear wheel up and the brake lever slows both wheels to a stop.
  // Whatever spin a wheel gains or loses in the air, the bike gets the opposite: revving lifts the nose,
  // braking drops it. (Engine braking is left out in the air, as if the clutch were pulled.)
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    const previousSpinRate = state.wheelSpinRates[wheelIndex];
    if (vehicle.wheelIsInContact(wheelIndex)) {
      state.wheelSpinRates[wheelIndex] = state.wheelLocked[wheelIndex] ? 0 : Math.max(0, forwardSpeed / wheelRadius - wheelSpinDeficits[wheelIndex]);
    } else {
      // The rear wheel revs up to the top speed rev limit, the same taper the engine uses on the ground
      const wheelSurfaceSpeed = previousSpinRate * wheelRadius;
      const driveTorque =
        wheelIndex === rearWheelIndex
          ? throttle * settings.engineForce * wheelRadius * THREE.MathUtils.clamp(1 - wheelSurfaceSpeed / settings.topSpeed, 0, 1)
          : 0;
      const spinRateAfterDrive = previousSpinRate + (driveTorque / settings.wheelInertia) * physicsTimestep;
      // Brakes slow the wheel toward a stop but never spin it backwards
      const fullBrakeForce = wheelIndex === rearWheelIndex ? settings.rearBrakeForce : settings.frontBrakeForce;
      const brakeSpinRateLoss = ((state.brakeLevers[wheelIndex] * fullBrakeForce * wheelRadius) / settings.wheelInertia) * physicsTimestep;
      state.wheelSpinRates[wheelIndex] = Math.sign(spinRateAfterDrive) * Math.max(0, Math.abs(spinRateAfterDrive) - brakeSpinRateLoss);
      // The wheel spins around the bike's -Z axis when rolling forward, so its reaction on the bike is
      // around +Z, and positive torque around +Z lifts the nose
      const spinAcceleration = (state.wheelSpinRates[wheelIndex] - previousSpinRate) / physicsTimestep;
      controlTorque.addScaledVector(bikeSideAxis, settings.wheelInertia * spinAcceleration);
    }
    state.wheelSpinAngles[wheelIndex] += state.wheelSpinRates[wheelIndex] * physicsTimestep;
  }

  // Upright assist: a spring-damper around the bike's forward axis only, so it never fights pitch or flips.
  // dot(side, up) is the sideways tilt (sin of roll).
  const rollError = bikeSideAxis.dot(worldUp);
  const rollRate = bikeAngularVelocity.dot(bikeForwardAxis);
  controlTorque.addScaledVector(bikeForwardAxis, settings.uprightAssistStrength * rollError - settings.uprightAssistDamping * rollRate);

  // Scrub: a bike laid over as it leaves the ground turns part of the upward kick into nothing,
  // so it flies lower and flatter. Horizontal speed is kept.
  if (isInAir && !wasInAir) {
    const isScrubbing = Math.abs(controls.riderSideLean) > 0.2;
    const scrubFraction = isScrubbing
      ? THREE.MathUtils.clamp(Math.abs(state.bikeLeanRadians) / THREE.MathUtils.degToRad(settings.scrubFullLeanDegrees), 0, 1)
      : 0;
    if (velocity.y > 0 && scrubFraction > 0) {
      const scrubbedUpwardSpeed = velocity.y * (1 - settings.scrubHeightAbsorb * scrubFraction);
      chassisBody.setLinvel({ x: velocity.x, y: scrubbedUpwardSpeed, z: velocity.z }, true);
    }
    takeoffScrubPercent = scrubFraction * 100;
    takeoffPreloadPercent = 0;
    const position = chassisBody.translation();
    takeoffPosition.set(position.x, 0, position.z);
    currentAirTime = 0;
    timeSinceTakeoff = 0;
  }
  if (isInAir) currentAirTime += physicsTimestep;
  updatePreload(isInAir);
  wasInAir = isInAir;

  if (landingLoadTimeRemaining > 0) {
    // Peak combined suspension force in the landing, in multiples of the bike's weight
    const suspensionForce = (vehicle.wheelSuspensionForce(frontWheelIndex) ?? 0) + (vehicle.wheelSuspensionForce(rearWheelIndex) ?? 0);
    state.lastJump.landingLoad = Math.max(state.lastJump.landingLoad, suspensionForce / (settings.bikeMass * settings.gravity));
    landingLoadTimeRemaining -= physicsTimestep;
  }

  // Rider lean is a torque around the side axis. On the ground the wheels resist it, so it moves load
  // between front and rear suspension like a weight shift. In the air nothing resists, so it pitches the bike.
  // Negative torque around +Z puts the nose down.
  const yawRate = bikeAngularVelocity.dot(worldUp);
  const riderTorque = isInAir ? settings.riderPitchTorqueAir : settings.riderWeightShiftTorqueGround;
  controlTorque.addScaledVector(bikeSideAxis, -controls.riderForwardLean * riderTorque);
  if (isInAir) {
    const pitchRate = bikeAngularVelocity.dot(bikeSideAxis);
    controlTorque.addScaledVector(bikeSideAxis, -settings.airPitchDamping * pitchRate);

    // Whip yaw: the bike swings sideways the way it's laid over, and a spring pulls it back in line with the
    // direction of travel. Laid over right yaws the nose right, which is negative around world up.
    const yawTorque =
      -THREE.MathUtils.clamp(whipAmount, -1.5, 1.5) * settings.whipYawTorque + settings.whipYawReturn * yawFromTravelRadians() - settings.airYawDamping * yawRate;
    controlTorque.addScaledVector(worldUp, yawTorque);
  }

  // Rapier keeps added torques until reset, so replace them every step
  chassisBody.resetTorques(true);
  chassisBody.addTorque(controlTorque, true);

  vehicle.updateVehicle(physicsTimestep);
  applyGroundSidePush();
  applyLockedTireSlide();
  if (!isInAir) applyRearSlideDrag();
  world.step();
  contactsAreStale = false;
}

// Preload: holding the right stick back on the ground loads the suspension (the rider pushes the bike
// down into the face), and flicking it forward lets the rider spring up off the bike as it leaves the
// lip. The pop is extra upward speed, so the bike goes higher and further. It only counts when the flick
// comes just before or just after the wheels leave the ground; let go too early and the load bleeds off.
function updatePreload(isInAir: boolean) {
  const stickBack = Math.max(0, -controls.riderForwardLean);
  const flickedForward = controls.riderForwardLean > 0.5;
  if (isInAir) timeSinceTakeoff += physicsTimestep;
  if (!isInAir && stickBack > 0.5) {
    state.preloadCharge = Math.min(stickBack, state.preloadCharge + physicsTimestep / settings.preloadChargeSeconds);
  } else if (flickedForward && state.preloadCharge > 0.05) {
    preloadRelease = state.preloadCharge;
    preloadReleaseTimeRemaining = settings.preloadEarlySeconds;
    state.preloadCharge = 0;
  } else if (!isInAir || timeSinceTakeoff > settings.preloadLateSeconds) {
    // Not pushing down any more: the suspension rebounds on its own and the load is gone
    state.preloadCharge = Math.max(0, state.preloadCharge - physicsTimestep / 0.25);
  }
  if (preloadReleaseTimeRemaining <= 0) return;
  preloadReleaseTimeRemaining -= physicsTimestep;
  const justTookOff = isInAir && timeSinceTakeoff <= settings.preloadLateSeconds;
  const velocity = chassisBody.linvel();
  if (justTookOff && velocity.y > 0) {
    chassisBody.setLinvel({ x: velocity.x, y: velocity.y + settings.preloadPopSpeed * preloadRelease, z: velocity.z }, true);
    takeoffPreloadPercent = preloadRelease * 100;
    preloadReleaseTimeRemaining = 0;
  }
}

resetBike();
