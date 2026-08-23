import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

// The Live View treatment without an AR session behind it: one continuous band
// painted along the way ahead, leading away from the walker and curving into
// the turn as one comes up.
//
// It draws the same shape as the anchored guidance and differs entirely in
// where the shape comes from. That one is geometry inside the AR scene, built
// on points anchored to real coordinates, so it sits on one patch of ground
// and stays on it. This one is computed from a compass bearing, a guessed
// camera height and a measured tilt, which puts it in roughly the right
// direction and lets it swim as the magnetometer wanders.
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

// How far ahead the chevrons are drawn, in metres.
//
// This used to be six, because past that a band ninety centimetres across had
// narrowed to a few points of screen. A chevron eight metres across is still
// legible at eighteen.
//
// Reaching further is only defensible *because* they are wide. This path is
// aimed by a magnetometer, and a ten-degree bearing error puts the far end of
// an eighteen-metre run three metres off to the side - which a chevron eight
// metres across still covers, and a narrow band would not have.
const PATH_LENGTH_M = 18;

// The chevron, in metres: how far it spans, how thick its arms are drawn, and
// how far its point reaches forward as a fraction of its span.
//
// The same shape the anchored guidance uses, because the two swap over mid-walk
// and a change of *form* at that moment would read as the guidance itself
// changing rather than as the same guidance from a different source. Only its
// steadiness differs, which is honest: that is the only thing that did change.
//
// Fixed at the wide end of the anchored version's range rather than measured.
// There is nothing here to measure it from - no pose, no accuracy figure, no
// offset from a route line - and this is the *less* certain of the two paths,
// so the wide end is the honest end to sit at.
const CHEVRON_WIDTH_M = 8;
const CHEVRON_ARM_M = 0.34;
const CHEVRON_SWEEP_FRACTION = 0.35;

// Where the first one sits and how far apart they are. Far enough out that the
// nearest is not under the walker's own feet, which is the one place a marker
// on the ground says nothing.
const CHEVRON_FIRST_M = 4;
const CHEVRON_SPACING_M = 6;

// The thinnest an arm is drawn, whatever perspective says. A stroke below a
// couple of points disappears into the camera's own noise.
const MIN_STROKE_PX = 2.5;

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
      {/* Three passes per chevron, widest first, matching the three strips the
          anchored version builds in 3D: a dark halo, a white rim, then the
          colour. Not decoration - any single outline colour disappears against
          one of the two grounds this has to work on, pale concrete and dark wet
          asphalt, so it gets both.

          Round joins and caps because the point of the V is a real corner and
          the arm ends are real ends; mitred joins on a stroke this thick spike
          out past the shape at the point. */}
      {chevrons.map((chevron, index) => (
        <React.Fragment key={index}>
          <Polyline
            points={chevron.points}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={chevron.stroke + HALO_WIDTH}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Polyline
            points={chevron.points}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.85}
            strokeWidth={chevron.stroke + RIM_WIDTH}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Polyline
            points={chevron.points}
            fill="none"
            stroke={color}
            strokeOpacity={chevron.opacity}
            strokeWidth={chevron.stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
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

interface Chevron {
  /** The three corners on screen, `x,y x,y x,y`, first arm tip to last. */
  points: string;
  /** How thick to draw the arms here, in pixels. */
  stroke: number;
  opacity: number;
}

// The chevrons ahead, each as three corners on screen.
//
// Empty when there is nothing left to draw, which on this path means the walker
// is facing so far from the route that all of it is behind the lens.
function buildChevrons(
  bearingToNextDegrees: number,
  metersToNext: number,
  bearingAfterNextDegrees: number,
  pitchDegrees: number,
  width: number,
  height: number,
): Chevron[] {
  const poses = walkPath(
    toRadians(bearingToNextDegrees),
    metersToNext,
    toRadians(bearingAfterNextDegrees),
  );

  // Focal length in pixels, from the field of view the preview is showing.
  const focal = width / 2 / Math.tan(toRadians(CAMERA_FOV_DEG) / 2);
  const pitch = toRadians(pitchDegrees);
  const halfWidth = CHEVRON_WIDTH_M / 2;
  const reach = (CHEVRON_WIDTH_M * CHEVRON_SWEEP_FRACTION) / 2;

  const chevrons: Chevron[] = [];
  let travelled = 0;
  let nextAt = CHEVRON_FIRST_M;
  let previous: PathPose | undefined;

  for (const pose of poses) {
    if (previous) {
      travelled += Math.hypot(pose.x - previous.x, pose.z - previous.z);
    }
    previous = pose;

    if (travelled < nextAt) continue;
    nextAt += CHEVRON_SPACING_M;

    // Along the path and across it, from this pose's own heading, so a chevron
    // sitting in the bend is aimed round the bend rather than down the leg it
    // started on.
    const alongX = Math.sin(pose.heading);
    const alongZ = Math.cos(pose.heading);
    const acrossX = Math.cos(pose.heading);
    const acrossZ = -Math.sin(pose.heading);

    const corners = [
      {
        x: pose.x - alongX * reach - acrossX * halfWidth,
        z: pose.z - alongZ * reach - acrossZ * halfWidth,
      },
      { x: pose.x + alongX * reach, z: pose.z + alongZ * reach },
      {
        x: pose.x - alongX * reach + acrossX * halfWidth,
        z: pose.z - alongZ * reach + acrossZ * halfWidth,
      },
    ];

    // All three corners or none of them. A chevron with one arm behind the lens
    // is not a smaller chevron, it is a torn one - and unlike the band this
    // replaced, dropping a whole chevron leaves no hole, because the gaps between
    // them are the shape.
    const projected: { x: number; y: number }[] = [];
    for (const corner of corners) {
      const point = projectGroundPoint(corner.x, corner.z, focal, pitch, width, height);
      if (!point) break;
      projected.push(point);
    }
    if (projected.length < corners.length) continue;

    // The same depth `projectGroundPoint` divides by, so an arm drawn this thick
    // is a third of a metre of ground at this distance - foreshortened the way
    // anything lying flat is, rather than a fixed number of pixels that would
    // read as a sticker on the lens.
    const depth = CAMERA_HEIGHT_M * Math.sin(pitch) + pose.z * Math.cos(pitch);

    // Fainter with distance, by how far out it actually is rather than by its
    // position in the list - the nearest chevron is the same brightness whether
    // it is the only one on screen or the first of four.
    const span = Math.max(1, PATH_LENGTH_M - CHEVRON_FIRST_M);
    const fade = Math.min(1, Math.max(0, (travelled - CHEVRON_FIRST_M) / span));

    chevrons.push({
      points: projected
        .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' '),
      stroke: Math.max(MIN_STROKE_PX, (CHEVRON_ARM_M * focal) / depth),
      opacity: NEAR_OPACITY + (FAR_OPACITY - NEAR_OPACITY) * fade,
    });
  }

  return chevrons;
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

