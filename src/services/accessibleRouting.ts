import Constants from 'expo-constants';
import type { LatLng, RouteStep, RouteSurface, WalkingRoute } from '../types/route';
import type { MobilityAid } from './mobility';

// Walking routes via OpenRouteService, which plans over OpenStreetMap.
//
// This is the app's primary router for every user, not just those with a
// mobility aid set. Google's Directions API only routes where it has a mapped
// sidewalk, and in the Kuala Lumpur study area it very often hasn't: asked for
// a 763m walk it has been observed returning three alternatives of 8.0, 8.5
// and 10.0km, detouring miles around a road it would not cross. OSM carries
// 14,601 footways in the same area. A pedestrian router is only as good as its
// pedestrian network, and here that is decisively OSM's.
//
// ORS has exactly one accessibility profile - `wheelchair`. There is no cane
// or walker profile, so the three aids are expressed as three restriction sets
// over that one profile (below). That is a real modelling choice, not a
// workaround: what differs between the three is how steep, how narrow and how
// rough a path can be before it stops being usable.
const ORS_BASE = 'https://api.openrouteservice.org/v2/directions';

const REQUEST_TIMEOUT_MS = 20000;

// How hard to push a walker with no aid away from big roads.
//
// `foot-walking` is the mirror image of Google's failing: where Google won't
// route without a sidewalk, ORS will happily route along any way OSM does not
// explicitly forbid pedestrians on - including a trunk-road shoulder. For an
// app whose entire subject is safe walking, the shortest line down a highway
// is not the right answer.
//
// `quiet` is ORS's own weighting for exactly this, biasing the route away from
// big streets and onto the footways and residential roads beside them. It is a
// preference and not a restriction, so a road with no alternative is still
// used rather than the route failing - which is the behaviour wanted. Held
// below 1.0 because at full strength it will take a long detour to avoid a
// short stretch of main road.
const QUIET_WEIGHTING = 0.8;

// Alternatives, so the route picker has something to pick between. ORS only
// offers these for two-point requests, which is all this app ever makes.
//
// `share_factor` is the most it may reuse of the fastest route, and
// Both knobs are filters, and both were originally set too strict - which is
// why most destinations came back with a single route where Google had been
// offering three.
//
// `share_factor` is the most of the fastest route an alternative may reuse.
// Lower demands a more distinct route, and therefore finds fewer: on a walk
// that leaves and arrives along the same few streets, almost every real
// alternative reuses more than 60% of the optimal one and is discarded. 0.8
// keeps the requirement that alternatives differ somewhere meaningful while
// accepting that they will share the ends.
//
// `weight_factor` is the most an alternative may cost relative to the fastest.
// Higher admits longer ways round. 1.8 is deliberately generous, because for
// this app a longer route is not automatically a worse one - the whole reason
// for offering a choice is that the shortest way may be the one down the side
// of a main road, and the walker is the one who should decide.
//
// `target_count` is at ORS's maximum of 3.
const ALTERNATIVE_ROUTES = {
  target_count: 3,
  share_factor: 0.8,
  weight_factor: 1.8,
};

// The published limits each aid is designed around, and what can actually be
// asked of the API.
//
// `standard` is the source of truth from the accessibility standards table
// (ADA-derived: 1:12 ramp ratio, 0.006 m un-beveled threshold, 0.915 m
// clear-width path). `restrictions` is what gets sent, and the two differ
// because ORS only accepts enumerated values for two of the three:
//
//   maximum_incline      3 | 6 | 10 | 15 | any    (percent)
//   maximum_sloped_kerb  0.03 | 0.06 | 0.1 | any  (metres)
//   minimum_width        any number               (metres)
//
// Where a standard falls between two options, the *stricter* one is sent.
// Erring loose would route someone onto a gradient their aid cannot hold on;
// erring strict only costs a detour. So 8.33% becomes 6, and 5.00% becomes 3.
//
// The kerb limits cannot be honoured at all: the standards want 0.006 m and
// 0.025 m, and ORS's finest option is 0.03 m - looser than all three. It is
// sent anyway as the closest available, but the real kerb check has to come
// from the OSM screening in `accessibility.ts`, not from the router.
//
// One further caveat: in the Kuala Lumpur study area OSM carries 296 tagged
// kerbs and 228 tagged inclines against 14,601 footways, so these limits will
// rarely bind there whatever their value. `avoidSteps` is what does the real
// work - KL has 2,415 mapped stairways.
interface AidRouting {
  standard: {
    maxInclinePercent: number;
    maxKerbMeters: number;
    minWidthMeters: number;
    /** 'conditional' cannot be expressed as a routing flag - see below. */
    avoidStairs: 'yes' | 'conditional';
  };
  avoidSteps: boolean;
  restrictions: Record<string, number | string>;
}

