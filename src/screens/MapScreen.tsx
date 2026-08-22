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
import { AppIcon } from '../components/AppIcon';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { LatLng, PlaceSuggestion, RouteSurface, WalkingRoute } from '../types/route';
import {
  findPlace,
  getPlaceDetails,
  getSuggestions,
} from '../services/directions';
import { planWalkingRoutes } from '../services/routing';
import { estimateWalk, routeDurationSeconds, type MobilityAid } from '../services/mobility';
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
import { RoutePillOverlay } from '../components/RoutePillOverlay';
import type {
  RoutePillDescriptor,
  RoutePillOverlayHandle,
} from '../components/RoutePillOverlay';
import type { MapRegion } from '../utils/geo';
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

// The zoom the map opens on, and the one the recentre button returns to:
// about a 1km span, which is the scale a walking route is read at.
//
// Expressed as a zoom level rather than a region, because a region is not a
// zoom - `animateToRegion` *fits* the given span into the viewport, so which
// of the two deltas binds depends on the aspect ratio, and the same region can
// settle at different zooms depending on where the camera started. A zoom
// level is the same every time, which is what "default zoom" has to mean.
const DEFAULT_ZOOM = 16;

// The span used for `initialRegion` only, which is a region prop and has no
// zoom form. Roughly equivalent to DEFAULT_ZOOM; it is what the map shows for
// the moment before the first location fix replaces it.
const DEFAULT_SPAN = { latitudeDelta: 0.01, longitudeDelta: 0.01 };

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

// One sentence per aid, all built the same way: what the route guarantees,
// then who it was planned for.
//
// The promise differs because the routing does. A cane route is allowed to
// include steps - `avoidSteps` is false for it in `accessibleRouting.ts`,
// since the standard is "short flights with continuous handrails" and that
// condition can only be checked afterwards by the OSM screening, not asked of
// the router. So it must not say "step-free", and the two that genuinely are
// planned step-free must say so. What was wrong before was the shape: the same
// fact arrived in a different grammatical form for each aid, which reads as
// three unrelated statements rather than one comparable guarantee.
const ACCESSIBLE_ROUTE_LABELS: Record<MobilityAid, string> = {
  none: '',
  wheelchair: 'Step-free route, planned for wheelchair access',
  walker: 'Step-free route, planned for walker access',
  cane: 'Even gradients and firm surfaces, planned for cane access',
};

// Dot colour for each accessibility verdict. The two warning colours are the
// hazard palette's, so a barrier reads the same here as it does on camera.
const ACCESS_COLORS: Record<AccessibilitySeverity, (palette: Palette) => string> = {
  clear: (T) => T.green,
  caution: () => HAZARD_COLORS['pathway-obstruction'],
  blocked: () => HAZARD_COLORS.pothole,
};

// How much road walking passes without comment.
//
// Some is unavoidable on any route here - a crossing, a stretch where the
// pavement simply gives out for fifty metres - and flagging every one of those
// would teach the walker to ignore the line entirely, which would cost them
// the one that matters.
const ROAD_WALKING_NOTICE_M = 50;

// How much of the route has to be classified footway before the app is willing
// to call it a footpath route.
const FOOTWAY_CONFIDENCE = 0.6;

// The share of road walking that turns the line from information into a
// warning. Proportional rather than absolute, because 200m of road is nothing
// on a 10km walk and a quarter of a 800m one - and a warning colour that shows
// on every long route is decoration, not a warning.
const ROAD_SHARE_CAUTION = 0.25;

// What the way-type breakdown is worth saying out loud, if anything.
//
// Null is a real answer and the most important case to get right: where OSM
// has classified too little of the route, there is nothing honest to report,
// and "on footpaths the whole way" inferred from a handful of tagged segments
// would be a guarantee the data cannot support. This app's whole subject is
// people for whom a wrong guarantee is worse than no information.
function surfaceNote(
  surface: RouteSurface,
): { text: string; severity: AccessibilitySeverity } | null {
  const total = surface.footwayMeters + surface.roadMeters + surface.otherMeters;
  if (total <= 0) return null;

  if (surface.roadMeters <= ROAD_WALKING_NOTICE_M) {
    if (surface.footwayMeters / total < FOOTWAY_CONFIDENCE) return null;
    return {
      text:
        surface.roadMeters > 0
          ? 'On footpaths almost the whole way'
          : 'On footpaths the whole way',
      severity: 'clear',
    };
  }

  // Always carries the two figures rather than an adjective, so the walker
  // makes the judgement themselves. Only the colour changes with severity.
  return {
    text: `${formatDistance(surface.roadMeters)} of ${formatDistance(
      total,
    )} shares the road with traffic`,
    severity: surface.roadMeters / total > ROAD_SHARE_CAUTION ? 'caution' : 'clear',
  };
}

