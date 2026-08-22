import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';

// The Live View treatment without an AR session behind it: one continuous band
// painted along the way ahead, leading away from the walker and curving into
// the turn as one comes up.
//
// It draws the same shape as the anchored band and differs entirely in where
// the shape comes from. That one is geometry inside the AR scene, built on
// points anchored to real coordinates, so it sits on one patch of ground and
// stays on it. This one is computed from a compass bearing, a guessed camera
// height and a measured tilt, which puts it in roughly the right direction and
// lets it swim as the magnetometer wanders.
//
// Drawing the same shape in both is the point. The two treatments swap over
// mid-walk as localisation comes and goes, and a change of *form* at that moment
// would read as the guidance itself changing rather than as the same guidance
// from a different source. Only its steadiness differs, which is honest: that is
// the only thing that actually did change.
//
// The band is built by projecting real ground positions through a pinhole camera
// model rather than by scaling a sprite, so it is foreshortened the way anything
// lying flat on the floor is - narrower the further off it gets. A scaled sprite
// reads as a sticker on the lens; this reads as paint on the ground.
//
// The tilt of the phone is measured (see the device-motion listener on the AR
// screen) and passed in, which is what keeps the band on the ground rather than
// glued to the middle of the screen: point the phone up at the buildings and the
// pavement - and the band on it - slides off the bottom of the frame, exactly as
// it does in life.
//
// Height and field of view are still assumed, because this path deliberately
// runs a 2D overlay over a plain camera preview rather than an AR session
// (Investigation Report, 2.2.2 Sub-Domain 3) and there is no pose tracking to
// measure them with. So the band shows which way to go; it is not a survey mark,
// and a walker reads its direction rather than the exact paving slab it lands on.
const CAMERA_HEIGHT_M = 1.4;
const CAMERA_FOV_DEG = 62;

// Used until the first device-motion reading arrives - roughly how a phone is
// held when walking with it.
export const DEFAULT_CAMERA_PITCH_DEG = 30;

// How far ahead the band is drawn, in metres. Kept short: the ground compresses
// hard towards the horizon, and past six metres a band lying on it has narrowed
// to a few points of screen - correct, and useless. A little shorter than the
// anchored band's eight metres, and deliberately: this one is aimed by a
// compass, and the further it reaches the wider a bearing error spreads it.
const PATH_LENGTH_M = 6.0;

// How wide the band is, in metres. The same width the anchored band uses (see
// GroundPath.widthM in the Swift view), because the two swap over mid-walk and a
// change of width at that moment would read as the guidance changing rather than
// as the same guidance from a different source.
const PATH_WIDTH_M = 0.9;

// How far the path takes to swing into a turn, centred on the turn point. A
// walker rounds a corner rather than pivoting on it, and a hard corner would put
// a kink in the band where a real one has a curve.
const BEND_METERS = 2.5;

// Step used to walk the path out from the walker.
//
// This is now the band's own resolution rather than just the accuracy of the
// bend, since every step becomes a pair of edge points. Small enough that a
// curve reads as a curve, coarse enough that six metres is thirty steps and not
// three hundred.
const PATH_STEP_M = 0.2;

// The band is cut off this far in front of the camera - past that a point is at
// or behind the lens, where the projection stops meaning anything and stretches
// to the size of the screen.
//
// Cut rather than dropped, exactly as on the native side: the walker is standing
// on the near end of this band, so on any bend that brings the path back towards
// them, dropping whole steps would punch holes in it.
const MIN_DEPTH_M = 0.45;

// The band is drawn twice over, matching the anchored one: a heavy dark halo
// underneath, then the fill with a bright rim on top. One outline colour always
// loses against one of the two grounds this has to work on - pale concrete and
// dark wet asphalt - so it gets both.
const HALO_WIDTH = 8;
const RIM_WIDTH = 2;