const AID_ROUTING: Record<Exclude<MobilityAid, 'none'>, AidRouting> = {
  wheelchair: {
    // Stairs are an absolute barrier: 100% step-free routing required.
    standard: {
      maxInclinePercent: 8.33,
      maxKerbMeters: 0.006,
      minWidthMeters: 0.915,
      avoidStairs: 'yes',
    },
    avoidSteps: true,
    restrictions: {
      maximum_incline: 6, // 8.33% rounded down to the nearest option
      maximum_sloped_kerb: 0.03, // standard is 0.006; 0.03 is the finest ORS has
      minimum_width: 0.915,
      smoothness_type: 'good',
      surface_type: 'cobblestone:flattened',
    },
  },
  walker: {
    // Standard walker, no wheels - cannot navigate stairs safely, and has the
    // tightest gradient limit of the three at 5%.
    standard: {
      maxInclinePercent: 5.0,
      maxKerbMeters: 0.006,
      minWidthMeters: 0.82,
      avoidStairs: 'yes',
    },
    avoidSteps: true,
    restrictions: {
      maximum_incline: 3, // 5.00% rounded down to the nearest option
      maximum_sloped_kerb: 0.03, // standard is 0.006; 0.03 is the finest ORS has
      minimum_width: 0.82,
      smoothness_type: 'intermediate',
    },
  },
  cane: {
    // "Conditional - can manage short flights only with continuous handrails."
    // `avoid_features` is binary, so that condition cannot be expressed here:
    // routing lets steps through, and the handrail-and-flight-length test is
    // applied afterwards by the OSM screening, which can read `handrail` and
    // `step_count` off the individual stairway.
    standard: {
      maxInclinePercent: 8.33,
      maxKerbMeters: 0.025,
      minWidthMeters: 0.75,
      avoidStairs: 'conditional',
    },
    avoidSteps: false,
    restrictions: {
      maximum_incline: 6, // 8.33% rounded down to the nearest option
      maximum_sloped_kerb: 0.03, // standard is 0.025; 0.03 is the nearest ORS has
      minimum_width: 0.75,
      smoothness_type: 'intermediate',
    },
  },
};

export class NoAccessibleRouteError extends Error {}

// ORS refused the *request*, not the journey - an option it does not recognise
// or support on this profile. Separated from every other failure because it is
// the only one worth retrying with a simpler request: a timeout, a dead
// network or a 500 will fail again just as slowly, and trying eight times
// turns a ten-second failure into a minute of the user watching a spinner.
class OrsRejectedError extends Error {}

// Whether ORS is configured at all. Without a key the app falls back to
// Google's Directions API - which still routes, and is still screened against
// OSM afterwards. It just routes worse.
export function hasAccessibleRoutingKey(): boolean {
  return Boolean(Constants.expoConfig?.extra?.openRouteServiceApiKey);
}

