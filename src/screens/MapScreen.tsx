import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  findPlace,
  getNearbyPlaces,
  getPlaceAutocomplete,
  getPlaceDetails,
  getWalkingRoutes,
} from '../services/directions';
import { adjustDurationForAid } from '../services/mobility';
import { formatDistance, formatDuration } from '../utils/format';
import { labelAnchorIndexForRoute } from '../utils/geo';
import { RoutePill } from '../components/RoutePill';
import { useSettings } from '../theme/SettingsContext';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';

// How long to wait after the user stops typing before firing an
// autocomplete request, to avoid a network call on every keystroke.
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

// How far the user has to move before their location is re-read. Nearby
// place suggestions are anchored to it, so it has to follow them around -
// but a fix every few metres would re-query Places constantly for no gain.
const LOCATION_UPDATE_DISTANCE_METERS = 25;

// Extra clearance (px) added around the framed routes so a pill anchored to a
// vertex at the very edge of the route's bounds still lands fully on screen,
// rather than half off it. Roughly half a pill each way, plus a margin.
const PILL_CLEARANCE = { horizontal: 50, vertical: 34 };

// Stand-ins used to frame the routes on the very first search, before the
// search bar and route panel have reported their real measured heights.
// Close enough that the corrected fit that follows is not a visible jump.
const ESTIMATED_SEARCH_HEIGHT = 52;
const ESTIMATED_PANEL_HEIGHT = 190;

type MapNavigation = NativeStackNavigationProp<RootStackParamList>;

