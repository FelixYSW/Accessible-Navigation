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
//
// `region` carries only a centre and a lat/lng span - it says nothing about
// the camera's heading or pitch, so this is only correct for a north-up, flat
// map. MapScreen disables the rotate and tilt gestures to keep that true.
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
// Returns the *index* of that vertex rather than the coordinate itself, so
// callers can look at its neighbours too.
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

// Thins a route polyline down to a set of points spaced at least
// `minSpacingMeters` apart, capped at `maxPoints`. Route geometry runs to
// hundreds of vertices bunched around corners, which is far more precision
// than a proximity query needs and would make the request body enormous.
// The first and last points are always kept.
export function samplePolyline(
  coordinates: LatLng[],
  minSpacingMeters: number,
  maxPoints: number,
): LatLng[] {
  if (coordinates.length <= 2) return [...coordinates];

  const kept: LatLng[] = [coordinates[0]];
  for (let i = 1; i < coordinates.length - 1; i += 1) {
    if (distanceMeters(kept[kept.length - 1], coordinates[i]) >= minSpacingMeters) {
      kept.push(coordinates[i]);
    }
  }
  kept.push(coordinates[coordinates.length - 1]);

  if (kept.length <= maxPoints) return kept;

  // Still too many on a long route - drop to an evenly spaced subset rather
  // than truncating, so the whole route stays covered.
  const step = (kept.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => kept[Math.round(i * step)]);
}

// How closely two routes follow the same ground, as a 0-1 fraction.
//
// Used to reconcile an OpenRouteService accessible route with Google's
// alternatives: the two engines route over different graphs (ORS uses OSM
// sidewalk ways where they are mapped, Google often road centrelines), so
// geometry that means "the same street" can differ by a pavement's width.
//
// Scored symmetrically - the fraction of each route lying close to the other,
// then the worse of the two. One-directional coverage would call a short route
// a match for a long one that happens to contain it.
export function routeSimilarity(
  a: LatLng[],
  b: LatLng[],
  toleranceMeters: number,
): number {
  if (a.length === 0 || b.length === 0) return 0;

  // Both sides are thinned first: this is O(n*m), and raw route geometry runs
  // to hundreds of vertices. `b` keeps the finer spacing because it is what
  // distances are measured against, and it is sampled by vertex rather than
  // interpolated - so its points must be closer together than the tolerance.
  const coarseA = samplePolyline(a, toleranceMeters, 150);
  const coarseB = samplePolyline(b, toleranceMeters, 150);
  const fineA = samplePolyline(a, toleranceMeters / 3, 400);
  const fineB = samplePolyline(b, toleranceMeters / 3, 400);

  return Math.min(
    coverage(coarseA, fineB, toleranceMeters),
    coverage(coarseB, fineA, toleranceMeters),
  );
}

