import type { LatLng } from '../types/route';
import { samplePolyline } from '../utils/geo';
import type { MobilityAid } from './mobility';

// Accessibility screening for a walking route, from OpenStreetMap.
//
// Google's Directions API has no accessibility data for walking at all - no
// kerbs, no steps, no surface (see the note in `directions.ts`). OSM does, and
// it is queryable for free through Overpass, so the two are used for what each
// is actually good at: Google finds the route, OSM says whether it is passable.
//
// Why screening rather than routing: OpenRouteService has a real wheelchair
// routing profile, but it decides on kerb heights, inclines, widths and
// surfaces - and a survey of the Kuala Lumpur study area (bbox 3.05-3.25N,
// 101.60-101.78E, Aug 2026) found 296 tagged kerbs and 228 tagged inclines
// city-wide against 14,601 footways. Those constraints would be inert here,
// producing ordinary pedestrian routes labelled as wheelchair routes. What the
// same survey did find was 2,415 mapped stairways, which is the one blocker
// with enough coverage to be worth acting on.

// Tried in order until one answers. Public Overpass instances are free and
// heavily shared, and any single one returns a 504 from its queue often enough
// to matter - measured against all three of these while building this, on the
// same query, within a minute of each other. They mirror the same OSM data, so
// failing over costs nothing but a retry.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// How close an OSM feature has to be to the route to count as on it. Kept
// tight because this is proximity, not a map-match: Google's route carries no
// OSM way IDs, so a stairway running alongside the path can't be told apart
// from one crossing it. Hence "reported along this route" in the wording
// below, never "this route has".
const PROXIMITY_METERS = 12;

// Overpass takes the route as a linestring in the query itself, so the point
// count is the request size. `around` buffers the whole polyline rather than
// each vertex separately, so thinning the line doesn't punch gaps in the
// search corridor - halving the point count over a 3 km test route returned
// byte-identical results while cutting the query to a third of its size.
const SAMPLE_SPACING_METERS = 40;
const MAX_QUERY_POINTS = 60;

// Generous, because a busy public instance can genuinely take 12 s or so to
// answer a query this shape. Routes are already on screen by then.
const REQUEST_TIMEOUT_MS = 20000;

// Public Overpass instances allow roughly two concurrent slots per IP, so
// routes are screened one after another rather than in parallel - firing three
// at once mostly earns three queue rejections. Google returns at most three
// walking alternatives anyway.
const MAX_SCREENED_ROUTES = 3;

// Surfaces that are hard going on wheels or with a walking aid. Deliberately
// short: a surface that is merely imperfect is not worth a warning that would
// train the user to ignore warnings.
const ROUGH_SURFACES = ['gravel', 'dirt', 'ground', 'sand', 'grass', 'mud', 'pebblestone'];

// The cane standard permits "short flights only, with continuous handrails".
// The handrail half is a tag; "short" is not defined by the standard, so this
// is a judgement call - a single storey runs to roughly 15-18 steps, so a
// flight of more than 12 is treated as more than a short one.
const SHORT_FLIGHT_MAX_STEPS = 12;

export type ObstacleKind = 'steps' | 'not-accessible' | 'rough-surface';

export interface RouteObstacle {
  kind: ObstacleKind;
  /** From OSM `step_count`, when the mapper recorded it. */
  stepCount?: number;
  hasRamp: boolean;
  hasHandrail: boolean;
}

export type AccessibilitySeverity = 'clear' | 'caution' | 'blocked';

export interface RouteAccessibility {
  obstacles: RouteObstacle[];
  severity: AccessibilitySeverity;
  /** One line for the route preview panel. */
  note: string;
}

// Whether a route is worth screening at all. With no aid selected the user
// hasn't asked for this, and the extra request and warnings would be noise.
export function needsAccessibilityCheck(aid: MobilityAid): boolean {
  return aid !== 'none';
}

// Screens a set of candidate routes, one at a time. A route whose lookup fails
// comes back as `null` - "unknown", which callers must present as silence and
// never as "clear".
export async function screenRoutes(
  routes: LatLng[][],
  aid: MobilityAid,
): Promise<(RouteAccessibility | null)[]> {
  const results: (RouteAccessibility | null)[] = [];

  for (const coordinates of routes.slice(0, MAX_SCREENED_ROUTES)) {
    try {
      results.push(await screenRouteAccessibility(coordinates, aid));
    } catch {
      results.push(null);
    }
  }

  // Anything past the screening cap is unknown rather than missing.
  while (results.length < routes.length) results.push(null);
  return results;
}

// Screens one route. Throws on network or Overpass failure.
export async function screenRouteAccessibility(
  coordinates: LatLng[],
  aid: MobilityAid,
): Promise<RouteAccessibility> {
  const points = samplePolyline(coordinates, SAMPLE_SPACING_METERS, MAX_QUERY_POINTS);
  const elements = await runOverpassQuery(buildQuery(points));
  const obstacles = elements.map(toObstacle).filter((o): o is RouteObstacle => o !== null);
  return summarise(obstacles, aid);
}

