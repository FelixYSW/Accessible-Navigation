import React, { useEffect, useRef, useState } from 'react';
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { LatLng, PlaceSuggestion, WalkingRoute } from '../types/route';
import {
  findPlace,
  getNearbyPlaces,
  getPlaceAutocomplete,
  getPlaceDetails,
  getWalkingRoutes,
} from '../services/directions';
import { formatDistance, formatDuration } from '../utils/format';

// How long to wait after the user stops typing before firing an
// autocomplete request, to avoid a network call on every keystroke.
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

// Screen-edge margin (in px) kept clear when framing route previews, so the
// polylines don't sit under the route picker panel at the bottom (the top
// margin is computed per-device from the safe area, since the search bar
// now sits directly under it with no header above).
const ROUTE_FIT_SIDE_PADDING = { right: 60, bottom: 220, left: 60 };

// Each route is drawn as two stacked polylines (a wider "outline" stroke
// under a narrower "fill" stroke) so it reads as a bordered line against
// the basemap, the way Google Maps draws its route options.
const ROUTE_COLORS = {
  selected: { fill: '#490dfb', outline: '#1d087e' },
  unselected: { fill: '#b2bdf9', outline: '#2b29c2' },
};

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

export function MapScreen({ navigation }: Props) {
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  // With the header removed, the search bar sits right under the safe area
  // (notch/status bar) instead of a fixed screen offset.
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
    mapRef.current.animateToRegion(
      { ...origin, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      500,
    );
  }, [origin]);

  // Keeps the route preview panel (and suggestions box) above the on-screen
  // keyboard - both are absolutely positioned, so without this they end up
  // rendered underneath it and effectively disappear while the search bar
  // is focused.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
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

  // Frames every previewed route on screen whenever a fresh set arrives
  // (not on re-selection - the camera shouldn't jump just because the user
  // picked a different alternative that's already in view).
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
      showWarning('Location not ready', 'Still determining your current location, try again shortly.');
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

  // Typing anything invalidates whatever route was previously previewed -
  // the panel should only ever reflect a destination the user actually
  // picked (via a suggestion or a submitted search), never stale text.
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
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        showsUserLocation
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
                  strokeColor={ROUTE_COLORS.unselected.outline}
                  lineCap="round"
                  lineJoin="round"
                  tappable
                  onPress={() => setSelectedRouteIndex(index)}
                />
                <Polyline
                  coordinates={r.coordinates}
                  strokeWidth={6}
                  strokeColor={ROUTE_COLORS.unselected.fill}
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
              strokeColor={ROUTE_COLORS.selected.outline}
              lineCap="round"
              lineJoin="round"
              zIndex={2}
            />
            <Polyline
              coordinates={selectedRoute.coordinates}
              strokeWidth={7}
              strokeColor={ROUTE_COLORS.selected.fill}
              lineCap="round"
              lineJoin="round"
              zIndex={3}
            />
            <Marker coordinate={selectedRoute.destination} title={selectedRoute.destinationName} />
          </>
        )}

        {routes.map((r, index) => {
          const isSelected = index === selectedRouteIndex;
          return (
            <Marker
              key={`label-${index}`}
              coordinate={r.coordinates[Math.floor(r.coordinates.length / 2)]}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => setSelectedRouteIndex(index)}
            >
              {/* collapsable={false} keeps this View in the native hierarchy -
                  without it, RN's view-flattening optimization can strip a
                  plain style-only View out entirely, leaving react-native-maps
                  nothing to snapshot and rendering the marker blank. */}
              <View
                collapsable={false}
                style={[styles.routeLabel, isSelected && styles.routeLabelSelected]}
              >
                <Text style={[styles.routeLabelDuration, isSelected && styles.routeLabelTextSelected]}>
                  {formatDuration(r.durationSeconds)}
                </Text>
                <Text style={[styles.routeLabelDistance, isSelected && styles.routeLabelTextSelected]}>
                  {formatDistance(r.distanceMeters)}
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={[styles.searchBar, { top: searchBarTop }]}>
        <TextInput
          style={styles.input}
          placeholder="Search a destination"
          value={query}
          onChangeText={handleQueryChange}
          onFocus={() => setSuggestionsVisible(true)}
          onBlur={handleBlur}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <View style={styles.inputAccessory} pointerEvents="box-none">
          {loading ? (
            <ActivityIndicator color={ROUTE_COLORS.selected.fill} />
          ) : (
            query.length > 0 && (
              <Pressable
                style={styles.clearButton}
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
        <View style={[styles.suggestionsBox, { top: searchBarTop + 58, maxHeight: 260 }]}>
          {suggestionsLoading && suggestions.length === 0 ? (
            <View style={styles.suggestionsEmpty}>
              <ActivityIndicator />
            </View>
          ) : suggestions.length === 0 ? (
            <View style={styles.suggestionsEmpty}>
              <Text style={styles.suggestionsEmptyText}>
                {query.trim() ? 'No matching places' : 'No nearby places found'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.placeId}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable style={styles.suggestionRow} onPress={() => handleSelectSuggestion(item)}>
                  <Text style={styles.suggestionName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.secondaryText && (
                    <Text style={styles.suggestionSecondary} numberOfLines={1}>
                      {item.secondaryText}
                    </Text>
                  )}
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {routes.length > 0 && selectedRoute && !suggestionsVisible && (
        <View style={[styles.routePanel, { bottom: 24 + keyboardHeight }]}>
          <Text style={styles.routeName} numberOfLines={1}>
            {selectedRoute.destinationName}
          </Text>
          {selectedRoute.destinationAddress && (
            <Text style={styles.routeAddress} numberOfLines={1}>
              {selectedRoute.destinationAddress}
            </Text>
          )}
          <Text style={styles.routeStats}>
            {formatDuration(selectedRoute.durationSeconds)} · {formatDistance(selectedRoute.distanceMeters)}
          </Text>
          <Pressable
            style={styles.startButton}
            onPress={() => navigation.navigate('ARNavigation', { route: selectedRoute })}
          >
            <Text style={styles.startButtonText}>Start AR Navigation</Text>
          </Pressable>
        </View>
      )}

      {warning && (
        <View style={styles.warningBackdrop}>
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>{warning.title}</Text>
            <Text style={styles.warningMessage}>{warning.message}</Text>
            <Pressable style={styles.warningButton} onPress={() => setWarning(null)}>
              <Text style={styles.warningButtonText}>OK</Text>
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
    left: 16,
    right: 16,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingRight: 40,
    paddingVertical: 12,
    fontSize: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  // Shared absolute-position slot (right edge of the input) for whichever
  // accessory is showing - the clear button, or a spinner while loading.
  // This wrapper stretches full height and centers its child; it must not
  // have a fixed height/width of its own, or combining that with top+bottom
  // makes Yoga anchor it to `top` and ignore `bottom` entirely (which is
  // what made the clear button hug the top of the search bar before).
  inputAccessory: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    height: 24,
    width: 24,
    borderRadius: 12,
    backgroundColor: '#C7C7CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  suggestionsBox: {
    // top is set inline, relative to the search bar's own (safe-area-based) top.
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  suggestionsEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionsEmptyText: { color: '#888', fontSize: 14 },
  suggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  suggestionName: { fontSize: 15, fontWeight: '600', color: '#111' },
  suggestionSecondary: { fontSize: 13, color: '#777', marginTop: 2 },
  routeLabel: {
    backgroundColor: ROUTE_COLORS.unselected.fill,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: ROUTE_COLORS.unselected.outline,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  routeLabelSelected: {
    backgroundColor: ROUTE_COLORS.selected.fill,
    borderColor: ROUTE_COLORS.selected.outline,
  },
  routeLabelDuration: { fontSize: 12, fontWeight: '700', color: ROUTE_COLORS.unselected.outline },
  routeLabelDistance: { fontSize: 10, fontWeight: '600', color: ROUTE_COLORS.unselected.outline },
  routeLabelTextSelected: { color: '#fff' },
  routePanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  routeName: { fontSize: 17, fontWeight: '700', color: '#111' },
  routeAddress: { fontSize: 13, color: '#777', marginTop: 2 },
  routeStats: { fontSize: 15, fontWeight: '600', color: ROUTE_COLORS.selected.outline, marginTop: 8 },
  startButton: {
    marginTop: 12,
    backgroundColor: '#30D158',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  startButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  warningBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  warningCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  warningTitle: { fontSize: 17, fontWeight: '700', color: '#111', textAlign: 'center' },
  warningMessage: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  warningButton: {
    marginTop: 18,
    alignSelf: 'stretch',
    backgroundColor: ROUTE_COLORS.selected.fill,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  warningButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
