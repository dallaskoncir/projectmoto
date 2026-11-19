import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';

// Every value that affects feel. Edited live by the panel; "copy settings" exports this as JSON.
const settings = {
  suspensionStiffness: 55, // Rapier scales this by bike mass, so sag stays the same if mass changes
  suspensionCompressionDamping: 5,
  suspensionReboundDamping: 7,
  suspensionTravel: 0.3,
  suspensionRestLength: 0.35,

  engineForce: 1500,
  topSpeed: 25, // meters per second; engine force fades to zero here
  engineBrakingForce: 150,
  brakeForce: 2000, // total, split evenly between the wheels

  frontGrip: 1.5,
  rearGrip: 1.2,

  steeringAngleDegrees: 30,
  steeringAngleAtTopSpeedDegrees: 6,

  riderPitchTorqueAir: 500,
  airPitchDamping: 100,
  riderWeightShiftTorqueGround: 600,
  wheelInertia: 0.6, // per wheel, kg m^2; sets how much brake taps and throttle blips pitch the bike in the air (real MX rear wheel is about 0.6)
  maxScrubLeanDegrees: 45, // how far the rider lays the bike over on the ground
  scrubHeightAbsorb: 0.25, // share of upward takeoff speed a full scrub removes
  maxWhipLeanDegrees: 70, // how far the rider lays the bike over in the air
  whipLeanResponse: 5,
  whipYawTorque: 300,
  whipYawReturn: 500, // pulls the bike back in line with its direction of travel in the air
  airYawDamping: 200,

  uprightAssistStrength: 4000,
  uprightAssistDamping: 400,
  leanAmount: 1, // 0 = always upright, 1 = physically balanced lean for the current turn
  maxLeanAngleDegrees: 50,
  leanResponse: 8, // how fast the bike rolls into the lean; higher = snappier

  bikeMass: 180,
  centerOfMassHeight: -0.15, // relative to the chassis box center; lower = harder to wheelie or loop
  gravity: 9.81,

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
  landingImpactBobbleSpeed: 5, // meters per second into the landing surface
  landingImpactCrashSpeed: 11,
  bobbleSpeedLoss: 0.35, // share of speed lost by the worst bobble
  bobbleSeconds: 0.8,
  crashRespawnSeconds: 2.5,
};

await RAPIER.init();

const physicsTimestep = 1 / 120;
const spawnPosition = { x: -60, y: 1, z: 0 };
const chassisHalfLength = 0.7;
const chassisHalfHeight = 0.25;
const chassisHalfWidth = 0.2;
const wheelRadius = 0.33;
const wheelAttachHeight = -0.15;
const rearWheelIndex = 0;
const frontWheelIndex = 1;

// ---------- Physics world ----------

const world = new RAPIER.World({ x: 0, y: -settings.gravity, z: 0 });
world.timestep = physicsTimestep;

const groundCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0));

// Tabletop jump, 25 m ahead of spawn. The takeoff is a circular arc that starts level with the ground and
// curves up to the lip angle, like a real MX face. Then a flat deck at lip height and a downslope landing.
// Sized so full throttle overjumps onto the flat unless you scrub; 70-85% throttle lands without scrubbing.
const rampStartX = -35;
const rampWidth = 5;
const takeoffLipAngleDegrees = 27;
const takeoffHeight = 2.2;
const deckLength = 14;
const landingAngleDegrees = 18;
const takeoffLipAngle = THREE.MathUtils.degToRad(takeoffLipAngleDegrees);
const takeoffArcRadius = takeoffHeight / (1 - Math.cos(takeoffLipAngle));
const takeoffArcSegments = 24;

// Side profile of the jump as (x, height) points from the start of the takeoff to the end of the landing
const rampProfile: [number, number][] = [];
for (let segmentIndex = 0; segmentIndex <= takeoffArcSegments; segmentIndex++) {
  const arcAngle = (takeoffLipAngle * segmentIndex) / takeoffArcSegments;
  rampProfile.push([rampStartX + takeoffArcRadius * Math.sin(arcAngle), takeoffArcRadius * (1 - Math.cos(arcAngle))]);
}
const lipX = rampProfile[rampProfile.length - 1][0];
const knuckleX = lipX + deckLength;
const landingEndX = knuckleX + takeoffHeight / Math.tan(THREE.MathUtils.degToRad(landingAngleDegrees));
rampProfile.push([knuckleX, takeoffHeight], [landingEndX, 0]);

