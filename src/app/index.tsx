/**
 * index.tsx — Main Orchestrator Screen
 *
 * This file ONLY:
 *  1. Calls the three custom hooks to get state and data.
 *  2. Decides which full-screen background to render (Camera vs Map).
 *  3. Drives the BottomSheet snap point from the current app state.
 *  4. Renders state-specific bottom sheet content.
 *
 * Zero business logic lives here — all logic is in hooks and components.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BottomSheet, {
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { SafeAreaView } from 'react-native-safe-area-context';

// ── Hooks ──────────────────────────────────────────────────────────────────
import { useLocation } from '../hooks/useLocation';
import { useDirections } from '../hooks/useDirections';
import {
  useAppStateMachine,
  SNAP_POINTS,
} from '../hooks/useAppStateMachine';

// ── Components ─────────────────────────────────────────────────────────────
import { CameraView } from '../components/CameraView';
import { MacroMapView } from '../components/MacroMapView';
import { SearchBar } from '../components/SearchBar';

// ─── Live ETA Helpers ─────────────────────────────────────────────────────────

/** Format seconds into a human-readable ETA string (e.g. "12 min"). */
function formatEta(seconds: number): string {
  if (seconds < 60) return `< 1 min`;
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

/** Format metres into a human-readable distance string. */
function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MainScreen(): React.JSX.Element {
  // ── Custom hooks ────────────────────────────────────────────────────────
  const { coords, loading: locationLoading } = useLocation();

  const {
    appState,
    selectedPlace,
    selectPlace,
    startNavigation,
    cancelRoute,
    clearPlace,
  } = useAppStateMachine();

  const {
    routes,
    selectedRouteIndex,
    setSelectedRouteIndex,
    selectedRoute,
    loading: directionsLoading,
    error: directionsError,
  } = useDirections(
    coords,
    selectedPlace?.placeId ?? null,
  );

  // ── Bottom sheet setup ─────────────────────────────────────────────────
  const bottomSheetRef = useRef<BottomSheet>(null);

  // Derive snap points from the current state using the exported constant.
  const snapPoints = useMemo(
    () => SNAP_POINTS[appState],
    [appState],
  );

  // Animate to the correct snap point when the state changes.
  useEffect(() => {
    bottomSheetRef.current?.snapToIndex(0);
  }, [appState]);

  // ── Background component selection ────────────────────────────────────
  const showCamera = appState === 'default' || appState === 'navigating';
  const showMap    = appState === 'preview';

  // ── Route selection handler ───────────────────────────────────────────
  const handleRouteSelect = useCallback(
    (index: number) => setSelectedRouteIndex(index),
    [setSelectedRouteIndex],
  );

  // ── Bottom sheet content by state ─────────────────────────────────────

  const renderDefaultContent = (): React.JSX.Element => (
    <View style={styles.sheetContent}>
      <View style={styles.sheetHandle} />
      <Text style={styles.sheetHeading}>Where would you like to go?</Text>
      {locationLoading ? (
        <View style={styles.centreRow}>
          <ActivityIndicator color="#3b82f6" />
          <Text style={styles.mutedText}>Acquiring location…</Text>
        </View>
      ) : (
        <SearchBar
          onPlaceSelected={selectPlace}
          isNavigating={false}
        />
      )}
    </View>
  );

  const renderPreviewContent = (): React.JSX.Element => (
    <View style={styles.sheetContent}>
      <View style={styles.sheetHandle} />

      {/* Destination header */}
      <View style={styles.destinationHeader}>
        <View style={styles.destinationIcon}>
          <Text style={styles.destinationIconText}>📍</Text>
        </View>
        <View style={styles.destinationTextGroup}>
          <Text style={styles.destinationName} numberOfLines={1}>
            {selectedPlace?.displayName ?? 'Destination'}
          </Text>
          <Text style={styles.destinationAddress} numberOfLines={1}>
            {selectedPlace?.formattedAddress ?? ''}
          </Text>
        </View>
        {/* Back button */}
        <TouchableOpacity
          onPress={clearPlace}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to search"
        >
          <Text style={styles.backButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Loading / error / route info */}
      {directionsLoading && (
        <View style={styles.centreRow}>
          <ActivityIndicator color="#3b82f6" />
          <Text style={styles.mutedText}>Finding routes…</Text>
        </View>
      )}

      {directionsError && !directionsLoading && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{directionsError}</Text>
        </View>
      )}

      {selectedRoute && !directionsLoading && (
        <>
          {/* Route summary strip */}
          <View style={styles.routeSummaryRow}>
            <View style={styles.routeSummaryItem}>
              <Text style={styles.routeSummaryValue}>
                {selectedRoute.duration}
              </Text>
              <Text style={styles.routeSummaryLabel}>Walk time</Text>
            </View>
            <View style={styles.routeSummaryDivider} />
            <View style={styles.routeSummaryItem}>
              <Text style={styles.routeSummaryValue}>
                {selectedRoute.distance}
              </Text>
              <Text style={styles.routeSummaryLabel}>Distance</Text>
            </View>
            {routes.length > 1 && (
              <>
                <View style={styles.routeSummaryDivider} />
                <View style={styles.routeSummaryItem}>
                  <Text style={styles.routeSummaryValue}>
                    {routes.length}
                  </Text>
                  <Text style={styles.routeSummaryLabel}>Routes</Text>
                </View>
              </>
            )}
          </View>

          {/* Alternative route pills */}
          {routes.length > 1 && (
            <BottomSheetScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.routePillsContainer}
            >
              {routes.map((r, i) => (
                <TouchableOpacity
                  key={`pill-${i}`}
                  style={[
                    styles.routePill,
                    i === selectedRouteIndex && styles.routePillSelected,
                  ]}
                  onPress={() => handleRouteSelect(i)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: i === selectedRouteIndex }}
                  accessibilityLabel={`Route ${i + 1}: ${r.duration}, ${r.distance}`}
                >
                  <Text
                    style={[
                      styles.routePillText,
                      i === selectedRouteIndex && styles.routePillTextSelected,
                    ]}
                  >
                    Route {i + 1} · {r.duration}
                  </Text>
                </TouchableOpacity>
              ))}
            </BottomSheetScrollView>
          )}

          {/* CTA */}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={startNavigation}
            accessibilityRole="button"
            accessibilityLabel={`Start navigation to ${selectedPlace?.displayName ?? 'destination'}`}
          >
            <Text style={styles.primaryButtonText}>
              ▶  Start Navigation
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const renderNavigatingContent = (): React.JSX.Element => {
    const eta = selectedRoute?.durationSeconds ?? 0;
    const dist = selectedRoute?.distanceMetres ?? 0;

    return (
      <View style={styles.sheetContent}>
        <View style={styles.sheetHandle} />

        <View style={styles.navRow}>
          {/* ETA & distance */}
          <View style={styles.navStatsGroup}>
            <Text style={styles.navEta}>{formatEta(eta)}</Text>
            <Text style={styles.navDistance}>{formatDistance(dist)}</Text>
          </View>

          {/* Live indicator dot */}
          <View style={styles.navLiveBadge}>
            <View style={styles.navLiveDot} />
            <Text style={styles.navLiveText}>LIVE</Text>
          </View>

          {/* Cancel */}
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={cancelRoute}
            accessibilityRole="button"
            accessibilityLabel="Cancel route and return to search"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.destinationName} numberOfLines={1}>
          → {selectedPlace?.displayName ?? 'Destination'}
        </Text>
      </View>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* ── Full-screen background layer ─────────────────────────────── */}
      <View style={StyleSheet.absoluteFill}>
        {showCamera && (
          <CameraView
            appState={appState}
            nextInstruction={
              appState === 'navigating'
                ? `Head towards ${selectedPlace?.displayName ?? 'destination'}`
                : undefined
            }
          />
        )}
        {showMap && (
          <MacroMapView
            userCoords={coords}
            selectedPlace={selectedPlace}
            routes={routes}
            selectedRouteIndex={selectedRouteIndex}
            onRouteSelect={handleRouteSelect}
          />
        )}
      </View>

      {/* ── Persistent Bottom Sheet ───────────────────────────────────── */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        handleStyle={styles.handleContainer}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        // Animate snap points smoothly when state transitions
        animateOnMount
      >
        {appState === 'default'    && renderDefaultContent()}
        {appState === 'preview'    && renderPreviewContent()}
        {appState === 'navigating' && renderNavigatingContent()}
      </BottomSheet>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },

  // ── Bottom sheet chrome ──────────────────────────────────────────────────
  sheetBackground: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#1e293b',
    // Subtle glow effect
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  handleContainer: {
    backgroundColor: 'transparent',
    paddingTop: 12,
  },
  handleIndicator: {
    backgroundColor: '#334155',
    width: 36,
    height: 4,
    borderRadius: 2,
  },

  // ── Shared sheet content wrapper ─────────────────────────────────────────
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    gap: 14,
  },
  sheetHandle: {
    // Visual spacer — the real handle is rendered by @gorhom/bottom-sheet
    height: 4,
  },
  sheetHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
    letterSpacing: -0.3,
  },

  // ── Utility ──────────────────────────────────────────────────────────────
  centreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mutedText: {
    color: '#64748b',
    fontSize: 14,
  },
  errorCard: {
    backgroundColor: '#450a0a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },

  // ── Preview state — destination header ───────────────────────────────────
  destinationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  destinationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  destinationIconText: {
    fontSize: 18,
  },
  destinationTextGroup: {
    flex: 1,
    gap: 2,
  },
  destinationName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  destinationAddress: {
    fontSize: 12,
    color: '#64748b',
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  backButtonText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },

  // ── Route summary row ────────────────────────────────────────────────────
  routeSummaryRow: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  routeSummaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  routeSummaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  routeSummaryLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  routeSummaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#334155',
    marginHorizontal: 8,
  },

  // ── Route pills ──────────────────────────────────────────────────────────
  routePillsContainer: {
    gap: 8,
    paddingVertical: 2,
  },
  routePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  routePillSelected: {
    backgroundColor: '#1d4ed8',
    borderColor: '#3b82f6',
  },
  routePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  routePillTextSelected: {
    color: '#fff',
  },

  // ── Primary CTA ──────────────────────────────────────────────────────────
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },

  // ── Navigating state ─────────────────────────────────────────────────────
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navStatsGroup: {
    flex: 1,
    gap: 2,
  },
  navEta: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f1f5f9',
    letterSpacing: -1,
  },
  navDistance: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '500',
  },
  navLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#334155',
  },
  navLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#22c55e',
  },
  navLiveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#22c55e',
    letterSpacing: 1,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ef4444',
  },
});
