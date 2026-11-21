// Keyboard controls, as an alternative to a controller. Keys are on or off, so the analog inputs ramp toward
// their target over a fraction of a second instead of snapping, and full lean stops at the tires' limit.
//
//   W / Up        throttle             E / Q        shift up / down
//   S / Down      brakes               Left Shift   clutch
//   A D / Left Right  lean             R            back to the start
//   Space         rear brake           [ / ]        previous / next track
//   I / K         rider forward / back
//   J / L         rider's body left / right    C            chase / first person camera

export const keyboardSettings = {
  fullLean: 0.85, // how far a held lean key pushes the "stick": 0.85 is right at the tires' limit
  rampSeconds: 0.2, // how long throttle, brakes and lean take to come all the way on
};

export const keyboardBindings = [
  ['W / Up', 'throttle'],
  ['S / Down', 'brakes'],
  ['A D / Left Right', 'lean'],
  ['Space', 'rear brake'],
  ['I / K', 'rider forward / back'],
  ['J / L', "rider's body left / right"],
  ['E / Q', 'shift up / down'],
  ['Left Shift', 'clutch'],
  ['R', 'back to the start'],
  ['[ / ]', 'previous / next track'],
  ['C', 'chase / first person camera'],
];

const held = new Set<string>();
let hasBeenUsed = false;

const handledKeys = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyE', 'KeyQ', 'ShiftLeft', 'KeyR', 'BracketLeft', 'BracketRight', 'KeyC',
]);

function isTypingInField(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return target !== null && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
}

window.addEventListener('keydown', (event) => {
  if (isTypingInField(event) || !handledKeys.has(event.code)) return;
  held.add(event.code);
  hasBeenUsed = true;
  event.preventDefault(); // arrows and Space would scroll the page
});
window.addEventListener('keyup', (event) => held.delete(event.code));
window.addEventListener('blur', () => held.clear()); // don't leave the throttle stuck on when the window loses focus

const isDown = (...codes: string[]) => codes.some((code) => held.has(code));
const axis = (negative: boolean, positive: boolean) => (positive ? 1 : 0) - (negative ? 1 : 0);

const smoothed = { throttle: 0, frontBrake: 0, steering: 0, riderForwardLean: 0, riderSideLean: 0 };

// Moves toward the target at full scale per rampSeconds, and back to zero twice as fast
function ramp(current: number, target: number, frameSeconds: number) {
  const releasing = Math.abs(target) < Math.abs(current) || Math.sign(target) !== Math.sign(current);
  const step = (frameSeconds / Math.max(keyboardSettings.rampSeconds, 0.01)) * (releasing ? 2 : 1);
  return current + Math.max(-step, Math.min(step, target - current));
}

export function readKeyboard(frameSeconds: number) {
  smoothed.throttle = ramp(smoothed.throttle, isDown('KeyW', 'ArrowUp') ? 1 : 0, frameSeconds);
  smoothed.frontBrake = ramp(smoothed.frontBrake, isDown('KeyS', 'ArrowDown') ? 1 : 0, frameSeconds);
  const leanTarget = axis(isDown('KeyA', 'ArrowLeft'), isDown('KeyD', 'ArrowRight')) * keyboardSettings.fullLean;
  smoothed.steering = ramp(smoothed.steering, leanTarget, frameSeconds);
  smoothed.riderForwardLean = ramp(smoothed.riderForwardLean, axis(isDown('KeyK'), isDown('KeyI')), frameSeconds);
  smoothed.riderSideLean = ramp(smoothed.riderSideLean, axis(isDown('KeyJ'), isDown('KeyL')), frameSeconds);
  return {
    hasBeenUsed,
    isAnyKeyHeld: held.size > 0,
    ...smoothed,
    rearBrake: isDown('Space') ? 1 : 0,
    shiftUp: isDown('KeyE'),
    shiftDown: isDown('KeyQ'),
    clutch: isDown('ShiftLeft'),
    reset: isDown('KeyR'),
    cameraToggle: isDown('KeyC'),
    trackStep: (isDown('BracketRight') ? 1 : 0) - (isDown('BracketLeft') ? 1 : 0),
  };
}
