import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { LatLng, PlaceSuggestion, WalkingRoute } from '../types/route';
import { HAZARD_CLASSES } from '../types/hazard';
import {
  findPlace,
  getNearbyPlaces,
  getPlaceAutocomplete,
  getPlaceDetails,
  getWalkingRoutes,
} from '../services/directions';
import { summariseRouteHazards } from '../services/routeHazards';
import { formatDistance, formatDuration } from '../utils/format';
import { coordinateToScreenPoint, labelAnchorIndexForRoute } from '../utils/geo';
import type { MapRegion } from '../utils/geo';
import { RoutePill } from '../components/RoutePill';
import { useSettings } from '../theme/SettingsContext';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';

// How long to wait after the user stops typing before firing an
// autocomplete request, to avoid a network call on every keystroke.
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

// Screen-edge margin (in px) kept clear when framing route previews, so the
// polylines don't sit under the route panel at the bottom (the top margin is
// computed per-device from the safe area, since the search bar sits directly
// under it with no header above).
const ROUTE_FIT_SIDE_PADDING = { right: 60, bottom: 220, left: 60 };

// How far a route pill is pushed off its own route, perpendicular to the
// route's local direction, so the pill sits beside the line and its tail can
// point back at it.
const PILL_OFFSET = 46;

// Vertices either side of the anchor used to estimate the route's local
// direction. A single neighbour is too noisy on dense polylines.
const DIRECTION_SAMPLE_SPAN = 4;

type MapNavigation = NativeStackNavigationProp<RootStackParamList>;