// The near end is stronger and the far end fainter, which is what gives the band
// its sense of receding. The same pair the anchored band uses.
//
// Well short of opaque, for the reason the anchored one is: a solid sheet of
// colour laid over the pavement hides exactly what a walker most needs to see -
// the kerb, the puddle, the broken slab. That argument is stronger here, not
// weaker. This band is aimed by a magnetometer, so it is the one more likely to
// be lying over ground the route does not actually cross.
const NEAR_OPACITY = 0.32;
const FAR_OPACITY = 0.22;

interface GroundArrowsProps {
  /** Which way the route goes from where the walker is standing, relative to
   *  the way they are facing: 0 is straight ahead, positive is to the right.
   *  The band sets off in this direction immediately - it is where the route
   *  is, not where the phone happens to be pointed. Undefined before the first
   *  fix, when there is nothing to point at. */
  bearingToNext: number | undefined;
  /** How far ahead the next route point is, in metres, and which way the route
   *  runs after it - so the band bends at the corner rather than at the walker.
   *  The bend only comes into view as they approach it, since the band only
   *  reaches a few metres out. */
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

  const band = useMemo(() => {
    if (bearingToNext === undefined) return undefined;
    return buildBand(
      bearingToNext,
      metersToNext ?? Infinity,
      bearingAfterNext ?? bearingToNext,
      pitchDegrees,
      width,
      height,
    );
  }, [bearingToNext, metersToNext, bearingAfterNext, pitchDegrees, width, height]);

  if (!band) return null;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient
          id="ground-arrows-fade"
          x1="0"
          y1={band.bottom}
          x2="0"
          y2={band.top}
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset={0} stopColor={color} stopOpacity={NEAR_OPACITY} />
          <Stop offset={1} stopColor={color} stopOpacity={FAR_OPACITY} />
        </LinearGradient>
      </Defs>

