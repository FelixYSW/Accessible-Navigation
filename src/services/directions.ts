import Constants from 'expo-constants';
import { decodePolyline } from '../utils/geo';
import type { LatLng, WalkingRoute } from '../types/route';

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

// Resolves a free-text search query (e.g. "KLCC") to a place using the
// Google Places API Text Search endpoint.
export async function findPlace(query: string): Promise<{ name: string; location: LatLng }> {
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
    location: {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
    },
  };
}

// Fetches a walking route between two points using the Google Directions API
// and decodes the overview polyline into a coordinate list for rendering.
export async function getWalkingRoute(
  origin: LatLng,
  destination: LatLng,
  destinationName: string,
): Promise<WalkingRoute> {
  const apiKey = getApiKey();
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('destination', `${destination.latitude},${destination.longitude}`);
  url.searchParams.set('mode', 'walking');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' || !data.routes?.length) {
    throw new DirectionsError(`Could not find a walking route (${data.status ?? 'unknown error'}).`);
  }

  const route = data.routes[0];
  const leg = route.legs[0];

  return {
    origin,
    destination,
    destinationName,
    coordinates: decodePolyline(route.overview_polyline.points),
    distanceMeters: leg.distance.value,
    durationSeconds: leg.duration.value,
  };
}
