// Rendering, tuning panel, controller input, camera and readout. The physics lives in simulation.ts.
import * as THREE from 'three';
import GUI from 'lil-gui';
import {
  applySettings,
  chassisBody,
  chassisHalfHeight,
  chassisHalfLength,
  chassisHalfWidth,
  controls,
  frontWheelIndex,
  knuckleX,
  lipX,
  physicsStep,
  physicsTimestep,
  rampTriangleIndices,
  rampVertices,
  rampWidth,
  rearWheelIndex,
  resetBike,
  settings,
  spawnPosition,
  state,
  takeoffHeight,
  vehicle,
  wheelRadius,
} from './simulation.ts';

// ---------- Rendering ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8c6d1);
scene.fog = new THREE.Fog(0xb8c6d1, 60, 180);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xffffff, 0x666655, 1.2));
const sunLight = new THREE.DirectionalLight(0xffffff, 2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.normalBias = 0.03; // stops the ramp's sloped faces from shadowing themselves (grainy stripes)
sunLight.shadow.camera.left = -25;
sunLight.shadow.camera.right = 25;
sunLight.shadow.camera.top = 25;
sunLight.shadow.camera.bottom = -25;
scene.add(sunLight, sunLight.target);
const sunOffset = new THREE.Vector3(15, 30, 10);

const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x8a8478 }));
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);
const groundGrid = new THREE.GridHelper(200, 100, 0x5e5a52, 0x6f6a61); // 2 m squares make speed readable
groundGrid.position.y = 0.01;
scene.add(groundGrid);

const rampGeometry = new THREE.BufferGeometry();
rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rampVertices, 3));
rampGeometry.setIndex(rampTriangleIndices);
rampGeometry.computeVertexNormals();
const rampMesh = new THREE.Mesh(
  rampGeometry,
  new THREE.MeshStandardMaterial({ color: 0xc28a4a, flatShading: true, side: THREE.DoubleSide }),
);
rampMesh.castShadow = true;
rampMesh.receiveShadow = true;
scene.add(rampMesh);
// White strips mark the lip and the knuckle (where the landing starts) so landing spots are easy to judge
for (const edgeX of [lipX, knuckleX]) {
  const edgeStrip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, rampWidth), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  edgeStrip.position.set(edgeX, takeoffHeight + 0.01, 0);
  scene.add(edgeStrip);
}

// bikeGroup follows the physics body. leanPivot sits on the ground contact line and rolls for the lean
// (simulated separately from the upright physics chassis), and leanedBikeGroup shifts the meshes back up
// so they sit where the physics chassis is.
const bikeGroup = new THREE.Group();
const leanPivot = new THREE.Group();
const leanedBikeGroup = new THREE.Group();
scene.add(bikeGroup);
bikeGroup.add(leanPivot);
leanPivot.add(leanedBikeGroup);
const chassisMesh = new THREE.Mesh(
  new THREE.BoxGeometry(chassisHalfLength * 2, chassisHalfHeight * 2, chassisHalfWidth * 2),
  new THREE.MeshStandardMaterial({ color: 0xd9452b }),
);
chassisMesh.castShadow = true;
leanedBikeGroup.add(chassisMesh);

// The rider pivots on the seat: slides forward and back with the right stick, and when the right stick lays
// the bike over the rider leans back the other way by the same amount, so the rider stays near the overall lean.
const riderPivot = new THREE.Group();
leanedBikeGroup.add(riderPivot);
const riderMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 0.35), new THREE.MeshStandardMaterial({ color: 0x2b5fd9 }));
riderMesh.castShadow = true;
riderMesh.position.y = 0.35;
riderPivot.add(riderMesh);
const riderSeatPosition = new THREE.Vector3(-0.15, chassisHalfHeight, 0);

const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.15, 24).rotateX(Math.PI / 2);
const wheelSpokeGeometry = new THREE.BoxGeometry(wheelRadius * 1.9, 0.08, 0.17);
const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
const wheelSpokeMaterial = new THREE.MeshStandardMaterial({ color: 0xdddddd });
const wheelSteeringPivots: THREE.Group[] = [];
const wheelSpinMeshes: THREE.Mesh[] = [];
for (let wheelIndex = 0; wheelIndex < vehicle.numWheels(); wheelIndex++) {
  const steeringPivot = new THREE.Group();
  const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
  wheelMesh.castShadow = true;
  wheelMesh.add(new THREE.Mesh(wheelSpokeGeometry, wheelSpokeMaterial));
  steeringPivot.add(wheelMesh);
  leanedBikeGroup.add(steeringPivot);
  wheelSteeringPivots.push(steeringPivot);
  wheelSpinMeshes.push(wheelMesh);
}

