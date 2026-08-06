import { HAZARD_COLORS } from '../theme/tokens';
import { HAZARD_LABELS, type HazardClass } from '../types/hazard';

export interface RouteHazardSummary {
  /** Dot colour for the route panel: the worst hazard's colour, or green when
   *  the route is clear. */
  color: string;
  note: string;
}

// Hazards already reported along a route, keyed by class. Nothing populates
// this yet - see `summariseRouteHazards` below.
export type RouteHazardCounts = Partial<Record<HazardClass, number>>;

// Turns the hazards known about a previewed route into the single dot +
// sentence the route panel shows.
//
// There is no hazard data source for a route yet: detection is on-device and
// live (`hazardDetector`), and the Directions API knows nothing about
// pavement condition. Until a reported-hazard store exists, `counts` arrives
// empty and the panel says so honestly rather than claiming the route is
// clear - a wheelchair user reading "no hazards" as a guarantee is exactly
// the failure this app exists to avoid.
//
// When that store lands, pass it in here and the panel starts reporting real
// counts with no UI change.
export function summariseRouteHazards(
  counts: RouteHazardCounts,
  greenColor: string,
  activeClasses: HazardClass[],
): RouteHazardSummary {
  const flagged = activeClasses
    .map((hazardClass) => ({ hazardClass, count: counts[hazardClass] ?? 0 }))
    .filter((entry) => entry.count > 0);

  if (flagged.length === 0) {
    return {
      color: greenColor,
      note: 'No hazard reports for this route yet',
    };
  }

  const total = flagged.reduce((sum, entry) => sum + entry.count, 0);
  // Name the hazard when there is only one kind to report, so the note is
  // specific ("1 pothole flagged") rather than a bare count.
  const note =
    flagged.length === 1
      ? `${total} ${HAZARD_LABELS[flagged[0].hazardClass].toLowerCase()} flagged`
      : `${total} hazards flagged on this route`;

  return { color: HAZARD_COLORS[flagged[0].hazardClass], note };
}