// Extrude the profile across the ramp width: a top surface plus side walls down to the ground.
// One triangle mesh serves both physics and rendering, because the curved face isn't convex.
const rampVertices: number[] = [];
const rampTriangleIndices: number[] = [];
function addRampQuad(corners: [number, number, number][]) {
  const firstIndex = rampVertices.length / 3;
  for (const corner of corners) rampVertices.push(...corner);
  rampTriangleIndices.push(firstIndex, firstIndex + 1, firstIndex + 2, firstIndex, firstIndex + 2, firstIndex + 3);
}
for (let pointIndex = 0; pointIndex < rampProfile.length - 1; pointIndex++) {
  const [startX, startHeight] = rampProfile[pointIndex];
  const [endX, endHeight] = rampProfile[pointIndex + 1];
  addRampQuad([[startX, startHeight, -rampWidth / 2], [endX, endHeight, -rampWidth / 2], [endX, endHeight, rampWidth / 2], [startX, startHeight, rampWidth / 2]]);
  for (const sideZ of [-rampWidth / 2, rampWidth / 2]) {
    addRampQuad([[startX, 0, sideZ], [endX, 0, sideZ], [endX, endHeight, sideZ], [startX, startHeight, sideZ]]);
  }
}
const rampCollider = world.createCollider(
  RAPIER.ColliderDesc.trimesh(
    new Float32Array(rampVertices),
    new Uint32Array(rampTriangleIndices),
    RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES, // smooth over the seams between triangles on the curve
  ),
);

// Chassis: bike local axes are +X forward, +Y up, +Z to the rider's right
const chassisBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z).setCanSleep(false),
);
const chassisCollider = world.createCollider(
  RAPIER.ColliderDesc.cuboid(chassisHalfLength, chassisHalfHeight, chassisHalfWidth).setFriction(0.5),
  chassisBody,
);

const vehicle = world.createVehicleController(chassisBody);
const wheelDirection = { x: 0, y: -1, z: 0 };
const wheelAxle = { x: 0, y: 0, z: 1 };
vehicle.addWheel({ x: -0.7, y: wheelAttachHeight, z: 0 }, wheelDirection, wheelAxle, settings.suspensionRestLength, wheelRadius);
vehicle.addWheel({ x: 0.75, y: wheelAttachHeight, z: 0 }, wheelDirection, wheelAxle, settings.suspensionRestLength, wheelRadius);

function applySettings() {
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
  vehicle.setWheelFrictionSlip(frontWheelIndex, settings.frontGrip);
  vehicle.setWheelFrictionSlip(rearWheelIndex, settings.rearGrip);
}
applySettings();

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

// bikeGroup follows the physics body. leanPivot sits on the ground contact line and rolls for the visual lean,
// and leanedBikeGroup shifts the meshes back up so they sit where the physics chassis is.
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

