// The tracks. Each is a closed loop of corner points (ridden in order, x to the right and z toward the
// bottom of the map, so a right-hander turns from +X toward +Z) and the features on each straight.
// straights[i] runs from corner i to corner i+1. Jumps without sizes are sized for their run-up speed.
import type { TrackDesign } from './track.ts';

const motocross = { style: 'motocross', landingRoom: 8, cornerClearance: 14, maxDesignSpeed: 21, maxJumpHeight: 4.5 } as const;
// Supercross jumps come right out of the turns and sit close together
const supercross = { style: 'supercross', landingRoom: 4, cornerClearance: 10, maxDesignSpeed: 16, maxJumpHeight: 3.2 } as const;

export const trackDesigns: TrackDesign[] = [
  {
    // The original loop: long top straight with the big double, a hairpin, an S through the middle
    name: 'Ridgeback MX',
    ...motocross,
    corners: [
      { x: -106, z: -106, radius: 14 },
      { x: 100, z: -106, radius: 12 },
      { x: 106, z: 25, radius: 9 },
      { x: 31, z: 28, radius: 10 },
      { x: 30, z: 112, radius: 8 },
      { x: 5, z: 112, radius: 8 },
      { x: 0, z: 56, radius: 10 },
      { x: -69, z: 56, radius: 10 },
      { x: -69, z: -25, radius: 10 },
      { x: -106, z: -25, radius: 10 },
    ],
    straights: [
      [
        { kind: 'tabletop' },
        { kind: 'big double', takeoff: 2.6, lipDegrees: 30, gap: 22, landing: 4.2, landingDegrees: 13, runUp: 37 },
      ],
      [{ kind: 'rollers', count: 2, height: 0.6, spacing: 7.4 }, { kind: 'tabletop' }],
      [{ kind: 'step-up', deck: 2.5 }],
      [{ kind: 'rollers', count: 4, height: 0.6, spacing: 7.9 }],
      [],
      [],
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 6.4 }],
      [{ kind: 'step-up' }],
      [],
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 6.4 }],
    ],
  },
  {
    // Fast and open: big sweepers, a long start straight with a big double, a quick S on the far side
    name: 'Long Meadow MX',
    ...motocross,
    corners: [
      { x: -110, z: -105, radius: 28 },
      { x: 110, z: -110, radius: 30 },
      { x: 118, z: 20, radius: 25 },
      { x: 70, z: 60, radius: 22 },
      { x: 90, z: 115, radius: 20 },
      { x: -40, z: 112, radius: 25 },
      { x: -60, z: 40, radius: 20 },
      { x: -115, z: 20, radius: 22 },
    ],
    straights: [
      [
        { kind: 'big double', takeoff: 2.6, lipDegrees: 30, gap: 24, landing: 4.2, landingDegrees: 13, runUp: 40 },
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
    // Twistier: lots of direction changes at medium speed, with step-ups and rollers between them
    name: 'Quarry MX',
    ...motocross,
    corners: [
      { x: -120, z: -60, radius: 16 },
      { x: -60, z: -115, radius: 15 },
      { x: 40, z: -95, radius: 14 },
      { x: 115, z: -115, radius: 15 },
      { x: 112, z: -20, radius: 13 },
      { x: 40, z: -35, radius: 13 },
      { x: 30, z: 40, radius: 13 },
      { x: 115, z: 55, radius: 14 },
      { x: 100, z: 118, radius: 15 },
      { x: -30, z: 100, radius: 14 },
      { x: -50, z: 30, radius: 13 },
      { x: -118, z: 40, radius: 14 },
    ],
    straights: [
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 7 }],
      [{ kind: 'tabletop' }],
      [{ kind: 'rollers', count: 3, height: 0.5, spacing: 7 }],
      [{ kind: 'double', lipDegrees: 24, takeoff: 1.6 }],
      [],
      [{ kind: 'rollers', count: 3, height: 0.6, spacing: 7 }],
      [{ kind: 'step-up', deck: 3 }],
      [],
      [{ kind: 'step-up' }, { kind: 'rollers', count: 3, height: 0.5, spacing: 7 }],
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
      { x: 65, z: -36, radius: 7 },
      { x: 65, z: -18, radius: 7 },
      { x: -62, z: -18, radius: 7 },
      { x: -62, z: 0, radius: 7 },
      { x: 65, z: 0, radius: 7 },
      { x: 65, z: 18, radius: 7 },
      { x: -85, z: 18, radius: 8 },
    ],
    straights: [
      [{ kind: 'triple', takeoff: 1.8, lipDegrees: 32, gap: 15, landing: 3.4, landingDegrees: 16, runUp: 12 }, { kind: 'tabletop' }],
      [],
      [{ kind: 'rhythm', count: 6, height: 0.7 }, { kind: 'double' }],
      [],
      [{ kind: 'whoops', count: 10, height: 0.45, spacing: 4.5 }, { kind: 'tabletop' }],
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
      { x: 70, z: -40, radius: 8 },
      { x: 70, z: 30, radius: 8 },
      { x: 10, z: 30, radius: 7 },
      { x: 10, z: -12, radius: 7 },
      { x: -40, z: -12, radius: 7 },
      { x: -40, z: 32, radius: 7 },
      { x: -80, z: 32, radius: 8 },
    ],
    straights: [
      [{ kind: 'triple', takeoff: 1.8, lipDegrees: 32, gap: 15, landing: 3.4, landingDegrees: 16, runUp: 12 }, { kind: 'rhythm', count: 5, height: 0.7 }],
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
      { x: 55, z: -30, radius: 7 },
      { x: 55, z: -12, radius: 7 },
      { x: -5, z: -12, radius: 6 },
      { x: -5, z: 12, radius: 6 },
      { x: -45, z: 12, radius: 6 },
      { x: -45, z: 45, radius: 7 },
      { x: 80, z: 45, radius: 7 },
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
      [{ kind: 'triple', takeoff: 1.8, lipDegrees: 32, gap: 15, landing: 3.4, landingDegrees: 16, runUp: 20 }, { kind: 'rhythm', count: 4, height: 0.7 }],
      [{ kind: 'whoops', count: 10, height: 0.45, spacing: 4.5 }],
      [{ kind: 'step-up' }, { kind: 'double' }, { kind: 'tabletop' }],
      [],
    ],
  },
];
