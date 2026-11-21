// The tracks. Each is a closed loop of corner points (ridden in order, x to the right and z toward the
// bottom of the map, so a right-hander turns from +X toward +Z) and the features on each straight.
// straights[i] runs from corner i to corner i+1. Jumps without sizes are sized for their run-up speed.
import type { TrackDesign } from './track.ts';

const motocross = { style: 'motocross', landingRoom: 8, cornerClearance: 14, maxDesignSpeed: 22, maxJumpHeight: 4.5 } as const;
// Supercross jumps come right out of the turns and sit close together
const supercross = { style: 'supercross', landingRoom: 4, cornerClearance: 10, maxDesignSpeed: 19, maxJumpHeight: 3.4, jumpSpeedScale: 1.1 } as const;

export const trackDesigns: TrackDesign[] = [
  {
    // The original loop: long top straight with the big double, a hairpin, an S through the middle
    name: 'Ridgeback MX',
    ...motocross,
    corners: [
      { x: -106, z: -106, radius: 14 },
      { x: 100, z: -106, radius: 12 },
      { x: 106, z: 25, radius: 9, insideBerm: true },
      { x: 31, z: 28, radius: 10 },
      { x: 30, z: 112, radius: 8, insideBerm: true },
      { x: 5, z: 112, radius: 8, insideBerm: true },
      { x: 0, z: 56, radius: 10 },
      { x: -69, z: 56, radius: 10 },
      { x: -69, z: -25, radius: 10 },
      { x: -106, z: -25, radius: 10 },
    ],
    straights: [
      [
        // The big one: a tall, steep tabletop with a long, curved landing
        { kind: 'tabletop', height: 5.5, lipDegrees: 33, deck: 35, landingDegrees: 34, landingBottomDegrees: 12 },
        { kind: 'big double', takeoff: 2.6, lipDegrees: 30, gap: 25, landing: 4.2, landingDegrees: 13, runUp: 24 },
      ],
      [{ kind: 'rollers', count: 2, height: 0.6, spacing: 7.4 }, { kind: 'tabletop' }],
      [{ kind: 'step-up', deck: 2, gap: 14.5 }],
      [{ kind: 'rollers', count: 4, height: 0.6, spacing: 7.9 }],
      [],
      [],
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 6.4 }],
      [{ kind: 'step-up', deck: 4 }],
      [],
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 6.4 }],
    ],
  },
  {
    // Fast and open: big sweepers, a long start straight with the whip jump, a quick S on the far side
    name: 'Long Meadow MX',
    ...motocross,
    corners: [
      { x: -110, z: -105, radius: 28 },
      { x: 110, z: -110, radius: 30 },
      { x: 118, z: 20, radius: 25 },
      { x: 70, z: 60, radius: 22 },
      { x: 90, z: 115, radius: 20, insideBerm: true },
      { x: -40, z: 112, radius: 25 },
      { x: -60, z: 40, radius: 20 },
      { x: -115, z: 20, radius: 22, insideBerm: true },
    ],
    straights: [
      [
        // Whip jump: a tall, steep lip for hang time (about 2.5 s), and a long landing to come down crossed up on
        { kind: 'whip jump', takeoff: 4.5, lipDegrees: 40, gap: 38, landing: 6.5, landingDegrees: 36, landingBottomDegrees: 10, runUp: 15 },
        { kind: 'rollers', count: 3, height: 0.5, spacing: 7 },
      ],
      [{ kind: 'double' }],
      [],
      [],
      [{ kind: 'step-up' }],
      [{ kind: 'rollers', count: 2, height: 0.5, spacing: 7 }],
      [],
      [{ kind: 'rollers', count: 5, height: 0.6, spacing: 7.5 }],
    ],
  },
  {
    // Twistier: lots of direction changes at medium speed, with step-ups and rollers between them. Hilly: a
    // climb from the start up to the tabletop, rollers down off the top, a drop into the pit for the step-up,
    // a steep climb out to the big step-up, and rollers back down to the start
    name: 'Quarry MX',
    ...motocross,
    corners: [
      { x: -120, z: -60, radius: 16 },
      { x: -60, z: -115, radius: 15, height: 6 },
      { x: 40, z: -95, radius: 14, height: 6 },
      { x: 115, z: -115, radius: 15, insideBerm: true, height: 2 },
      { x: 112, z: -11, radius: 13, height: 2 },
      { x: 40, z: -35, radius: 13, height: -3 },
      { x: 30, z: 40, radius: 13, height: -3 },
      { x: 115, z: 55, radius: 14, height: -3 },
      { x: 118, z: 120, radius: 15, height: 2 },
      { x: -58, z: 112, radius: 14, height: 2 },
      { x: -50, z: 24, radius: 13 },
      { x: -118, z: 40, radius: 14, insideBerm: true },
    ],
    straights: [
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 7 }],
      [{ kind: 'tabletop' }],
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 7 }],
      [{ kind: 'double', lipDegrees: 24, takeoff: 1.6 }],
      [],
      [{ kind: 'rollers', count: 3, height: 0.6, spacing: 6 }],
      [{ kind: 'step-up', deck: 3 }],
      [],
      // The big one: a step-up hit in 3rd gear wide open, up onto a tall deck
      [{ kind: 'step-up', takeoff: 2.4, lipDegrees: 30, rise: 1.6, gap: 35, deck: 14, landingDegrees: 30, landingBottomDegrees: 12, runUp: 45 }],
      [{ kind: 'rollers', count: 3, height: 0.6, spacing: 7 }],
      [],
      [{ kind: 'double' }],
    ],
  },
  {
    // Stadium zig-zag: four lanes joined by flat 180s, back up the side to the start
    name: 'Harbor SX',
    ...supercross,
    corners: [
      { x: -85, z: -36, radius: 8 },
      { x: 65, z: -36, radius: 7, insideBerm: true },
      { x: 65, z: -18, radius: 7, insideBerm: true },
      { x: -62, z: -18, radius: 7 },
      { x: -62, z: 0, radius: 7 },
      { x: 65, z: 0, radius: 7, insideBerm: true },
      { x: 65, z: 18, radius: 7, insideBerm: true },
      { x: -85, z: 18, radius: 8 },
    ],
    straights: [
      [{ kind: 'triple', takeoff: 1.8, lipDegrees: 32, gap: 23, landing: 3.8, landingDegrees: 16, runUp: 12 }, { kind: 'tabletop' }],
      [],
      [{ kind: 'rhythm', count: 6, height: 0.7 }, { kind: 'double' }],
      [],
      [{ kind: 'whoops', count: 10, height: 0.45, spacing: 4.5 }, { kind: 'tabletop', deck: 18 }],
      [],
      [{ kind: 'step-up' }, { kind: 'double' }, { kind: 'rhythm', count: 4, height: 0.7 }],
      [],
    ],
  },
  {
    // A U through the middle with two left-handers, a long whoops lane down the right side
    name: 'Dome SX',
    ...supercross,
    corners: [
      { x: -80, z: -40, radius: 8 },
      { x: 70, z: -40, radius: 8, insideBerm: true },
      { x: 70, z: 30, radius: 8 },
      { x: 10, z: 30, radius: 7 },
      { x: 10, z: -12, radius: 7 },
      { x: -40, z: -12, radius: 7, insideBerm: true },
      { x: -40, z: 38, radius: 7 },
      { x: -80, z: 38, radius: 8 },
    ],
    straights: [
      [{ kind: 'triple', takeoff: 1.8, lipDegrees: 32, gap: 23, landing: 3.8, landingDegrees: 16, runUp: 12 }, { kind: 'rhythm', count: 5, height: 0.7 }],
      [{ kind: 'whoops', count: 7, height: 0.45, spacing: 4.5 }],
      [{ kind: 'rhythm', count: 3, height: 0.7 }],
      [],
      [],
      [],
      [],
      [{ kind: 'double' }],
    ],
  },
  {
    // Tight and mostly left-handed: a hairpin, a quick S, then a long sweep around the outside
    name: 'Night SX',
    ...supercross,
    corners: [
      { x: -80, z: -30, radius: 7 },
      { x: 55, z: -30, radius: 7, insideBerm: true },
      { x: 55, z: -12, radius: 7, insideBerm: true },
      { x: -5, z: -12, radius: 6 },
      { x: -5, z: 12, radius: 6 },
      { x: -45, z: 12, radius: 6 },
      { x: -45, z: 45, radius: 7 },
      { x: 80, z: 45, radius: 7, insideBerm: true },
      { x: 80, z: -55, radius: 7 },
      { x: -95, z: -55, radius: 7 },
    ],
    straights: [
      [{ kind: 'rhythm', count: 5, height: 0.7 }, { kind: 'tabletop' }],
      [],
      [{ kind: 'rollers', count: 3, height: 0.6, spacing: 6.5 }],
      [],
      [],
      [],
      [{ kind: 'triple', takeoff: 1.8, lipDegrees: 32, gap: 23, landing: 3.8, landingDegrees: 16, runUp: 10 }, { kind: 'rhythm', count: 4, height: 0.7 }],
      [{ kind: 'whoops', count: 10, height: 0.45, spacing: 4.5 }],
      [{ kind: 'step-on-off', runUp: 8 }, { kind: 'tabletop', deck: 19 }],
      [],
    ],
  },
];