// Every walking route ORS offers between two points, fastest first.
//
// The profile follows the aid: `wheelchair` for the three aids, restricted per
// the table above, and `foot-walking` for someone with none. Routes planned on
// the wheelchair profile are marked `accessibleFor`, which is what lets the UI
// say "step-free route" about them without having to re-derive it.
//
// Throws `NoAccessibleRouteError` when ORS can route in general but finds
// nothing meeting the restrictions - a real answer ("there is no accessible
// way"), distinct from a network failure.
export async function planRoutes(
  origin: LatLng,
  destination: LatLng,
  destinationName: string,
  aid: MobilityAid,
  destinationAddress?: string,
): Promise<WalkingRoute[]> {
  const apiKey = Constants.expoConfig?.extra?.openRouteServiceApiKey as string | undefined;
  if (!apiKey) throw new Error('OpenRouteService API key is not configured.');

  const profile = aid === 'none' ? 'foot-walking' : 'wheelchair';
  const accessibleFor = aid === 'none' ? undefined : aid;

  let lastError: unknown;

  for (const options of optionLadder(aid)) {
    // Each set of options is tried with the way-type breakdown and then
    // without it. `extra_info` is the one part of the request that cannot go
    // in the ladder itself - it is a top-level field, not an option - and if a
    // deployment refuses it there, every rung would fail and the whole app
    // would fall silently back to Google. Dropping it costs the surface line
    // on the route panel and nothing else, so it is worth losing to keep the
    // route.
    for (const withExtras of [true, false]) {
      try {
        const features = await requestRoutes(
          apiKey,
          profile,
          origin,
          destination,
          options,
          withExtras,
        );
        return features
          .map((feature: any) =>
            toRoute(
              feature,
              origin,
              destination,
              destinationName,
              destinationAddress,
              accessibleFor,
            ),
          )
          .filter((route): route is WalkingRoute => route !== null)
          .sort((a, b) => a.durationSeconds - b.durationSeconds);
      } catch (error) {
        // "No route" is ORS's answer, not its failure - a simpler request gets
        // the same answer more slowly.
        if (error instanceof NoAccessibleRouteError) throw error;
        // Anything that is not a rejected parameter will fail again the same
        // way. Stop rather than spend the user's time proving it.
        if (!(error instanceof OrsRejectedError)) throw error;

        // Logged because the ladder is otherwise silent, and its failures are
        // indistinguishable from ordinary results. A rung that drops
        // `alternative_routes` produces a single route - which looks exactly
        // like a destination that genuinely has only one sensible way to it.
        // Without this line there is no way to tell those apart from the
        // outside, and the wrong one of the two was the reason the route
        // picker looked broken.
        console.warn(
          `[routing] ORS refused ${Object.keys(options).join(', ') || 'the base request'}` +
            `${withExtras ? ' +extra_info' : ''} - ${error.message}. Retrying simpler.`,
        );
        lastError = error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('OpenRouteService could not plan a route.');
}

// A single accessible route, for the case where the routes on screen came from
// Google rather than from ORS. Kept as its own entry point because the map
// screen appends this one route to Google's set and says so.
export async function findAccessibleRoute(
  origin: LatLng,
  destination: LatLng,
  destinationName: string,
  aid: Exclude<MobilityAid, 'none'>,
  destinationAddress?: string,
): Promise<WalkingRoute> {
  const routes = await planRoutes(origin, destination, destinationName, aid, destinationAddress);
  if (routes.length === 0) throw new NoAccessibleRouteError('No accessible route found');
  return routes[0];
}

// The request options to try, in order, stopping at the first that ORS
// accepts.
//
// ORS rejects options it does not recognise with a 400 rather than ignoring
// them, and which of these a given deployment accepts has moved between
// versions - `alternative_routes` in particular is refused in combination with
// some profile parameters. Degrading through the list means a rejected extra
// costs one wasted request instead of the whole route.
//
// `avoid_features` is the one thing never dropped. Falling back to a route
// with steps in it for a wheelchair user would be worse than no route at all,
// because it would look exactly like a route that had been checked.
function optionLadder(aid: MobilityAid): Record<string, unknown>[] {
  if (aid === 'none') {
    const quiet = { profile_params: { weightings: { quiet: QUIET_WEIGHTING } } };
    return [
      { ...quiet, alternative_routes: ALTERNATIVE_ROUTES },
      quiet,
      { alternative_routes: ALTERNATIVE_ROUTES },
      {},
    ];
  }

  const { avoidSteps, restrictions } = AID_ROUTING[aid];
  const avoid = avoidSteps ? { avoid_features: ['steps'] } : {};
  return [
    { ...avoid, profile_params: { restrictions }, alternative_routes: ALTERNATIVE_ROUTES },
    { ...avoid, profile_params: { restrictions } },
    { ...avoid, alternative_routes: ALTERNATIVE_ROUTES },
    avoid,
  ];
}

async function requestRoutes(
  apiKey: string,
  profile: string,
  origin: LatLng,
  destination: LatLng,
  options: Record<string, unknown>,
  withExtras: boolean,
): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ORS_BASE}/${profile}/geojson`, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // ORS takes coordinates longitude-first, the opposite of Google.
        coordinates: [
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude],
        ],
        // Asked for because the navigation banner names the street you are on
        // and the one you are turning into. Costs a little response size on a
        // request that is already slow; without it ORS returns geometry only
        // and the walker navigates with no street names.
        instructions: true,
        // The per-way breakdown behind `RouteSurface` - what tells a walker
        // whether the short route is short because it runs down the side of a
        // main road.
        ...(withExtras ? { extra_info: ['waytype'] } : {}),
        ...(Object.keys(options).length > 0 ? { options } : {}),
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      // 2009/2010 are ORS's "route could not be found" codes - the honest
      // answer that no path exists, not a fault.
      const code = data?.error?.code;
      if (code === 2009 || code === 2010) {
        throw new NoAccessibleRouteError('No accessible route found');
      }
      if (response.status === 400) {
        throw new OrsRejectedError(`OpenRouteService rejected the request (${code ?? 400})`);
      }
      throw new Error(`OpenRouteService returned ${response.status}`);
    }

    const features = data?.features;
    if (!Array.isArray(features) || features.length === 0) {
      throw new NoAccessibleRouteError('No accessible route found');
    }
    return features;
  } finally {
    clearTimeout(timeout);
  }
}

// One GeoJSON feature to a route. Null for a feature carrying no geometry,
// which ORS occasionally returns alongside good ones in an alternatives
// response rather than omitting.
function toRoute(
  feature: any,
  origin: LatLng,
  destination: LatLng,
  destinationName: string,
  destinationAddress: string | undefined,
  accessibleFor: Exclude<MobilityAid, 'none'> | undefined,
): WalkingRoute | null {
  if (!feature?.geometry?.coordinates?.length) return null;

  const coordinates: LatLng[] = feature.geometry.coordinates.map(
    ([longitude, latitude]: [number, number]) => ({ latitude, longitude }),
  );
  const steps = parseSteps(feature.properties?.segments, coordinates);

  return {
    origin,
    destination,
    destinationName,
    destinationAddress,
    coordinates,
    steps,
    distanceMeters: feature.properties?.summary?.distance ?? 0,
    durationSeconds: feature.properties?.summary?.duration ?? 0,
    summary: summarise(steps),
    surface: parseSurface(feature.properties?.extras),
    ...(accessibleFor ? { accessibleFor } : {}),
  };
}

// ORS's `waytype` codes. Only the ones that change the answer are named; the
// rest fall through to `otherMeters`.
//
//   0 unknown   1 state road   2 road       3 street    4 path
//   5 track     6 cycleway     7 footway    8 steps     9 ferry
//   10 construction
const PEDESTRIAN_WAYTYPES = new Set([4, 6, 7, 8]);
const ROAD_WAYTYPES = new Set([1, 2, 3]);

// The `waytype` extra, totalled into the three buckets the UI reports.
//
// Read from ORS's own `summary` rather than from the per-segment `values`
// array: the summary already carries a distance per way type, and rebuilding
// those from segment indices would mean re-measuring the geometry to get an
// answer ORS has already computed.
function parseSurface(extras: any): RouteSurface | undefined {
  const summary = extras?.waytype?.summary;
  if (!Array.isArray(summary) || summary.length === 0) return undefined;

  let footwayMeters = 0;
  let roadMeters = 0;
  let otherMeters = 0;

  for (const entry of summary) {
    const distance = typeof entry?.distance === 'number' ? entry.distance : 0;
    if (PEDESTRIAN_WAYTYPES.has(entry?.value)) footwayMeters += distance;
    else if (ROAD_WAYTYPES.has(entry?.value)) roadMeters += distance;
    else otherMeters += distance;
  }

  return { footwayMeters, roadMeters, otherMeters };
}

// A short label for the streets a route mostly follows, used by the picker to
// tell otherwise-similar alternatives apart. Google supplies one; ORS does
// not, so the longest named step stands in - which is the same thing Google's
// summary usually turns out to be.
function summarise(steps: RouteStep[]): string | undefined {
  let longest: RouteStep | undefined;
  for (const step of steps) {
    if (!step.road) continue;
    if (!longest || step.distanceMeters > longest.distanceMeters) longest = step;
  }
  return longest?.road;
}

// ORS's numeric manoeuvre codes, translated into the string codes Google's
// Directions API uses - so that `maneuverFromApi` stays the single place that
// decides which arrow to draw, and neither caller has to know where its route
// came from.
//
// Only the codes with an exact Google equivalent are mapped. The rest are
// deliberately absent, which leaves the banner falling back to the turn angle
// it measures from the geometry: roundabouts (7, 8) because a roundabout on
// foot is walked round as an ordinary turn of whatever angle it happens to be,
// U-turns (9) because ORS does not say which way round, and depart/arrive
// (11, 10) because they are not manoeuvres. Every one of those is better
// served by the measured angle than by a guess, and a guess here draws a
// left-turn arrow on a right turn.
const ORS_MANEUVERS: Record<number, string> = {
  0: 'turn-left',
  1: 'turn-right',
  2: 'turn-sharp-left',
  3: 'turn-sharp-right',
  4: 'turn-slight-left',
  5: 'turn-slight-right',
  6: 'straight',
  12: 'fork-left', // keep left
  13: 'fork-right', // keep right
};

// ORS's turn-by-turn steps, mapped onto the same `RouteStep` shape Google's
// are. Two differences it has to bridge: the road name arrives as its own
// field (as "-" when the way is unnamed) rather than being buried in the
// instruction text, and each step points at the shared coordinate array by
// index instead of carrying its own start and end.
function parseSteps(segments: any, coordinates: LatLng[]): RouteStep[] {
  if (!Array.isArray(segments)) return [];

  return segments.flatMap((segment: any) =>
    (segment?.steps ?? []).map((step: any): RouteStep => {
      const [startIndex, endIndex] = step.way_points ?? [0, 0];
      const road = typeof step.name === 'string' && step.name !== '-' ? step.name : undefined;
      return {
        instruction: step.instruction ?? '',
        road,
        maneuver: typeof step.type === 'number' ? ORS_MANEUVERS[step.type] : undefined,
        distanceMeters: step.distance ?? 0,
        start: coordinates[clampIndex(startIndex, coordinates)],
        end: coordinates[clampIndex(endIndex, coordinates)],
      };
    }),
  );
}

function clampIndex(index: number, coordinates: LatLng[]): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), coordinates.length - 1);
}
