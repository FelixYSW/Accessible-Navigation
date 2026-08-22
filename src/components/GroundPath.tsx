import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';
import type { ProjectedAnchor } from '../../modules/ar-geospatial';

// The Live View treatment, drawn on anchors rather than on assumptions: one
// continuous band painted along the route ahead, running away from the walker,
// following the pavement round a corner and following the ground up and down it.
//
// This replaced a run of separate chevrons. The chevrons were correct in
// principle and awkward in practice, because each was sized and faded on its
// own: every rule that varied with distance had to be made to agree across the
// joins between them, and the last one added - growing the far ones so they did
// not shrink to a hairline - left a visible pinch at whichever chevron happened
// to be nearest the camera, with bigger ones both ahead of it and behind. A
// walker standing in the middle of their own route saw it narrow at their feet
// and widen in both directions, which is not something any real marking does.
//
// A band has no parts, so there is nothing to disagree. It is one width in the
// world from end to end and narrows towards the horizon the way a painted line
// does. What the chevrons were carrying and a plain band is not - which way
// along it to walk - is given back by the triangles lying in it and by the
// travelling highlight, neither of which has to hold the guidance up on its own.
//
// As with the chevrons there is deliberately no geometry in this file. The
// polygons arrive already projected and already clipped from the native side,
// where the camera pose lives; re-deriving them here would mean drawing a frame
// late, and a frame late is exactly what looks like drift.

// The band is drawn twice over, which is what keeps it legible against both pale
// concrete and dark wet asphalt - any single outline colour disappears against
// one of them.
const HALO_WIDTH = 8;
const RIM_WIDTH = 2;

// Ground already covered, drawn in the way a route behind you is drawn on every
// map that bothers to draw it at all.
//
// Mostly invisible while walking forwards, which is not a reason to leave it
// out: it is what makes turning round intelligible. Glancing back at a junction
// otherwise shows a band running away in the direction you came from,
// indistinguishable from one telling you to go that way.
//
// Grey rather than a dimmed version of the guidance colour, because dimming is
// already what distance does to the far end of the live band - two meanings on
// one channel would make a long route ahead read as a route behind.
const WALKED_COLOR = '#9AA0A6';
const WALKED_NEAR_OPACITY = 0.5;
const WALKED_FAR_OPACITY = 0.32;

// Distance fade, applied as a gradient up the screen rather than per shape.
//
// It works because this is a band lying on the ground: on a ground plane,
// further away is always higher up the frame, so screen height stands in for
// distance exactly. Kept shallow - the far end is the part carrying the
// direction of the route, and fading it to a whisper would hide the very thing
// the band exists to show.
const NEAR_OPACITY = 0.95;
const FAR_OPACITY = 0.55;

// A brightening that travels from the walker outwards, one pass every cycle.
//
// It earns its place twice over: motion is what catches an eye that is busy
// watching the pavement, and a highlight moving *away* states the direction to
// walk without anything having to be read. Kept to brightness alone - nothing
// moves or changes size, so there is no parallax for the band to appear to swim
// in.
//
// Travelling up the screen for the same reason the fade runs that way. The band
// may bend and may climb, and a highlight following it would need the
// centreline; a horizontal front sweeping up the frame needs only the two
// numbers the polygon already gives us.
const WAVE_CYCLE_MS = 1900;
const WAVE_WIDTH = 0.22;
const WAVE_STRENGTH = 0.35;

// The direction triangles lying in the band.
//
// Drawn in white rather than in the guidance colour: they sit *on* a coloured
// band, and a marking has to differ from what it is marked on. Kept solid at
// every distance, with no fade of their own - they are already shrinking with
// distance under true perspective, and fading them as well would take the far
// ones out entirely.
const MARKER_FILL = 'rgba(255,255,255,0.92)';
const MARKER_EDGE = 'rgba(0,0,0,0.35)';
const MARKER_EDGE_WIDTH = 1;

interface GroundPathProps {
  /** Every anchor the AR session projected this frame, of all kinds. */
  anchors: ProjectedAnchor[];
  color: string;
}

