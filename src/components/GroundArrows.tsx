import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

// The Live View treatment: a run of chevrons painted onto the pavement ahead,
// leading away from the walker and curving into the turn as one comes up.
//
// They are drawn by projecting real ground positions through a pinhole camera
// model rather than by scaling a sprite, so each chevron is foreshortened the
// way something lying flat on the floor is - shallower and narrower the
// further off it is. A scaled sprite reads as a sticker on the lens; this
// reads as paint on the ground, which is the point of the view.
//
// The tilt of the phone is measured (see the device-motion listener on the AR
// screen) and passed in, which is what keeps the chevrons on the ground rather
// than glued to the middle of the screen: point the phone up at the buildings
// and the pavement - and the chevrons on it - slides off the bottom of the
// frame, exactly as it does in life.
//
// Height and field of view are still assumed, because this app deliberately
// runs a 2D overlay over a plain camera preview rather than an AR session
// (Investigation Report, 2.2.2 Sub-Domain 3) and there is no pose tracking to
// measure them with. So the chevrons show which way to go; they are not survey
// marks, and a walker reads their direction rather than the exact paving slab
// they land on.
const CAMERA_HEIGHT_M = 1.4;
const CAMERA_FOV_DEG = 62;

// Used until the first device-motion reading arrives - roughly how a phone is
// held when walking with it.
export const DEFAULT_CAMERA_PITCH_DEG = 30;

// Where the chevrons sit along the path, in metres ahead. Kept close and few:
// the ground compresses hard towards the horizon, and a chevron out at 13m
// projects to a 2px sliver - correct, and useless. These four span roughly
// 175px of screen at the front down to 60px at the back on a 402pt phone,
// which reads as a receding run of large floor markings.
const ARROW_DISTANCES_M = [1.0, 2.2, 3.5, 5.0];

// One chevron, in metres, in its own frame: +y is the way it points, x is
// across the path. Matches the anchored chevrons exactly - the two treatments
// swap over mid-walk as localisation comes and goes, and a change of size at
// that moment would read as the guidance itself changing rather than as the
// same guidance from a different source.
const CHEVRON_M: [number, number][] = [
  [0, 0.55],
  [0.65, -0.2],
  [0.65, -0.55],
  [0, 0.2],
  [-0.65, -0.55],
  [-0.65, -0.2],
];

// How far the path takes to swing into a turn, centred on the turn point. A
// walker rounds a corner rather than pivoting on it, and a hard corner puts
// the chevrons past it edge-on to the camera, where they collapse to slivers.
const BEND_METERS = 2.5;

// Step used to walk the path out from the walker. Small enough that the curve
// is smooth at the distances above, coarse enough to stay cheap on a heading
// update.
const PATH_STEP_M = 0.2;

// A chevron is drawn only while every corner of it is this far in front of the
// camera - past that it is at or behind the lens, where the projection stops
// meaning anything and stretches to the size of the screen.
const MIN_DEPTH_M = 0.6;

// The nearest chevron is solid and the furthest is faint, which is what gives
// the run its sense of receding.
const NEAR_OPACITY = 0.95;
const FAR_OPACITY = 0.62;

interface GroundArrowsProps {
  /** Which way the route goes from where the walker is standing, relative to
   *  the way they are facing: 0 is straight ahead, positive is to the right.
   *  The chevrons set off in this direction immediately - it is where the
   *  route is, not where the phone happens to be pointed. Undefined before the
   *  first fix, when there is nothing to point at. */
  bearingToNext: number | undefined;
  /** How far ahead the next route point is, in metres, and which way the route
   *  runs after it - so the run bends at the corner rather than at the walker.
   *  The bend only comes into view as they approach it, since the chevrons
   *  only reach a few metres out. */
  metersToNext: number | undefined;
  bearingAfterNext: number | undefined;
  /** How far the phone is tilted down from level, in degrees. */
  pitchDegrees: number;
  color: string;
}

export function GroundArrows({
  bearingToNext,
  metersToNext,
  bearingAfterNext,
  pitchDegrees,
  color,
}: GroundArrowsProps) {
  const { width, height } = useWindowDimensions();

  const chevrons = useMemo(() => {
    if (bearingToNext === undefined) return [];
    return buildChevrons(
      bearingToNext,
      metersToNext ?? Infinity,
      bearingAfterNext ?? bearingToNext,
      pitchDegrees,
      width,
      height,
    );
  }, [bearingToNext, metersToNext, bearingAfterNext, pitchDegrees, width, height]);

  if (chevrons.length === 0) return null;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Drawn twice, like the anchored chevrons: a heavy dark halo underneath
          and a bright rim on top. One outline colour always loses against one
          of the two grounds this has to work on - pale concrete and dark wet
          asphalt - so it gets both. */}
      {chevrons.map((chevron, index) => (
        <React.Fragment key={index}>
          <Polygon
            points={chevron.points}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={7}
            strokeLinejoin="round"
          />
          <Polygon
            points={chevron.points}
            fill={color}
            fillOpacity={chevron.opacity}
            stroke="#ffffff"
            strokeOpacity={0.85}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </React.Fragment>
      ))}
    </Svg>
  );
}

