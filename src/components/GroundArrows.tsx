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
// What the model assumes, because this app deliberately runs a 2D overlay over
// a plain camera preview rather than an AR session (Investigation Report,
// 2.2.2 Sub-Domain 3): the phone is held at about chest height, tilted down by
// a fixed amount, with a typical phone camera's field of view. There is no
// pose tracking here to measure any of it. So the chevrons show which way to
// go; they are not survey marks, and a walker reads their direction rather
// than the exact paving slab they land on.
const CAMERA_HEIGHT_M = 1.4;
const CAMERA_PITCH_DEG = 30;
const CAMERA_FOV_DEG = 62;

// Where the chevrons sit along the path, in metres ahead. Kept close and few:
// the ground compresses hard towards the horizon, and a chevron out at 13m
// projects to a 2px sliver - correct, and useless. These four span roughly
// 175px of screen at the front down to 60px at the back on a 402pt phone,
// which reads as a receding run of large floor markings.
const ARROW_DISTANCES_M = [1.8, 2.9, 4.2, 5.8];

// One chevron, in metres, in its own frame: +y is the way it points, x is
// across the path. A metre wide, so it reads at walking scale.
const CHEVRON_M: [number, number][] = [
  [0, 0.4],
  [0.5, -0.16],
  [0.5, -0.4],
  [0, 0.16],
  [-0.5, -0.4],
  [-0.5, -0.16],
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
const FAR_OPACITY = 0.4;

interface GroundArrowsProps {
  /** Bearing to the next route point relative to the way the walker faces:
   *  0 is straight ahead, positive is to the right. Undefined before the first
   *  fix, when there is nothing to point at. */
  turnAngle: number | undefined;
  /** How far ahead that point is, in metres. The path bends where it sits, so
   *  the bend comes up the run as the walker approaches the corner. */
  metersToTarget: number | undefined;
  color: string;
}

export function GroundArrows({ turnAngle, metersToTarget, color }: GroundArrowsProps) {
  const { width, height } = useWindowDimensions();

  const chevrons = useMemo(() => {
    if (turnAngle === undefined) return [];
    return buildChevrons(turnAngle, metersToTarget ?? 0, width, height);
  }, [turnAngle, metersToTarget, width, height]);

  if (chevrons.length === 0) return null;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {chevrons.map((chevron, index) => (
        <Polygon
          key={index}
          points={chevron.points}
          fill={color}
          fillOpacity={chevron.opacity}
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

interface PathPose {
  x: number;
  z: number;
  heading: number;
}

function buildChevrons(
  turnAngleDegrees: number,
  metersToTarget: number,
  width: number,
  height: number,
): { points: string; opacity: number }[] {
  const poses = walkPath(toRadians(turnAngleDegrees), metersToTarget);
  // Focal length in pixels, from the field of view the preview is showing.
  const focal = width / 2 / Math.tan(toRadians(CAMERA_FOV_DEG) / 2);
  const pitch = toRadians(CAMERA_PITCH_DEG);

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
// heading changes along the way: it eases from straight ahead into the turn
// across `BEND_METERS`, and each step's position depends on where the previous
// one ended up.
function walkPath(turnAngle: number, turnAt: number): PathPose[] {
  const sampled: PathPose[] = [];
  const furthest = ARROW_DISTANCES_M[ARROW_DISTANCES_M.length - 1];
  let next = 0;

  let x = 0;
  let z = 0;

  for (let travelled = 0; travelled <= furthest + PATH_STEP_M; travelled += PATH_STEP_M) {
    const heading = turnAngle * bendProgress(travelled, turnAt);

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