// Fraction of `points` lying within `tolerance` of any point in `against`.
// `against` is sampled finely by the caller, since distance is measured to its
// vertices rather than to its segments.
function coverage(points: LatLng[], against: LatLng[], tolerance: number): number {
  let near = 0;
  for (const point of points) {
    if (against.some((other) => distanceMeters(point, other) <= tolerance)) near += 1;
  }
  return near / points.length;
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

// Given a route polyline and the user's current position, finds the next point
// on the route that is still ahead of the user - the nearest vertex they
// haven't reached yet - for use as the AR arrow's target.
//
// The search starts from the vertex the walker is closest to, not from the
// start of the route. Scanning from the start instead returns the first vertex
// further than the reached radius, and once the walker is more than that far
// from the origin - which happens within the first few paces - that vertex is
// the origin itself. The arrow would then point back the way they came for the
// rest of the walk.
export function nextRoutePoint(
  routeCoordinates: LatLng[],
  currentPosition: LatLng,
  reachedRadiusMeters = 12,
): LatLng | undefined {
  const index = nextRoutePointIndex(routeCoordinates, currentPosition, reachedRadiusMeters);
  return index === undefined ? undefined : routeCoordinates[index];
}

/** As `nextRoutePoint`, but returns the index - so a caller can also look at
 *  what the route does *after* that point. */
export function nextRoutePointIndex(
  routeCoordinates: LatLng[],
  currentPosition: LatLng,
  reachedRadiusMeters = 12,
): number | undefined {
  if (routeCoordinates.length === 0) return undefined;

  let nearestIndex = 0;
  let nearestDistance = Infinity;
  for (let i = 0; i < routeCoordinates.length; i += 1) {
    const distance = distanceMeters(currentPosition, routeCoordinates[i]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }

  for (let i = nearestIndex; i < routeCoordinates.length; i += 1) {
    if (distanceMeters(currentPosition, routeCoordinates[i]) > reachedRadiusMeters) {
      return i;
    }
  }
  return routeCoordinates.length - 1;
}

// The direction the route runs once it is past `index`, as a compass bearing.
//
// Measured to a point a good way further along rather than to the very next
// vertex: route polylines are stitched from per-step geometry and their
// vertices can sit a couple of metres apart, so the bearing to the immediate
// next one is mostly noise. Undefined at the end of the route, where there is
// no onward direction to report.
export function routeBearingAfter(
  routeCoordinates: LatLng[],
  index: number,
  lookAheadMeters = 15,
): number | undefined {
  const from = routeCoordinates[index];
  if (!from) return undefined;

  for (let i = index + 1; i < routeCoordinates.length; i += 1) {
    if (distanceMeters(from, routeCoordinates[i]) >= lookAheadMeters) {
      return bearingBetween(from, routeCoordinates[i]);
    }
  }

  const last = routeCoordinates[routeCoordinates.length - 1];
  return last === from ? undefined : bearingBetween(from, last);
}

// How far along the route a position falls, in metres from its start.
//
// Measured onto the nearest *segment* rather than to the nearest vertex.
// Vertices sit several metres apart on a straight stretch, so snapping to them
// would leave this answer unchanged for a dozen paces and then jump - and the
// AR anchors are spaced off this figure, so a jump would move them.
export function distanceAlongRoute(coordinates: LatLng[], position: LatLng): number {
  if (coordinates.length < 2) return 0;

  let travelled = 0;
  let best = 0;
  let bestOffset = Infinity;

  for (let i = 1; i < coordinates.length; i += 1) {
    const segmentLength = distanceMeters(coordinates[i - 1], coordinates[i]);
    const fraction = fractionAlongSegment(position, coordinates[i - 1], coordinates[i]);
    const offset = distanceMeters(
      position,
      interpolateCoordinate(coordinates[i - 1], coordinates[i], fraction),
    );

    if (offset < bestOffset) {
      bestOffset = offset;
      best = travelled + fraction * segmentLength;
    }
    travelled += segmentLength;
  }

  return best;
}

// The coordinate a given distance along the route, interpolated within the
// segment it lands in. Undefined past the end, which is how a caller knows it
// has run out of route rather than being handed the destination over and over.
export function pointAtDistanceAlong(
  coordinates: LatLng[],
  meters: number,
): LatLng | undefined {
  if (coordinates.length === 0) return undefined;
  if (meters <= 0) return coordinates[0];

  let travelled = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const segmentLength = distanceMeters(coordinates[i - 1], coordinates[i]);
    if (travelled + segmentLength >= meters) {
      const fraction = segmentLength === 0 ? 0 : (meters - travelled) / segmentLength;
      return interpolateCoordinate(coordinates[i - 1], coordinates[i], fraction);
    }
    travelled += segmentLength;
  }

  return undefined;
}

// Metres per degree of latitude. Longitude shrinks towards the poles, so it is
// scaled by the cosine of the latitude wherever it is used.
const METERS_PER_DEGREE_LAT = (EARTH_RADIUS_METERS * Math.PI) / 180;

// The local north/east displacement from one coordinate to another, in metres.
//
// A flat approximation, which over the tens of metres this is used for is
// accurate to well under a centimetre - far below the accuracy of anything
// being measured with it.
export function metersBetween(from: LatLng, to: LatLng): { north: number; east: number } {
  return {
    north: (to.latitude - from.latitude) * METERS_PER_DEGREE_LAT,
    east:
      (to.longitude - from.longitude) *
      METERS_PER_DEGREE_LAT *
      Math.cos(toRadians(from.latitude)),
  };
}

/** The inverse of `metersBetween`: a coordinate shifted by a north/east offset. */
export function offsetCoordinate(origin: LatLng, north: number, east: number): LatLng {
  return {
    latitude: origin.latitude + north / METERS_PER_DEGREE_LAT,
    longitude:
      origin.longitude +
      east / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(origin.latitude))),
  };
}

