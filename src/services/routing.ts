import type { LatLng, WalkingRoute } from '../types/route';
import { getWalkingRoutes } from './directions';
import { hasAccessibleRoutingKey, planRoutes } from './accessibleRouting';
import type { MobilityAid } from './mobility';

// Which router actually answered. Returned rather than discarded because the
// two disagree substantially in the study area, and knowing which one produced
// a surprising route is the first thing worth knowing about it - both when
// debugging and when writing the comparison up.
export type RouteSource = 'openrouteservice' | 'google';

export interface RoutePlan {
  routes: WalkingRoute[];
  source: RouteSource;
}

// The app's walking routes, from OpenStreetMap where possible.
//
// OpenRouteService is asked first, for every user and every mobility aid. It
// plans over OSM, which in the Kuala Lumpur study area has an incomparably
// better pedestrian network than Google's: asked for the same 763m walk,
// Google returned three alternatives of 8.0, 8.5 and 10.0km because it will
// not route where it has no mapped sidewalk. OSM carries 14,601 footways in
// the same area, and ORS also applies the aid's restrictions while planning
// rather than only reporting problems afterwards.
//
// Google is kept as the fallback, not deleted. ORS is a free service on a
// rate-limited key and the app must still route when it is unavailable, when
// the key is missing from a build, or when OSM's coverage genuinely runs out.
// A worse route is recoverable; a walking app that cannot produce a route is
// not. Whichever router answers, the OSM screening in `accessibility.ts` runs
// over the result afterwards exactly as before.
export async function planWalkingRoutes(
  origin: LatLng,
  destination: LatLng,
  destinationName: string,
  destinationAddress: string | undefined,
  aid: MobilityAid,
): Promise<RoutePlan> {
  if (hasAccessibleRoutingKey()) {
    try {
      const routes = await planRoutes(origin, destination, destinationName, aid, destinationAddress);
      if (routes.length > 0) return { routes, source: 'openrouteservice' };
    } catch {
      // Deliberately swallowed, including "no accessible route". Falling back
      // is more useful than failing: Google's routes plus the OSM screening at
      // least show the walker where the barriers are, and the map screen asks
      // ORS again for the accessible route so that "no accessible route
      // exists" is still reported in its own words rather than inferred here.
    }
  }

  const routes = await getWalkingRoutes(origin, destination, destinationName, destinationAddress);
  return { routes, source: 'google' };
}
