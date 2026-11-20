// Rendering, tuning panel, controller input, camera and readout. The physics lives in simulation.ts.
import * as THREE from 'three';
import GUI from 'lil-gui';
import {
  applySettings,
  chassisBody,
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
import { trackDesigns } from './trackDesigns.ts';
import { createBikeModel } from './bikeModel.ts';

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
      color.lerp(raisedDirtColor, Math.min(1, Math.abs(height) / 1.2) * Math.max(track.onTrack[pointIndex], 0.6));
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
const bikeModel = createBikeModel();
leanedBikeGroup.add(bikeModel.root);
// The rider stands on the pegs on straights and in the air, and sits down into corners and when slow
let riderStanding = 0;

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
engineFolder.add(settings, 'gearbox', ['automatic', 'manual']).name('gearbox (manual: A up, B down)');
engineFolder.add(settings, 'frontSprocket', 11, 15, 1).name('front sprocket');
engineFolder.add(settings, 'rearSprocket', 44, 56, 1).name('rear sprocket');
engineFolder.add(settings, 'enginePowerScale', 0.2, 1.2, 0.05).name('power (1 = stock YZ250F)');
engineFolder.add(settings, 'autoUpshiftRpm', 8000, 14000, 100).name('auto upshift rpm');
engineFolder.add(settings, 'autoDownshiftRpm', 4000, 11000, 100).name('auto downshift rpm');
engineFolder.add(settings, 'revLimitRpm', 10000, 15000, 100).name('rev limiter rpm');
engineFolder.add(settings, 'shiftSeconds', 0, 0.3, 0.01).name('shift drive cut (s)');
engineFolder.add(settings, 'clutchBiteSeconds', 0.05, 1, 0.05).name('clutch bite time (s)');
engineFolder.add(settings, 'engineBrakingTorque', 0, 15, 0.5).name('engine braking (Nm)');
engineFolder.add(settings, 'dragArea', 0, 1.5, 0.05).name('air drag area');
const brakeFolder = gui.addFolder('Brakes');
brakeFolder.add(settings, 'frontBrakeForce', 0, 4000, 10).name('front brake force (LT)');
brakeFolder.add(settings, 'rearBrakeForce', 0, 3000, 10).name('rear brake force');
brakeFolder.add(settings, 'rearBrakeButtonStrength', 0, 1, 0.01).name('RB rear brake strength');
brakeFolder.add(settings, 'rearBrakeRampSeconds', 0, 1, 0.01).name('RB build-up time (s)');
brakeFolder.add(settings, 'combinedBrakes').name('combined (LT brakes both)');
brakeFolder.add(settings, 'combinedFrontShare', 0, 1, 0.01).name('combined front share');
brakeFolder.add(settings, 'lockedTireGrip', 0.3, 1, 0.01).name('locked tire grip');
const corneringFolder = gui.addFolder('Grip and cornering');
corneringFolder.add(settings, 'frontGrip', 0.1, 5, 0.05).name('front grip');
corneringFolder.add(settings, 'rearGrip', 0.1, 5, 0.05).name('rear grip');
corneringFolder.add(settings, 'fullStickOverLeanDegrees', 0, 20, 0.5).name('full stick lean past grip');
corneringFolder.add(settings, 'bermNoSlideBankDegrees', 1, 30, 1).name('berm bank that holds full stick');
corneringFolder.add(settings, 'bermStickShare', 0, 1, 0.05).name('berm extra lean on full stick');
corneringFolder.add(settings, 'bermExitSeconds', 0, 1, 0.05).name('time to stand up off a berm');
corneringFolder.add(settings, 'leanGripUse', 0.5, 1, 0.01).name('grip estimate scale (slide starts)');
corneringFolder.add(settings, 'overLeanRangeDegrees', 1, 20, 0.5).name('lean past grip for full slide');
corneringFolder.add(settings, 'overLeanRearGripLoss', 0, 1, 0.05).name('rear grip lost in a slide');
corneringFolder.add(settings, 'overLeanSlideDrag', 0, 2, 0.05).name('slide drag (scrubs speed)');
corneringFolder.add(settings, 'throttleRearGripUse', 0, 3, 0.05).name('throttle use of rear grip');
corneringFolder.add(settings, 'slideHoldSeconds', 0.2, 5, 0.1).name('slide hold time before low-side');
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
riderFolder.add(settings, 'preloadPopSpeed', 0, 5, 0.1).name('preload pop (m/s up)');
riderFolder.add(settings, 'preloadChargeSeconds', 0.05, 1.5, 0.05).name('preload hold time');
riderFolder.add(settings, 'preloadEarlySeconds', 0, 1, 0.01).name('preload flick window before lip');
riderFolder.add(settings, 'preloadLateSeconds', 0, 0.5, 0.01).name('preload flick window after lip');
riderFolder.add(settings, 'maxWhipLeanDegrees', 0, 90, 1).name('whip lean angle');
riderFolder.add(settings, 'leftStickWhipShare', 0, 1, 0.05).name('left stick whip share');
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
const trackChoices = Object.fromEntries(trackDesigns.map((design, index) => [`${design.name} (${design.style})`, index]));
const layoutController = trackFolder
  .add(settings, 'trackIndex', trackChoices)
  .name('track (D-pad left/right)')
  .onChange((index: number) => loadTrack(Number(index)));
trackFolder.add({ restart: () => resetBike() }, 'restart').name('back to the start (View button)');
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
let trackStepPressed = 0; // -1 D-pad left, +1 D-pad right
let trackStepWasPressed = 0;
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
    controls.frontBrake = 0;
    controls.rearBrake = 0;
    controls.steering = 0;
    controls.riderForwardLean = 0;
    controls.riderSideLean = 0;
    controls.shiftUp = false;
    controls.shiftDown = false;
    controls.clutch = false;
    resetPressed = false;
    trackStepPressed = 0;
    return;
  }
  // Standard mapping: buttons 6/7 are LT/RT, 5 is RB, axis 0 is left stick X, axes 2/3 are right stick X/Y (up is negative)
  controls.throttle = gamepad.buttons[7]?.value ?? 0;
  controls.frontBrake = gamepad.buttons[6]?.value ?? 0;
  controls.rearBrake = gamepad.buttons[5]?.pressed ? 1 : 0;
  controls.steering = applyDeadzone(gamepad.axes[0] ?? 0);
  controls.riderForwardLean = -applyDeadzone(gamepad.axes[3] ?? 0); // +1 = rider forward
  controls.riderSideLean = applyDeadzone(gamepad.axes[2] ?? 0); // +1 = rider's body right, bike over to the left
  controls.shiftUp = gamepad.buttons[0]?.pressed ?? false; // A
  controls.shiftDown = gamepad.buttons[1]?.pressed ?? false; // B
  controls.clutch = gamepad.buttons[4]?.pressed ?? false; // LB
  resetPressed = gamepad.buttons[8]?.pressed ?? false; // View
  trackStepPressed = (gamepad.buttons[15]?.pressed ? 1 : 0) - (gamepad.buttons[14]?.pressed ? 1 : 0);
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

