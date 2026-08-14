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

// The nearest chevron is solid and the furthest is faint, which is what gives
// the run its sense of receding. Faded by real distance rather than by position
// in the list, since the list scrolls past as the walker advances.
const NEAR_OPACITY = 0.95;
const FAR_OPACITY = 0.35;
const FULLY_SOLID_M = 3;
const FULLY_FADED_M = 14;

interface GroundChevronsProps {
  /** Every anchor the AR session projected this frame, of both kinds. */
  anchors: ProjectedAnchor[];
  color: string;
}

export function GroundChevrons({ anchors, color }: GroundChevronsProps) {
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
        // Furthest first, so nearer chevrons paint over the ones behind them
        // where the run doubles back on itself around a tight corner.
        .sort((a, b) => b.distance - a.distance),
    [anchors],
  );

  if (chevrons.length === 0) return null;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {chevrons.map((chevron) => (
        <Polygon
          key={chevron.index}
          points={toPoints(chevron.outline!)}
          fill={color}
          fillOpacity={opacityAt(chevron.distance)}
          // A dark edge, so the run stays legible over pale concrete as well
          // as dark asphalt.
          stroke="rgba(0,0,0,0.45)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      ))}
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
