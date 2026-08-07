// What the "Mobility aid" setting actually does.
//
// Google's Directions API returns one walking duration per route, computed at
// a fixed able-bodied pace (~5 km/h). For someone using a cane or a walker
// that number is not just optimistic, it is unusable for planning - the
// difference between "12 min" and the real 28 min is the difference between
// catching a bus and missing it.
//
// So the aid the user selects is turned into a travel speed, and every
// duration the app shows (route pills, the route preview panel, the remaining
// time during AR navigation) is rescaled from Google's pace to theirs.
// Distances are untouched - only time changes.

export type MobilityAid = 'none' | 'cane' | 'walker' | 'wheelchair';

// The pace Google's walking durations assume, in m/s.
const GOOGLE_WALKING_SPEED_MPS = 1.4;

// Comfortable sustained outdoor travel speed per aid, in m/s. These are
// mid-range values from the gait-speed literature (unaided community walking
// ~1.2-1.4, single-point cane ~0.8-1.0, wheeled walker ~0.6-0.7, self-propelled
// manual wheelchair ~0.9-1.1) rather than best-effort maximums, since the
// number is used for an estimate of a whole journey.
export const MOBILITY_AID_SPEED_MPS: Record<MobilityAid, number> = {
  none: 1.4,
  cane: 0.9,
  walker: 0.65,
  wheelchair: 1.0,
};

export const MOBILITY_AID_LABELS: Record<MobilityAid, string> = {
  none: 'None',
  cane: 'Cane',
  walker: 'Walker',
  wheelchair: 'Wheelchair',
};

export const MOBILITY_AIDS: MobilityAid[] = ['none', 'cane', 'walker', 'wheelchair'];

// Rescales a Google walking duration to the user's own pace. `none` leaves it
// exactly as Google returned it.
export function adjustDurationForAid(durationSeconds: number, aid: MobilityAid): number {
  return durationSeconds * (GOOGLE_WALKING_SPEED_MPS / MOBILITY_AID_SPEED_MPS[aid]);
}

// One-line explanation of the effect, shown under the control in Settings so
// the setting visibly does something instead of looking decorative.
export function describeAidPace(aid: MobilityAid): string {
  if (aid === 'none') return 'Walking times use the standard walking pace';
  const percent = Math.round((GOOGLE_WALKING_SPEED_MPS / MOBILITY_AID_SPEED_MPS[aid] - 1) * 100);
  return `Walking times allow ${percent}% longer, at ${MOBILITY_AID_SPEED_MPS[aid].toFixed(
    2,
  )} m/s`;
}
