# ProjectMOTO

A gray-box prototype for a motocross game. There's no art, menus or sound, just physics, controller
controls and tracks to ride.

Built with [three.js](https://threejs.org), [Rapier](https://rapier.rs) physics and
[lil-gui](https://lil-gui.georgealways.com) for live tuning.

## Running it

```sh
npm install
npm run dev
```

Open the URL Vite prints, plug in an Xbox-style controller and press a button. Only controllers with the
browser's "standard" mapping are used, so wheels and pedals are ignored.

## Controls

| Input | Action |
| --- | --- |
| RT | Throttle |
| LT | Front brake |
| RB | Rear brake (builds up while held) |
| Left stick | Lean the bike and rider into a turn. The rider countersteers to get there. |
| Right stick left/right | Lay the bike over that way: press it into a turn, scrub off a lip, whip in the air |
| Right stick up/down | Rider forward/back: weight shift on the ground, pitch in the air |
| A | Back to the start |
| D-pad left/right | Previous/next track |

## Tracks

Six fixed tracks, picked from the Track folder in the panel or with the D-pad:

- **Motocross:** Ridgeback, Long Meadow and Quarry. Long straights, sweeping bermed corners, big doubles,
  tabletops, step-ups and rollers.
- **Supercross:** Harbor, Dome and Night. Compact stadium layouts with tight 180s, rhythm sections, whoops and
  triples.

## Tuning

Every value that affects the feel is in the panel on the right and changes live: suspension, engine, brakes,
grip, cornering, rider, landings and camera. **Copy settings** copies the current values as JSON.

## Code

- `src/simulation.ts`: all the physics (bike, lean and balance, brakes and tire lock-up, jumps, landings and
  crashes). It has no browser code, so it also runs headless in Node.
- `src/track.ts`: builds a track's heightfield from a design, including berms and jump shapes. Each jump is
  sized from the speed its run-up gives.
- `src/trackDesigns.ts`: the six track layouts, as corner points plus the features on each straight.
- `src/main.ts`: rendering, the tuning panel, controller input, the camera and the readout.

Driving the simulation from a script in Node 24 is the quickest way to check a physics change:

```ts
import { controls, physicsStep, state, loadTrack } from './src/simulation.ts';

loadTrack(0);
controls.throttle = 0.6;
for (let step = 0; step < 240; step++) physicsStep(); // two seconds at 120 Hz
console.log(state.bikeLeanRadians, state.lastJump);
```
