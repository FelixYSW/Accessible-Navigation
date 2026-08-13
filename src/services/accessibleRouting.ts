import Constants from 'expo-constants';
import type { LatLng, RouteStep, WalkingRoute } from '../types/route';
import type { MobilityAid } from './mobility';

// Accessibility-aware routing via OpenRouteService, which plans over
// OpenStreetMap and can route *around* barriers rather than just reporting
// them the way `accessibility.ts` does.
//
// ORS has exactly one accessibility profile - `wheelchair`. There is no cane
// or walker profile, so the three aids are expressed as three restriction sets
// over that one profile (below). That is a real modelling choice, not a
// workaround: what differs between the three is how steep, how narrow and how
// rough a path can be before it stops being usable.
const ORS_ENDPOINT = 'https://api.openrouteservice.org/v2/directions/wheelchair/geojson';

const REQUEST_TIMEOUT_MS = 20000;

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

// Whether accessibility-aware routing is configured at all. Without a key the
// app falls back to Google routes plus OSM screening, so this is optional
// rather than a hard requirement.
export function hasAccessibleRoutingKey(): boolean {
  return Boolean(Constants.expoConfig?.extra?.openRouteServiceApiKey);
}

// Asks ORS for a route the given aid can actually use. Throws
// `NoAccessibleRouteError` when ORS can route in general but can't find a path
// meeting the restrictions - a real answer ("there is no accessible way"),
// distinct from a network failure.
export async function findAccessibleRoute(
  origin: LatLng,
  destination: LatLng,
  destinationName: string,
  aid: Exclude<MobilityAid, 'none'>,
  destinationAddress?: string,
): Promise<WalkingRoute> {
  const apiKey = Constants.expoConfig?.extra?.openRouteServiceApiKey as string | undefined;
  if (!apiKey) throw new Error('OpenRouteService API key is not configured.');

  const { avoidSteps, restrictions } = AID_ROUTING[aid];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ORS_ENDPOINT, {
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
        // Asked for because the AR navigation banner names the street you are
        // on and the one you are turning into. Costs a little response size on
        // a request that is already slow; without it ORS returns geometry
        // only and an accessible route would navigate with no street names.
        instructions: true,
        options: {
          ...(avoidSteps ? { avoid_features: ['steps'] } : {}),
          profile_params: { restrictions },
        },
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      // 2009/2010 are ORS's "route could not be found" codes - the honest
      // answer that no accessible path exists, not a fault.
      const code = data?.error?.code;
      if (code === 2009 || code === 2010) {
        throw new NoAccessibleRouteError('No accessible route found');
      }
      throw new Error(`OpenRouteService returned ${response.status}`);
    }

    const feature = data?.features?.[0];
    if (!feature?.geometry?.coordinates?.length) {
      throw new NoAccessibleRouteError('No accessible route found');
    }

    const coordinates: LatLng[] = feature.geometry.coordinates.map(
      ([longitude, latitude]: [number, number]) => ({ latitude, longitude }),
    );

    return {
      origin,
      destination,
      destinationName,
      destinationAddress,
      coordinates,
      // ORS words its steps differently from Google's and indexes them into
      // the coordinate array rather than carrying their own geometry, so they
      // are mapped here instead of being left empty - a wheelchair user
      // following the accessible route should get the same street-by-street
      // banner as everyone else, not a blank one.
      steps: parseSteps(feature.properties?.segments, coordinates),
      distanceMeters: feature.properties?.summary?.distance ?? 0,
      durationSeconds: feature.properties?.summary?.duration ?? 0,
      accessibleFor: aid,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ORS's turn-by-turn steps, mapped onto the same `RouteStep` shape Google's
// are. Two differences it has to bridge: the road name arrives as its own
// field (as "-" when the way is unnamed) rather than being buried in the
// instruction text, and each step points at the shared coordinate array by
// index instead of carrying its own start and end.
//
// `maneuver` is deliberately left unset. ORS reports the manoeuvre as a
// numeric type code from a different vocabulary to Google's, and a wrong
// mapping would put a left-turn arrow on a right turn - worse than the banner
// falling back to the bearing it computes itself.
function parseSteps(segments: any, coordinates: LatLng[]): RouteStep[] {
  if (!Array.isArray(segments)) return [];

  return segments.flatMap((segment: any) =>
    (segment?.steps ?? []).map((step: any): RouteStep => {
      const [startIndex, endIndex] = step.way_points ?? [0, 0];
      const road = typeof step.name === 'string' && step.name !== '-' ? step.name : undefined;
      return {
        instruction: step.instruction ?? '',
        road,
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