      <Polygon
        points={band.points}
        fill="none"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth={HALO_WIDTH}
        strokeLinejoin="round"
      />
      <Polygon
        points={band.points}
        fill="url(#ground-arrows-fade)"
        stroke="#ffffff"
        strokeOpacity={0.85}
        strokeWidth={RIM_WIDTH}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface PathPose {
  x: number;
  z: number;
  heading: number;
}

interface Band {
  points: string;
  /** Where the band reaches on screen, which is what the fade is anchored to. */
  top: number;
  bottom: number;
}

// The band as a single closed polygon: down one edge and back up the other.
//
// Undefined when there is nothing left to draw, which on this path means the
// walker is facing so far from the route that all of it is behind the lens.
function buildBand(
  bearingToNextDegrees: number,
  metersToNext: number,
  bearingAfterNextDegrees: number,
  pitchDegrees: number,
  width: number,
  height: number,
): Band | undefined {
  const poses = walkPath(
    toRadians(bearingToNextDegrees),
    metersToNext,
    toRadians(bearingAfterNextDegrees),
  );
  // Focal length in pixels, from the field of view the preview is showing.
  const focal = width / 2 / Math.tan(toRadians(CAMERA_FOV_DEG) / 2);
  const pitch = toRadians(pitchDegrees);
  const half = PATH_WIDTH_M / 2;

  const leftEdge: { x: number; y: number }[] = [];
  const rightEdge: { x: number; y: number }[] = [];

  for (const pose of clipToCamera(poses, pitch)) {
    // The band's width runs across the path, so it is the heading turned a
    // quarter turn - and it follows the bend, since each pose carries its own.
    const acrossX = Math.cos(pose.heading) * half;
    const acrossZ = -Math.sin(pose.heading) * half;

    const left = projectGroundPoint(
      pose.x - acrossX,
      pose.z - acrossZ,
      focal,
      pitch,
      width,
      height,
    );
    const right = projectGroundPoint(
      pose.x + acrossX,
      pose.z + acrossZ,
      focal,
      pitch,
      width,
      height,
    );
    // One edge behind the lens while the other is in front happens only where
    // the band is nearly edge-on, and there is no sensible half-width to draw.
    if (!left || !right) continue;

    leftEdge.push(left);
    rightEdge.push(right);
  }

  if (leftEdge.length < 2) return undefined;

  const corners = [...leftEdge, ...rightEdge.reverse()];
  let top = Infinity;
  let bottom = -Infinity;
  for (const corner of corners) {
    if (corner.y < top) top = corner.y;
    if (corner.y > bottom) bottom = corner.y;
  }

  return {
    points: corners.map((corner) => `${corner.x.toFixed(1)},${corner.y.toFixed(1)}`).join(' '),
    top,
    // A band seen exactly edge-on has no height, and a gradient between two
    // equal points is undefined.
    bottom: bottom > top ? bottom : top + 1,
  };
}

// The path with everything at or behind the lens removed, and the step that
// straddles the near plane cut at it.
//
// Depth here is the same quantity `projectGroundPoint` divides by, so a pose
// that survives this is one that projects.
function clipToCamera(poses: PathPose[], pitch: number): PathPose[] {
  const depthOf = (pose: PathPose) =>
    CAMERA_HEIGHT_M * Math.sin(pitch) + pose.z * Math.cos(pitch);

  const kept: PathPose[] = [];

  for (let i = 0; i < poses.length; i += 1) {
    const here = poses[i];
    const depth = depthOf(here);
    if (depth >= MIN_DEPTH_M) {
      kept.push(here);
      continue;
    }

    // Crossing into view: interpolate to the exact near plane, so the band
    // starts at the bottom of the frame rather than a step inside it.
    const next = poses[i + 1];
    if (!next) continue;
    const nextDepth = depthOf(next);
    if (nextDepth < MIN_DEPTH_M) continue;

    const t = (MIN_DEPTH_M - depth) / (nextDepth - depth);
    kept.push({
      x: here.x + (next.x - here.x) * t,
      z: here.z + (next.z - here.z) * t,
      // Not interpolated. Over one 20cm step the heading barely moves, and
      // taking the one ahead keeps the band's first edge square to the
      // direction it is about to run in.
      heading: next.heading,
    });
  }

  return kept;
}

// The path ahead, sampled every step out to the full length.
//
// Walked out step by step rather than solved in closed form, because the
// heading changes along the way: it starts off aimed at the next route point,
// eases into the onward direction across `BEND_METERS` around that point, and
// each step's position depends on where the previous one ended up.
function walkPath(bearingToNext: number, turnAt: number, bearingAfterNext: number): PathPose[] {
  const sampled: PathPose[] = [];

  let x = 0;
  let z = 0;

  for (let travelled = 0; travelled <= PATH_LENGTH_M; travelled += PATH_STEP_M) {
    // Interpolated between the two legs rather than multiplied up from zero:
    // leg one is already off at an angle if the walker is not facing along the
    // route, and starting the band straight ahead of the camera would point
    // them down whatever they happen to be facing instead of down the route.
    const heading = interpolateAngle(
      bearingToNext,
      bearingAfterNext,
      bendProgress(travelled, turnAt),
    );

    sampled.push({ x, z, heading });

    x += Math.sin(heading) * PATH_STEP_M;
    z += Math.cos(heading) * PATH_STEP_M;
  }

  return sampled;
}

// Blends two headings the short way round, so a bend from +170deg to -170deg
// swings 20deg through the back rather than 340deg through the front.
function interpolateAngle(from: number, to: number, progress: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * progress;
}

// How far into the turn the path is at a given distance: 0 before the bend
// starts, 1 once it is complete, smoothly in between so the band swings round
// rather than snapping to the new heading.
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
// The camera sits `CAMERA_HEIGHT_M` above the ground looking `pitch` down, so
// the ground point is rotated into camera space by that pitch and then divided
// through by its depth, which is what does the foreshortening.
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

