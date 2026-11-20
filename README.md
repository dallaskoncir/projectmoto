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
| RT | Throttle. Leaned over, the drive uses up the rear tire's grip: too much gas mid-corner steps the rear out and runs wide, and held on it low-sides. Pick the bike up to get on the gas |
| LT | Brakes, both wheels together (75% front by default) |
| RB | Rear brake on its own (builds up while held), when combined brakes are switched off in the Brakes panel |
| Left stick | Lean the bike and rider into a turn. The rider countersteers to get there. About 85% stick is the tires' limit; past it the rear steps out and the bike slides around tighter, scrubbing speed. Hold it there too long and it low-sides. A berm lets the bike lean further and corner harder than flat ground, so ride up into it to carry more speed; it holds full stick, but turning much tighter than the berm drops you off its face to the inside, where the rear steps out until you stand the bike up. In the air it lays the bike over: hold it through the lip to start a whip |
| Right stick left/right | Move the rider's body that way, and the bike goes over the other way: stand it up or press it down in a turn, scrub off a lip, whip in the air (with the left stick, the full whip with more swing) |
| Right stick up/down | Rider forward/back: weight shift on the ground, pitch in the air. Preload: hold it back up the face of a jump and flick it forward at the lip to pop higher and further |
| A | Back to the start |
| D-pad left/right | Previous/next track |

## Tracks

Six fixed tracks, picked from the Track folder in the panel or with the D-pad:

- **Motocross:** Ridgeback, Long Meadow and Quarry. Long straights, sweeping bermed corners, big doubles,
  tabletops, step-ups and rollers.
- **Supercross:** Harbor, Dome and Night. Compact stadium layouts with tight 180s, rhythm sections, whoops and
  triples. Night's long back straight has a step-on, step-off: jump up onto a 3 m plateau, get on the gas
  across the top, and jump off the kicker at the far end over a gap to the landing.

Some corners on every track also have an inside berm: a banked lane cut into the inside of the turn, for a
shorter, tighter line than the outside berm. It's quicker through some corners and slower through others, so
pick your line.

## Tuning

Every value that affects the feel is in the panel on the right and changes live: suspension, engine, brakes,
grip, cornering, rider, landings and camera. **Copy settings** copies the current values as JSON.

## Code

- `src/simulation.ts`: all the physics (bike, lean and balance, brakes and tire lock-up, jumps, landings and
  crashes). It has no browser code, so it also runs headless in Node.
- `src/track.ts`: builds a track's heightfield from a design, including berms and jump shapes. Each jump is
  sized from the speed its run-up gives.
- `src/trackDesigns.ts`: the six track layouts, as corner points plus the features on each straight.
- `src/bikeModel.ts`: the visible bike and rider, built from simple shapes. The forks, swingarm and wheels
  follow the physics, and the rider's arms and legs stay on the bars and pegs as the body moves.
- `src/main.ts`: rendering, the tuning panel, controller input, the camera and the readout. Add
  `?view=side`, `front`, `rear`, `top` or `quarter` to the URL to park the camera beside the bike.

Driving the simulation from a script in Node 24 is the quickest way to check a physics change:

```ts
import { controls, physicsStep, state, loadTrack } from './src/simulation.ts';

loadTrack(0);
controls.throttle = 0.6;
for (let step = 0; step < 240; step++) physicsStep(); // two seconds at 120 Hz
console.log(state.bikeLeanRadians, state.lastJump);
```
