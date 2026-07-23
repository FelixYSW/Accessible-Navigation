/**
 * useLocation.ts
 *
 * Requests iOS foreground location permission and returns the device's current
 * coordinates. Degrades gracefully on denial — returns `null` coords so
 * downstream hooks can handle the absence without crashing.
 *
 * Business logic only — no UI rendered here.
 */

import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Coords {
  latitude: number;
  longitude: number;
}

export type LocationPermissionStatus = 'undetermined' | 'granted' | 'denied';

export interface UseLocationReturn {
  /** Current device coordinates, or null if permission denied / not yet resolved. */
  coords: Coords | null;
  /** Whether the initial permission + position fetch is still in progress. */
  loading: boolean;
  /** Human-readable error message, or null if no error. */
  error: string | null;
  /** Current permission status. */
  permissionStatus: LocationPermissionStatus;
  /** Imperatively re-fetch the current position (e.g. on user tap). */
  refresh: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Requests foreground location permission on mount and resolves the device's
 * current position once. Call `refresh()` to update the position on demand.
 */
export function useLocation(): UseLocationReturn {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<LocationPermissionStatus>('undetermined');

  const fetchPosition = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      // Request foreground permission — shows iOS system dialog on first call.
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setPermissionStatus('denied');
        setError(
          'Location permission denied. Please enable it in Settings to use navigation.',
        );
        return;
      }

      setPermissionStatus('granted');

      // HIGH accuracy for walking navigation; timeout after 10 s.
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 10_000,
        mayShowUserSettingsDialog: true,
      });

      setCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to determine location.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch once on mount.
  useEffect(() => {
    void fetchPosition();
  }, [fetchPosition]);

  return {
    coords,
    loading,
    error,
    permissionStatus,
    refresh: fetchPosition,
  };
}
