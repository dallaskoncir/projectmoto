# ProjectMOTO

A gray-box prototype for a motocross game. There's no art or menus, just physics, controller
controls, tracks to ride and rough engine sounds.

The bike is geared like a stock 2024-on Yamaha YZ250F: five speeds, 57/17 primary, 13/50 sprockets and a
14,000 rpm limiter, with automatic or manual shifting.

Built with [three.js](https://threejs.org), [Rapier](https://rapier.rs) physics and
[lil-gui](https://lil-gui.georgealways.com) for live tuning.

## Running it

```sh
npm install
npm run dev
```

Open the URL Vite prints, plug in an Xbox-style controller and press a button, or ride with the keyboard (see
below). Click the page or press a key once to turn the sound on (browsers won't start audio from a controller
button). Only controllers with the
browser's "standard" mapping are used, so wheels and pedals are ignored.

## Controls

| Input | Action |
| --- | --- |
| RT | Throttle. Leaned over, the drive uses up the rear tire's grip: too much gas mid-corner spins the rear up and steps it out, so it slides and scrubs speed instead of driving. Pick the bike up to get on the gas. Wheelies past about 35° get the rider rolling off and tapping the rear brake, so it won't loop out |
| LT | Brakes, both wheels together (75% front by default) |
| RB | Rear brake on its own (builds up while held), when combined brakes are switched off in the Brakes panel |
| LB | Clutch: hold to free the engine from the rear wheel (coast with no engine braking, or rev it up); let it out with the revs up for a kick of drive (a clutch dump). Pulling away doesn't need it |
| Left stick | Lean the bike and rider into a turn. The rider countersteers to get there. About 85% stick is the tires' limit; past it the rear steps out and the bike slides around tighter, scrubbing speed. Hold it there too long and it low-sides. A berm lets the bike lean further and corner harder than flat ground, so ride up into it to carry more speed; it holds full stick, but turning much tighter than the berm drops you off its face to the inside, where the rear steps out until you stand the bike up. Whips come from the takeoff: lean into the face and lay it over at the lip, and the bike leaves swinging over, harder the more it's leaned and the bigger the jump. It keeps its lay-over (and goes right over or upside down if you let it swing), so hold the sticks the other way in time and the rider brings it back up and settles it straight. Gas brings it back too: the engine and rear wheel spinning stand the bike up on their own, and with the sticks pulled back as well it comes back fastest. It doesn't fight a whip being thrown: it builds in just after the lip and stays off while you push the bike further over, so scrub with the gas on and keep pushing to hold a whip out. In the air the sticks only push a little further over. A small lean straightens up on its own |
| Right stick left/right | Move the rider's body that way, and the bike goes over the other way: stand it up or press it down in a turn, scrub off a lip, lay it over at the lip to throw a whip, push or pull the bike over in the air (with the left stick, harder). A scrub or whip doesn't come back on its own: push the other way in the air to stand the bike back up |
| Right stick up/down | Rider forward/back: weight shift on the ground, pitch in the air. Preload: hold it back up the face of a jump and flick it forward at the lip to pop higher and further |
| A / B | Shift up / down (manual gearbox, the default; switch to automatic in the Engine folder of the panel) |
| View | Back to the start |
| D-pad left/right | Previous/next track |

### Keyboard

The keyboard works too, alongside a controller or instead of one. Throttle, brakes and lean ramp in over a
fraction of a second, and a held lean key stops at the tires' limit (both adjustable under Camera and input).

| Keys | Action |
| --- | --- |
| W / Up | Throttle |
| S / Down | Brakes |
| A D / Left Right | Lean |
| Space | Rear brake |
| I / K | Rider forward / back (preload: K up the face, I at the lip) |
| J / L | Rider's body left / right (scrub, whip) |
| E / Q | Shift up / down |
| Left Shift | Clutch |
| R | Back to the start |
| [ / ] | Previous / next track |

## Tracks

Six fixed tracks, picked from the Track folder in the panel or with the D-pad:

- **Motocross:** Ridgeback, Long Meadow and Quarry. Long straights, sweeping bermed corners, big doubles,
  tabletops, step-ups and rollers, and one big jump each:
  - **Ridgeback:** a 5.5 m tabletop with a steep 33° face, a long deck and a curved landing at the start of
    the top straight. Full gas lands down the landing; come up short and you land on the deck.
  - **Long Meadow:** the whip jump on the start straight: a tall, steep 40° lip over a 38 m gap to a long
    curved landing, for about 2.5 s of air. Pin it out of the first corner, lean into the face with the left
    stick (don't scrub it, or you'll case it), and you can throw it right over and bring it back.
  - **Quarry:** hilly, with a climb out of the first corner up to the tabletop, rollers down off the top, a drop
    into the pit for the step-up and a steep climb out to the big one. The big one is a step-up on the bottom
    straight, hit in 3rd gear wide open, 35 m up onto a 4 m deck. Back off and you case it (2nd on the limiter
    only just makes the knuckle). Brake hard after the landing for the corner.
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
- `src/keyboardInput.ts`: the keyboard layout, merged with the controller in `main.ts`.
- `src/bikeSound.ts`: rough engine, wind, skid and landing sounds, made live with Web Audio from the engine's
  revs and load (no sound files). Volume and mute are in the Sound folder of the panel.
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