// The walk to a suggestion, at the user's own pace.
//
// The tilde is doing real work and is not decoration. Places measures in a
// straight line, so this is an estimate of a route nobody has planned yet, and
// it will not match the figure on the route panel once one has been. Printing
// it bare would read as the same kind of number as that one.
function formatWalk(straightLineMeters: number, aid: MobilityAid): string {
  const walk = estimateWalk(straightLineMeters, aid);
  return `~${formatDistance(walk.meters)} · ${formatDuration(walk.seconds)}`;
}

// Read out as one sentence rather than as three loose fragments, and with the
// estimate spelled out - a screen reader user gets no tilde and no layout to
// tell them this figure is softer than the one on the route panel.
function suggestionLabel(suggestion: PlaceSuggestion, aid: MobilityAid): string {
  const parts = [suggestion.name];
  if (suggestion.secondaryText) parts.push(suggestion.secondaryText);
  if (suggestion.distanceMeters !== undefined) {
    const walk = estimateWalk(suggestion.distanceMeters, aid);
    parts.push(
      `about ${formatDistance(walk.meters)}, roughly ${formatDuration(walk.seconds)} on foot`,
    );
  }
  return parts.join(', ');
}

// The panel's accessibility line: either a verdict with a coloured dot, or a
// dotless line saying an answer is still on its way.
type AccessLine =
  | { kind: 'pending'; text: string }
  | { kind: 'verdict'; text: string; severity: AccessibilitySeverity };

type MapNavigation = NativeStackNavigationProp<RootStackParamList>;

