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
import { LocateFixed } from 'lucide-react-native';
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
import { routeDurationSeconds, type MobilityAid } from '../services/mobility';
import {
  needsAccessibilityCheck,
  screenRoutes,
  type AccessibilitySeverity,
  type RouteAccessibility,
} from '../services/accessibility';
import { formatDistance, formatDuration } from '../utils/format';
import { labelAnchorIndexForRoute, routeSimilarity } from '../utils/geo';
import {
  findAccessibleRoute,
  hasAccessibleRoutingKey,
  NoAccessibleRouteError,
} from '../services/accessibleRouting';
import { RoutePillLayer } from '../components/RoutePillLayer';
import type { RoutePillDescriptor, RoutePillLayerHandle } from '../components/RoutePillLayer';
import { useSettings } from '../theme/SettingsContext';
import { HAZARD_COLORS, RADIUS, SCREEN_MARGIN, type Palette } from '../theme/tokens';

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

// How close ORS's accessible route has to run to one of Google's alternatives
// before the two are called the same route. Generous, because the engines
// disagree about which side of a street a pedestrian is on: ORS follows mapped
// sidewalk ways, Google usually the road centreline.
const ROUTE_MATCH_TOLERANCE_METERS = 30;
const ROUTE_MATCH_THRESHOLD = 0.75;

// Named per aid, because "step-free" is the wrong promise for a cane user -
// their route is allowed to include steps and is chosen on gradient and
// surface instead.
const ACCESSIBLE_ROUTE_LABELS: Record<MobilityAid, string> = {
  none: '',
  wheelchair: 'Step-free route, planned for wheelchair access',
  walker: 'Step-free route, planned for walker access',
  cane: 'Planned for even gradients and firm surfaces',
};

// Dot colour for each accessibility verdict. The two warning colours are the
// hazard palette's, so a barrier reads the same here as it does on camera.
const ACCESS_COLORS: Record<AccessibilitySeverity, (palette: Palette) => string> = {
  clear: (T) => T.green,
  caution: () => HAZARD_COLORS['pathway-obstruction'],
  blocked: () => HAZARD_COLORS.pothole,
};

type MapNavigation = NativeStackNavigationProp<RootStackParamList>;