const overlayElement = document.getElementById('overlay')!;
const hudElement = document.getElementById('hud')!;
const statusElement = document.getElementById('status')!;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Tuning panel ----------

const gui = new GUI({ title: 'Feel tuning' });
const suspensionFolder = gui.addFolder('Suspension');
suspensionFolder.add(settings, 'suspensionStiffness', 5, 150, 1).name('stiffness');
suspensionFolder.add(settings, 'suspensionCompressionDamping', 0, 30, 0.1).name('compression damping');
suspensionFolder.add(settings, 'suspensionReboundDamping', 0, 30, 0.1).name('rebound damping');
suspensionFolder.add(settings, 'suspensionTravel', 0.05, 0.6, 0.01).name('travel');
suspensionFolder.add(settings, 'suspensionRestLength', 0.1, 0.6, 0.01).name('rest length');
const engineFolder = gui.addFolder('Engine and brakes');
engineFolder.add(settings, 'engineForce', 0, 5000, 10).name('engine force');
engineFolder.add(settings, 'topSpeed', 5, 60, 0.5).name('top speed (m/s)');
engineFolder.add(settings, 'engineBrakingForce', 0, 1000, 10).name('engine braking');
engineFolder.add(settings, 'brakeForce', 0, 6000, 10).name('brake force');
const corneringFolder = gui.addFolder('Grip and cornering');
corneringFolder.add(settings, 'frontGrip', 0.1, 5, 0.05).name('front grip');
corneringFolder.add(settings, 'rearGrip', 0.1, 5, 0.05).name('rear grip');
corneringFolder.add(settings, 'maxLeanAngleDegrees', 5, 65, 1).name('full stick lean');
corneringFolder.add(settings, 'pressExtraLeanDegrees', 0, 25, 1).name('extra lean when pressing bike in');
corneringFolder.add(settings, 'pressGripBonus', 0, 1, 0.01).name('extra grip when pressing bike in');
corneringFolder.add(settings, 'countersteerLimitG', 0, 1.5, 0.05).name('countersteer limit (g)');
corneringFolder.add(settings, 'riderLeanInitiation', 0, 30, 0.5).name('rider hips lean start');
corneringFolder.add(settings, 'footDabSpeed', 0, 10, 0.1).name('foot dab speed (m/s)');
corneringFolder.add(settings, 'riderSaveStrength', 0, 20, 0.5).name('slide save strength');
corneringFolder.add(settings, 'leanResponse', 1, 20, 0.5).name('lean response');
corneringFolder.add(settings, 'leanPendulumHeight', 0.3, 2, 0.05).name('center of mass height (balance)');
corneringFolder.add(settings, 'steeringLockDegrees', 5, 50, 0.5).name('steering lock');
corneringFolder.add(settings, 'feetDownSpeed', 0, 6, 0.1).name('feet down speed (m/s)');
corneringFolder.add(settings, 'lowSideLeanDegrees', 30, 85, 1).name('low-side lean');
const riderFolder = gui.addFolder('Rider');
riderFolder.add(settings, 'bikePressDegrees', 0, 50, 1).name('bike press lean (right stick)');
riderFolder.add(settings, 'riderBodyResponse', 1, 30, 0.5).name('body response');
riderFolder.add(settings, 'riderWeightShiftTorqueGround', 0, 3000, 10).name('ground weight shift');
riderFolder.add(settings, 'riderPitchTorqueAir', 0, 2000, 10).name('air pitch torque');
riderFolder.add(settings, 'airPitchDamping', 0, 500, 1).name('air pitch damping');
riderFolder.add(settings, 'wheelInertia', 0.05, 5, 0.05).name('wheel inertia (air brake/throttle pitch)');
riderFolder.add(settings, 'scrubFullLeanDegrees', 5, 70, 1).name('bike lean for full scrub');
riderFolder.add(settings, 'scrubHeightAbsorb', 0, 1, 0.01).name('scrub height absorb');
riderFolder.add(settings, 'maxWhipLeanDegrees', 0, 90, 1).name('whip lean angle');
riderFolder.add(settings, 'whipLeanResponse', 1, 30, 0.5).name('whip lean response');
riderFolder.add(settings, 'whipYawTorque', 0, 2000, 10).name('whip yaw torque');
riderFolder.add(settings, 'whipYawReturn', 0, 3000, 10).name('whip yaw return');
riderFolder.add(settings, 'airYawDamping', 0, 1000, 5).name('air yaw damping');
const bodyFolder = gui.addFolder('Body and world');
bodyFolder.add(settings, 'uprightAssistStrength', 0, 20000, 50).name('upright assist');
bodyFolder.add(settings, 'uprightAssistDamping', 0, 3000, 10).name('upright damping');
bodyFolder.add(settings, 'bikeMass', 50, 400, 1).name('bike mass');
bodyFolder.add(settings, 'centerOfMassHeight', -0.6, 0.4, 0.01).name('center of mass height (chassis)');
bodyFolder.add(settings, 'gravity', 1, 30, 0.1).name('gravity');
const cameraFolder = gui.addFolder('Camera and input');
cameraFolder.add(settings, 'cameraDistance', 2, 15, 0.1).name('camera distance');
cameraFolder.add(settings, 'cameraHeight', 0, 8, 0.1).name('camera height');
cameraFolder.add(settings, 'cameraSmoothing', 1, 30, 0.5).name('camera smoothing');
cameraFolder.add(settings, 'stickDeadzone', 0, 0.4, 0.01).name('stick deadzone');
const landingFolder = gui.addFolder('Landing penalty');
landingFolder.add(settings, 'landingLeanBobbleDegrees', 0, 90, 1).name('lean bobble angle');
landingFolder.add(settings, 'landingLeanCrashDegrees', 0, 90, 1).name('lean crash angle');
landingFolder.add(settings, 'landingSidewaysBobbleDegrees', 0, 90, 1).name('sideways bobble angle');
landingFolder.add(settings, 'landingSidewaysCrashDegrees', 0, 90, 1).name('sideways crash angle');
landingFolder.add(settings, 'landingPitchBobbleDegrees', 0, 90, 1).name('pitch bobble angle');
landingFolder.add(settings, 'landingPitchCrashDegrees', 0, 180, 1).name('pitch crash angle');
landingFolder.add(settings, 'landingImpactBobbleSpeed', 0, 20, 0.1).name('impact bobble speed');
landingFolder.add(settings, 'landingImpactCrashSpeed', 0, 30, 0.1).name('impact crash speed');
landingFolder.add(settings, 'bobbleSpeedLoss', 0, 1, 0.01).name('bobble speed loss');
landingFolder.add(settings, 'bobbleSeconds', 0, 3, 0.05).name('bobble duration');
landingFolder.add(settings, 'crashRespawnSeconds', 0.5, 10, 0.1).name('crash respawn time');
const copyButton = gui
  .add(
    {
      copySettings: async () => {
        await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
        copyButton.name('copied!');
        setTimeout(() => copyButton.name('copy settings'), 1200);
      },
    },
    'copySettings',
  )
  .name('copy settings');
