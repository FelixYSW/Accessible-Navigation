import Constants from 'expo-constants';
import { decodePolyline, distanceMeters } from '../utils/geo';
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

// Words people type for a kind of place, mapped to the Google place type that
// means it.
//
// Searching a type rather than a keyword is the difference between "places
// near me that are pharmacies" and "places near me with the word pharmacy in
// their name" - which in Malaysia misses Guardian, Watsons, Caring and every
// independent farmasi, while matching anything that happens to be called
// "... Pharmacy Sdn Bhd" however far away it is.
//
// Deliberately short. Every entry has to be a word someone would actually type
// into a walking app, and a long list of guesses would mostly serve to
// hijack searches that were meant literally.
const PLACE_TYPES: Record<string, string> = {
  atm: 'atm',
  bakery: 'bakery',
  bank: 'bank',
  bar: 'bar',
  'bus station': 'bus_station',
  'bus stop': 'bus_station',
  cafe: 'cafe',
  clinic: 'doctor',
  'convenience store': 'convenience_store',
  dentist: 'dentist',
  doctor: 'doctor',
  gym: 'gym',
  hospital: 'hospital',
  hotel: 'lodging',
  laundry: 'laundry',
  library: 'library',
  lrt: 'subway_station',
  mall: 'shopping_mall',
  market: 'supermarket',
  mosque: 'mosque',
  mrt: 'subway_station',
  park: 'park',
  parking: 'parking',
  petrol: 'gas_station',
  'petrol station': 'gas_station',
  pharmacy: 'pharmacy',
  farmasi: 'pharmacy',
  police: 'police',
  'post office': 'post_office',
  restaurant: 'restaurant',
  school: 'school',
  'shopping mall': 'shopping_mall',
  supermarket: 'supermarket',
  'train station': 'train_station',
  university: 'university',
};

function placeTypeFor(query: string): string | undefined {
  return PLACE_TYPES[query.trim().toLowerCase()];
}

// Suggestions for whatever is in the search bar.
//
// Nearby Search ranked by distance is the primary source, and Autocomplete is
// the fallback rather than the other way round. That is the opposite of the
// obvious arrangement and it is the fix for a real failure: Autocomplete ranks
// by relevance and prominence, so searching a chain returned the branches
// Google considers notable rather than the ones within walking distance -
// 1.2km away first while the 300m branch was not in the list at all. Sorting
// cannot repair a list that never contained the right answer.
//
// Nearby Search asks a different question - "places matching this, nearest
// first" - and answers it with real coordinates. Autocomplete still gets the
// things Nearby Search cannot do: street addresses, and named places that are
// not a POI category.
export async function getSuggestions(
  query: string,
  origin: LatLng,
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return getNearbyPlaces(origin);

  try {
    const nearby = await searchNearby(trimmed, origin);
    if (nearby.length > 0) return nearby;
  } catch {
    // Fall through to Autocomplete, which is a different endpoint and may well
    // still answer.
  }

  return getPlaceAutocomplete(trimmed, origin);
}

// Places matching `query`, nearest first, with no distance limit.
//
// `rankby=distance` is what does the work here, and it comes with two API
// constraints worth knowing: it forbids `radius`, and it requires one of
// keyword, name or type. A category search sends `type` alone rather than both
// - adding the keyword as well would AND the two and cut out every pharmacy
// not literally named "pharmacy", which is the failure this is here to avoid.
async function searchNearby(query: string, origin: LatLng): Promise<PlaceSuggestion[]> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('rankby', 'distance');
  url.searchParams.set('key', apiKey);

  const type = placeTypeFor(query);
  if (type) {
    url.searchParams.set('type', type);
  } else {
    url.searchParams.set('keyword', query);
  }

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new DirectionsError(`Could not search nearby (${data.status ?? 'unknown error'}).`);
  }

  return toSuggestions(data.results, origin);
}

// Places open around the user, shown as suggestions when the search bar is
// focused but empty (Places Nearby Search).
async function getNearbyPlaces(origin: LatLng): Promise<PlaceSuggestion[]> {
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

  return toSuggestions(data.results, origin);
}

// Nearby Search results to suggestions. Coordinates come back on every result,
// so the distance is measured here rather than asked for - there is no `origin`
// parameter on this endpoint the way there is on Autocomplete.
function toSuggestions(results: any, origin: LatLng): PlaceSuggestion[] {
  const suggestions: PlaceSuggestion[] = (results ?? []).map((result: any) => {
    const location = result.geometry?.location;
    return {
      placeId: result.place_id as string,
      name: result.name as string,
      secondaryText: result.vicinity as string | undefined,
      distanceMeters:
        typeof location?.lat === 'number' && typeof location?.lng === 'number'
          ? distanceMeters(origin, { latitude: location.lat, longitude: location.lng })
          : undefined,
    };
  });

  return byDistance(suggestions);
}

// Places matching what the user has typed so far (Places Autocomplete),
// biased toward the user's current location and returned nearest first.
//
// `location` + `radius` bias *which* places come back; `origin` is a separate
// parameter that asks Google to measure each prediction from a point and return
// `distance_meters` with it. Without `origin` the predictions carry no distance
// at all, and the only other way to get one would be a Place Details request
// per suggestion - four or five extra round trips on every keystroke, billed
// individually. One parameter replaces all of that.
async function getPlaceAutocomplete(
  input: string,
  origin: LatLng,
): Promise<PlaceSuggestion[]> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', input);
  url.searchParams.set('location', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('radius', String(NEARBY_SEARCH_RADIUS_METERS));
  url.searchParams.set('origin', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new DirectionsError(`Could not load suggestions (${data.status ?? 'unknown error'}).`);
  }

  const suggestions: PlaceSuggestion[] = (data.predictions ?? []).map((prediction: any) => ({
    placeId: prediction.place_id as string,
    name: (prediction.structured_formatting?.main_text ?? prediction.description) as string,
    secondaryText: prediction.structured_formatting?.secondary_text as string | undefined,
    distanceMeters:
      typeof prediction.distance_meters === 'number' ? prediction.distance_meters : undefined,
  }));

  return byDistance(suggestions);
}

// Nearest first, with anything Google could not measure left in the order it
// gave them.
//
// This deliberately overrides Google's own ranking, which is by relevance to
// the typed text. For a walking app that is the right trade: someone on foot
// searching "pharmacy" wants the one they can reach, and the second-best name
// match 300m away beats the best one across the city. It is a real trade
// though - a distinctive query whose obvious answer is far away will no longer
// come first.
//
// `sort` is stable in Hermes, so the unmeasured tail keeps Google's relevance
// order among itself rather than being shuffled.
function byDistance(suggestions: PlaceSuggestion[]): PlaceSuggestion[] {
  return [...suggestions].sort((a, b) => {
    if (a.distanceMeters === undefined && b.distanceMeters === undefined) return 0;
    if (a.distanceMeters === undefined) return 1;
    if (b.distanceMeters === undefined) return -1;
    return a.distanceMeters - b.distanceMeters;
  });
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
