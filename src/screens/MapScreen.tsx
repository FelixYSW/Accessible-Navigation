import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
// polylines don't sit under the search bar or the route picker panel.
const ROUTE_FIT_PADDING = { top: 100, right: 60, bottom: 220, left: 60 };

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
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState<WalkingRoute[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location permission needed',
          'Accessible Navigation needs your location to plan walking routes.',
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    })();
  }, []);

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
      edgePadding: ROUTE_FIT_PADDING,
      animated: true,
    });
  }, [routes]);

  const previewRoutes = async (
    destination: LatLng,
    destinationName: string,
    destinationAddress?: string,
  ) => {
    if (!origin) {
      Alert.alert('Location not ready', 'Still determining your current location, try again shortly.');
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
      Alert.alert('Could not find route', error instanceof Error ? error.message : String(error));
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
      Alert.alert('Could not find route', error instanceof Error ? error.message : String(error));
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
      Alert.alert('Could not find route', error instanceof Error ? error.message : String(error));
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
                  strokeWidth={7}
                  strokeColor={ROUTE_COLORS.unselected.outline}
                  tappable
                  onPress={() => setSelectedRouteIndex(index)}
                />
                <Polyline
                  coordinates={r.coordinates}
                  strokeWidth={4}
                  strokeColor={ROUTE_COLORS.unselected.fill}
                />
              </React.Fragment>
            ),
        )}

        {selectedRoute && (
          <>
            <Polyline
              coordinates={selectedRoute.coordinates}
              strokeWidth={8}
              strokeColor={ROUTE_COLORS.selected.outline}
              zIndex={2}
            />
            <Polyline
              coordinates={selectedRoute.coordinates}
              strokeWidth={5}
              strokeColor={ROUTE_COLORS.selected.fill}
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
              tracksViewChanges={false}
              onPress={() => setSelectedRouteIndex(index)}
            >
              <View style={[styles.routeLabel, isSelected && styles.routeLabelSelected]}>
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

      <View style={styles.searchBar}>
        <View style={styles.inputWrapper}>
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
          {query.length > 0 && (
            <Pressable
              style={styles.clearButton}
              onPress={handleClear}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.clearButtonText}>✕</Text>
            </Pressable>
          )}
        </View>
        <Pressable style={styles.searchButton} onPress={handleSearch} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>Go</Text>}
        </Pressable>
      </View>

      {suggestionsVisible && (
        <View style={[styles.suggestionsBox, { maxHeight: 260 }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchBar: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },
  inputWrapper: {
    flex: 1,
    justifyContent: 'center',
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
  clearButton: {
    position: 'absolute',
    right: 10,
    height: 24,
    width: 24,
    borderRadius: 12,
    backgroundColor: '#C7C7CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  suggestionsBox: {
    position: 'absolute',
    top: 74,
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
  searchButton: {
    backgroundColor: '#0A84FF',
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
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
});