gui.onChange(applySettings);

// ---------- Input ----------

let resetPressed = false;
let resetWasPressed = false;
let controllerDescription = 'no controller';

function applyDeadzone(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude < settings.stickDeadzone) return 0;
  return (Math.sign(value) * (magnitude - settings.stickDeadzone)) / (1 - settings.stickDeadzone);
}

function readGamepad() {
  // Only use a standard-layout pad (Xbox style). Wheels, pedals and other devices report no standard mapping.
  const connectedGamepads = navigator.getGamepads().filter((connectedGamepad) => connectedGamepad !== null);
  const gamepad = connectedGamepads.find((connectedGamepad) => connectedGamepad.mapping === 'standard');
  overlayElement.style.display = gamepad ? 'none' : 'flex';
  if (!gamepad) {
    const ignoredDevices = connectedGamepads.map((connectedGamepad) => connectedGamepad.id).join(', ');
    overlayElement.textContent = ignoredDevices
      ? `Connect a controller and press a button (ignoring: ${ignoredDevices})`
      : 'Connect a controller and press a button';
    controls.throttle = 0;
    controls.brake = 0;
    controls.steering = 0;
    controls.riderForwardLean = 0;
    controls.riderSideLean = 0;
    resetPressed = false;
    return;
  }
  // Standard mapping: buttons 6/7 are LT/RT, axis 0 is left stick X, axes 2/3 are right stick X/Y (up is negative)
  controls.throttle = gamepad.buttons[7]?.value ?? 0;
  controls.brake = gamepad.buttons[6]?.value ?? 0;
  controls.steering = applyDeadzone(gamepad.axes[0] ?? 0);
  controls.riderForwardLean = -applyDeadzone(gamepad.axes[3] ?? 0); // +1 = rider forward
  controls.riderSideLean = applyDeadzone(gamepad.axes[2] ?? 0); // +1 = lay the bike over to the right
  resetPressed = gamepad.buttons[0]?.pressed ?? false;
  controllerDescription = gamepad.id;
}

