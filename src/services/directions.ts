import Constants from 'expo-constants';
import { decodePolyline } from '../utils/geo';
import type { LatLng, PlaceSuggestion, RouteStep, WalkingRoute } from '../types/route';

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

// NOTE: Google's Directions API has no "wheelchair accessible" walking
// option - that parameter only exists for `mode=transit`
// (transit_routing_preference=less_walking doesn't apply either, and
// there's no avoid=stairs/curbs equivalent for walking). There is no
// server-side way to request or filter for wheelchair-accessible routes
// here; every route Google returns for mode=walking is used as-is, unfiltered.

// One step of the API's turn-by-turn directions, in the shape the navigation
// banner needs.
function parseStep(step: any): RouteStep {
  const instruction = stripHtml(step.html_instructions ?? '');
  return {
    instruction,
    road: roadFromInstruction(instruction),
    maneuver: step.maneuver || undefined,
    distanceMeters: step.distance?.value ?? 0,
    start: { latitude: step.start_location.lat, longitude: step.start_location.lng },
    end: { latitude: step.end_location.lat, longitude: step.end_location.lng },
  };
}

// `html_instructions` is markup ("Turn <b>left</b> onto <b>Jalan Tun
// Razak</b>"), sometimes with a <div> carrying a secondary note. The tags are
// dropped and the div is turned into a sentence break so the two don't run
// into each other as one word.
function stripHtml(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// The road a step runs along. Google phrases walking instructions as "Turn
// left onto X", "Continue onto X", "Head north on X" - so the road is whatever
// follows the last "onto" or " on ". Anything else ("Head north", "Destination
// will be on the right") names no road, and the banner falls back to the
// instruction itself rather than showing a fragment of one.
function roadFromInstruction(instruction: string): string | undefined {
  const match = instruction.match(/\b(?:onto|on)\s+(.+?)(?:\.|,|$)/i);
  const road = match?.[1]?.trim();
  if (!road) return undefined;
  // "on the right"/"on your left" are directions, not roads.
  if (/^(the|your)\b/i.test(road)) return undefined;
  return road;
}

// Fetches every walking route Google offers between two points (not just
// the fastest) so the user can preview and pick between them, sorted
// fastest-first.
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

  const routes: WalkingRoute[] = data.routes.map((route: any) => {
    const leg = route.legs[0];
    // Each step carries its own, higher-resolution polyline; the route's
    // overview_polyline is a lossy simplification meant for quick preview
    // rendering, and decoding it directly is what made routes look overly
    // boxy/jagged at turns. Stitching the per-step polylines together
    // instead follows the actual street geometry much more closely.
    const coordinates = leg.steps.flatMap((step: any) => decodePolyline(step.polyline.points));
    return {
      origin,
      destination,
      destinationName,
      destinationAddress,
      coordinates,
      steps: leg.steps.map(parseStep),
      distanceMeters: leg.distance.value,
      durationSeconds: leg.duration.value,
      summary: route.summary || undefined,
    };
  });

  return routes.sort((a, b) => a.durationSeconds - b.durationSeconds);
}