export function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const inputRef = useRef<TextInput>(null);
  // The pill layer is fed the region imperatively on every frame of a pan, so
  // that tracking the map costs a re-render of four pills rather than of this
  // whole screen and every polyline on it.
  const pillLayerRef = useRef<RoutePillOverlayHandle>(null);
  const insets = useSafeAreaInsets();
  // The native tab bar floats over the map, so everything anchored to the
  // bottom of this screen - the route panel, the recentre button, and the
  // strip the routes are framed into - has to start above it.
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<MapNavigation>();
  const { T, F, scaled, darkMode, mobilityAid } = useSettings();

  // With no header above it, the search bar sits right under the safe area.
  const searchBarTop = insets.top + 8;

  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [query, setQuery] = useState('');
  // The destination being previewed, held as state rather than routed to
  // directly, because the routes depend on the mobility aid as well: ORS plans
  // on a different profile for each, so changing the aid has to re-plan rather
  // than just re-decorate what Google already returned.
  const [preview, setPreview] = useState<{
    location: LatLng;
    name: string;
    address?: string;
  } | null>(null);
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
  // Set once the native map is laid out and will accept camera commands.
  const [mapReady, setMapReady] = useState(false);
  // The map's settled region and its pixel size. Held only so the pill markers
  // can tell which of them would overlap at this zoom - the map itself does
  // the positioning, so this deliberately updates when a gesture ends rather
  // than on every frame of one.
  const [region, setRegion] = useState<MapRegion | null>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
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

  // Routes are on screen and the user's job is to pick one. The map is still
  // free to pan and zoom here - a walker checking which side of a junction a
  // route takes needs to be able to look - but the camera has a home to go
  // back to, which is the framing that fits every route and pill on screen.
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
      routeDurationSeconds(walkingRoute.durationSeconds, mobilityAid, walkingRoute.accessibleFor),
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
              routeDurationSeconds(r.durationSeconds, mobilityAid, r.accessibleFor),
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
  // themselves (see `onRegionChange` below), and the recentre button turns it
  // back on.
  //
  // Suspended while routes are previewed: the camera is framed on the whole
  // route set then, and a location update arriving mid-preview must not pull
  // it back onto the user and crop the routes out of view.
  //
  // `following` is read through a ref rather than listed as a dependency, so
  // that turning it back on doesn't re-run this effect: the recentre button
  // does its own, zoom-resetting move, and a second animation racing it would
  // undo the zoom half of it.
  // Gated on the map reporting itself ready, not just on the ref existing. A
  // camera call made before the native map has laid out is silently dropped,
  // and the first fix often arrives first - the cached position comes back in
  // milliseconds. That is what left the app centred on the user at the wide
  // fallback zoom instead of the default one: the pan happened, the zoom
  // change went nowhere.
  // Every "go back to the user" on this screen goes through here, so the first
  // fix, the recentre button and the end of a preview cannot end up at
  // different zooms - which is exactly what happened when each made its own
  // camera call.
  const centreOnUser = useCallback((on: LatLng) => {
    mapRef.current?.animateCamera({ center: on, zoom: DEFAULT_ZOOM }, { duration: 500 });
  }, []);

  const hasCentredRef = useRef(false);
  const followingRef = useRef(following);
  followingRef.current = following;
  const wasPreviewingRef = useRef(false);
  useEffect(() => {
    if (!origin || !mapReady || !mapRef.current) return;

    // Whether the routes have just gone away - cleared from the search bar,
    // or invalidated by typing over the destination. However it happened, the
    // camera is left framed on routes that are no longer drawn, at a zoom
    // chosen to fit them, so going back to the user means going back to the
    // default zoom too and not just sliding the centre across.
    const leftPreview = wasPreviewingRef.current && !previewing;
    wasPreviewingRef.current = previewing;

    if (!hasCentredRef.current) {
      hasCentredRef.current = true;
      centreOnUser(origin);
      return;
    }

    if (!followingRef.current || previewing) return;

    if (leftPreview) {
      centreOnUser(origin);
      return;
    }

    // `animateCamera` rather than `animateToRegion`: it moves the centre and
    // leaves the zoom alone, so walking along doesn't keep pulling the map
    // back to a zoom level the user has since changed.
    mapRef.current.animateCamera({ center: origin }, { duration: 500 });
  }, [origin, previewing, mapReady, centreOnUser]);

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
          const results = await getSuggestions(trimmed, origin);
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
            bottom: SCREEN_MARGIN + tabBarHeight + (panel || ESTIMATED_PANEL_HEIGHT) + PILL_CLEARANCE.vertical,
            left: SCREEN_MARGIN + PILL_CLEARANCE.horizontal,
            right: SCREEN_MARGIN + PILL_CLEARANCE.horizontal,
          },
          animated: true,
        },
      );
    },
    [searchBarTop, tabBarHeight],
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

    // Nothing to add when ORS planned these in the first place: every one of
    // them already came off the wheelchair profile with this aid's
    // restrictions applied, so asking again would return one of the routes
    // already on screen. This only runs when the plan fell back to Google -
    // and then it does real work, because it is the one thing that can still
    // offer a way through that Google never mentioned, or say plainly that
    // there isn't one.
    if (routes[0].accessibleFor === mobilityAid) return;

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

  // Read by the planning effect below, which must not list `origin` as a
  // dependency: it changes every 25m the user walks, and re-planning on it
  // would throw away the routes they are in the middle of choosing between.
  const originRef = useRef(origin);
  originRef.current = origin;

  // Picking a destination only records it. The routes themselves are planned
  // by the effect below, because they depend on the mobility aid as much as on
  // the destination - ORS plans on the wheelchair profile for an aid and on
  // foot-walking without one, so changing the setting has to re-plan from
  // scratch rather than annotate what is already on screen.
  const previewRoutes = (
    destination: LatLng,
    destinationName: string,
    destinationAddress?: string,
  ) => {
    if (!originRef.current) {
      showWarning(
        'Location not ready',
        'Still determining your current location, try again shortly.',
      );
      return;
    }

    setSuggestionsVisible(false);
    Keyboard.dismiss();
    setPreview({ location: destination, name: destinationName, address: destinationAddress });
  };

  useEffect(() => {
    if (!preview) return;
    const from = originRef.current;
    if (!from) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const plan = await planWalkingRoutes(
          from,
          preview.location,
          preview.name,
          preview.address,
          mobilityAid,
        );
        if (cancelled) return;
        setRoutes(plan.routes);
        setSelectedRouteIndex(0);
      } catch (error) {
        if (cancelled) return;
        showWarning('Could not find route', error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preview, mobilityAid]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSuggestionsVisible(false);
    Keyboard.dismiss();
    try {
      const place = await findPlace(query.trim());
      previewRoutes(place.location, place.name, place.address);
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
      previewRoutes(place.location, place.name, place.address);
    } catch (error) {
      showWarning('Could not find route', error instanceof Error ? error.message : String(error));
    }
  };

  // Typing anything invalidates whatever route was previously previewed - the
  // panel should only ever reflect a destination the user actually picked
  // (via a suggestion or a submitted search), never stale text.
  const handleQueryChange = (text: string) => {
    setQuery(text);
    // `preview` goes too, not just the routes it produced - left set, a change
    // of mobility aid would re-plan a destination the user has already typed
    // over and put the routes back.
    if (preview) setPreview(null);
    if (routes.length > 0) setRoutes([]);
  };

  const handleClear = () => {
    setQuery('');
    setPreview(null);
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

  // One button, two homes. While routes are being previewed, "back" means the
  // framing that fits every route and every pill on screen - the view the
  // preview opened on - not the user's location, which may be at the very edge
  // of it. With no routes up, it means the user, at the zoom the map opens on:
  // someone who has zoomed out to look around and then asked to be taken back
  // wants the walking-scale view they started from, not their own dot lost in
  // the middle of the same city-wide one.
  const recentre = () => {
    setFollowing(true);
    if (previewing) {
      fitRoutes(displayRoutes);
    } else if (origin) {
      centreOnUser(origin);
    }
  };

  // The opening camera, issued a second time once the map has settled.
  //
  // The first camera command after mount is not reliably obeyed in full. The
  // native map applies its own `initialRegion` at around the same moment, and
  // when the two collide the centre survives while the zoom is discarded -
  // which lands the user centred on themselves at the fallback region's
  // city-wide zoom rather than at DEFAULT_ZOOM. Gating on `onMapReady`
  // narrowed that window; it did not close it, because "ready" and "finished
  // applying the initial region" are not the same instant.
  //
  // A settled region is the signal that they are. Re-issuing the same command
  // then is a no-op in every case where the first one worked - it animates to
  // a camera already in place - so this costs one redundant camera call at
  // startup and nothing else.
  //
  // Fires once. Anything the user has done in the meantime outranks it: a
  // gesture, a route preview, or having turned follow mode off all mean the
  // camera is where they put it, and correcting the opening zoom at that point
  // would be yanking the map out from under them.
  const settledOnceRef = useRef(false);
  const confirmOpeningZoom = (fromGesture: boolean) => {
    if (settledOnceRef.current) return;
    settledOnceRef.current = true;

    if (fromGesture || previewing || !followingRef.current) return;
    if (!hasCentredRef.current || !originRef.current) return;
    centreOnUser(originRef.current);
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
  // Shown for every aid including none - someone walking unaided is exactly
  // who ends up on a road shoulder, since theirs is the only profile that
  // permits one.
  const selectedSurface = selectedRoute?.surface ? surfaceNote(selectedRoute.surface) : null;

  // The single accessibility line for the panel.
  //
  // There used to be up to four of these stacked, and with ORS routing
  // everyone they started appearing together and saying the same thing twice:
  // "Step-free route, planned for wheelchair access" directly above "No steps
  // or barriers reported on this route" is one fact wearing two hats, and the
  // "Checking step-free access…" that preceded it made the panel visibly
  // rearrange itself while being read. Three dots of varying colour is not
  // three times the information.
  //
  // So they collapse to one line, picked by which has the most to say. The
  // ordering is the point:
  //
  //   1. No accessible route at all - the strongest thing that can be said.
  //   2. A barrier actually found on the route. This outranks how the route
  //      was *planned*, because it is the more specific claim and the only one
  //      that changes what the walker does. It is also the case where the two
  //      sources disagree, and a disagreement must never be resolved in favour
  //      of the reassuring half.
  //   3. How it was planned, when nothing was found against it.
  //   4. The screening's own all-clear, for routes that were never planned
  //      around anything (the Google fallback).
  //
  // Pending states come last and only when there is nothing better to show,
  // which is why the wheelchair case above no longer flickers through
  // "Checking…": it has a true line to show from the first render, and the
  // screening either confirms it silently or replaces it with a warning.
  const screened = needsAccessibilityCheck(mobilityAid)
    ? accessibility[selectedRouteIndex]
    : undefined;

  const accessLine = ((): AccessLine | null => {
    if (noAccessibleRoute) {
      return {
        kind: 'verdict',
        text: 'No fully accessible route found to here',
        severity: 'caution',
      };
    }
    if (screened && screened.severity !== 'clear') {
      return { kind: 'verdict', text: screened.note, severity: screened.severity };
    }
    if (selectedIsAccessible) {
      return {
        kind: 'verdict',
        text: ACCESSIBLE_ROUTE_LABELS[mobilityAid],
        severity: 'clear',
      };
    }
    if (screened) {
      return { kind: 'verdict', text: screened.note, severity: screened.severity };
    }
    if (routingAccessible) {
      return { kind: 'pending', text: 'Looking for an accessible route…' };
    }
    if (screening) {
      return { kind: 'pending', text: 'Checking step-free access…' };
    }
    return null;
  })();

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
        onMapReady={() => setMapReady(true)}
        // The pills are positioned from `region`, which carries a centre and a
        // lat/lng span but no heading or pitch. Rotating or tilting the camera
        // would leave that projection describing a map orientation the user is
        // no longer looking at, and the pills would slide off their routes -
        // so neither gesture is offered. Walking navigation has no use for
        // them anyway.
        rotateEnabled={false}
        pitchEnabled={false}
        // A region change the user drove themselves ends follow mode.
        // `isGesture` is what separates that from the programmatic moves this
        // screen makes constantly (the fit onto a route set, the recentre) -
        // without it, framing a route would immediately count as the user
        // panning away. It is reported by the Google provider, which this map
        // always uses.
        onRegionChange={(r, details) => {
          // Every frame of a pan, and of the screen's own camera animations.
          // This is what keeps the pills on their roads while the map moves;
          // it deliberately does not touch state.
          pillLayerRef.current?.setRegion(r);
          if (details?.isGesture) setFollowing(false);
        }}
        onRegionChangeComplete={(r, details) => {
          pillLayerRef.current?.setRegion(r);
          setRegion(r);
          if (details?.isGesture) setFollowing(false);
          confirmOpeningZoom(details?.isGesture === true);
        }}
        onLayout={(e) => setMapSize(e.nativeEvent.layout)}
        initialRegion={
          origin
            ? { ...origin, ...DEFAULT_SPAN }
            : {
                // Kuala Lumpur, the study area from the FYP field observation.
                latitude: 3.139,
                longitude: 101.6869,
                // Deliberately the same span as the located case, rather than
                // the city-wide one this used to open on.
                //
                // This is the zoom that survives when the opening camera
                // command loses its zoom component, so it is the zoom the user
                // is left at when that goes wrong - and a walking-scale view of
                // somewhere they are about to be moved away from is a far
                // better thing to be stuck with than a city-wide one. It shows
                // for the second or two before the first fix arrives either
                // way, and a whole-city view of a city they may not even be in
                // was never the more useful of the two.
                ...DEFAULT_SPAN,
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

      {/* Drawn over the map rather than inside it. A marker carrying React
          children does not survive this project's New Architecture build - see
          the note in RoutePillOverlay. Sits here, immediately after the map, so
          it covers the basemap but stays under the search bar and route
          panel below. */}
      <RoutePillOverlay
        ref={pillLayerRef}
        pills={pills}
        selectedIndex={selectedRouteIndex}
        onSelect={setSelectedRouteIndex}
        region={region}
        size={mapSize}
      />

      {/* Offered only once the map has actually been moved off its home - on
          an already-centred map it would be a control that does nothing. What
          "home" means depends on what is on screen: the routes while one is
          being previewed, the user's own location otherwise. */}
      {(previewing || origin) && !following && !suggestionsVisible && (
        <Pressable
          style={[
            styles.recenterButton,
            {
              backgroundColor: T.cardRaised,
              height: scaled(48),
              width: scaled(48),
              borderRadius: scaled(48) / 2,
              // Clears the route panel, which is only on screen while routes
              // are being previewed.
              bottom: SCREEN_MARGIN + tabBarHeight + (previewing ? chromeHeights.current.panel + 10 : 0),
            },
            T.shadow,
          ]}
          onPress={recentre}
          accessibilityRole="button"
          accessibilityLabel={previewing ? 'Show the whole route' : 'Recentre on my location'}
          hitSlop={8}
        >
          <AppIcon name="crosshair" size={scaled(22)} color={T.accent} />
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
                    accessibilityRole="button"
                    accessibilityLabel={suggestionLabel(item, mobilityAid)}
                  >
                    {/* The name gets the whole width. It is the thing being
                        chosen between, and sharing the line with the walk cost
                        it characters on exactly the rows where names are
                        longest and most alike - the branches of one chain. */}
                    <Text
                      style={[styles.suggestionName, { color: T.text, fontSize: F.label }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {(item.secondaryText || item.distanceMeters !== undefined) && (
                      <View style={styles.suggestionTop}>
                        {item.secondaryText && (
                          <Text
                            style={[styles.suggestionSecondary, { color: T.text2, fontSize: F.xs }]}
                            numberOfLines={1}
                          >
                            {item.secondaryText}
                          </Text>
                        )}
                        {/* Right-aligned so the eye can run straight down the
                            column and compare rows. Prefixed with ~ because it
                            is measured in a straight line and the real route is
                            longer - see `estimateWalk`. */}
                        {item.distanceMeters !== undefined && (
                          <Text
                            // The tab bar's selected blue, so the one accent
                            // colour on screen means one thing. Follows the
                            // theme: the token carries a different blue in each
                            // mode.
                            style={[styles.suggestionWalk, { color: T.accent, fontSize: F.xs }]}
                            numberOfLines={1}
                          >
                            {formatWalk(item.distanceMeters, mobilityAid)}
                          </Text>
                        )}
                      </View>
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
            { backgroundColor: T.cardRaised, bottom: SCREEN_MARGIN + tabBarHeight + keyboardHeight },
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

          {/* One line, chosen from four possible sources - see `accessLine`. */}
          {accessLine &&
            (accessLine.kind === 'pending' ? (
              <Text style={[styles.routeAccess, { color: T.text2, fontSize: F.tinySm }]}>
                {accessLine.text}
              </Text>
            ) : (
              <View style={styles.accessRow}>
                <View
                  style={[accessDotSize, { backgroundColor: ACCESS_COLORS[accessLine.severity](T) }]}
                />
                <Text style={{ color: T.text2, fontSize: F.tinySm, flex: 1 }}>
                  {accessLine.text}
                </Text>
              </View>
            ))}

          {/* What the route is made of. A second line rather than part of the
              one above, because it answers a genuinely different question: a
              route can be perfectly step-free and still spend half its length
              on the carriageway, and neither fact substitutes for the other. */}
          {selectedSurface && (
            <View style={styles.accessRow}>
              <View
                style={[accessDotSize, { backgroundColor: ACCESS_COLORS[selectedSurface.severity](T) }]}
              />
              <Text style={{ color: T.text2, fontSize: F.tinySm, flex: 1 }}>
                {selectedSurface.text}
              </Text>
            </View>
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
  // Size, radius and bottom offset are set inline: the first two from the Text
  // Size multiplier, the last from whether the route panel is in the way.
  recenterButton: {
    position: 'absolute',
    right: SCREEN_MARGIN,
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
  // The second line: address on the left, walk on the right. `flex-end` is
  // what right-aligns the walk on a row that has no address to push it over.
  suggestionTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 2,
  },
  suggestionName: { fontWeight: '600' },
  // Never shrinks: the address has flex and wins the squeeze, because a
  // truncated address still places the result and a truncated "1.2 km · 18 min"
  // is not a distance.
  suggestionWalk: { fontWeight: '600', flexShrink: 0 },
  suggestionSecondary: { flex: 1 },
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