// ---------- Main loop ----------

const worldUp = new THREE.Vector3(0, 1, 0);
const previousBikePosition = new THREE.Vector3().copy(spawnPosition);
const previousBikeQuaternion = new THREE.Quaternion();
const currentBikePosition = new THREE.Vector3();
const currentBikeQuaternion = new THREE.Quaternion();
const cameraHeading = new THREE.Vector3(1, 0, 0);
const cameraDesiredPosition = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
const cameraDesiredLookTarget = new THREE.Vector3();
const flatSideAxis = new THREE.Vector3();
let lastSeenResetCount = -1;
let leanPivotHeight = 0;
let physicsTimeAccumulator = 0;
let lastFrameTime = performance.now();

function updateCamera(frameSeconds: number, snapCamera: boolean) {
  // In the air, follow the direction of travel so whips don't swing the camera. On the ground, heading
  // comes from the bike's side axis, which stays horizontal through front and back flips.
  const velocity = chassisBody.linvel();
  flatSideAxis.set(0, 0, 1).applyQuaternion(bikeGroup.quaternion);
  flatSideAxis.y = 0;
  if (state.isInAir && velocity.x * velocity.x + velocity.z * velocity.z > 4) {
    cameraHeading.set(velocity.x, 0, velocity.z).normalize();
  } else if (flatSideAxis.lengthSq() > 0.01) {
    cameraHeading.crossVectors(worldUp, flatSideAxis).normalize();
  }

  cameraDesiredPosition.copy(bikeGroup.position).addScaledVector(cameraHeading, -settings.cameraDistance);
  cameraDesiredPosition.y += settings.cameraHeight;
  cameraDesiredLookTarget.copy(bikeGroup.position);
  cameraDesiredLookTarget.y += 0.8;

  if (snapCamera) {
    camera.position.copy(cameraDesiredPosition);
    cameraLookTarget.copy(cameraDesiredLookTarget);
  } else {
    // Frame-rate independent exponential smoothing
    const positionBlend = 1 - Math.exp(-settings.cameraSmoothing * frameSeconds);
    const lookBlend = 1 - Math.exp(-settings.cameraSmoothing * 2 * frameSeconds);
    camera.position.lerp(cameraDesiredPosition, positionBlend);
    cameraLookTarget.lerp(cameraDesiredLookTarget, lookBlend);
  }
  camera.position.y = Math.max(camera.position.y, 0.3);
  camera.lookAt(cameraLookTarget);
}

function updateBikeVisuals(interpolation: number, frameSeconds: number) {
  // Blend between the last two physics states so motion is smooth at any display refresh rate
  const position = chassisBody.translation();
  const rotation = chassisBody.rotation();
  currentBikePosition.set(position.x, position.y, position.z);
  currentBikeQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  bikeGroup.position.lerpVectors(previousBikePosition, currentBikePosition, interpolation);
  bikeGroup.quaternion.slerpQuaternions(previousBikeQuaternion, currentBikeQuaternion, interpolation);

  riderPivot.position.copy(riderSeatPosition);
  riderPivot.position.x += controls.riderForwardLean * 0.3;
  riderPivot.position.z -= state.bikePressAmount * 0.12;
  riderPivot.rotation.x = -THREE.MathUtils.degToRad(settings.bikePressDegrees) * state.bikePressAmount;

  for (let wheelIndex = 0; wheelIndex < vehicle.numWheels(); wheelIndex++) {
    const connectionPoint = vehicle.wheelChassisConnectionPointCs(wheelIndex)!;
    const suspensionLength = vehicle.wheelSuspensionLength(wheelIndex) ?? settings.suspensionRestLength;
    wheelSteeringPivots[wheelIndex].position.set(connectionPoint.x, connectionPoint.y - suspensionLength, connectionPoint.z);
    wheelSpinMeshes[wheelIndex].rotation.z = -state.wheelSpinAngles[wheelIndex];
  }
  // Show the handlebar angle, which on a leaned bike is less than the turn it makes on the ground
  wheelSteeringPivots[frontWheelIndex].rotation.y = -state.handlebarRadians;

  // Roll the visible bike around the line where the tires touch the ground so the wheels stay planted,
  // or around the center of mass in the air. The pivot height blends so the switch doesn't jump.
  const groundContactHeight = wheelSteeringPivots[rearWheelIndex].position.y - wheelRadius;
  const targetPivotHeight = state.isInAir ? settings.centerOfMassHeight : groundContactHeight;
  leanPivotHeight += (targetPivotHeight - leanPivotHeight) * (1 - Math.exp(-8 * frameSeconds));
  leanPivot.position.y = leanPivotHeight;
  leanedBikeGroup.position.y = -leanPivotHeight;
  leanPivot.rotation.x = state.bikeLeanRadians + state.wobbleRadians;

  sunLight.position.copy(bikeGroup.position).add(sunOffset);
  sunLight.target.position.copy(bikeGroup.position);
}