// Visual only: slides forward and back with the right stick so weight shift is visible
const riderMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 0.35), new THREE.MeshStandardMaterial({ color: 0x2b5fd9 }));
riderMesh.castShadow = true;
leanedBikeGroup.add(riderMesh);
const riderRestPosition = new THREE.Vector3(-0.15, chassisHalfHeight + 0.35, 0);

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
const gripFolder = gui.addFolder('Grip and steering');
gripFolder.add(settings, 'frontGrip', 0.1, 5, 0.05).name('front grip');
gripFolder.add(settings, 'rearGrip', 0.1, 5, 0.05).name('rear grip');
gripFolder.add(settings, 'steeringAngleDegrees', 0, 50, 0.5).name('steering angle');
gripFolder.add(settings, 'steeringAngleAtTopSpeedDegrees', 0, 50, 0.5).name('steering at top speed');
const riderFolder = gui.addFolder('Rider');
riderFolder.add(settings, 'riderPitchTorqueAir', 0, 2000, 10).name('air pitch torque');
riderFolder.add(settings, 'airPitchDamping', 0, 500, 1).name('air pitch damping');
riderFolder.add(settings, 'riderWeightShiftTorqueGround', 0, 3000, 10).name('ground weight shift');
riderFolder.add(settings, 'wheelInertia', 0.05, 5, 0.05).name('wheel inertia (air brake/throttle pitch)');
riderFolder.add(settings, 'maxScrubLeanDegrees', 0, 70, 1).name('scrub lean angle');
riderFolder.add(settings, 'scrubHeightAbsorb', 0, 1, 0.01).name('scrub height absorb');
riderFolder.add(settings, 'maxWhipLeanDegrees', 0, 90, 1).name('whip lean angle');
riderFolder.add(settings, 'whipLeanResponse', 1, 30, 0.5).name('whip lean response');
riderFolder.add(settings, 'whipYawTorque', 0, 2000, 10).name('whip yaw torque');
riderFolder.add(settings, 'whipYawReturn', 0, 3000, 10).name('whip yaw return');
riderFolder.add(settings, 'airYawDamping', 0, 1000, 5).name('air yaw damping');
const bodyFolder = gui.addFolder('Body and world');
bodyFolder.add(settings, 'uprightAssistStrength', 0, 20000, 50).name('upright assist');
bodyFolder.add(settings, 'uprightAssistDamping', 0, 3000, 10).name('upright damping');
bodyFolder.add(settings, 'leanAmount', 0, 1.5, 0.01).name('lean amount');
bodyFolder.add(settings, 'maxLeanAngleDegrees', 0, 70, 1).name('max lean angle');
bodyFolder.add(settings, 'leanResponse', 1, 30, 0.5).name('lean response');
bodyFolder.add(settings, 'bikeMass', 50, 400, 1).name('bike mass');
bodyFolder.add(settings, 'centerOfMassHeight', -0.6, 0.4, 0.01).name('center of mass height');
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

const controllerInput = { throttle: 0, brake: 0, steering: 0, riderForwardLean: 0, riderSideLean: 0, resetPressed: false };
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
    controllerInput.throttle = 0;
    controllerInput.brake = 0;
    controllerInput.steering = 0;
    controllerInput.riderForwardLean = 0;
    controllerInput.riderSideLean = 0;
    controllerInput.resetPressed = false;
    return;
  }
  // Standard mapping: buttons 6/7 are LT/RT, axis 0 is left stick X, axes 2/3 are right stick X/Y (up is negative)
  controllerInput.throttle = gamepad.buttons[7]?.value ?? 0;
  controllerInput.brake = gamepad.buttons[6]?.value ?? 0;
  controllerInput.steering = applyDeadzone(gamepad.axes[0] ?? 0);
  controllerInput.riderForwardLean = -applyDeadzone(gamepad.axes[3] ?? 0); // +1 = rider forward
  controllerInput.riderSideLean = applyDeadzone(gamepad.axes[2] ?? 0); // +1 = rider right
  controllerInput.resetPressed = gamepad.buttons[0]?.pressed ?? false;
  controllerDescription = gamepad.id;
}

// ---------- Bike control ----------

const worldUp = new THREE.Vector3(0, 1, 0);
const bikeQuaternion = new THREE.Quaternion();
const bikeForwardAxis = new THREE.Vector3();
const bikeSideAxis = new THREE.Vector3();
const bikeAngularVelocity = new THREE.Vector3();
const controlTorque = new THREE.Vector3();
const bikeFlatHeading = new THREE.Vector3();
const travelFlatHeading = new THREE.Vector3();
let leanRadians = 0;
let leanPivotHeight = 0;
let wasInAir = false;
let currentAirTime = 0;
let takeoffScrubPercent = 0;
const takeoffPosition = new THREE.Vector3();
let landingLoadTimeRemaining = 0;
const lastJump = { distance: 0, airTime: 0, scrubPercent: 0, landingLoad: 0, result: '' };
const bikeUpAxis = new THREE.Vector3();
const landingSurfaceNormal = new THREE.Vector3();
const leanTransferRotation = new THREE.Quaternion();
let bobbleTimeRemaining = 0;
let bobbleSeverity = 0;
let wobbleRadians = 0; // visual shake during a bobble
let crashTimeRemaining = 0;
const wheelSpinRates = [0, 0]; // radians per second, positive when rolling forward
const wheelSpinAngles = [0, 0];
// Rapier's contact list still describes the old position until a step runs after a teleport
let contactsAreStale = false;
let statusMessage = '';
let statusTimeRemaining = 0;

