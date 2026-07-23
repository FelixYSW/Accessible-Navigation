/**
 * MacroMapView.tsx
 *
 * Renders Apple MapKit via react-native-maps (NO provider prop → defaults to
 * MapKit on iOS). Displays:
 *  - A destination Marker for the selected place.
 *  - Up to 3 walking route Polylines: blue (selected, zIndex 2), grey (alternatives).
 *  - Tappable alternative polylines that call onRouteSelect to switch the active route.
 *  - Automatic fitToCoordinates when routes change (with safe padding for the bottom sheet).
 *
 * No Google Maps native SDK is used anywhere in this file.
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import type { LatLng } from '../hooks/useDirections';
import type { SelectedPlace } from '../hooks/useAppStateMachine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutePolyline {
  points: LatLng[];
  duration: string;
  distance: string;
  durationSeconds: number;
  distanceMetres: number;
}

interface MacroMapViewProps {
  /** Device's current location — used as the map's initial region centre. */
  userCoords: LatLng | null;
  /** The place the user has selected as their destination. */
  selectedPlace: SelectedPlace | null;
  /** All decoded routes returned by useDirections. */
  routes: RoutePolyline[];
  /** Index of the blue (active) route. */
  selectedRouteIndex: number;
  /** Called when the user taps an alternative polyline. */
  onRouteSelect: (index: number) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Edge padding (pts) applied to fitToCoordinates so polylines don't hide under the bottom sheet. */
const FIT_EDGE_PADDING = {
  top: 80,
  right: 40,
  bottom: 280, // tall enough to clear the 45% snap-point bottom sheet
  left: 40,
} as const;

const ROUTE_COLORS = {
  selected:    '#3b82f6', // blue-500
  alternative: '#94a3b8', // slate-400
} as const;

const ROUTE_WIDTHS = {
  selected:    6,
  alternative: 4,
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function MacroMapView({
  userCoords,
  selectedPlace,
  routes,
  selectedRouteIndex,
  onRouteSelect,
}: MacroMapViewProps): React.JSX.Element {
  const mapRef = useRef<MapView>(null);

  // ── Compute initial region ──────────────────────────────────────────────
  const initialRegion: Region | undefined = userCoords
    ? {
        latitude: userCoords.latitude,
        longitude: userCoords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : undefined;

  // ── Fit map to show full route on load / route switch ──────────────────
  useEffect(() => {
    if (!mapRef.current || routes.length === 0) return;

    // Collect all points from the selected route to compute bounding box.
    const selectedRoute = routes[selectedRouteIndex];
    if (!selectedRoute || selectedRoute.points.length === 0) return;

    // Small delay to ensure the map has laid out before fitting.
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(selectedRoute.points, {
        edgePadding: FIT_EDGE_PADDING,
        animated: true,
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [routes, selectedRouteIndex]);

  // ── Destination coordinate for the Marker ─────────────────────────────
  // Derive from the last point of the selected route (most accurate endpoint).
  const selectedRoutePoints = routes[selectedRouteIndex]?.points ?? [];
  const destinationCoord =
    selectedRoutePoints.length > 0
      ? selectedRoutePoints[selectedRoutePoints.length - 1]
      : null;

  return (
    <View style={styles.container}>
      {/*
       * NOTE: No `provider` prop is set.
       * react-native-maps defaults to Apple MapKit on iOS when PROVIDER_GOOGLE
       * is not specified. This satisfies the "no Google Maps SDK" constraint.
       */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation
        showsCompass
        showsScale
        rotateEnabled={false}
        accessibilityLabel="Walking route map"
        mapType="standard"
      >
        {/* ── Alternative routes (rendered first so they appear below selected) */}
        {routes.map((route, index) => {
          if (index === selectedRouteIndex) return null; // rendered separately below
          return (
            <Polyline
              key={`alt-route-${index}`}
              coordinates={route.points}
              strokeColor={ROUTE_COLORS.alternative}
              strokeWidth={ROUTE_WIDTHS.alternative}
              lineCap="round"
              lineJoin="round"
              tappable
              onPress={() => onRouteSelect(index)}
              accessibilityLabel={`Alternative route ${index + 1}, ${route.duration}, ${route.distance}. Tap to select.`}
            />
          );
        })}

        {/* ── Selected (active) route — rendered on top with higher z-index ── */}
        {routes[selectedRouteIndex] && (
          <Polyline
            key={`selected-route-${selectedRouteIndex}`}
            coordinates={routes[selectedRouteIndex].points}
            strokeColor={ROUTE_COLORS.selected}
            strokeWidth={ROUTE_WIDTHS.selected}
            lineCap="round"
            lineJoin="round"
            zIndex={2}
            accessibilityLabel={`Selected route, ${routes[selectedRouteIndex].duration}, ${routes[selectedRouteIndex].distance}`}
          />
        )}

        {/* ── Destination Marker ─────────────────────────────────────────── */}
        {destinationCoord && (
          <Marker
            coordinate={destinationCoord}
            title={selectedPlace?.displayName ?? 'Destination'}
            description={selectedPlace?.formattedAddress}
            pinColor={ROUTE_COLORS.selected}
            accessibilityLabel={`Destination: ${selectedPlace?.displayName ?? 'selected location'}`}
          />
        )}
      </MapView>

      {/* ── Route alternative selector badges (top-right) ─────────────── */}
      {routes.length > 1 && (
        <View style={styles.routeBadgeContainer}>
          {routes.map((route, index) => {
            const isSelected = index === selectedRouteIndex;
            return (
              <TouchableOpacity
                key={`badge-${index}`}
                style={[
                  styles.routeBadge,
                  isSelected && styles.routeBadgeSelected,
                ]}
                onPress={() => onRouteSelect(index)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Route ${index + 1}: ${route.duration}, ${route.distance}`}
              >
                <Text
                  style={[
                    styles.routeBadgeText,
                    isSelected && styles.routeBadgeTextSelected,
                  ]}
                >
                  {index + 1}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  routeBadgeContainer: {
    position: 'absolute',
    top: 60,
    right: 16,
    gap: 8,
  },
  routeBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#475569',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  routeBadgeSelected: {
    backgroundColor: '#3b82f6',
    borderColor: '#60a5fa',
  },
  routeBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
  },
  routeBadgeTextSelected: {
    color: '#fff',
  },
});
