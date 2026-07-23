/**
 * useAppStateMachine.ts
 *
 * Single source of truth for all top-level UI state transitions.
 * The three states map directly to distinct UI configurations:
 *
 *   'default'    → full-screen Camera + SearchBar bottom sheet (25%)
 *   'preview'    → full-screen MapKit + route info bottom sheet (15%)
 *   'navigating' → full-screen Camera with AR overlay + ETA bottom sheet (10%)
 *
 * This hook only manages state and exposes typed transition functions.
 * It contains NO UI code and NO side effects beyond useState.
 */

import { useCallback, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

/** The three mutually exclusive top-level application states. */
export type AppState = 'default' | 'preview' | 'navigating';

/**
 * Minimal representation of a selected Google Place, derived from the
 * Places API (New) Autocomplete response.
 */
export interface SelectedPlace {
  /** Google Place ID — used as the Directions API destination. */
  placeId: string;
  /** Human-readable primary name of the place (e.g. "King's College London"). */
  displayName: string;
  /** Secondary human-readable address line. */
  formattedAddress: string;
}

export interface UseAppStateMachineReturn {
  /** Current top-level application state. */
  appState: AppState;

  /** The place the user has selected (set once place is chosen). */
  selectedPlace: SelectedPlace | null;

  /**
   * Transition: 'default' → 'preview'
   * Called when the user taps an autocomplete suggestion.
   */
  selectPlace: (place: SelectedPlace) => void;

  /**
   * Transition: 'preview' → 'navigating'
   * Called when the user taps "Start Navigation".
   */
  startNavigation: () => void;

  /**
   * Transition: 'navigating' | 'preview' → 'default'
   * Called when the user taps "Cancel Route" or the back gesture.
   */
  cancelRoute: () => void;

  /**
   * Transition: 'preview' → 'default' (keeps appState, clears selectedPlace)
   * Useful for the back button in preview state.
   */
  clearPlace: () => void;
}

// ─── Snap Points ──────────────────────────────────────────────────────────────

/**
 * Bottom-sheet snap point string for each state. Exported so the main screen
 * can pass them directly to BottomSheet without duplicating the mapping.
 */
export const SNAP_POINTS: Record<AppState, string[]> = {
  default:    ['25%'],
  preview:    ['45%'],
  navigating: ['15%'],
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAppStateMachine(): UseAppStateMachineReturn {
  const [appState, setAppState] = useState<AppState>('default');
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);

  const selectPlace = useCallback((place: SelectedPlace) => {
    setSelectedPlace(place);
    setAppState('preview');
  }, []);

  const startNavigation = useCallback(() => {
    setAppState('navigating');
  }, []);

  const cancelRoute = useCallback(() => {
    setSelectedPlace(null);
    setAppState('default');
  }, []);

  const clearPlace = useCallback(() => {
    setSelectedPlace(null);
    setAppState('default');
  }, []);

  return {
    appState,
    selectedPlace,
    selectPlace,
    startNavigation,
    cancelRoute,
    clearPlace,
  };
}