const hudForwardAxis = new THREE.Vector3();

function updateHud(frameSeconds: number) {
  state.statusTimeRemaining -= frameSeconds;
  statusElement.textContent = state.statusTimeRemaining > 0 ? state.statusMessage : '';
  const speedKilometersPerHour = Math.abs(vehicle.currentVehicleSpeed()) * 3.6;
  const frontContact = vehicle.wheelIsInContact(frontWheelIndex) ? 'down' : 'up';
  const rearContact = vehicle.wheelIsInContact(rearWheelIndex) ? 'down' : 'up';
  // Nose up is positive: how far the bike's forward axis points above the horizon
  const noseUpDegrees = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(hudForwardAxis.set(1, 0, 0).applyQuaternion(bikeGroup.quaternion).y, -1, 1)));
  const toDegrees = (radians: number) => THREE.MathUtils.radToDeg(radians).toFixed(0);
  const lastJump = state.lastJump;
  hudElement.textContent =
    `${speedKilometersPerHour.toFixed(0)} km/h   pitch ${noseUpDegrees.toFixed(0)}°   ` +
    `rear wheel ${(state.wheelSpinRates[rearWheelIndex] * wheelRadius * 3.6).toFixed(0)} km/h   ` +
    `front ${frontContact}   rear ${rearContact}\n` +
    `bike lean ${toDegrees(state.bikeLeanRadians)}°   bike+rider lean ${toDegrees(state.bodyLeanRadians)}°   ` +
    `bars ${toDegrees(state.handlebarRadians)}°   cornering ${(Math.abs(state.lateralAcceleration) / settings.gravity).toFixed(2)} g\n` +
    `last jump ${lastJump.distance.toFixed(1)} m   air ${lastJump.airTime.toFixed(2)} s   ` +
    `scrub ${lastJump.scrubPercent.toFixed(0)}%   landing ${lastJump.landingLoad.toFixed(1)} g ${lastJump.result}\n` +
    `${controllerDescription}\n` +
    `throttle ${controls.throttle.toFixed(2)}   brake ${controls.brake.toFixed(2)}   ` +
    `steer ${controls.steering.toFixed(2)}   rider forward ${controls.riderForwardLean.toFixed(2)}   ` +
    `bike press ${controls.riderSideLean.toFixed(2)}`;
}

function frame(now: number) {
  const frameSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  readGamepad();
  if (resetPressed && !resetWasPressed) resetBike();
  resetWasPressed = resetPressed;

  physicsTimeAccumulator += frameSeconds;
  while (physicsTimeAccumulator >= physicsTimestep) {
    const position = chassisBody.translation();
    const rotation = chassisBody.rotation();
    previousBikePosition.set(position.x, position.y, position.z);
    previousBikeQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    physicsStep();
    physicsTimeAccumulator -= physicsTimestep;
  }

  // After a reset (button or crash respawn) don't blend from the old spot, and jump the camera there
  const justReset = state.resetCount !== lastSeenResetCount;
  lastSeenResetCount = state.resetCount;
  if (justReset) {
    const position = chassisBody.translation();
    const rotation = chassisBody.rotation();
    previousBikePosition.set(position.x, position.y, position.z);
    previousBikeQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  updateBikeVisuals(physicsTimeAccumulator / physicsTimestep, frameSeconds);
  updateCamera(frameSeconds, justReset);
  updateHud(frameSeconds);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