function showStatus(message: string, seconds: number) {
  statusMessage = message;
  statusTimeRemaining = seconds;
}

function resetBike() {
  contactsAreStale = true;
  crashTimeRemaining = 0;
  bobbleTimeRemaining = 0;
  wasInAir = false;
  statusTimeRemaining = 0;
  chassisBody.setTranslation(spawnPosition, true);
  chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  previousBikePosition.copy(spawnPosition);
  previousBikeQuaternion.identity();
  leanRadians = 0;
  wheelSpinRates.fill(0);
  snapCameraNextFrame = true;
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

function chassisTouchesGround() {
  let isTouching = false;
  for (const surfaceCollider of [groundCollider, rampCollider]) {
    world.contactPair(chassisCollider, surfaceCollider, (manifold) => {
      // Rapier also reports predicted contacts a few centimeters away, so only count real touches
      for (let contactIndex = 0; contactIndex < manifold.numContacts(); contactIndex++) {
        if (manifold.contactDist(contactIndex) <= 0.005) isTouching = true;
      }
    });
  }
  return isTouching;
}

function crash(reason: string) {
  // Hand the visual lean over to the physics body so the fall continues from what the player saw
  leanTransferRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), leanRadians);
  bikeQuaternion.multiply(leanTransferRotation);
  chassisBody.setRotation(bikeQuaternion, true);
  leanRadians = 0;
  bobbleTimeRemaining = 0;
  crashTimeRemaining = settings.crashRespawnSeconds;
  lastJump.result = 'crash';
  showStatus(`Crash: ${reason}`, settings.crashRespawnSeconds);
}

// 0 at or below the bobble angle, 1 at the crash angle, above 1 is a crash
function landingSeverity(errorDegrees: number, bobbleDegrees: number, crashDegrees: number) {
  if (errorDegrees <= bobbleDegrees) return 0;
  return (errorDegrees - bobbleDegrees) / Math.max(crashDegrees - bobbleDegrees, 0.001);
}

function judgeLanding() {
  const leanDegrees = Math.abs(THREE.MathUtils.radToDeg(leanRadians));
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
    lastJump.result = `bobble ${(bobbleSeverity * 100).toFixed(0)}%`;
    showStatus(`Bobble: ${description}`, 1.2);
  } else {
    lastJump.result = 'clean';
  }
}