function buildQuery(points: LatLng[]): string {
  const line = points
    .map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`)
    .join(',');
  const surfaces = ROUGH_SURFACES.join('|');

  // One spatial pass, then tag filters over the result set. Running three
  // separate `around` clauses instead - the obvious way to write this - makes
  // the server walk the corridor three times, and reliably 504'd on the public
  // instance for a route of any length.
  //
  // The union deduplicates by element id, so a stairway that is also tagged
  // wheelchair=no is only returned once.
  return `[out:json][timeout:60];
way(around:${PROXIMITY_METERS},${line})["highway"]->.near;
(
  way.near["highway"="steps"];
  way.near["wheelchair"~"^(no|limited)$"];
  way.near["surface"~"^(${surfaces})$"];
);
out tags;`;
}

interface OverpassElement {
  tags?: Record<string, string>;
}

async function runOverpassQuery(query: string): Promise<OverpassElement[]> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return await postToOverpass(endpoint, query);
    } catch (error) {
      // A busy instance answers with a 504 and an HTML error page, so a failure
      // here says nothing about the next one - move on and try it.
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All Overpass endpoints failed');
}

async function postToOverpass(endpoint: string, query: string): Promise<OverpassElement[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Overpass's usage policy asks clients to identify themselves.
        'User-Agent': 'AccessibleNavigation/1.0 (FYP research app)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Overpass returned ${response.status}`);
    }

    const data = await response.json();
    return (data.elements ?? []) as OverpassElement[];
  } finally {
    clearTimeout(timeout);
  }
}

function toObstacle(element: OverpassElement): RouteObstacle | null {
  const tags = element.tags;
  if (!tags) return null;

  const hasRamp = tags.ramp === 'yes' || tags['ramp:wheelchair'] === 'yes';
  const hasHandrail = tags.handrail === 'yes';

  if (tags.highway === 'steps') {
    const parsed = Number.parseInt(tags.step_count ?? '', 10);
    return {
      kind: 'steps',
      stepCount: Number.isFinite(parsed) ? parsed : undefined,
      hasRamp,
      hasHandrail,
    };
  }

  if (tags.wheelchair === 'no' || tags.wheelchair === 'limited') {
    return { kind: 'not-accessible', hasRamp, hasHandrail };
  }

  if (tags.surface && ROUGH_SURFACES.includes(tags.surface)) {
    return { kind: 'rough-surface', hasRamp, hasHandrail };
  }

  return null;
}

// How much each obstacle matters depends on the aid. Steps with a ramp
// alongside are passable on wheels; steps with a handrail and no ramp are
// manageable with a cane but not with a wheelchair.
function summarise(obstacles: RouteObstacle[], aid: MobilityAid): RouteAccessibility {
  const steps = obstacles.filter((o) => o.kind === 'steps');
  const rampedSteps = steps.filter((o) => o.hasRamp);
  const unrampedSteps = steps.filter((o) => !o.hasRamp);
  const blocked = obstacles.filter((o) => o.kind === 'not-accessible');
  const rough = obstacles.filter((o) => o.kind === 'rough-surface');

  if (obstacles.length === 0) {
    return { obstacles, severity: 'clear', note: 'No steps or barriers reported on this route' };
  }

  if (unrampedSteps.length > 0) {
    const total = unrampedSteps.reduce((sum, o) => sum + (o.stepCount ?? 0), 0);
    const flights = unrampedSteps.length;
    const detail = total > 0 ? `${total} steps` : `${flights} flight${flights === 1 ? '' : 's'} of steps`;
    // The cane standard is conditional rather than absolute: short flights are
    // manageable, but only with continuous handrails. Both halves are checked
    // here because the router can't express either - `avoid_features` is
    // all-or-nothing.
    if (aid === 'cane') {
      const railed = unrampedSteps.every((o) => o.hasHandrail);
      // An untagged flight can't be shown to be long, and cane users manage
      // steps routinely, so unknown counts are given the benefit of the doubt.
      const longFlight = unrampedSteps.some(
        (o) => o.stepCount !== undefined && o.stepCount > SHORT_FLIGHT_MAX_STEPS,
      );

      if (!railed) {
        return {
          obstacles,
          severity: 'blocked',
          note: `${detail} reported along this route, no handrail`,
        };
      }
      if (longFlight) {
        return {
          obstacles,
          severity: 'blocked',
          note: `${detail} reported along this route in one long flight`,
        };
      }
      return {
        obstacles,
        severity: 'caution',
        note: `${detail} reported along this route, with handrails`,
      };
    }

    return {
      obstacles,
      severity: 'blocked',
      note: `${detail} reported along this route, no ramp`,
    };
  }

  if (blocked.length > 0) {
    return {
      obstacles,
      severity: 'blocked',
      note: `${blocked.length} section${blocked.length === 1 ? '' : 's'} mapped as not step-free`,
    };
  }

  if (rough.length > 0) {
    return {
      obstacles,
      severity: 'caution',
      note: `${rough.length} unpaved stretch${rough.length === 1 ? '' : 'es'} reported on this route`,
    };
  }

  // Only ramped steps left - worth mentioning, not worth warning about.
  return {
    obstacles,
    severity: 'clear',
    note:
      rampedSteps.length > 0
        ? 'Steps on this route have a ramp alongside'
        : 'No steps or barriers reported on this route',
  };
}