export function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const pillLayerRef = useRef<RoutePillLayerHandle>(null);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<MapNavigation>();
  const { T, F, scaled, darkMode, mobilityAid } = useSettings();

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
  // Whether the camera is still tracking the user. True until they drag the
  // map somewhere else, and back to true when they tap Recentre.
  const [following, setFollowing] = useState(true);
  const [warning, setWarning] = useState<{ title: string; message: string } | null>(null);
  // OSM accessibility screening, one entry per route (null where the lookup
  // failed - "unknown", which must never be presented as "clear").
  const [accessibility, setAccessibility] = useState<(RouteAccessibility | null)[]>([]);
  const [screening, setScreening] = useState(false);
  // The accessibility-aware route from OpenRouteService. Held apart from
  // `routes` (which is Google's answer) so that appending it can't retrigger
  // the effects keyed on `routes` and loop.
  const [accessibleRoute, setAccessibleRoute] = useState<WalkingRoute | null>(null);
  // Set instead when ORS's route turned out to be one Google already offered.
  const [accessibleMatch, setAccessibleMatch] = useState<number | null>(null);
  const [routingAccessible, setRoutingAccessible] = useState(false);
  const [noAccessibleRoute, setNoAccessibleRoute] = useState(false);
  // Measured heights of the two floating panels, so routes can be framed in
  // the strip of map that is actually visible between them. Both change with
  // the Text Size setting, so they are measured rather than hard-coded. Held
  // in a ref, not state: re-framing is driven by the route set changing, and
  // a measurement must never re-render or re-frame on its own.
  const chromeHeights = useRef({ search: 0, panel: 0 });

  // What the map actually shows: Google's routes, plus ORS's accessible route
  // when it found one Google didn't already offer.
  const displayRoutes = useMemo(
    () => (accessibleRoute ? [...routes, accessibleRoute] : routes),
    [routes, accessibleRoute],
  );

  // Routes are on screen and the user's job is to pick one. The map is frozen
  // in this state - see the gesture props on MapView.
  const previewing = displayRoutes.length > 0;

  // The vertex each route's pill is anchored to - recomputed only when the
  // route set changes, since the search is O(n*m) over route vertices.
  const anchorIndexes = useMemo(
    () =>
      displayRoutes.map((_, index) =>
        labelAnchorIndexForRoute(
          displayRoutes.map((r) => r.coordinates),
          index,
        ),
      ),
    [displayRoutes],
  );

  // Every duration on this screen is rescaled from Google's able-bodied
  // walking pace to the pace implied by the user's Mobility aid setting.
  const durationForRoute = (walkingRoute: WalkingRoute) =>
    formatDuration(
      routeDurationSeconds(
        walkingRoute.durationSeconds,
        mobilityAid,
        Boolean(walkingRoute.accessibleFor),
      ),
    );

  // The pills' content, computed here so the layer re-renders on a pan
  // without rebuilding any of it.
  const pills = useMemo<RoutePillDescriptor[]>(
    () =>
      displayRoutes.flatMap((r, index) => {
        const coordinate = r.coordinates[anchorIndexes[index]];
        if (!coordinate) return [];
        return [
          {
            coordinate,
            duration: formatDuration(
              routeDurationSeconds(r.durationSeconds, mobilityAid, Boolean(r.accessibleFor)),
            ),
            distance: formatDistance(r.distanceMeters),
          },
        ];
      }),
    [displayRoutes, anchorIndexes, mobilityAid],
  );

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
  // After that first fix the map keeps following the user as they walk, which
  // is the default a walking app should have: the thing you need to see is
  // where you are. Following stops the moment the user drags the map away
  // themselves (see `onRegionChange` below), and the recentre button brings it
  // back - flipping `following` back to true re-runs this effect, which is
  // what actually moves the camera.
  //
  // Suspended while routes are previewed: the camera is framed on the whole
  // route set then, and a location update arriving mid-preview must not pull
  // it back onto the user and crop the routes out of view.
  const hasCentredRef = useRef(false);
  useEffect(() => {
    if (!origin || !mapRef.current) return;

    if (!hasCentredRef.current) {
      hasCentredRef.current = true;
      mapRef.current.animateToRegion({ ...origin, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
      return;
    }

    if (!following || previewing) return;
    // `animateCamera` rather than `animateToRegion`: it moves the centre and
    // leaves the zoom alone, so following the user doesn't keep resetting a
    // zoom level they chose.
    mapRef.current.animateCamera({ center: origin }, { duration: 500 });
  }, [origin, following, previewing]);

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
  // Keyed on `displayRoutes`, so an accessible route arriving from ORS a few
  // seconds later is framed too rather than appearing half off-screen.
  const fittedRoutes = useRef<WalkingRoute[]>([]);
  useEffect(() => {
    fittedRoutes.current = displayRoutes;
    fitRoutes(displayRoutes);
  }, [displayRoutes, fitRoutes]);

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

  // Asks OpenRouteService for a route planned around the barriers that matter
  // for this aid, then reconciles it with what Google returned. Three outcomes:
  //
  //   - it matches one of Google's alternatives  -> that one is labelled and
  //     selected, and the user keeps Google's geometry and ETA
  //   - it doesn't match any of them             -> it is added as an extra
  //     option, which is the interesting case: a way through that Google
  //     never offered
  //   - ORS can't find one at all                -> said plainly, rather than
  //     leaving the user to infer it from three warnings
  //
  // Runs alongside the OSM screening below rather than replacing it: this says
  // "here is a route you can use", the screening says "here is what is wrong
  // with the others".
  const accessibleChosen = useRef(false);
  useEffect(() => {
    setAccessibleRoute(null);
    setAccessibleMatch(null);
    setNoAccessibleRoute(false);
    accessibleChosen.current = false;

    if (routes.length === 0 || mobilityAid === 'none' || !hasAccessibleRoutingKey()) return;

    const reference = routes[0];
    let cancelled = false;
    setRoutingAccessible(true);

    (async () => {
      try {
        const candidate = await findAccessibleRoute(
          reference.origin,
          reference.destination,
          reference.destinationName,
          mobilityAid,
          reference.destinationAddress,
        );
        if (cancelled) return;

        const scores = routes.map((r) =>
          routeSimilarity(candidate.coordinates, r.coordinates, ROUTE_MATCH_TOLERANCE_METERS),
        );
        const best = scores.reduce((a, b, i) => (b > scores[a] ? i : a), 0);

        accessibleChosen.current = true;
        if (scores[best] >= ROUTE_MATCH_THRESHOLD) {
          setAccessibleMatch(best);
          setSelectedRouteIndex(best);
        } else {
          setAccessibleRoute(candidate);
          // It is the whole point of the request - select it.
          setSelectedRouteIndex(routes.length);
        }
      } catch (error) {
        if (!cancelled && error instanceof NoAccessibleRouteError) setNoAccessibleRoute(true);
        // Anything else is a network or key problem: stay quiet and leave the
        // OSM screening below to describe Google's routes.
      } finally {
        if (!cancelled) setRoutingAccessible(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routes, mobilityAid]);

  // Screens every previewed route against OpenStreetMap once the routes are
  // already on screen, rather than before showing them: Overpass can take
  // several seconds, and a route the user can see and start walking beats a
  // spinner. The panel says it is still checking until the answers land.
  useEffect(() => {
    if (routes.length === 0 || !needsAccessibilityCheck(mobilityAid)) {
      setAccessibility([]);
      setScreening(false);
      return;
    }

    let cancelled = false;
    setAccessibility([]);
    setScreening(true);

    (async () => {
      const results = await screenRoutes(
        routes.map((r) => r.coordinates),
        mobilityAid,
      );
      if (cancelled) return;

      setAccessibility(results);
      setScreening(false);

      // Move the user off a route the screening says they can't use, if one
      // of the alternatives is passable. The route order is left alone - the
      // map reshuffling under a selection the user just made is worse than
      // simply picking a better one for them.
      //
      // Skipped once ORS has supplied a route planned around the barriers:
      // that is stronger evidence than this screening, and the two effects
      // would otherwise take turns overriding each other's selection.
      if (accessibleChosen.current) return;
      setSelectedRouteIndex((current) => {
        if (results[current]?.severity !== 'blocked') return current;
        const passable = results.findIndex((r) => r !== null && r.severity !== 'blocked');
        return passable === -1 ? current : passable;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [routes, mobilityAid]);

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

  // Backs all the way out of searching: keyboard down, field unfocused,
  // suggestions gone. `blur()` is explicit rather than left to `dismiss()`,
  // which lowers the keyboard without always taking focus off the field -
  // leaving a search bar that still looks active and a caret still blinking.
  const dismissSearch = () => {
    inputRef.current?.blur();
    Keyboard.dismiss();
    setSuggestionsVisible(false);
  };

  // The verdict dots on the route panel read as punctuation for the line of
  // text beside them, so they grow with it.
  const accessDotSize = {
    height: scaled(8),
    width: scaled(8),
    borderRadius: scaled(8) / 2,
  };

  const selectedRoute = displayRoutes[selectedRouteIndex];
  // The selected route is accessibility-planned either because it *is* ORS's
  // route, or because ORS's route turned out to be this one of Google's.
  const selectedIsAccessible =
    Boolean(selectedRoute?.accessibleFor) || accessibleMatch === selectedRouteIndex;

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
        // The pills are positioned from `region`, which carries a centre and a
        // lat/lng span but no heading or pitch. Rotating or tilting the camera
        // would leave that projection describing a map orientation the user is
        // no longer looking at, and the pills would slide off their routes -
        // so neither gesture is offered. Walking navigation has no use for
        // them anyway.
        rotateEnabled={false}
        pitchEnabled={false}
        // While routes are previewed the map is locked: the only decision left
        // on this screen is which of the routes to take, and panning or
        // zooming away from them only loses the answer. The camera is already
        // framed on every route, and tapping a route line or its pill still
        // selects it - those are annotation presses, not map gestures, so
        // freezing the camera doesn't disable choosing.
        scrollEnabled={!previewing}
        zoomEnabled={!previewing}
        // Fed straight to the pill layer instead of into state here, so a pan
        // re-renders three pills rather than this whole screen.
        //
        // A region change the user drove themselves also ends follow mode.
        // `isGesture` is what separates that from the programmatic moves this
        // screen makes constantly (the fit onto a route set, the recentre) -
        // without it, framing a route would immediately count as the user
        // panning away. It is reported by the Google provider, which this map
        // always uses.
        onRegionChange={(r, details) => {
          pillLayerRef.current?.setRegion(r);
          if (details?.isGesture) setFollowing(false);
        }}
        onRegionChangeComplete={(r, details) => {
          pillLayerRef.current?.setRegion(r);
          if (details?.isGesture) setFollowing(false);
        }}
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
        {displayRoutes.map(
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

      <RoutePillLayer
        ref={pillLayerRef}
        pills={pills}
        selectedIndex={selectedRouteIndex}
        onSelect={setSelectedRouteIndex}
      />

      {/* Only offered once the map has actually stopped following the user -
          a recentre button on an already-centred map is a control that does
          nothing. Never during a preview, where the map is frozen on the
          routes and can't have been dragged off the user in the first place. */}
      {origin && !following && !previewing && !suggestionsVisible && (
        <Pressable
          style={[
            styles.recenterButton,
            {
              backgroundColor: T.cardRaised,
              height: scaled(48),
              width: scaled(48),
              borderRadius: scaled(48) / 2,
            },
            T.shadow,
          ]}
          onPress={() => setFollowing(true)}
          accessibilityRole="button"
          accessibilityLabel="Recentre on my location"
          hitSlop={8}
        >
          <LocateFixed size={scaled(22)} color={T.accent} strokeWidth={2} />
        </Pressable>
      )}

      {/* Tapping anywhere off the search bar puts the keyboard away, which is
          the only way to get back to a full-screen map once the field has
          focus. Sits under the search bar's zIndex so taps on the field and
          its suggestion rows still reach them. */}
      {suggestionsVisible && (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.dismissLayer]}
          onPress={dismissSearch}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      )}

      <View style={[styles.searchBar, { top: searchBarTop }]}>
        <View
          style={[styles.searchSurface, { backgroundColor: T.cardRaised }, T.shadow]}
          onLayout={(e) => measureChrome('search', e.nativeEvent.layout.height)}
        >
          <TextInput
            ref={inputRef}
            // The right padding is the clear button's own scaled width plus
            // its inset, so a bigger button can't end up sitting on the text.
            style={[styles.input, { color: T.text, fontSize: F.body, paddingRight: scaled(24) + 20 }]}
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
                  style={[
                    styles.clearButton,
                    {
                      backgroundColor: T.clearBtn,
                      height: scaled(24),
                      width: scaled(24),
                      borderRadius: scaled(24) / 2,
                    },
                  ]}
                  onPress={handleClear}
                  accessibilityLabel="Clear search"
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={[styles.clearButtonText, { fontSize: F.tiny }]}>✕</Text>
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

          {/* The accessibility-routed verdict outranks the screening line
              below it: this route was planned around the barriers, rather
              than merely inspected for them afterwards. */}
          {selectedIsAccessible && (
            <View style={styles.accessRow}>
              <View style={[accessDotSize, { backgroundColor: T.green }]} />
              <Text style={{ color: T.text2, fontSize: F.tinySm, flex: 1 }}>
                {ACCESSIBLE_ROUTE_LABELS[mobilityAid]}
              </Text>
            </View>
          )}

          {routingAccessible && (
            <Text style={[styles.routeAccess, { color: T.text2, fontSize: F.tinySm }]}>
              Looking for an accessible route…
            </Text>
          )}

          {noAccessibleRoute && (
            <View style={styles.accessRow}>
              <View
                style={[accessDotSize, { backgroundColor: HAZARD_COLORS['pathway-obstruction'] }]}
              />
              <Text style={{ color: T.text2, fontSize: F.tinySm, flex: 1 }}>
                No fully accessible route found to here
              </Text>
            </View>
          )}

          {/* Shown only when a mobility aid is set, and only when OSM actually
              answered. A failed lookup says nothing at all - silence is the
              honest result, whereas "no barriers found" read as a guarantee is
              exactly the failure this feature exists to prevent. */}
          {!selectedIsAccessible &&
            needsAccessibilityCheck(mobilityAid) &&
            (screening ? (
              <Text style={[styles.routeAccess, { color: T.text2, fontSize: F.tinySm }]}>
                Checking step-free access…
              </Text>
            ) : (
              accessibility[selectedRouteIndex] && (
                <View style={styles.accessRow}>
                  <View
                    style={[
                      accessDotSize,
                      {
                        backgroundColor:
                          ACCESS_COLORS[accessibility[selectedRouteIndex]!.severity](T),
                      },
                    ]}
                  />
                  <Text style={{ color: T.text2, fontSize: F.tinySm, flex: 1 }}>
                    {accessibility[selectedRouteIndex]!.note}
                  </Text>
                </View>
              )
            ))}

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
  // Size and radius are set inline, from the Text Size multiplier.
  clearButton: { alignItems: 'center', justifyContent: 'center' },
  clearButtonText: { color: '#fff', fontWeight: '700' },
  // Below the search bar's zIndex (5) and above the map, so it swallows taps
  // meant for the map without covering the field it is dismissing.
  dismissLayer: { zIndex: 3 },
  // Size and radius are set inline, from the Text Size multiplier.
  recenterButton: {
    position: 'absolute',
    right: SCREEN_MARGIN,
    bottom: SCREEN_MARGIN,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
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
  routeAccess: { marginTop: 6 },
  accessRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
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