interface PathPose {
  x: number;
  z: number;
  heading: number;
}

function buildChevrons(
  bearingToNextDegrees: number,
  metersToNext: number,
  bearingAfterNextDegrees: number,
  pitchDegrees: number,
  width: number,
  height: number,
): { points: string; opacity: number }[] {
  const poses = walkPath(
    toRadians(bearingToNextDegrees),
    metersToNext,
    toRadians(bearingAfterNextDegrees),
  );
  // Focal length in pixels, from the field of view the preview is showing.
  const focal = width / 2 / Math.tan(toRadians(CAMERA_FOV_DEG) / 2);
  const pitch = toRadians(pitchDegrees);

  const built: { points: string; opacity: number }[] = [];

  poses.forEach((pose, index) => {
    const projected = CHEVRON_M.map(([across, ahead]) => {
      // Corner position on the ground, in the walker's frame: the chevron's
      // own frame turned to face the way the path runs where it sits.
      const x = pose.x + across * Math.cos(pose.heading) + ahead * Math.sin(pose.heading);
      const z = pose.z - across * Math.sin(pose.heading) + ahead * Math.cos(pose.heading);
      return projectGroundPoint(x, z, focal, pitch, width, height);
    });

    // One corner behind the lens takes the whole chevron with it: a partly
    // projected polygon is not a smaller chevron, it is a torn one.
    if (projected.some((point) => point === null)) return;

    const fade = index / Math.max(1, ARROW_DISTANCES_M.length - 1);
    built.push({
      points: projected.map((point) => `${point!.x.toFixed(1)},${point!.y.toFixed(1)}`).join(' '),
      opacity: NEAR_OPACITY + (FAR_OPACITY - NEAR_OPACITY) * fade,
    });
  });

  return built;
}

// The path ahead, sampled at each chevron's distance.
//
// Walked out step by step rather than solved in closed form, because the
// heading changes along the way: it starts off aimed at the next route point,
// eases into the onward direction across `BEND_METERS` around that point, and
// each step's position depends on where the previous one ended up.
function walkPath(bearingToNext: number, turnAt: number, bearingAfterNext: number): PathPose[] {
  const sampled: PathPose[] = [];
  const furthest = ARROW_DISTANCES_M[ARROW_DISTANCES_M.length - 1];
  let next = 0;

  let x = 0;
  let z = 0;

  for (let travelled = 0; travelled <= furthest + PATH_STEP_M; travelled += PATH_STEP_M) {
    // Interpolated between the two legs rather than multiplied up from zero:
    // leg one is already off at an angle if the walker isn't facing along the
    // route, and starting the run straight ahead of the camera would point
    // them down whatever they happen to be facing instead of down the route.
    const heading = interpolateAngle(
      bearingToNext,
      bearingAfterNext,
      bendProgress(travelled, turnAt),
    );

    while (next < ARROW_DISTANCES_M.length && travelled >= ARROW_DISTANCES_M[next]) {
      sampled.push({ x, z, heading });
      next += 1;
    }
    if (next >= ARROW_DISTANCES_M.length) break;

    x += Math.sin(heading) * PATH_STEP_M;
    z += Math.cos(heading) * PATH_STEP_M;
  }

  return sampled;
}

// How far into the turn the path is at a given distance: 0 before the bend
// starts, 1 once it is complete, smoothly in between so the chevrons swing
// round rather than snapping to the new heading.
// Blends two headings the short way round, so a bend from +170deg to -170deg
// swings 20deg through the back rather than 340deg through the front.
function interpolateAngle(from: number, to: number, progress: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * progress;
}

function bendProgress(travelled: number, turnAt: number): number {
  const t = (travelled - (turnAt - BEND_METERS / 2)) / BEND_METERS;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Smoothstep: flat at both ends, so the curve has no corner at either.
  return t * t * (3 - 2 * t);
}

// A point on the ground, in metres relative to the walker, to a pixel on the
// preview. Null when it falls behind the lens.
//
// The camera sits `CAMERA_HEIGHT_M` above the ground looking `CAMERA_PITCH_DEG`
// down, so the ground point is rotated into camera space by that pitch and
// then divided through by its depth, which is what does the foreshortening.
function projectGroundPoint(
  x: number,
  z: number,
  focal: number,
  pitch: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const depth = CAMERA_HEIGHT_M * Math.sin(pitch) + z * Math.cos(pitch);
  if (depth < MIN_DEPTH_M) return null;

  const below = CAMERA_HEIGHT_M * Math.cos(pitch) - z * Math.sin(pitch);

  return {
    x: width / 2 + (focal * x) / depth,
    y: height / 2 + (focal * below) / depth,
  };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
