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

// The pace OpenRouteService's wheelchair profile assumes, in m/s - its own
// default base speed of 4 km/h.
const ORS_WHEELCHAIR_SPEED_MPS = 1.11;

// The duration to show for a route, whichever router produced it and whichever
// profile it was planned on.
//
// Both inputs matter, and conflating them was a real error. A route planned on
// ORS's wheelchair profile arrives already paced - but paced for a wheelchair,
// which is only the right answer for one of the three aids that use that
// profile. Treating "came back accessible" as "needs no rescaling" left a
// walker, who travels at 0.65 m/s, reading times computed at 1.11 - a journey
// shown as half an hour that takes the better part of an hour.
//
// So the router's own pace is used only as the baseline it actually is, and
// every duration the app shows is expressed in the aid's speed from the table
// above.
export function routeDurationSeconds(
  durationSeconds: number,
  aid: MobilityAid,
  /** The aid this route was planned for, if it came from ORS's wheelchair
   *  profile. Undefined for Google's routes and for ORS's foot-walking ones,
   *  which are both paced for an unaided walker. */
  plannedFor: MobilityAid | undefined,
): number {
  const routerSpeed =
    plannedFor && plannedFor !== 'none' ? ORS_WHEELCHAIR_SPEED_MPS : GOOGLE_WALKING_SPEED_MPS;
  return durationSeconds * (routerSpeed / MOBILITY_AID_SPEED_MPS[aid]);
}

// How much further you actually walk than the straight line to a place.
//
// Streets do not run in straight lines and pedestrians cannot cut through
// buildings, so the crow-flies distance a Places result carries always
// understates the walk. The ratio between the two is the network's circuity,
// and for urban pedestrian networks it sits somewhere around 1.2-1.5; 1.3 is
// the middle of that.
//
// It is an estimate and nothing more. The honest figure for a given place is
// the one that appears once a route has actually been planned to it, and the
// two will differ - sometimes a lot, in a place like the study area where a
// river or an expressway can make a 200m straight line into a kilometre of
// walking. This exists so a list of suggestions can say something useful about
// effort before committing to a routing request for each one.
const PEDESTRIAN_CIRCUITY = 1.3;

/** A rough walk to somewhere `straightLineMeters` away as the crow flies,
 *  at the pace implied by the user's Mobility aid setting. */
export function estimateWalk(
  straightLineMeters: number,
  aid: MobilityAid,
): { meters: number; seconds: number } {
  const meters = straightLineMeters * PEDESTRIAN_CIRCUITY;
  return { meters, seconds: meters / MOBILITY_AID_SPEED_MPS[aid] };
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