export function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<MapNavigation>();
  const { T, F, darkMode, hazardActive } = useSettings();

  // With no header above it, the search bar sits right under the safe area.
  const searchBarTop = insets.top + 8;

  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState<WalkingRoute[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [warning, setWarning] = useState<{ title: string; message: string } | null>(null);
  // The map's current viewport and on-screen size, tracked so route pills can
  // be projected into screen space and follow the map as it moves.
  const [region, setRegion] = useState<MapRegion | null>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);

  // The vertex each route's pill is anchored to - recomputed only when the
  // route set changes, since the search is O(n*m) over route vertices.
  const anchorIndexes = useMemo(
    () =>
      routes.map((_, index) =>
        labelAnchorIndexForRoute(
          routes.map((r) => r.coordinates),
          index,
        ),
      ),
    [routes],
  );

  const activeHazardClasses = useMemo(
    () => HAZARD_CLASSES.filter((hazardClass) => hazardActive[hazardClass]),
    [hazardActive],
  );

  // In-app replacement for Alert.alert - keeps error/notice styling
  // consistent with the rest of the screen instead of the OS-native dialog.
  const showWarning = (title: string, message: string) => setWarning({ title, message });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showWarning(
          'Location permission needed',
          'Accessible Navigation needs your location to plan walking routes.',
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    })();
  }, []);

  // MapView's `initialRegion` is only read once, at mount - and the very
  // first render happens before the location fetch above resolves, so it
  // always starts on the Kuala Lumpur fallback. Once `origin` actually
  // arrives, explicitly move the camera there instead of relying on the
  // (by-then-ignored) prop.
  useEffect(() => {
    if (!origin || !mapRef.current) return;
    mapRef.current.animateToRegion({ ...origin, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
  }, [origin]);

  // Keeps the route panel (and suggestions box) above the on-screen keyboard -
  // both are absolutely positioned, so without this they end up rendered
  // underneath it and effectively disappear while the search bar is focused.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Keeps the suggestion list in sync with what's typed: nearby places when
  // the bar is focused and empty, debounced autocomplete matches otherwise.
  useEffect(() => {
    if (!suggestionsVisible || !origin) return;

    const trimmed = query.trim();
    let cancelled = false;
    setSuggestionsLoading(true);

    const timeout = setTimeout(
      async () => {
        try {
          const results = trimmed
            ? await getPlaceAutocomplete(trimmed, origin)
            : await getNearbyPlaces(origin);
          if (!cancelled) setSuggestions(results);
        } catch {
          // Suggestions are best-effort - stay quiet and just show nothing,
          // rather than interrupting typing with an alert.
          if (!cancelled) setSuggestions([]);
        } finally {
          if (!cancelled) setSuggestionsLoading(false);
        }
      },
      trimmed ? AUTOCOMPLETE_DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, suggestionsVisible, origin]);

  // Frames every previewed route on screen whenever a fresh set arrives (not
  // on re-selection - the camera shouldn't jump just because the user picked
  // a different alternative that's already in view).
  useEffect(() => {
    if (routes.length === 0 || !mapRef.current) return;
    const allCoordinates = routes.flatMap((r) => r.coordinates);
    mapRef.current.fitToCoordinates(allCoordinates, {
      edgePadding: { ...ROUTE_FIT_SIDE_PADDING, top: searchBarTop + 60 },
      animated: true,
    });
  }, [routes, searchBarTop]);

  const previewRoutes = async (
    destination: LatLng,
    destinationName: string,
    destinationAddress?: string,
  ) => {
    if (!origin) {
      showWarning(
        'Location not ready',
        'Still determining your current location, try again shortly.',
      );
      return;
    }

    setSuggestionsVisible(false);
    Keyboard.dismiss();
    setLoading(true);
    try {
      const walkingRoutes = await getWalkingRoutes(
        origin,
        destination,
        destinationName,
        destinationAddress,
      );
      setRoutes(walkingRoutes);
      setSelectedRouteIndex(0);
    } catch (error) {
      showWarning('Could not find route', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSuggestionsVisible(false);
    Keyboard.dismiss();
    try {
      const place = await findPlace(query.trim());
      await previewRoutes(place.location, place.name, place.address);
    } catch (error) {
      showWarning('Could not find route', error instanceof Error ? error.message : String(error));
    }
  };

  const handleSelectSuggestion = async (suggestion: PlaceSuggestion) => {
    setQuery(suggestion.name);
    setSuggestionsVisible(false);
    Keyboard.dismiss();
    try {
      const place = await getPlaceDetails(suggestion.placeId);
      await previewRoutes(place.location, place.name, place.address);
    } catch (error) {
      showWarning('Could not find route', error instanceof Error ? error.message : String(error));
    }
  };

  // Typing anything invalidates whatever route was previously previewed - the
  // panel should only ever reflect a destination the user actually picked
  // (via a suggestion or a submitted search), never stale text.
  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (routes.length > 0) setRoutes([]);
  };

  const handleClear = () => {
    setQuery('');
    setRoutes([]);
  };

  // Delayed so a tap on a suggestion row registers before the list unmounts
  // (the row's onPress would otherwise never fire, since blur happens first).
  const handleBlur = () => {
    setTimeout(() => setSuggestionsVisible(false), 150);
  };

  const selectedRoute = routes[selectedRouteIndex];
  const hazardSummary = summariseRouteHazards({}, T.green, activeHazardClasses);

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <MapView
        // Android only reads `userInterfaceStyle` when it builds the map
        // (it becomes a GoogleMapOptions.mapColorScheme at creation), so
        // toggling Dark Mode has to recreate the view for the basemap to
        // follow. Remounting loses the camera, hence the tracked `region`
        // below as the restored starting point.
        key={darkMode ? 'map-dark' : 'map-light'}
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        showsUserLocation
        // Keeps the Google basemap in step with the app's Dark Mode setting,
        // so the chrome floating over it isn't a dark card on a white map.
        userInterfaceStyle={darkMode ? 'dark' : 'light'}
        onLayout={(e) => setMapSize(e.nativeEvent.layout)}
        onRegionChange={setRegion}
        onRegionChangeComplete={setRegion}
        initialRegion={
          // `region` is whatever the user last had on screen, so a Dark Mode
          // remount comes back to the same place instead of jumping home.
          region ??
          (origin
            ? { ...origin, latitudeDelta: 0.01, longitudeDelta: 0.01 }
            : {
                // Kuala Lumpur, the study area from the FYP field observation.
                latitude: 3.139,
                longitude: 101.6869,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              })
        }
      >
        {routes.map(
          (r, index) =>
            index !== selectedRouteIndex && (
              <React.Fragment key={`alt-${index}`}>
                <Polyline
                  coordinates={r.coordinates}
                  strokeWidth={10}
                  strokeColor={T.routeAltOutline}
                  lineCap="round"
                  lineJoin="round"
                  tappable
                  onPress={() => setSelectedRouteIndex(index)}
                />
                <Polyline
                  coordinates={r.coordinates}
                  strokeWidth={6}
                  strokeColor={T.routeAltFill}
                  lineCap="round"
                  lineJoin="round"
                />
              </React.Fragment>
            ),
        )}

        {selectedRoute && (
          <>
            <Polyline
              coordinates={selectedRoute.coordinates}
              strokeWidth={12}
              strokeColor={T.routeMainOutline}
              lineCap="round"
              lineJoin="round"
              zIndex={2}
            />
            <Polyline
              coordinates={selectedRoute.coordinates}
              strokeWidth={7}
              strokeColor={T.routeMainFill}
              lineCap="round"
              lineJoin="round"
              zIndex={3}
            />
            <Marker coordinate={selectedRoute.destination} title={selectedRoute.destinationName} />
          </>
        )}
      </MapView>

      {/* Route pills are plain React Native views layered over the map,
          positioned by projecting each route's anchor vertex into screen
          space. They deliberately avoid <Marker> custom children, which
          render by snapshotting the child view natively and came out blank
          on this stack (New Architecture + Google provider on iOS). */}
      {region && mapSize && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {routes.map((r, index) => {
            const placement = pillPlacement(routes, index, anchorIndexes, region, mapSize);
            if (!placement) return null;

            const { center, tailAngle } = placement;
            // Skip pills the map has scrolled out of view.
            if (
              center.x < -PILL_OFFSET ||
              center.y < -PILL_OFFSET ||
              center.x > mapSize.width + PILL_OFFSET ||
              center.y > mapSize.height + PILL_OFFSET
            ) {
              return null;
            }

            const duration = formatDuration(r.durationSeconds);
            const distance = formatDistance(r.distanceMeters);

            return (
              <RoutePill
                key={`pill-${index}`}
                duration={duration}
                distance={distance}
                selected={index === selectedRouteIndex}
                center={center}
                tailAngle={tailAngle}
                onPress={() => setSelectedRouteIndex(index)}
                accessibilityLabel={`Route ${index + 1}: ${duration}, ${distance}`}
              />
            );
          })}
        </View>
      )}

      <View style={[styles.searchBar, { top: searchBarTop }]}>
        <View
          style={[styles.searchSurface, { backgroundColor: T.cardRaised }, T.shadow]}
        >
          <TextInput
            style={[styles.input, { color: T.text, fontSize: F.body }]}
            placeholder="Search a destination"
            placeholderTextColor={T.text2}
            value={query}
            onChangeText={handleQueryChange}
            onFocus={() => setSuggestionsVisible(true)}
            onBlur={handleBlur}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {/* Shared absolute-position slot (right edge of the input) for
              whichever accessory is showing - the clear button, or a spinner
              while loading. This wrapper stretches full height and centers its
              child; it must not have a fixed height/width of its own, or
              combining that with top+bottom makes Yoga anchor it to `top` and
              ignore `bottom` entirely. */}
          <View style={styles.inputAccessory} pointerEvents="box-none">
            {loading ? (
              <ActivityIndicator color={T.accent} />
            ) : (
              query.length > 0 && (
                <Pressable
                  style={[styles.clearButton, { backgroundColor: T.clearBtn }]}
                  onPress={handleClear}
                  accessibilityLabel="Clear search"
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={styles.clearButtonText}>✕</Text>
                </Pressable>
              )
            )}
          </View>
        </View>

        {suggestionsVisible && (
          <View
            style={[
              styles.suggestionsBox,
              { backgroundColor: T.cardRaised, maxHeight: 260 },
              T.shadow,
            ]}
          >
            {suggestionsLoading && suggestions.length === 0 ? (
              <View style={styles.suggestionsEmpty}>
                <ActivityIndicator color={T.accent} />
              </View>
            ) : suggestions.length === 0 ? (
              <View style={styles.suggestionsEmpty}>
                <Text style={{ color: T.text2, fontSize: F.sm }}>
                  {query.trim() ? 'No matching places' : 'No nearby places found'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={suggestions}
                keyExtractor={(item) => item.placeId}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.suggestionRow, { borderBottomColor: T.sepStrong }]}
                    onPress={() => handleSelectSuggestion(item)}
                  >
                    <Text
                      style={[styles.suggestionName, { color: T.text, fontSize: F.label }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {item.secondaryText && (
                      <Text
                        style={[styles.suggestionSecondary, { color: T.text2, fontSize: F.xs }]}
                        numberOfLines={1}
                      >
                        {item.secondaryText}
                      </Text>
                    )}
                  </Pressable>
                )}
              />
            )}
          </View>
        )}
      </View>

      {selectedRoute && !suggestionsVisible && (
        <View
          style={[
            styles.routePanel,
            { backgroundColor: T.cardRaised, bottom: SCREEN_MARGIN + keyboardHeight },
            T.panelShadow,
          ]}
        >
          <Text style={[styles.routeName, { color: T.text, fontSize: F.h2 }]} numberOfLines={1}>
            {selectedRoute.destinationName}
          </Text>
          {/* The design's secondary line is the route summary ("Via Jalan
              Sultan Ismail"); the exact address takes priority here because
              the app already promises to always show it, with the summary as
              the fallback when Google returns no address. */}
          {(selectedRoute.destinationAddress ?? selectedRoute.summary) && (
            <Text style={[styles.routeSecondary, { color: T.text2, fontSize: F.xs }]} numberOfLines={1}>
              {selectedRoute.destinationAddress ?? selectedRoute.summary}
            </Text>
          )}
          <Text style={[styles.routeStats, { color: T.accentDeep, fontSize: F.label }]}>
            {formatDuration(selectedRoute.durationSeconds)} ·{' '}
            {formatDistance(selectedRoute.distanceMeters)}
          </Text>

          <View style={styles.hazardNoteRow}>
            <View style={[styles.hazardDot, { backgroundColor: hazardSummary.color }]} />
            <Text style={[styles.hazardNote, { color: T.text2, fontSize: F.tinySm }]}>
              {hazardSummary.note}
            </Text>
          </View>

          <Pressable
            style={[styles.startButton, { backgroundColor: T.green }]}
            onPress={() => navigation.navigate('ARNavigation', { route: selectedRoute })}
            accessibilityRole="button"
          >
            <Text style={[styles.startButtonText, { fontSize: F.body }]}>Start AR Navigation</Text>
          </Pressable>
        </View>
      )}

      {warning && (
        <View style={styles.warningBackdrop}>
          <View style={[styles.warningCard, { backgroundColor: T.cardRaised }, T.shadow]}>
            <Text style={[styles.warningTitle, { color: T.text, fontSize: F.h2 }]}>
              {warning.title}
            </Text>
            <Text style={[styles.warningMessage, { color: T.text2, fontSize: F.sm }]}>
              {warning.message}
            </Text>
            <Pressable
              style={[styles.warningButton, { backgroundColor: T.accent }]}
              onPress={() => setWarning(null)}
            >
              <Text style={[styles.warningButtonText, { fontSize: F.label }]}>OK</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// Works out where a route's pill sits and which way its tail points: the pill
// is pushed off its anchor vertex perpendicular to the route's local
// direction, and the tail then points straight back at that vertex.
function pillPlacement(
  routes: WalkingRoute[],
  index: number,
  anchorIndexes: number[],
  region: MapRegion,
  mapSize: { width: number; height: number },
): { center: { x: number; y: number }; tailAngle: number } | null {
  const coordinates = routes[index]?.coordinates;
  const anchorIndex = anchorIndexes[index];
  if (!coordinates || coordinates.length === 0 || anchorIndex === undefined) return null;

  const project = (coordinate: LatLng) => coordinateToScreenPoint(coordinate, region, mapSize);
  const anchor = project(coordinates[anchorIndex]);

  const before = project(coordinates[Math.max(0, anchorIndex - DIRECTION_SAMPLE_SPAN)]);
  const after = project(
    coordinates[Math.min(coordinates.length - 1, anchorIndex + DIRECTION_SAMPLE_SPAN)],
  );

  let dx = after.x - before.x;
  let dy = after.y - before.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    // Degenerate stretch (all sampled vertices project to the same pixel) -
    // fall back to pushing the pill straight up.
    dx = 1;
    dy = 0;
  } else {
    dx /= length;
    dy /= length;
  }

  // Two candidate sides of the route; pick whichever lands further from the
  // other routes, so alternatives' pills don't stack on top of each other.
  const candidates = [
    { x: anchor.x - dy * PILL_OFFSET, y: anchor.y + dx * PILL_OFFSET },
    { x: anchor.x + dy * PILL_OFFSET, y: anchor.y - dx * PILL_OFFSET },
  ];

  const others = routes.filter((_, i) => i !== index);
  const center =
    others.length === 0
      ? candidates[0]
      : candidates.reduce((best, candidate) =>
          clearance(candidate, others, project) > clearance(best, others, project)
            ? candidate
            : best,
        );

  const tailAngle = (Math.atan2(anchor.y - center.y, anchor.x - center.x) * 180) / Math.PI;
  return { center, tailAngle };
}

// Smallest screen-space distance from `point` to any of the other routes,
// sampled rather than measured against every vertex.
function clearance(
  point: { x: number; y: number },
  others: WalkingRoute[],
  project: (coordinate: LatLng) => { x: number; y: number },
): number {
  let nearest = Infinity;
  for (const other of others) {
    const step = Math.max(1, Math.floor(other.coordinates.length / 24));
    for (let i = 0; i < other.coordinates.length; i += step) {
      const projected = project(other.coordinates[i]);
      const d = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (d < nearest) nearest = d;
    }
  }
  return nearest;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchBar: {
    // top is set inline, from the safe-area inset.
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    zIndex: 5,
  },
  searchSurface: { borderRadius: RADIUS.control },
  input: {
    paddingLeft: 16,
    paddingRight: 44,
    paddingVertical: 15,
  },
  inputAccessory: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    height: 24,
    width: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  suggestionsBox: {
    marginTop: 8,
    borderRadius: RADIUS.control,
    overflow: 'hidden',
  },
  suggestionsEmpty: { paddingVertical: 20, alignItems: 'center', justifyContent: 'center' },
  suggestionRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionName: { fontWeight: '600' },
  suggestionSecondary: { marginTop: 2 },
  routePanel: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    borderRadius: RADIUS.section,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 18,
  },
  routeName: { fontWeight: '700' },
  routeSecondary: { marginTop: 2 },
  routeStats: { fontWeight: '600', marginTop: 10 },
  hazardNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  hazardDot: { width: 8, height: 8, borderRadius: 4 },
  hazardNote: { flex: 1 },
  startButton: {
    marginTop: 14,
    borderRadius: RADIUS.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startButtonText: { color: '#fff', fontWeight: '700' },
  warningBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  warningCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: RADIUS.card,
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  warningTitle: { fontWeight: '700', textAlign: 'center' },
  warningMessage: { textAlign: 'center', marginTop: 8, lineHeight: 20 },
  warningButton: {
    marginTop: 18,
    alignSelf: 'stretch',
    borderRadius: RADIUS.small,
    paddingVertical: 12,
    alignItems: 'center',
  },
  warningButtonText: { color: '#fff', fontWeight: '700' },
});
