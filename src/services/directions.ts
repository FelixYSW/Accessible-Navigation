import Constants from 'expo-constants';
import { decodePolyline } from '../utils/geo';
import type { LatLng, PlaceSuggestion, WalkingRoute } from '../types/route';

// How far around the user's current location to bias/limit place
// suggestions, in meters.
const NEARBY_SEARCH_RADIUS_METERS = 1500;

function getApiKey(): string {
  const key = Constants.expoConfig?.extra?.googleMapsApiKey as string | undefined;
  if (!key) {
    throw new Error(
      'Google Maps API key is not configured. Set GOOGLE_MAPS_API_KEY before building the app.',
    );
  }
  return key;
}

export class DirectionsError extends Error {}

// Places open around the user, shown as suggestions when the search bar is
// focused but empty (Places Nearby Search).
export async function getNearbyPlaces(origin: LatLng): Promise<PlaceSuggestion[]> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('radius', String(NEARBY_SEARCH_RADIUS_METERS));
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new DirectionsError(`Could not load nearby places (${data.status ?? 'unknown error'}).`);
  }

  return (data.results ?? []).map((result: any) => ({
    placeId: result.place_id as string,
    name: result.name as string,
    secondaryText: result.vicinity as string | undefined,
  }));
}

// Places matching what the user has typed so far (Places Autocomplete),
// biased toward the user's current location.
export async function getPlaceAutocomplete(
  input: string,
  origin: LatLng,
): Promise<PlaceSuggestion[]> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', input);
  url.searchParams.set('location', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('radius', String(NEARBY_SEARCH_RADIUS_METERS));
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new DirectionsError(`Could not load suggestions (${data.status ?? 'unknown error'}).`);
  }

  return (data.predictions ?? []).map((prediction: any) => ({
    placeId: prediction.place_id as string,
    name: (prediction.structured_formatting?.main_text ?? prediction.description) as string,
    secondaryText: prediction.structured_formatting?.secondary_text as string | undefined,
  }));
}

// Resolves a suggestion's place ID (from either of the two functions above)
// to the coordinates and address needed to fetch a walking route.
export async function getPlaceDetails(
  placeId: string,
): Promise<{ name: string; address?: string; location: LatLng }> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,geometry,formatted_address');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' || !data.result) {
    throw new DirectionsError(`Could not load place details (${data.status ?? 'unknown error'}).`);
  }

  return {
    name: data.result.name as string,
    address: data.result.formatted_address as string | undefined,
    location: {
      latitude: data.result.geometry.location.lat,
      longitude: data.result.geometry.location.lng,
    },
  };
}

// Resolves a free-text search query (e.g. "KLCC") to a place using the
// Google Places API Text Search endpoint.
export async function findPlace(
  query: string,
): Promise<{ name: string; address?: string; location: LatLng }> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' || !data.results?.length) {
    throw new DirectionsError(`No results found for "${query}" (${data.status ?? 'unknown error'}).`);
  }

  const result = data.results[0];
  return {
    name: result.name as string,
    address: result.formatted_address as string | undefined,
    location: {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
    },
  };
}

// A route is only walkable if it doesn't rely on a literal ferry crossing
// (nothing to walk on) - the Directions API will otherwise happily bridge a
// water gap with a FERRY step, which reads as "walking across the
// lake/river" once decoded onto the map. This only flags an explicit ferry
// leg, not every non-"WALKING" step - normal walking routes can legitimately
// include steps (e.g. crossing a bridge) that shouldn't be excluded, and
// over-filtering here was forcing every remaining option into a long
// detour around otherwise-fine, nearby routes.
function crossesWater(route: any): boolean {
  const steps = route.legs?.[0]?.steps ?? [];
  return steps.some(
    (step: any) => step.travel_mode === 'FERRY' || /\bferry\b/i.test(step.html_instructions ?? ''),
  );
}

// Fetches every walking route Google offers between two points (not just
// the fastest) so the user can preview and pick between them, sorted
// fastest-first. Routes that require a ferry (i.e. aren't actually
// walkable) are filtered out.
export async function getWalkingRoutes(
  origin: LatLng,
  destination: LatLng,
  destinationName: string,
  destinationAddress?: string,
): Promise<WalkingRoute[]> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('destination', `${destination.latitude},${destination.longitude}`);
  url.searchParams.set('mode', 'walking');
  url.searchParams.set('alternatives', 'true');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' || !data.routes?.length) {
    throw new DirectionsError(`Could not find a walking route (${data.status ?? 'unknown error'}).`);
  }

  const walkableRoutes = data.routes.filter((route: any) => !crossesWater(route));
  if (walkableRoutes.length === 0) {
    throw new DirectionsError(
      'No walkable route was found - every option Google returned crosses water with no path.',
    );
  }

  const routes: WalkingRoute[] = walkableRoutes.map((route: any) => {
    const leg = route.legs[0];
    return {
      origin,
      destination,
      destinationName,
      destinationAddress,
      coordinates: decodePolyline(route.overview_polyline.points),
      distanceMeters: leg.distance.value,
      durationSeconds: leg.duration.value,
      summary: route.summary || undefined,
    };
  });

  return routes.sort((a, b) => a.durationSeconds - b.durationSeconds);
}