function physicsStep() {
  const rotation = chassisBody.rotation();
  bikeQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  bikeForwardAxis.set(1, 0, 0).applyQuaternion(bikeQuaternion);
  bikeSideAxis.set(0, 0, 1).applyQuaternion(bikeQuaternion);
  const angularVelocity = chassisBody.angvel();
  bikeAngularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z);

  // Crashed: the rider is off, so no engine, no assists. The bike falls over and slides to a stop.
  if (crashTimeRemaining > 0) {
    vehicle.setWheelEngineForce(rearWheelIndex, 0);
    vehicle.setWheelSteering(frontWheelIndex, 0);
    vehicle.setWheelBrake(frontWheelIndex, (settings.brakeForce / 2) * physicsTimestep);
    vehicle.setWheelBrake(rearWheelIndex, (settings.brakeForce / 2) * physicsTimestep);
    chassisBody.resetTorques(true);
    wobbleRadians = 0;
    vehicle.updateVehicle(physicsTimestep);
    world.step();
    crashTimeRemaining -= physicsTimestep;
    if (crashTimeRemaining <= 0) resetBike();
    return;
  }

  const forwardSpeed = vehicle.currentVehicleSpeed();
  const speedFraction = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / settings.topSpeed, 0, 1);
  const isInAir = !vehicle.wheelIsInContact(frontWheelIndex) && !vehicle.wheelIsInContact(rearWheelIndex);

  // Landing: record jump stats and judge it. Short hops off bumps are ignored.
  if (!isInAir && wasInAir && currentAirTime > 0.3) {
    const position = chassisBody.translation();
    lastJump.distance = takeoffPosition.distanceTo(new THREE.Vector3(position.x, 0, position.z));
    lastJump.airTime = currentAirTime;
    lastJump.scrubPercent = takeoffScrubPercent;
    lastJump.landingLoad = 0;
    landingLoadTimeRemaining = 0.3;
    judgeLanding();
    if (crashTimeRemaining > 0) return;
  }
  // The frame hitting the ground before the wheels (an upside-down landing, casing onto an edge) is a crash.
  // With the wheels down it is just the suspension bottoming out, which the landing impact check covers.
  if (isInAir && !contactsAreStale && chassisTouchesGround()) {
    crash('the bike hit the ground');
    return;
  }

  // A bobble cuts the throttle while the rider recovers, fading out over its duration
  let throttle = controllerInput.throttle;
  wobbleRadians = 0;
  if (bobbleTimeRemaining > 0) {
    const bobbleFade = bobbleTimeRemaining / settings.bobbleSeconds;
    throttle *= 1 - bobbleSeverity * bobbleFade;
    wobbleRadians = Math.sin(bobbleTimeRemaining * 30) * THREE.MathUtils.degToRad(15) * bobbleSeverity * bobbleFade;
    bobbleTimeRemaining -= physicsTimestep;
  }

  // Engine force fades linearly to zero at top speed
  const engineTaper = THREE.MathUtils.clamp(1 - forwardSpeed / settings.topSpeed, 0, 1);
  vehicle.setWheelEngineForce(rearWheelIndex, throttle * settings.engineForce * engineTaper);

  // Rapier's wheel brake is an impulse cap per step, so convert from newtons
  const brakeForcePerWheel = (controllerInput.brake * settings.brakeForce) / 2;
  const engineBraking = (1 - throttle) * settings.engineBrakingForce;
  vehicle.setWheelBrake(frontWheelIndex, brakeForcePerWheel * physicsTimestep);
  vehicle.setWheelBrake(rearWheelIndex, Math.max(brakeForcePerWheel, engineBraking) * physicsTimestep);

  // Less steering lock at speed so a full stick doesn't snap the bike sideways
  const steeringAngleDegrees = THREE.MathUtils.lerp(settings.steeringAngleDegrees, settings.steeringAngleAtTopSpeedDegrees, speedFraction);
  // Positive Rapier steering turns left, stick right is positive
  vehicle.setWheelSteering(frontWheelIndex, -controllerInput.steering * THREE.MathUtils.degToRad(steeringAngleDegrees));

  controlTorque.set(0, 0, 0);

  // Wheel spin and its reaction on the bike. On the ground a wheel spins at road speed. In the air nothing
  // holds it there, so the engine revs the rear wheel up and the brake lever slows both wheels to a stop.
  // Whatever spin a wheel gains or loses in the air, the bike gets the opposite: revving lifts the nose,
  // braking drops it. (Engine braking is left out in the air, as if the clutch were pulled.)
  for (const wheelIndex of [rearWheelIndex, frontWheelIndex]) {
    const previousSpinRate = wheelSpinRates[wheelIndex];
    if (vehicle.wheelIsInContact(wheelIndex)) {
      wheelSpinRates[wheelIndex] = forwardSpeed / wheelRadius;
    } else {
      // The rear wheel revs up to the top speed rev limit, the same taper the engine uses on the ground
      const wheelSurfaceSpeed = previousSpinRate * wheelRadius;
      const driveTorque =
        wheelIndex === rearWheelIndex
          ? throttle * settings.engineForce * wheelRadius * THREE.MathUtils.clamp(1 - wheelSurfaceSpeed / settings.topSpeed, 0, 1)
          : 0;
      const spinRateAfterDrive = previousSpinRate + (driveTorque / settings.wheelInertia) * physicsTimestep;
      // Brakes slow the wheel toward a stop but never spin it backwards
      const brakeSpinRateLoss = ((brakeForcePerWheel * wheelRadius) / settings.wheelInertia) * physicsTimestep;
      wheelSpinRates[wheelIndex] = Math.sign(spinRateAfterDrive) * Math.max(0, Math.abs(spinRateAfterDrive) - brakeSpinRateLoss);
      // The wheel spins around the bike's -Z axis when rolling forward, so its reaction on the bike is
      // around +Z, and positive torque around +Z lifts the nose
      const spinAcceleration = (wheelSpinRates[wheelIndex] - previousSpinRate) / physicsTimestep;
      controlTorque.addScaledVector(bikeSideAxis, settings.wheelInertia * spinAcceleration);
    }
    wheelSpinAngles[wheelIndex] += wheelSpinRates[wheelIndex] * physicsTimestep;
  }

  // Upright assist: a spring-damper around the bike's forward axis only, so it never fights pitch or flips.
  // dot(side, up) is the sideways tilt (sin of roll).
  const rollError = bikeSideAxis.dot(worldUp);
  const rollRate = bikeAngularVelocity.dot(bikeForwardAxis);
  controlTorque.addScaledVector(bikeForwardAxis, settings.uprightAssistStrength * rollError - settings.uprightAssistDamping * rollRate);

  // Lean is shown by rolling the visible bike (see updateBikeVisuals). The physics chassis stays upright
  // because Rapier's wheel rays tilt with it, so a leaned chassis loses its suspension and falls over.
  // Ground: balanced lean for the turn, where tan(lean) = lateral acceleration / g = speed * yaw rate / g,
  // plus the rider laying the bike over with the right stick (scrub). Air: the right stick lays it over (whip).
  // Positive lean rolls the top toward +Z (right). Turning right is a negative yaw rate.
  const yawRate = bikeAngularVelocity.dot(worldUp);
  let targetLeanRadians: number;
  if (isInAir) {
    targetLeanRadians = controllerInput.riderSideLean * THREE.MathUtils.degToRad(settings.maxWhipLeanDegrees);
  } else {
    const balancedLeanRadians = -Math.atan2(forwardSpeed * yawRate, settings.gravity) * settings.leanAmount;
    const scrubLeanRadians = controllerInput.riderSideLean * THREE.MathUtils.degToRad(settings.maxScrubLeanDegrees);
    const maxLeanRadians = THREE.MathUtils.degToRad(settings.maxLeanAngleDegrees);
    targetLeanRadians = THREE.MathUtils.clamp(balancedLeanRadians + scrubLeanRadians, -maxLeanRadians, maxLeanRadians);
  }
  const leanResponse = isInAir ? settings.whipLeanResponse : settings.leanResponse;
  leanRadians += (targetLeanRadians - leanRadians) * (1 - Math.exp(-leanResponse * physicsTimestep));

  // Scrub: a bike laid over as it leaves the ground turns part of the upward kick into nothing,
  // so it flies lower and flatter. Horizontal speed is kept.
  if (isInAir && !wasInAir) {
    const isScrubbing = Math.abs(controllerInput.riderSideLean) > 0.2;
    const scrubFraction = isScrubbing
      ? THREE.MathUtils.clamp(Math.abs(leanRadians) / THREE.MathUtils.degToRad(settings.maxScrubLeanDegrees), 0, 1)
      : 0;
    const velocity = chassisBody.linvel();
    if (velocity.y > 0 && scrubFraction > 0) {
      const scrubbedUpwardSpeed = velocity.y * (1 - settings.scrubHeightAbsorb * scrubFraction);
      chassisBody.setLinvel({ x: velocity.x, y: scrubbedUpwardSpeed, z: velocity.z }, true);
    }
    takeoffScrubPercent = scrubFraction * 100;
    const position = chassisBody.translation();
    takeoffPosition.set(position.x, 0, position.z);
    currentAirTime = 0;
  }
  if (isInAir) currentAirTime += physicsTimestep;
  wasInAir = isInAir;

  if (landingLoadTimeRemaining > 0) {
    // Peak combined suspension force in the landing, in multiples of the bike's weight
    const suspensionForce = (vehicle.wheelSuspensionForce(frontWheelIndex) ?? 0) + (vehicle.wheelSuspensionForce(rearWheelIndex) ?? 0);
    lastJump.landingLoad = Math.max(lastJump.landingLoad, suspensionForce / (settings.bikeMass * settings.gravity));
    landingLoadTimeRemaining -= physicsTimestep;
  }

  // Rider lean is a torque around the side axis. On the ground the wheels resist it, so it moves load
  // between front and rear suspension like a weight shift. In the air nothing resists, so it pitches the bike.
  // Negative torque around +Z puts the nose down.
  const riderTorque = isInAir ? settings.riderPitchTorqueAir : settings.riderWeightShiftTorqueGround;
  controlTorque.addScaledVector(bikeSideAxis, -controllerInput.riderForwardLean * riderTorque);
  if (isInAir) {
    const pitchRate = bikeAngularVelocity.dot(bikeSideAxis);
    controlTorque.addScaledVector(bikeSideAxis, -settings.airPitchDamping * pitchRate);

    // Whip yaw: the right stick swings the bike sideways, and a spring pulls it back in line with the
    // direction of travel. Stick right yaws the nose right, which is negative around world up.
    const yawTorque =
      -controllerInput.riderSideLean * settings.whipYawTorque +
      settings.whipYawReturn * yawFromTravelRadians() -
      settings.airYawDamping * yawRate;
    controlTorque.addScaledVector(worldUp, yawTorque);
  }

  // Rapier keeps added torques until reset, so replace them every step
  chassisBody.resetTorques(true);
  chassisBody.addTorque(controlTorque, true);

  vehicle.updateVehicle(physicsTimestep);
  world.step();
  contactsAreStale = false;
}

