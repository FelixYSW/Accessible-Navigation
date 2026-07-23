/**
 * useDirections.ts
 *
 * Fetches walking directions from the Google Directions REST API (not the SDK).
 * Returns up to 3 alternative routes with decoded polylines ready for
 * react-native-maps <Polyline> components.
 *
 * Reads the API key from process.env.EXPO_PUBLIC_GOOGLE_API_KEY — never
 * hardcoded.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coords } from './useLocation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface DirectionsRoute {
  /** Decoded polyline coordinates for react-native-maps <Polyline>. */
  points: LatLng[];
  /** Human-readable total duration string (e.g. "12 mins"). */
  duration: string;
  /** Duration in seconds for live ETA calculations. */
  durationSeconds: number;
  /** Human-readable total distance string (e.g. "950 m"). */
  distance: string;
  /** Distance in metres. */
  distanceMetres: number;
  /** Raw encoded polyline overview string (kept for reference). */
  encodedPolyline: string;
}

export interface UseDirectionsReturn {
  /** Up to 3 decoded walking routes. Empty array while loading or on error. */
  routes: DirectionsRoute[];
  /** Index of the route currently highlighted blue on the map. */
  selectedRouteIndex: number;
  /** Switch the active route (e.g. when user taps a grey alternative). */
  setSelectedRouteIndex: (index: number) => void;
  /** Convenience accessor — the currently selected route or null. */
  selectedRoute: DirectionsRoute | null;
  loading: boolean;
  error: string | null;
}

// ─── Polyline Decoder ─────────────────────────────────────────────────────────

/**
 * Decodes a Google Maps encoded polyline string into an array of LatLng objects.
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode latitude chunk
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    // Decode longitude chunk
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

// ─── Google Directions API response types (minimal) ───────────────────────────

interface DirectionsLeg {
  duration: { text: string; value: number };
  distance: { text: string; value: number };
}

interface DirectionsApiRoute {
  overview_polyline: { points: string };
  legs: DirectionsLeg[];
}

interface DirectionsApiResponse {
  status: string;
  routes: DirectionsApiRoute[];
  error_message?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches and decodes walking directions between `origin` and a Google Place ID.
 * Automatically re-fetches when either argument changes.
 *
 * @param origin          - Current device coordinates (from useLocation).
 * @param destinationPlaceId - Google Place ID of the selected destination.
 */
export function useDirections(
  origin: Coords | null,
  destinationPlaceId: string | null,
): UseDirectionsReturn {
  const [routes, setRoutes] = useState<DirectionsRoute[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Abort controller ref to cancel in-flight requests on re-fetch.
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDirections = useCallback(async () => {
    if (!origin || !destinationPlaceId) {
      setRoutes([]);
      return;
    }

    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      setError('Google API key is missing. Check your .env file.');
      return;
    }

    // Cancel any previous in-flight request.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setSelectedRouteIndex(0);

    try {
      const params = new URLSearchParams({
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `place_id:${destinationPlaceId}`,
        mode: 'walking',
        alternatives: 'true',
        key: apiKey,
      });

      const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`Directions API HTTP error: ${response.status}`);
      }

      const data: DirectionsApiResponse = await response.json();

      if (data.status === 'ZERO_RESULTS') {
        setError('No walking route found to that destination.');
        setRoutes([]);
        return;
      }

      if (data.status !== 'OK') {
        throw new Error(
          data.error_message ?? `Directions API error: ${data.status}`,
        );
      }

      // Parse and decode each route (cap at 3 alternatives).
      const decoded: DirectionsRoute[] = data.routes
        .slice(0, 3)
        .map((r: DirectionsApiRoute) => {
          // Aggregate legs for multi-leg journeys (walking usually has 1 leg).
          const totalDurationSecs = r.legs.reduce(
            (acc, leg) => acc + leg.duration.value,
            0,
          );
          const totalDistanceMetres = r.legs.reduce(
            (acc, leg) => acc + leg.distance.value,
            0,
          );

          const primaryLeg = r.legs[0];

          return {
            points: decodePolyline(r.overview_polyline.points),
            duration: primaryLeg.duration.text,
            durationSeconds: totalDurationSecs,
            distance: primaryLeg.distance.text,
            distanceMetres: totalDistanceMetres,
            encodedPolyline: r.overview_polyline.points,
          };
        });

      setRoutes(decoded);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was intentionally cancelled — not a user-visible error.
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Failed to fetch directions.';
      setError(message);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [origin, destinationPlaceId]);

  useEffect(() => {
    void fetchDirections();
    return () => {
      // Cleanup: cancel pending request when inputs change or component unmounts.
      abortControllerRef.current?.abort();
    };
  }, [fetchDirections]);

  const selectedRoute = routes[selectedRouteIndex] ?? null;

  return {
    routes,
    selectedRouteIndex,
    setSelectedRouteIndex,
    selectedRoute,
    loading,
    error,
  };
}