// The direction the route runs at a given distance along it, as a unit
// north/east vector. Measured across a short span rather than from one vertex
// to the next, since consecutive vertices can sit centimetres apart and the
// direction between them is then mostly rounding noise.
export function routeDirectionAt(
  coordinates: LatLng[],
  meters: number,
  spanMeters = 1.5,
): { north: number; east: number } | undefined {
  const half = spanMeters / 2;
  const behind = pointAtDistanceAlong(coordinates, Math.max(0, meters - half));
  // Past the end of the route there is nothing ahead to aim at, so the span
  // collapses backwards onto the last of it.
  const ahead =
    pointAtDistanceAlong(coordinates, meters + half) ??
    pointAtDistanceAlong(coordinates, meters) ??
    coordinates[coordinates.length - 1];

  if (!behind || !ahead) return undefined;

  const delta = metersBetween(behind, ahead);
  const length = Math.hypot(delta.north, delta.east);
  if (length < 1e-6) return undefined;

  return { north: delta.north / length, east: delta.east / length };
}

// How far to one side of the route a position is standing, in metres, positive
// to the right of the direction of travel.
//
// This is the number that says which pavement someone is on. Walking routes are
// drawn down the middle of the road, so a walker is reliably a couple of metres
// to one side of the line the route describes - and it is a *signed*,
// perpendicular quantity rather than a fixed compass offset, because "the left
// pavement" points a different way on every leg of the route.
export function lateralOffsetFromRoute(
  coordinates: LatLng[],
  position: LatLng,
): number | undefined {
  const along = distanceAlongRoute(coordinates, position);
  const onRoute = pointAtDistanceAlong(coordinates, along);
  const direction = routeDirectionAt(coordinates, along);
  if (!onRoute || !direction) return undefined;

  const delta = metersBetween(onRoute, position);
  // Dot with the rightward normal of the direction of travel, which in
  // north/east terms is (-east, north).
  return delta.north * -direction.east + delta.east * direction.north;
}

// A point a given distance along the route, shifted sideways onto the walker's
// own side of it. The shift follows the route round its corners, since it is
// applied along the local perpendicular rather than as a fixed bearing.
export function pointBesideRoute(
  coordinates: LatLng[],
  meters: number,
  lateralMeters: number,
): LatLng | undefined {
  const point = pointAtDistanceAlong(coordinates, meters);
  if (!point || lateralMeters === 0) return point;

  const direction = routeDirectionAt(coordinates, meters);
  if (!direction) return point;

  return offsetCoordinate(
    point,
    -direction.east * lateralMeters,
    direction.north * lateralMeters,
  );
}

// Where the foot of the perpendicular from `position` falls on segment a-b, as
// a 0-1 fraction of the segment, clamped to its ends.
//
// Worked in degrees with longitude squashed by the latitude, which is accurate
// well past the length of any route segment and avoids a projection: the units
// cancel in the ratio, so only the shape of the triangle matters.
function fractionAlongSegment(position: LatLng, a: LatLng, b: LatLng): number {
  const squash = Math.cos(toRadians(a.latitude));
  const bx = (b.longitude - a.longitude) * squash;
  const by = b.latitude - a.latitude;
  const px = (position.longitude - a.longitude) * squash;
  const py = position.latitude - a.latitude;

  const lengthSquared = bx * bx + by * by;
  if (lengthSquared === 0) return 0;

  return Math.min(1, Math.max(0, (px * bx + py * by) / lengthSquared));
}

function interpolateCoordinate(a: LatLng, b: LatLng, fraction: number): LatLng {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * fraction,
    longitude: a.longitude + (b.longitude - a.longitude) * fraction,
  };
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
