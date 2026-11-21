// The visible dirt bike and rider, built from simple shapes. Coordinates are the physics chassis's own:
// +X forward, +Y up, +Z to the rider's right, origin at the chassis center (the ground is about 0.72 m
// below). The model only follows the physics; nothing here affects how the bike rides.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wheelRadius } from './simulation.ts';

export type BikePose = {
  rearAxle: THREE.Vector3; // where the physics puts each axle, chassis coordinates
  frontAxle: THREE.Vector3;
  handlebarRadians: number; // positive = bars turned right
  rearSpinRadians: number;
  frontSpinRadians: number;
  riderForward: number; // -1..1, rider's weight back to forward
  riderPress: number; // -1..1, how hard the rider lays the bike over (the body leans the other way)
  riderPressRadians: number; // body counter-lean at a full press
  riderStanding: number; // 0 sitting, 1 standing on the pegs
};

// ---------- Materials ----------

// Physically based: the scene's sky environment map does most of the work, so metals are fully metallic
// and plastics and the helmet get a glossy clear coat that picks up the sky. Riding gear is cloth (sheen).
// Yamaha racing blue plastics with white side panels
const plastic = new THREE.MeshPhysicalMaterial({ color: 0x1240b0, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const plasticWhite = new THREE.MeshPhysicalMaterial({ color: 0xf1f1ee, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3 });
const seatBlack = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.75 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 });
const frameMetal = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: 1, roughness: 0.32 }); // polished aluminum
const engineMetal = new THREE.MeshStandardMaterial({ color: 0x3a3d43, metalness: 0.85, roughness: 0.55 }); // cast cases
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.9, roughness: 0.4 }); // anodized black
const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.12 });
const springYellow = new THREE.MeshPhysicalMaterial({ color: 0xe8c12c, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
const jersey = new THREE.MeshPhysicalMaterial({ color: 0xeceae6, roughness: 0.85, sheen: 0.6, sheenRoughness: 0.7, sheenColor: 0xffffff });
const jerseyTrim = new THREE.MeshPhysicalMaterial({ color: 0x1240b0, roughness: 0.85, sheen: 0.6, sheenRoughness: 0.7, sheenColor: 0x6d8ee0 });
const pants = new THREE.MeshPhysicalMaterial({ color: 0x24272e, roughness: 0.85, sheen: 0.5, sheenRoughness: 0.6, sheenColor: 0x8a8f9a });
const boots = new THREE.MeshPhysicalMaterial({ color: 0xe9e9e6, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
const gloves = new THREE.MeshPhysicalMaterial({ color: 0x24272e, roughness: 0.8, sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0x8a8f9a });
const helmetShell = new THREE.MeshPhysicalMaterial({ color: 0xf1f1ee, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
// Mirrored orange goggle lens
const gogglesLens = new THREE.MeshPhysicalMaterial({ color: 0xff8a1f, metalness: 0.7, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });

// ---------- Shape helpers ----------

const yAxis = new THREE.Vector3(0, 1, 0);
const scratchDirection = new THREE.Vector3();

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
  const created = new THREE.Mesh(geometry, material);
  created.castShadow = true;
  parent.add(created);
  return created;
}

// A unit-height cylinder along Y, stretched and aimed between two points each time it's placed
function rod(radius: number, material: THREE.Material, parent: THREE.Object3D, segments = 10) {
  return mesh(new THREE.CylinderGeometry(radius, radius, 1, segments), material, parent);
}

function placeBetween(object: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, stretch = true) {
  scratchDirection.subVectors(to, from);
  const length = scratchDirection.length();
  object.position.addVectors(from, to).multiplyScalar(0.5);
  if (length > 1e-6) object.quaternion.setFromUnitVectors(yAxis, scratchDirection.divideScalar(length));
  if (stretch) object.scale.set(1, length, 1);
}

function fixedRod(radius: number, material: THREE.Material, parent: THREE.Object3D, from: number[], to: number[]) {
  const created = rod(radius, material, parent);
  placeBetween(created, new THREE.Vector3(...from), new THREE.Vector3(...to));
  return created;
}

function box(size: number[], material: THREE.Material, parent: THREE.Object3D, position: number[], rotationZ = 0) {
  const created = mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material, parent);
  created.position.set(position[0], position[1], position[2]);
  created.rotation.z = rotationZ;
  return created;
}

// A flat plate cut to an outline in the side view (x, y pairs), `thickness` across the bike, centered on z
function plate(outline: number[][], thickness: number, material: THREE.Material, parent: THREE.Object3D, z: number) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).translate(0, 0, -thickness / 2);
  const created = mesh(geometry, material, parent);
  created.position.z = z;
  return created;
}

// A limb segment of fixed length along Y, centered, so it can be aimed with placeBetween(..., false)
function limb(length: number, radius: number, material: THREE.Material, parent: THREE.Object3D) {
  return mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - 2 * radius), 4, 10), material, parent);
}

