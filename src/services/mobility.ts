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

// Ordered fastest to slowest by the speeds above, so the control reads as a
// scale rather than an arbitrary list - which is what lets the hare/tortoise
// markers either side of it mean anything. Keep this ordering in step with
// `MOBILITY_AID_SPEED_MPS` if a speed is ever retuned.
export const MOBILITY_AIDS: MobilityAid[] = ['none', 'wheelchair', 'cane', 'walker'];

// Rescales a Google walking duration to the user's own pace. `none` leaves it
// exactly as Google returned it.
export function adjustDurationForAid(durationSeconds: number, aid: MobilityAid): number {
  return durationSeconds * (GOOGLE_WALKING_SPEED_MPS / MOBILITY_AID_SPEED_MPS[aid]);
}

// The duration to show for a route, whichever router produced it.
//
// Only Google's durations need rescaling. OpenRouteService's wheelchair
// profile applies its own pace model, so putting the multiplier on top of that
// would charge the user for the same slowdown twice.
export function routeDurationSeconds(
  durationSeconds: number,
  aid: MobilityAid,
  alreadyPaced: boolean,
): number {
  return alreadyPaced ? durationSeconds : adjustDurationForAid(durationSeconds, aid);
}

// One short line under the control in Settings, so the setting visibly does
// something instead of looking decorative. Covers both of its effects - the
// slower timings and the kind of route planned - in plain words; the exact
// speeds and limits live in the code above and in `accessibleRouting.ts`
// rather than being recited at the user.
// The pace words are comparative - "slower", "even slower", "slowest" - so
// they read as one scale running left to right across the control, matching
// the hare and tortoise either side of it. That makes them dependent on the
// ordering in `MOBILITY_AIDS` and on the speeds above: reorder either and
// these stop being true.
export const MOBILITY_AID_DESCRIPTIONS: Record<MobilityAid, string> = {
  none: 'Standard walking times',
  wheelchair: 'Slower pace, step-free routes',
  cane: 'Even slower pace, stairs need handrails',
  walker: 'Slowest pace, step-free and gentle slopes',
};
