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
  loadTrack,
  physicsStep,
  physicsTimestep,
  rearWheelIndex,
  resetBike,
  settings,
  state,
  track,
  vehicle,
  wheelRadius,
} from './simulation.ts';
import { cellSize, cellsPerSide, centerlineSpacing, mapSize, trackHalfWidth } from './track.ts';

// ---------- Rendering ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8c6d1);
scene.fog = new THREE.Fog(0xb8c6d1, 80, 260);

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

// ---------- Terrain ----------

// A 2 m grid laid over the ground in world space makes speed readable
const gridCanvas = document.createElement('canvas');
gridCanvas.width = gridCanvas.height = 64;
const gridContext = gridCanvas.getContext('2d')!;
gridContext.fillStyle = '#ffffff';
gridContext.fillRect(0, 0, 64, 64);
gridContext.fillStyle = '#d4d0c8';
gridContext.fillRect(0, 0, 64, 2);
gridContext.fillRect(0, 0, 2, 64);
const gridTexture = new THREE.CanvasTexture(gridCanvas);
gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping;
gridTexture.anisotropy = 8;
gridTexture.colorSpace = THREE.SRGBColorSpace;

const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: gridTexture, roughness: 0.95 });
const offTrackColor = new THREE.Color(0x7d8a6a);
const trackColor = new THREE.Color(0x9a7650);
const raisedDirtColor = new THREE.Color(0xc28a4a); // jumps and berms
const edgeMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
let terrainMesh: THREE.Mesh | undefined;
const edgeMarkers = new THREE.Group();
scene.add(edgeMarkers);

// One mesh from the same heights the physics uses. Rebuilt when a new layout is loaded.
function buildTerrainMesh() {
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
  }
  const pointsPerSide = cellsPerSide + 1;
  const positions = new Float32Array(pointsPerSide * pointsPerSide * 3);
  const colors = new Float32Array(pointsPerSide * pointsPerSide * 3);
  const uvs = new Float32Array(pointsPerSide * pointsPerSide * 2);
  const color = new THREE.Color();
  for (let xIndex = 0; xIndex <= cellsPerSide; xIndex++) {
    for (let zIndex = 0; zIndex <= cellsPerSide; zIndex++) {
      // Same layout as the physics heights: index = zIndex + xIndex * pointsPerSide
      const pointIndex = zIndex + xIndex * pointsPerSide;
      const x = xIndex * cellSize - mapSize / 2;
      const z = zIndex * cellSize - mapSize / 2;
      const height = track.heights[pointIndex];
      positions.set([x, height, z], pointIndex * 3);
      uvs.set([x / 2, z / 2], pointIndex * 2);
      color.copy(offTrackColor).lerp(trackColor, track.onTrack[pointIndex]);
      color.lerp(raisedDirtColor, Math.min(1, height / 1.2) * Math.max(track.onTrack[pointIndex], 0.6));
      colors.set([color.r, color.g, color.b], pointIndex * 3);
    }
  }
  const indices = new Uint32Array(cellsPerSide * cellsPerSide * 6);
  let write = 0;
  for (let xIndex = 0; xIndex < cellsPerSide; xIndex++) {
    for (let zIndex = 0; zIndex < cellsPerSide; zIndex++) {
      const a = zIndex + xIndex * pointsPerSide;
      const b = a + pointsPerSide; // next x
      const c = a + 1; // next z
      const d = b + 1;
      indices.set([a, c, b, b, c, d], write);
      write += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  scene.add(terrainMesh);

  // White strips across the track mark every lip and knuckle so takeoffs and landings are easy to judge
  for (const marker of [...edgeMarkers.children]) {
    edgeMarkers.remove(marker);
    (marker as THREE.Mesh).geometry.dispose();
  }
  const sampleCount = track.centerlineX.length;
  for (const jump of track.jumps) {
    jump.edges.forEach((edge, edgeIndex) => {
      const sample = Math.round((jump.start + edge) / centerlineSpacing) % sampleCount;
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, trackHalfWidth * 2), edgeMarkerMaterial);
      marker.position.set(track.centerlineX[sample], jump.edgeHeights[edgeIndex] + 0.02, track.centerlineZ[sample]);
      marker.rotation.y = Math.atan2(-track.tangentZ[sample], track.tangentX[sample]);
      edgeMarkers.add(marker);
    });
  }
}
buildTerrainMesh();
let builtTrackVersion = state.trackVersion;

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
const trackFolder = gui.addFolder('Track');
const layoutController = trackFolder
  .add(settings, 'trackSeed', 1, 999999, 1)
  .name('layout number')
  .onFinishChange((seed: number) => loadTrack(Math.round(seed)));
trackFolder
  .add({ newLayout: () => loadTrack(1 + Math.floor(Math.random() * 999999)) }, 'newLayout')
  .name('new random layout');
trackFolder.add({ restart: () => resetBike() }, 'restart').name('back to the start (A button)');
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
const previousBikePosition = new THREE.Vector3();
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
  camera.position.y = Math.max(camera.position.y, track.heightAt(camera.position.x, camera.position.z) + 0.5);
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
  // The next feature down the track and the speed it's built for
  const bikePosition = chassisBody.translation();
  const distanceAlong = track.nearestCenterlineIndex(bikePosition.x, bikePosition.z) * centerlineSpacing;
  let nextJumpText = '';
  let nearestAhead = Infinity;
  for (const jump of track.jumps) {
    const ahead = (jump.start - distanceAlong + track.length) % track.length;
    if (ahead < nearestAhead) {
      nearestAhead = ahead;
      nextJumpText = `next: ${jump.kind} in ${ahead.toFixed(0)} m, built for ${(jump.designSpeed * 3.6).toFixed(0)} km/h`;
    }
  }
  hudElement.textContent =
    `layout ${settings.trackSeed}   ground bank ${toDegrees(Math.abs(state.groundBankRadians))}°   ${nextJumpText}\n` +
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

  if (state.trackVersion !== builtTrackVersion) {
    buildTerrainMesh();
    builtTrackVersion = state.trackVersion;
    layoutController.updateDisplay();
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