// ?view=side|front|rear|top|quarter parks the camera next to the bike (offsets in the bike's own axes) for
// looking at the model instead of riding
const inspectView = new URLSearchParams(window.location.search).get('view');
const inspectOffsets: Record<string, [number, number, number]> = {
  side: [0, 0.3, 3.2],
  front: [3.4, 0.5, 0.3],
  rear: [-3.4, 0.6, 0.3],
  top: [0.01, 4, 0],
  quarter: [2.3, 0.9, 2.5],
};
const inspectOffset = new THREE.Vector3();

function updateCamera(frameSeconds: number, snapCamera: boolean) {
  const offset = inspectView ? inspectOffsets[inspectView] : undefined;
  if (offset) {
    inspectOffset.set(...offset).applyQuaternion(bikeGroup.quaternion);
    camera.position.copy(bikeGroup.position).add(inspectOffset);
    camera.lookAt(bikeGroup.position.x, bikeGroup.position.y + 0.15, bikeGroup.position.z);
    return;
  }
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

  const axles = [new THREE.Vector3(), new THREE.Vector3()];
  for (let wheelIndex = 0; wheelIndex < vehicle.numWheels(); wheelIndex++) {
    const connectionPoint = vehicle.wheelChassisConnectionPointCs(wheelIndex)!;
    const suspensionLength = vehicle.wheelSuspensionLength(wheelIndex) ?? settings.suspensionRestLength;
    axles[wheelIndex].set(connectionPoint.x, connectionPoint.y - suspensionLength, connectionPoint.z);
  }
  const speed = Math.abs(vehicle.currentVehicleSpeed());
  const wantsToStand = state.isInAir || (speed > 5 && Math.abs(state.bodyLeanRadians) < THREE.MathUtils.degToRad(12));
  // Preloading crouches the rider down onto the bike; the flick springs them back up
  const standTarget = (wantsToStand ? 1 : 0) * (1 - 0.8 * state.preloadCharge);
  const standResponse = standTarget > riderStanding && state.isInAir ? 12 : 4;
  riderStanding += (standTarget - riderStanding) * (1 - Math.exp(-standResponse * frameSeconds));
  bikeModel.update({
    rearAxle: axles[rearWheelIndex],
    frontAxle: axles[frontWheelIndex],
    handlebarRadians: state.handlebarRadians,
    rearSpinRadians: state.wheelSpinAngles[rearWheelIndex],
    frontSpinRadians: state.wheelSpinAngles[frontWheelIndex],
    riderForward: controls.riderForwardLean,
    riderPress: state.bikePressAmount,
    riderPressRadians: THREE.MathUtils.degToRad(settings.bikePressDegrees),
    riderStanding,
  });

  // Roll the visible bike around the line where the tires touch the ground so the wheels stay planted,
  // or around the center of mass in the air. The pivot height blends so the switch doesn't jump.
  const groundContactHeight = axles[rearWheelIndex].y - wheelRadius;
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
    `${track.design.name}   ground bank ${toDegrees(Math.abs(state.groundBankRadians))}°   ${nextJumpText}\n` +
    `${speedKilometersPerHour.toFixed(0)} km/h   gear ${state.gear} (${settings.gearbox})   ` +
    `${(Math.round(state.engineRpm / 100) * 100).toFixed(0)} rpm${state.isOnRevLimiter ? ' LIMITER' : ''}${controls.clutch ? ' CLUTCH IN' : ''}   pitch ${noseUpDegrees.toFixed(0)}°   ` +
    `rear wheel ${(state.wheelSpinRates[rearWheelIndex] * wheelRadius * 3.6).toFixed(0)} km/h   ` +
    `front ${frontContact}   rear ${rearContact}\n` +
    `bike lean ${toDegrees(state.bikeLeanRadians)}°   bike+rider lean ${toDegrees(state.bodyLeanRadians)}°   ` +
    `bars ${toDegrees(state.handlebarRadians)}°   cornering ${(Math.abs(state.lateralAcceleration) / settings.gravity).toFixed(2)} g   ` +
    `rear slide ${(state.rearSlideAmount * 100).toFixed(0)}%${state.slideTime > 0.5 * settings.slideHoldSeconds ? ' FALLING IN' : ''}\n` +
    `last jump ${lastJump.distance.toFixed(1)} m   air ${lastJump.airTime.toFixed(2)} s   ` +
    `scrub ${lastJump.scrubPercent.toFixed(0)}%   preload ${lastJump.preloadPercent.toFixed(0)}%   landing ${lastJump.landingLoad.toFixed(1)} g ${lastJump.result}\n` +
    `${controllerDescription}\n` +
    `throttle ${controls.throttle.toFixed(2)}   ` +
    `front brake ${state.brakeLevers[frontWheelIndex].toFixed(2)}${state.wheelLocked[frontWheelIndex] ? ' LOCKED' : ''}   ` +
    `rear brake ${state.brakeLevers[rearWheelIndex].toFixed(2)}${state.wheelLocked[rearWheelIndex] ? ' LOCKED' : ''}   ` +
    `steer ${controls.steering.toFixed(2)}   rider forward ${controls.riderForwardLean.toFixed(2)}   ` +
    `rider side ${controls.riderSideLean.toFixed(2)}   preload ${(state.preloadCharge * 100).toFixed(0)}%`;
}

function frame(now: number) {
  const frameSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  readGamepad();
  if (resetPressed && !resetWasPressed) resetBike();
  resetWasPressed = resetPressed;
  if (trackStepPressed !== 0 && trackStepWasPressed === 0) loadTrack(settings.trackIndex + trackStepPressed);
  trackStepWasPressed = trackStepPressed;

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