export function GroundPath({ anchors, color }: GroundPathProps) {
  // Covered ground first, so that where the two bands meet under the walker the
  // live one is painted over the grey rather than under it.
  const paths = useMemo(
    () =>
      anchors
        .filter(
          (anchor) =>
            (anchor.kind === 'path' || anchor.kind === 'path-walked') &&
            anchor.visible &&
            anchor.outline !== undefined &&
            // Three corners is the least that can enclose an area. Below that
            // the native side has clipped the band down to nothing and there is
            // no shape left to draw.
            anchor.outline.length >= 6,
        )
        .sort((a, b) => Number(a.kind === 'path') - Number(b.kind === 'path')),
    [anchors],
  );

  if (paths.length === 0) return null;

  // Read at render rather than driven by an animation clock, because this
  // component already re-renders on every camera frame - the projected polygons
  // arrive that often. A second timer would add a dependency and a wake-up for
  // something the existing render loop gives away.
  const phase = (Date.now() % WAVE_CYCLE_MS) / WAVE_CYCLE_MS;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        {paths.map((path) => {
          const walked = path.kind === 'path-walked';
          const { top, bottom } = verticalExtent(path.outline!);
          return (
            <LinearGradient
              key={`fade${path.index}`}
              id={`fade${path.index}`}
              x1="0"
              y1={bottom}
              x2="0"
              y2={top}
              gradientUnits="userSpaceOnUse"
            >
              {fadeStops(walked ? undefined : phase, walked).map((stop, index) => (
                <Stop
                  key={index}
                  offset={stop.offset}
                  stopColor={walked ? WALKED_COLOR : color}
                  stopOpacity={stop.opacity}
                />
              ))}
            </LinearGradient>
          );
        })}
      </Defs>

      {paths.map((path) => (
        <React.Fragment key={path.index}>
          <Polygon
            points={toPoints(path.outline!)}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={HALO_WIDTH}
            strokeLinejoin="round"
          />
          <Polygon
            points={toPoints(path.outline!)}
            fill={`url(#fade${path.index})`}
            stroke="#ffffff"
            strokeOpacity={path.kind === 'path-walked' ? 0.4 : 0.85}
            strokeWidth={RIM_WIDTH}
            strokeLinejoin="round"
          />
          {/* Only on the live band. A triangle on covered ground would be
              pointing the way the walker has already gone. */}
          {path.kind === 'path' &&
            triangles(path.markers).map((points, index) => (
              <Polygon
                key={index}
                points={points}
                fill={MARKER_FILL}
                stroke={MARKER_EDGE}
                strokeWidth={MARKER_EDGE_WIDTH}
                strokeLinejoin="round"
              />
            ))}
        </React.Fragment>
      ))}
    </Svg>
  );
}

// The native side sends corners flattened to [x0, y0, x1, y1, ...], which is
// one array rather than an object per corner per frame at 60Hz.
function toPoints(outline: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < outline.length; i += 2) {
    pairs.push(`${outline[i].toFixed(1)},${outline[i + 1].toFixed(1)}`);
  }
  return pairs.join(' ');
}

// The markers arrive as one flat run of triangles, six numbers each.
function triangles(markers: number[] | undefined): string[] {
  if (!markers) return [];
  const shapes: string[] = [];
  for (let i = 0; i + 5 < markers.length; i += 6) {
    shapes.push(toPoints(markers.slice(i, i + 6)));
  }
  return shapes;
}

// How far up and down the screen the band reaches, which is what the gradient is
// anchored to. Taken from the polygon rather than from the viewport, so the fade
// spans the band actually on screen instead of being mostly spent on empty sky.
function verticalExtent(outline: number[]): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 1; i < outline.length; i += 2) {
    if (outline[i] < top) top = outline[i];
    if (outline[i] > bottom) bottom = outline[i];
  }
  // A band seen exactly edge-on has no height, and a gradient between two equal
  // points is undefined. One pixel apart is enough to keep it well formed.
  return { top, bottom: bottom > top ? bottom : top + 1 };
}

// The fade from near to far, with the travelling highlight folded into it.
//
// Both are the same gradient because they are the same axis, and one gradient
// with five stops costs a great deal less per frame than two stacked polygons.
// Offset 0 is the near end.
//
// A phase of undefined means no highlight, which is what covered ground gets:
// the sweep says "walk this way" and there is nowhere to walk back to.
function fadeStops(
  phase: number | undefined,
  walked: boolean,
): { offset: number; opacity: number }[] {
  const near = walked ? WALKED_NEAR_OPACITY : NEAR_OPACITY;
  const far = walked ? WALKED_FAR_OPACITY : FAR_OPACITY;
  const base = (offset: number) => near + (far - near) * offset;

  const stops = [
    { offset: 0, opacity: base(0) },
    { offset: 1, opacity: base(1) },
  ];

  if (phase === undefined) return stops;

  // The highlight runs off the far end and restarts at the near one rather than
  // wrapping. Wrapping would light both ends at once - they are a whole cycle
  // apart - which reads as a flicker rather than as a sweep.
  const centre = phase * (1 + WAVE_WIDTH * 2) - WAVE_WIDTH;
  for (const offset of [centre - WAVE_WIDTH, centre, centre + WAVE_WIDTH]) {
    if (offset <= 0 || offset >= 1) continue;
    const lift = offset === centre ? WAVE_STRENGTH : 0;
    stops.push({ offset, opacity: Math.min(1, base(offset) + lift) });
  }

  return stops.sort((a, b) => a.offset - b.offset);
}