// Two-bone IK: from a root toward a target with bone lengths a and b, bending toward `pole`. Writes the
// middle joint and where the end actually reaches (short of the target if it's out of reach).
const ikDirection = new THREE.Vector3();
const ikBend = new THREE.Vector3();
function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, joint: THREE.Vector3, end: THREE.Vector3) {
  ikDirection.subVectors(target, root);
  const distance = THREE.MathUtils.clamp(ikDirection.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  ikDirection.normalize();
  const cosine = (a * a + distance * distance - b * b) / (2 * a * distance);
  ikBend.copy(pole).addScaledVector(ikDirection, -pole.dot(ikDirection)).normalize();
  joint.copy(root).addScaledVector(ikDirection, a * cosine).addScaledVector(ikBend, a * Math.sqrt(Math.max(0, 1 - cosine * cosine)));
  end.copy(root).addScaledVector(ikDirection, distance);
}

// ---------- Wheels ----------

function buildWheel(discSide: number) {
  const wheel = new THREE.Group();
  const tireTube = 0.055;
  mesh(new THREE.TorusGeometry(wheelRadius - tireTube, tireTube, 10, 40), rubber, wheel);
  // Knobs around the tread, staggered side to side, so the wheel visibly turns
  const knobs: THREE.BufferGeometry[] = [];
  const knobCount = 36;
  for (let index = 0; index < knobCount; index++) {
    const angle = (index / knobCount) * Math.PI * 2;
    const knob = new THREE.BoxGeometry(0.03, 0.024, 0.045)
      .translate(0, wheelRadius - 0.006, index % 2 === 0 ? 0.025 : -0.025)
      .rotateZ(angle);
    knobs.push(knob);
  }
  mesh(mergeGeometries(knobs), rubber, wheel);
  mesh(new THREE.TorusGeometry(wheelRadius - 0.085, 0.012, 6, 40), darkMetal, wheel);
  mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 12).rotateX(Math.PI / 2), frameMetal, wheel);
  const spokes: THREE.BufferGeometry[] = [];
  const spokeCount = 18;
  for (let index = 0; index < spokeCount; index++) {
    const angle = (index / spokeCount) * Math.PI * 2;
    const hub = new THREE.Vector3(0.04 * Math.cos(angle), 0.04 * Math.sin(angle), index % 2 === 0 ? 0.04 : -0.04);
    const rim = new THREE.Vector3((wheelRadius - 0.09) * Math.cos(angle + 0.5), (wheelRadius - 0.09) * Math.sin(angle + 0.5), 0);
    const spoke = new THREE.CylinderGeometry(0.004, 0.004, hub.distanceTo(rim), 4);
    const aim = new THREE.Quaternion().setFromUnitVectors(yAxis, rim.clone().sub(hub).normalize());
    spoke.applyQuaternion(aim).translate((hub.x + rim.x) / 2, (hub.y + rim.y) / 2, (hub.z + rim.z) / 2);
    spokes.push(spoke);
  }
  mesh(mergeGeometries(spokes), chrome, wheel);
  const disc = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.006, 24).rotateX(Math.PI / 2), chrome, wheel);
  disc.position.z = discSide * 0.07;
  return wheel;
}