export function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<MapNavigation>();
  const { T, F, darkMode, mobilityAid } = useSettings();

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
  // Measured heights of the two floating panels, so routes can be framed in
  // the strip of map that is actually visible between them. Both change with
  // the Text Size setting, so they are measured rather than hard-coded. Held
  // in a ref, not state: re-framing is driven by the route set changing, and
  // a measurement must never re-render or re-frame on its own.
  const chromeHeights = useRef({ search: 0, panel: 0 });

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

  // Every duration on this screen is rescaled from Google's able-bodied
  // walking pace to the pace implied by the user's Mobility aid setting.
  const durationForRoute = (walkingRoute: WalkingRoute) =>
    formatDuration(adjustDurationForAid(walkingRoute.durationSeconds, mobilityAid));

  // In-app replacement for Alert.alert - keeps error/notice styling
  // consistent with the rest of the screen instead of the OS-native dialog.
  const showWarning = (title: string, message: string) => setWarning({ title, message });

  // The user's location is watched, not read once: the suggestions shown when
  // the search bar is focused but empty are the places near them *now*, so
  // walking a few streets over has to change what is offered.
  useEffect(() => {
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showWarning(
          'Location permission needed',
          'Accessible Navigation needs your location to plan walking routes.',
        );
        return;
      }

      // One immediate fix so routing and suggestions work right away, then
      // the watch takes over for everything after that.
      const position = await Location.getCurrentPositionAsync({});
      if (cancelled) return;
      setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: LOCATION_UPDATE_DISTANCE_METERS,
        },
        (update) => {
          if (!cancelled) {
            setOrigin({ latitude: update.coords.latitude, longitude: update.coords.longitude });
          }
        },
      );
      if (cancelled) subscription.remove();
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  // MapView's `initialRegion` is only read once, at mount - and the very
  // first render happens before the location fetch above resolves, so it
  // always starts on the Kuala Lumpur fallback. Once `origin` actually
  // arrives, explicitly move the camera there.
  //
  // Only for the *first* fix, though: `origin` now updates as the user walks,
  // and re-centring on every update would yank the map back from wherever
  // they had panned it to.
  const hasCentredRef = useRef(false);
  useEffect(() => {
    if (!origin || hasCentredRef.current || !mapRef.current) return;
    hasCentredRef.current = true;
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
  // Both are anchored to `origin`, so they follow the user as they move.
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

  // Frames a set of routes inside the strip of map left visible between the
  // search bar and the route panel, widened by half a pill on each side - so
  // no route line and no route pill can end up hidden behind either panel or
  // cropped off an edge.
  const fitRoutes = useCallback(
    (list: WalkingRoute[]) => {
      if (list.length === 0 || !mapRef.current) return;
      const { search, panel } = chromeHeights.current;
      mapRef.current.fitToCoordinates(
        list.flatMap((r) => r.coordinates),
        {
          edgePadding: {
            top: searchBarTop + (search || ESTIMATED_SEARCH_HEIGHT) + PILL_CLEARANCE.vertical,
            bottom: SCREEN_MARGIN + (panel || ESTIMATED_PANEL_HEIGHT) + PILL_CLEARANCE.vertical,
            left: SCREEN_MARGIN + PILL_CLEARANCE.horizontal,
            right: SCREEN_MARGIN + PILL_CLEARANCE.horizontal,
          },
          animated: true,
        },
      );
    },
    [searchBarTop],
  );

  // Re-framed only when a fresh set of routes arrives - never on re-selection,
  // since the camera shouldn't jump just because the user picked a different
  // alternative that's already in view.
  const fittedRoutes = useRef<WalkingRoute[]>([]);
  useEffect(() => {
    fittedRoutes.current = routes;
    fitRoutes(routes);
  }, [routes, fitRoutes]);

  // The first search runs against the estimated panel heights, because
  // neither panel has been laid out yet. Once a real measurement replaces an
  // estimate, that one search is re-framed with it; later measurements (a
  // Text Size change, an alternative with a longer "Via" line) only update
  // the number used by the next search.
  const measureChrome = (key: 'search' | 'panel', height: number) => {
    if (Math.abs(chromeHeights.current[key] - height) < 1) return;
    const wasEstimated = chromeHeights.current[key] === 0;
    chromeHeights.current[key] = height;
    if (wasEstimated) fitRoutes(fittedRoutes.current);
  };

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

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        showsUserLocation
        // Keeps the Google basemap in step with the app's Dark Mode setting,
        // so the chrome floating over it isn't a dark card on a white map.
        //
        // The view is deliberately *not* remounted when this flips: on iOS the
        // prop is applied live, and recreating the map to re-read it would
        // throw away the camera and drop the user back at a default view every
        // time they toggled Dark Mode.
        userInterfaceStyle={darkMode ? 'dark' : 'light'}
        initialRegion={
          origin
            ? { ...origin, latitudeDelta: 0.01, longitudeDelta: 0.01 }
            : {
                // Kuala Lumpur, the study area from the FYP field observation.
                latitude: 3.139,
                longitude: 101.6869,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }
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

        {/* Route pills are map markers, so the map keeps them pinned to their
            coordinates itself - no JS projection, and so no lag behind a pan
            and no drift when the camera is rotated or tilted. Rendered after
            the polylines and the destination marker so they draw on top. */}
        {routes.map((r, index) => {
          const anchor = r.coordinates[anchorIndexes[index]];
          if (!anchor) return null;

          const duration = durationForRoute(r);
          const distance = formatDistance(r.distanceMeters);

          return (
            <RoutePill
              key={`pill-${index}`}
              coordinate={anchor}
              duration={duration}
              distance={distance}
              selected={index === selectedRouteIndex}
              onPress={() => setSelectedRouteIndex(index)}
              accessibilityLabel={`Route ${index + 1}: ${duration}, ${distance}`}
            />
          );
        })}
      </MapView>

      <View style={[styles.searchBar, { top: searchBarTop }]}>
        <View
          style={[styles.searchSurface, { backgroundColor: T.cardRaised }, T.shadow]}
          onLayout={(e) => measureChrome('search', e.nativeEvent.layout.height)}
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
          onLayout={(e) => measureChrome('panel', e.nativeEvent.layout.height)}
        >
          <Text style={[styles.routeName, { color: T.text, fontSize: F.h2 }]} numberOfLines={1}>
            {selectedRoute.destinationName}
          </Text>
          {selectedRoute.destinationAddress && (
            <Text style={[styles.routeSecondary, { color: T.text2, fontSize: F.xs }]} numberOfLines={1}>
              {selectedRoute.destinationAddress}
            </Text>
          )}
          <Text style={[styles.routeStats, { color: T.accentDeep, fontSize: F.label }]}>
            {durationForRoute(selectedRoute)} · {formatDistance(selectedRoute.distanceMeters)}
          </Text>
          {/* Which streets this particular route runs along - the one thing
              that tells otherwise-similar alternatives apart, so it belongs on
              the panel that describes the selected one. Google omits it on
              very short routes. */}
          {selectedRoute.summary && (
            <Text style={[styles.routeVia, { color: T.text2, fontSize: F.tinySm }]} numberOfLines={2}>
              Via {selectedRoute.summary}
            </Text>
          )}

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
    zIndex: 4,
  },
  routeName: { fontWeight: '700' },
  routeSecondary: { marginTop: 2 },
  routeStats: { fontWeight: '600', marginTop: 10 },
  routeVia: { marginTop: 4 },
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