// ---------- Main loop ----------

const previousBikePosition = new THREE.Vector3().copy(spawnPosition);
const previousBikeQuaternion = new THREE.Quaternion();
const currentBikePosition = new THREE.Vector3();
const currentBikeQuaternion = new THREE.Quaternion();
const cameraHeading = new THREE.Vector3(1, 0, 0);
const cameraDesiredPosition = new THREE.Vector3();
const cameraLookTarget = new THREE.Vector3();
const cameraDesiredLookTarget = new THREE.Vector3();
const flatSideAxis = new THREE.Vector3();
let snapCameraNextFrame = true;
let physicsTimeAccumulator = 0;
let lastFrameTime = performance.now();

function updateCamera(frameSeconds: number) {
  // In the air, follow the direction of travel so whips don't swing the camera. On the ground, heading
  // comes from the bike's side axis, which stays horizontal through front and back flips.
  const velocity = chassisBody.linvel();
  const isInAir = !vehicle.wheelIsInContact(frontWheelIndex) && !vehicle.wheelIsInContact(rearWheelIndex);
  flatSideAxis.set(0, 0, 1).applyQuaternion(bikeGroup.quaternion);
  flatSideAxis.y = 0;
  if (isInAir && velocity.x * velocity.x + velocity.z * velocity.z > 4) {
    cameraHeading.set(velocity.x, 0, velocity.z).normalize();
  } else if (flatSideAxis.lengthSq() > 0.01) {
    cameraHeading.crossVectors(worldUp, flatSideAxis).normalize();
  }

  cameraDesiredPosition.copy(bikeGroup.position).addScaledVector(cameraHeading, -settings.cameraDistance);
  cameraDesiredPosition.y += settings.cameraHeight;
  cameraDesiredLookTarget.copy(bikeGroup.position);
  cameraDesiredLookTarget.y += 0.8;

  if (snapCameraNextFrame) {
    camera.position.copy(cameraDesiredPosition);
    cameraLookTarget.copy(cameraDesiredLookTarget);
    snapCameraNextFrame = false;
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

  riderMesh.position.copy(riderRestPosition);
  riderMesh.position.x += controllerInput.riderForwardLean * 0.3;
  riderMesh.position.z += controllerInput.riderSideLean * 0.15;

  for (let wheelIndex = 0; wheelIndex < vehicle.numWheels(); wheelIndex++) {
    const connectionPoint = vehicle.wheelChassisConnectionPointCs(wheelIndex)!;
    const suspensionLength = vehicle.wheelSuspensionLength(wheelIndex) ?? settings.suspensionRestLength;
    wheelSteeringPivots[wheelIndex].position.set(connectionPoint.x, connectionPoint.y - suspensionLength, connectionPoint.z);
    wheelSteeringPivots[wheelIndex].rotation.y = vehicle.wheelSteering(wheelIndex) ?? 0;
    wheelSpinMeshes[wheelIndex].rotation.z = -wheelSpinAngles[wheelIndex];
  }

  // Roll the visible bike around the line where the tires touch the ground so the wheels stay planted,
  // or around the center of mass in the air. The pivot height blends so the switch doesn't jump.
  const isInAir = !vehicle.wheelIsInContact(frontWheelIndex) && !vehicle.wheelIsInContact(rearWheelIndex);
  const groundContactHeight = wheelSteeringPivots[rearWheelIndex].position.y - wheelRadius;
  const targetPivotHeight = isInAir ? settings.centerOfMassHeight : groundContactHeight;
  leanPivotHeight += (targetPivotHeight - leanPivotHeight) * (1 - Math.exp(-settings.leanResponse * frameSeconds));
  leanPivot.position.y = leanPivotHeight;
  leanedBikeGroup.position.y = -leanPivotHeight;
  leanPivot.rotation.x = leanRadians + wobbleRadians;

  sunLight.position.copy(bikeGroup.position).add(sunOffset);
  sunLight.target.position.copy(bikeGroup.position);
}

const hudForwardAxis = new THREE.Vector3();

function updateHud(frameSeconds: number) {
  statusTimeRemaining -= frameSeconds;
  statusElement.textContent = statusTimeRemaining > 0 ? statusMessage : '';
  const speedKilometersPerHour = Math.abs(vehicle.currentVehicleSpeed()) * 3.6;
  const frontContact = vehicle.wheelIsInContact(frontWheelIndex) ? 'down' : 'up';
  const rearContact = vehicle.wheelIsInContact(rearWheelIndex) ? 'down' : 'up';
  // Nose up is positive: how far the bike's forward axis points above the horizon
  const noseUpDegrees = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(hudForwardAxis.set(1, 0, 0).applyQuaternion(bikeGroup.quaternion).y, -1, 1)));
  hudElement.textContent =
    `${speedKilometersPerHour.toFixed(0)} km/h   bike lean ${THREE.MathUtils.radToDeg(leanRadians).toFixed(0)}°   ` +
    `pitch ${noseUpDegrees.toFixed(0)}°   rear wheel ${((wheelSpinRates[rearWheelIndex] * wheelRadius) * 3.6).toFixed(0)} km/h   ` +
    `front ${frontContact}   rear ${rearContact}\n` +
    `last jump ${lastJump.distance.toFixed(1)} m   air ${lastJump.airTime.toFixed(2)} s   ` +
    `scrub ${lastJump.scrubPercent.toFixed(0)}%   landing ${lastJump.landingLoad.toFixed(1)} g ${lastJump.result}\n` +
    `${controllerDescription}\n` +
    `throttle ${controllerInput.throttle.toFixed(2)}   brake ${controllerInput.brake.toFixed(2)}   ` +
    `steer ${controllerInput.steering.toFixed(2)}   rider forward ${controllerInput.riderForwardLean.toFixed(2)}   ` +
    `rider side ${controllerInput.riderSideLean.toFixed(2)}`;
}

function frame(now: number) {
  const frameSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  readGamepad();
  if (controllerInput.resetPressed && !resetWasPressed) resetBike();
  resetWasPressed = controllerInput.resetPressed;

  physicsTimeAccumulator += frameSeconds;
  while (physicsTimeAccumulator >= physicsTimestep) {
    const position = chassisBody.translation();
    const rotation = chassisBody.rotation();
    previousBikePosition.set(position.x, position.y, position.z);
    previousBikeQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    physicsStep();
    physicsTimeAccumulator -= physicsTimestep;
  }

  updateBikeVisuals(physicsTimeAccumulator / physicsTimestep, frameSeconds);
  updateCamera(frameSeconds);
  updateHud(frameSeconds);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