// ---------- The bike and rider ----------

const rake = THREE.MathUtils.degToRad(26);
const steeringHead = new THREE.Vector3(0.4, 0.3, 0); // top of the steering axis
const swingarmPivot = new THREE.Vector3(-0.12, -0.2, 0);
const riderSeat = new THREE.Vector3(-0.15, 0.17, 0);

export function createBikeModel() {
  const root = new THREE.Group();

  // Frame: twin spars from the steering head to the swingarm pivot, a cradle under the engine, and a
  // subframe holding the seat and rear fender
  for (const side of [-1, 1]) {
    fixedRod(0.022, frameMetal, root, [0.43, 0.22, 0.05 * side], [0.02, 0.07, 0.08 * side]);
    fixedRod(0.022, frameMetal, root, [0.02, 0.07, 0.08 * side], [-0.12, -0.16, 0.08 * side]);
    fixedRod(0.018, frameMetal, root, [0.46, 0.16, 0.03 * side], [0.32, -0.26, 0.05 * side]);
    fixedRod(0.018, frameMetal, root, [0.32, -0.26, 0.05 * side], [0.13, -0.42, 0.05 * side]);
    fixedRod(0.018, frameMetal, root, [0.13, -0.42, 0.05 * side], [-0.1, -0.4, 0.06 * side]);
    fixedRod(0.018, frameMetal, root, [-0.1, -0.4, 0.06 * side], [-0.12, -0.16, 0.08 * side]);
    fixedRod(0.014, frameMetal, root, [0.0, 0.08, 0.08 * side], [-0.74, 0.13, 0.07 * side]);
    fixedRod(0.012, frameMetal, root, [-0.12, -0.12, 0.08 * side], [-0.55, 0.11, 0.07 * side]);
  }
  const headTubeBottom = steeringHead.clone().add(new THREE.Vector3(Math.sin(rake), -Math.cos(rake), 0).multiplyScalar(0.17));
  placeBetween(rod(0.032, frameMetal, root), steeringHead, headTubeBottom);

  // Engine: crankcase, a cylinder leaning forward, and its head
  box([0.34, 0.24, 0.17], engineMetal, root, [0.06, -0.27, 0]);
  box([0.15, 0.2, 0.14], engineMetal, root, [0.15, -0.08, 0], -0.25);
  box([0.17, 0.06, 0.16], darkMetal, root, [0.18, 0.02, 0], -0.25);
  const sprocketCover = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14).rotateX(Math.PI / 2), darkMetal, root);
  sprocketCover.position.set(-0.07, -0.22, -0.095);

  // Exhaust: header pipe curling out from the front of the cylinder and back along the right side to a silencer
  const header = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.24, -0.02, 0.04),
    new THREE.Vector3(0.32, -0.12, 0.08),
    new THREE.Vector3(0.24, -0.27, 0.14),
    new THREE.Vector3(0.02, -0.2, 0.16),
    new THREE.Vector3(-0.22, -0.02, 0.15),
    new THREE.Vector3(-0.32, 0.03, 0.14),
  ]);
  mesh(new THREE.TubeGeometry(header, 30, 0.022, 8), chrome, root);
  const silencer = rod(0.048, chrome, root, 14);
  placeBetween(silencer, new THREE.Vector3(-0.3, 0.03, 0.14), new THREE.Vector3(-0.78, 0.15, 0.13));
  const silencerTip = rod(0.03, darkMetal, root);
  placeBetween(silencerTip, new THREE.Vector3(-0.78, 0.15, 0.13), new THREE.Vector3(-0.84, 0.165, 0.13));

  // Bodywork: tank, radiator shrouds, seat, side number plates, rear fender
  box([0.32, 0.13, 0.2], plastic, root, [0.22, 0.17, 0], -0.12);
  for (const side of [-1, 1]) {
    box([0.16, 0.2, 0.03], darkMetal, root, [0.31, 0.02, 0.11 * side], -0.15); // radiator
    plate(
      [[0.12, 0.27], [0.43, 0.25], [0.48, 0.12], [0.38, -0.12], [0.24, -0.1], [0.16, 0.08]],
      0.018,
      plastic,
      root,
      0.135 * side,
    );
    plate([[-0.32, 0.12], [-0.7, 0.16], [-0.66, 0.0], [-0.36, -0.06]], 0.016, plasticWhite, root, 0.125 * side);
  }
  box([0.86, 0.07, 0.2], seatBlack, root, [-0.2, 0.17, 0], 0.02);
  plate([[-0.55, 0.15], [-1.02, 0.24], [-1.04, 0.2], [-0.6, 0.1]], 0.16, plastic, root, 0);

  // Footpegs
  const pegs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    box([0.05, 0.02, 0.09], darkMetal, root, [-0.07, -0.34, 0.2 * side]);
    const peg = new THREE.Object3D();
    peg.position.set(-0.07, -0.31, 0.21 * side);
    root.add(peg);
    pegs.push(peg);
  }

  // Swingarm and rear shock, re-aimed at the rear axle every frame
  const swingarm = new THREE.Group();
  swingarm.position.copy(swingarmPivot);
  root.add(swingarm);
  const swingarmArms: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.BoxGeometry(1, 0.055, 0.03).translate(0.5, 0, 0), frameMetal, swingarm);
    arm.position.z = 0.085 * side;
    swingarmArms.push(arm);
  }
  const shockSpring = rod(0.035, springYellow, root);
  const shockBody = rod(0.02, chrome, root);
  const shockTop = new THREE.Vector3(-0.22, 0.08, 0);
  const rearWheel = buildWheel(1);
  root.add(rearWheel);
  const rearSprocket = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20).rotateX(Math.PI / 2), darkMetal, rearWheel);
  rearSprocket.position.z = -0.07;

  // Front end: everything that steers turns about the raked steering axis. Inside steeringFrame, -Y points
  // down the forks and +X forward, square to them.
  const steeringFrame = new THREE.Group();
  steeringFrame.position.copy(steeringHead);
  steeringFrame.rotation.z = rake;
  root.add(steeringFrame);
  const steering = new THREE.Group();
  steeringFrame.add(steering);
  box([0.09, 0.035, 0.27], darkMetal, steering, [0.02, 0.0, 0]); // top clamp
  box([0.09, 0.035, 0.27], darkMetal, steering, [0.02, -0.16, 0]); // bottom clamp
  const forkLowers: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    fixedRod(0.03, darkMetal, steering, [0.02, 0.02, 0.105 * side], [0.02, -0.45, 0.105 * side]);
    const lower = rod(0.024, chrome, steering);
    lower.position.z = 0.105 * side;
    forkLowers.push(lower);
  }
  // Handlebar on risers, with grips and a crossbar pad
  fixedRod(0.015, darkMetal, steering, [-0.03, 0.02, -0.05], [-0.06, 0.11, -0.05]);
  fixedRod(0.015, darkMetal, steering, [-0.03, 0.02, 0.05], [-0.06, 0.11, 0.05]);
  const handlebar = rod(0.012, darkMetal, steering);
  placeBetween(handlebar, new THREE.Vector3(-0.08, 0.14, -0.4), new THREE.Vector3(-0.08, 0.14, 0.4));
  box([0.04, 0.04, 0.12], plastic, steering, [-0.065, 0.13, 0]);
  const grips: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const grip = rod(0.02, rubber, steering);
    placeBetween(grip, new THREE.Vector3(-0.08, 0.14, 0.3 * side), new THREE.Vector3(-0.08, 0.14, 0.4 * side));
    const hand = new THREE.Object3D();
    hand.position.set(-0.08, 0.14, 0.35 * side);
    steering.add(hand);
    grips.push(hand);
  }
  // Front number plate and the front fender (bolted to the bottom clamp, so it doesn't move with the wheel)
  plate([[0.06, -0.18], [0.12, -0.17], [0.12, 0.06], [0.07, 0.1]], 0.24, plasticWhite, steering, 0);
  const fenderMount = new THREE.Group(); // under the bottom clamp, turned back level with the bike
  fenderMount.position.set(0.02, -0.28, 0);
  fenderMount.rotation.z = -rake;
  steering.add(fenderMount);
  // Follows the top of the tire: nearly level behind the forks, curving down over the front of the wheel
  plate(
    [
      [-0.2, 0.0], [0.0, -0.025], [0.2, -0.045], [0.38, -0.08], [0.5, -0.14], [0.54, -0.18],
      [0.56, -0.165], [0.52, -0.12], [0.4, -0.05], [0.2, -0.015], [0.0, 0.005], [-0.2, 0.035],
    ],
    0.14,
    plastic,
    fenderMount,
    0,
  );
  const frontWheel = buildWheel(-1);
  steering.add(frontWheel);

  // Rider: torso and head ride on riderPivot (which slides and counter-leans on the seat); arms and legs
  // are re-solved every frame so the hands stay on the grips and the feet on the pegs
  const riderPivot = new THREE.Group();
  root.add(riderPivot);
  const torsoPivot = new THREE.Group(); // at the pelvis, pitches the upper body forward
  riderPivot.add(torsoPivot);
  const torsoLength = 0.5;
  const torso = mesh(new THREE.CapsuleGeometry(0.14, torsoLength - 0.2, 4, 12), jersey, torsoPivot);
  torso.scale.set(0.8, 1, 1.05);
  torso.position.y = torsoLength / 2;
  const collar = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 12), jerseyTrim, torsoPivot);
  collar.position.y = torsoLength + 0.02;
  const pelvis = mesh(new THREE.CapsuleGeometry(0.12, 0.08, 4, 10).rotateX(Math.PI / 2), pants, torsoPivot);
  pelvis.scale.set(0.9, 0.85, 1);
  // Helmet with a peak, chin bar and goggles; it keeps looking ahead as the body pitches
  const head = new THREE.Group();
  head.position.set(0.04, torsoLength + 0.17, 0);
  torsoPivot.add(head);
  const shell = mesh(new THREE.SphereGeometry(0.14, 18, 14), helmetShell, head);
  shell.scale.set(1.12, 1, 0.95);
  box([0.16, 0.02, 0.17], plastic, head, [0.12, 0.09, 0], -0.25); // peak
  box([0.09, 0.07, 0.12], helmetShell, head, [0.14, -0.08, 0], 0.3); // chin bar
  box([0.03, 0.055, 0.2], gogglesLens, head, [0.14, 0.01, 0]);
  box([0.12, 0.025, 0.27], seatBlack, head, [0.05, 0.01, 0]); // goggle strap

  const upperArmLength = 0.29;
  const forearmLength = 0.28;
  const thighLength = 0.44;
  const shinLength = 0.43;
  const arms = [-1, 1].map(() => ({
    upper: limb(upperArmLength, 0.05, jersey, root),
    lower: limb(forearmLength, 0.042, jersey, root),
    hand: mesh(new THREE.SphereGeometry(0.045, 10, 8), gloves, root),
  }));
  const legs = [-1, 1].map(() => {
    const boot = new THREE.Group();
    root.add(boot);
    box([0.26, 0.09, 0.11], boots, boot, [0.03, 0, 0]);
    return { upper: limb(thighLength, 0.075, pants, root), lower: limb(shinLength, 0.062, boots, root), boot };
  });

  const scratch = {
    shoulder: new THREE.Vector3(),
    hip: new THREE.Vector3(),
    target: new THREE.Vector3(),
    joint: new THREE.Vector3(),
    end: new THREE.Vector3(),
    pole: new THREE.Vector3(),
    axle: new THREE.Vector3(),
  };

  function update(pose: BikePose) {
    // Rear wheel where the physics has it; the swingarm and shock follow
    rearWheel.position.copy(pose.rearAxle);
    rearWheel.rotation.z = -pose.rearSpinRadians;
    const armLength = swingarmPivot.distanceTo(pose.rearAxle);
    swingarm.rotation.z = Math.atan2(pose.rearAxle.y - swingarmPivot.y, pose.rearAxle.x - swingarmPivot.x);
    for (const arm of swingarmArms) arm.scale.x = armLength;
    const shockBottom = scratch.axle.copy(pose.rearAxle).sub(swingarmPivot).multiplyScalar(0.35).add(swingarmPivot);
    placeBetween(shockSpring, shockTop, shockBottom.clone().lerp(shockTop, 0.3));
    placeBetween(shockBody, shockTop, shockBottom);

    // Front wheel slides along the raked forks to the height the physics has the axle at
    const forkTravel = (steeringHead.y - pose.frontAxle.y) / Math.cos(rake);
    steering.rotation.y = -pose.handlebarRadians;
    frontWheel.position.set(0.02, -forkTravel, 0);
    frontWheel.rotation.z = -pose.frontSpinRadians;
    for (const lower of forkLowers) {
      placeBetween(lower, new THREE.Vector3(0.02, -forkTravel, lower.position.z), new THREE.Vector3(0.02, -forkTravel + 0.36, lower.position.z));
    }

    // Rider body: slides fore and aft and counter-leans on the seat, rises off it when standing
    riderPivot.position.copy(riderSeat);
    riderPivot.position.x += pose.riderForward * 0.2;
    riderPivot.position.z -= pose.riderPress * 0.1;
    riderPivot.rotation.x = -pose.riderPressRadians * pose.riderPress;
    torsoPivot.position.set(0, 0.1 + 0.2 * pose.riderStanding, 0);
    const pitchForward = THREE.MathUtils.degToRad(32 + 14 * pose.riderStanding + 12 * pose.riderForward);
    torsoPivot.rotation.z = -pitchForward;
    head.rotation.z = pitchForward * 0.7;

    root.updateMatrixWorld(true);
    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const side = sideIndex === 0 ? -1 : 1;
      // Arm: shoulder on the torso to the grip, elbows back and a little out
      scratch.shoulder.set(-0.02, torsoLength - 0.06, 0.2 * side);
      torsoPivot.localToWorld(scratch.shoulder);
      root.worldToLocal(scratch.shoulder);
      grips[sideIndex].getWorldPosition(scratch.target);
      root.worldToLocal(scratch.target);
      scratch.pole.set(-0.8, -0.1, 0.55 * side);
      const arm = arms[sideIndex];
      solveTwoBone(scratch.shoulder, scratch.target, upperArmLength, forearmLength, scratch.pole, scratch.joint, scratch.end);
      placeBetween(arm.upper, scratch.shoulder, scratch.joint, false);
      placeBetween(arm.lower, scratch.joint, scratch.end, false);
      arm.hand.position.copy(scratch.end);

      // Leg: hip to the peg, knees forward and a little out
      scratch.hip.set(0, 0, 0.11 * side);
      torsoPivot.localToWorld(scratch.hip);
      root.worldToLocal(scratch.hip);
      pegs[sideIndex].getWorldPosition(scratch.target);
      root.worldToLocal(scratch.target);
      scratch.target.y += 0.05;
      scratch.pole.set(1, 0.15, 0.35 * side);
      const leg = legs[sideIndex];
      solveTwoBone(scratch.hip, scratch.target, thighLength, shinLength, scratch.pole, scratch.joint, scratch.end);
      placeBetween(leg.upper, scratch.hip, scratch.joint, false);
      placeBetween(leg.lower, scratch.joint, scratch.end, false);
      leg.boot.position.copy(scratch.end);
    }
  }

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).castShadow = true;
  });
  return { root, update, head };
}
