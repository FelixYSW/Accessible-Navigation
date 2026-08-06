import type { LatLng } from '../types/route';

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

// Web Mercator's vertical axis. Longitude maps linearly across the screen,
// but latitude does not - projecting through Mercator is what keeps a
// screen-space overlay pinned to the right spot on the map as it zooms.
function mercatorY(latitude: number): number {
  const clamped = Math.max(Math.min(latitude, 89.9), -89.9);
  return Math.log(Math.tan(Math.PI / 4 + toRadians(clamped) / 2));
}

// Projects a geographic coordinate to an x/y pixel offset inside a map view
// of `size` currently showing `region`, so plain React Native views can be
// positioned on top of the map at real-world locations.
export function coordinateToScreenPoint(
  coordinate: LatLng,
  region: MapRegion,
  size: { width: number; height: number },
): { x: number; y: number } {
  const west = region.longitude - region.longitudeDelta / 2;
  const x = ((coordinate.longitude - west) / region.longitudeDelta) * size.width;

  const top = mercatorY(region.latitude + region.latitudeDelta / 2);
  const bottom = mercatorY(region.latitude - region.latitudeDelta / 2);
  const y = ((top - mercatorY(coordinate.latitude)) / (top - bottom)) * size.height;

  return { x, y };
}

// Picks the point along a route best suited to carrying its label: the
// vertex furthest from every other route, so overlapping alternatives get
// labels on the stretches where they actually diverge (mirroring how
// Google Maps places its route badges) rather than stacked on shared roads.
//
// Returns the *index* of that vertex, so callers can also look at its
// neighbours - the redesigned route pill needs the local direction of the
// route there to work out which way its tail should point.
export function labelAnchorIndexForRoute(routes: LatLng[][], index: number): number {
  const own = routes[index];
  const others = routes.filter((_, i) => i !== index);
  const middle = Math.floor(own.length / 2);
  if (others.length === 0) return middle;

  let best = middle;
  let bestDistance = -1;

  // Sampling keeps this cheap on long routes with thousands of vertices.
  const step = Math.max(1, Math.floor(own.length / 60));
  for (let i = 0; i < own.length; i += step) {
    const candidate = own[i];
    let nearest = Infinity;
    for (const other of others) {
      const otherStep = Math.max(1, Math.floor(other.length / 60));
      for (let j = 0; j < other.length; j += otherStep) {
        const d = distanceMeters(candidate, other[j]);
        if (d < nearest) nearest = d;
      }
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = i;
    }
  }

  return best;
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// Initial compass bearing (0-360, 0 = true north) from point a to point b.
export function bearingBetween(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLng = toRadians(b.longitude - a.longitude);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Smallest signed difference (-180, 180] from `heading` to `bearing`, i.e. how
// far and in which direction the user needs to turn to face `bearing`.
export function relativeBearing(heading: number, bearing: number): number {
  let diff = (bearing - heading) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

// Given a route polyline and the user's current position, finds the next
// point on the route that is still ahead of the user (i.e. the nearest
// vertex the user hasn't reached yet), for use as the AR arrow's target.
export function nextRoutePoint(
  routeCoordinates: LatLng[],
  currentPosition: LatLng,
  reachedRadiusMeters = 12,
): LatLng | undefined {
  for (const point of routeCoordinates) {
    if (distanceMeters(currentPosition, point) > reachedRadiusMeters) {
      return point;
    }
  }
  return routeCoordinates[routeCoordinates.length - 1];
}

// Decodes a Google Maps encoded polyline string into a list of coordinates.
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
export function decodePolyline(encoded: string): LatLng[] {
  const coordinates: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return coordinates;
}
