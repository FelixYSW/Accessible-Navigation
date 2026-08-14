import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import type { ProjectedAnchor } from '../../modules/ar-geospatial';

// The Live View treatment, drawn on anchors rather than on assumptions: a run
// of chevrons painted onto the pavement ahead, leading away from the walker and
// following the route round a corner.
//
// This is the counterpart to GroundArrows and replaces it wherever ARCore has
// localised. The two draw the same shape and differ entirely in where the shape
// comes from. GroundArrows computes it from a compass bearing, a guessed camera
// height and a measured tilt, which puts the chevrons in roughly the right
// direction and lets them swim as the magnetometer wanders. Here every corner
// has already been projected natively from a point anchored to real
// coordinates, so a chevron sits on one patch of ground and stays on it while
// the phone moves - which is the whole reason for the AR session.
//
// So there is deliberately no geometry in this file. Handing the maths back to
// JS would mean re-deriving the camera pose a frame late, and a frame late is
// exactly what looks like drift.

// Each chevron is drawn twice: a heavy dark halo underneath, then the coloured
// face with a bright rim on top. One stroke cannot do this job, because the run
// has to stay legible against both pale concrete and dark wet asphalt, and any
// single outline colour disappears against one of them.
const HALO_WIDTH = 7;
const RIM_WIDTH = 2;

// Distance fade, which is what gives the run its sense of receding. Kept much
// shallower than a natural falloff would be: the far chevrons are the ones
// carrying the direction of the route, so fading them to a whisper would hide
// the very thing the run exists to show.
const NEAR_OPACITY = 0.95;
const FAR_OPACITY = 0.62;
const FULLY_SOLID_M = 3;
const FULLY_FADED_M = 14;

// A brightening that travels from the walker outwards, one pass every cycle.
//
// It earns its place twice over: motion is what catches an eye that is busy
// watching the pavement, and a wave moving *away* states the direction to walk
// without any glyph having to be read. Kept to brightness alone - nothing moves
// or changes size, so there is no parallax for the run to appear to swim in.
const WAVE_CYCLE_MS = 1700;
const WAVE_SPREAD = 0.45;
const WAVE_STRENGTH = 0.28;

interface GroundChevronsProps {
  /** Every anchor the AR session projected this frame, of both kinds. */
  anchors: ProjectedAnchor[];
  color: string;
}

export function GroundChevrons({ anchors, color }: GroundChevronsProps) {
  // Near to far. The wave is phased along this order, and the painting order is
  // its reverse so nearer chevrons cover the ones behind them where the run
  // doubles back around a tight corner.
  const chevrons = useMemo(
    () =>
      anchors
        .filter(
          (anchor) =>
            anchor.kind === 'geospatial' &&
            anchor.visible &&
            anchor.outline !== undefined &&
            anchor.outline.length >= 6,
        )
        .sort((a, b) => a.distance - b.distance),
    [anchors],
  );

  if (chevrons.length === 0) return null;

  // Read at render rather than driven by an animation clock, because this
  // component already re-renders on every camera frame - the anchor positions
  // arrive that often. A second timer would add a dependency and a wake-up for
  // something the existing render loop gives away.
  const phase = (Date.now() % WAVE_CYCLE_MS) / WAVE_CYCLE_MS;
  const lastIndex = Math.max(1, chevrons.length - 1);

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {chevrons
        .map((chevron, index) => {
          const points = toPoints(chevron.outline!);
          const opacity = Math.min(
            1,
            opacityAt(chevron.distance) + waveAt(index / lastIndex, phase) * WAVE_STRENGTH,
          );

          return (
            <React.Fragment key={chevron.index}>
              <Polygon
                points={points}
                fill="none"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={HALO_WIDTH}
                strokeLinejoin="round"
              />
              <Polygon
                points={points}
                fill={color}
                fillOpacity={opacity}
                stroke="#ffffff"
                strokeOpacity={0.85}
                strokeWidth={RIM_WIDTH}
                strokeLinejoin="round"
              />
            </React.Fragment>
          );
        })
        .reverse()}
    </Svg>
  );
}

// The native side sends corners flattened to [x0, y0, x1, y1, ...], which is
// one array rather than six objects per chevron per frame at 60Hz.
function toPoints(outline: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < outline.length; i += 2) {
    pairs.push(`${outline[i].toFixed(1)},${outline[i + 1].toFixed(1)}`);
  }
  return pairs.join(' ');
}

function opacityAt(distance: number): number {
  const fade = (distance - FULLY_SOLID_M) / (FULLY_FADED_M - FULLY_SOLID_M);
  const clamped = Math.min(1, Math.max(0, fade));
  return NEAR_OPACITY + (FAR_OPACITY - NEAR_OPACITY) * clamped;
}

// How lit a chevron is, given where it sits along the run and where the wave
// front has got to.
//
// The brightest point sits exactly on the front and fades off *behind* it,
// towards the walker, so the highlight reads as something moving away rather
// than as a band with an edge at each end.
//
// Deliberately not wrapped around the ends. Taking the distance modulo one
// would light the far chevron at the same instant as the near one, since the
// two are a whole cycle apart - two bright spots at once, which reads as a
// flicker instead of a sweep. Letting it run off the end and restart is what a
// sweep actually does.
function waveAt(position: number, phase: number): number {
  const trail = phase - position;
  if (trail < 0 || trail >= WAVE_SPREAD) return 0;
  return 0.5 * (1 + Math.cos((trail / WAVE_SPREAD) * Math.PI));
}
