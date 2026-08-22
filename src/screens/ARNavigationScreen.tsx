import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { LatLng, RouteStep, WalkingRoute } from '../types/route';
import { HAZARD_CLASSES } from '../types/hazard';
import {
  bearingBetween,
  distanceAlongRoute,
  distanceMeters,
  lateralOffsetFromRoute,
  nextRoutePointIndex,
  pointBesideRoute,
  relativeBearing,
  routeBearingAfter,
} from '../utils/geo';
import {
  ARGeospatialView,
  isARGeospatialSupported,
  type GeoAnchor,
  type GeospatialUpdate,
  type ProjectedAnchor,
} from '../../modules/ar-geospatial';
import { useHazardDetections } from '../services/hazardDetector';
import { useSpokenHazardCues, useSpokenTurnCues } from '../services/voiceCues';
import { AppIcon } from '../components/AppIcon';
import { CameraStage } from '../components/CameraStage';
import { DEFAULT_CAMERA_PITCH_DEG, GroundArrows } from '../components/GroundArrows';
import { GroundChevrons } from '../components/GroundChevrons';
import { DestinationPin } from '../components/DestinationPin';
import {
  MANEUVER_ICONS,
  MANEUVER_LABELS,
  maneuverFromAngle,
  maneuverFromApi,
  type Maneuver,
} from '../components/maneuverIcons';
import { HazardOverlay } from '../components/HazardOverlay';
import { ScanPrompt } from '../components/ScanPrompt';
import { VoiceCueBar } from '../components/VoiceCueBar';
import { HazardTypeBar } from '../components/HazardTypeBar';
import { useSettings } from '../theme/SettingsContext';
import { routeDurationSeconds } from '../services/mobility';
import { OVERLAY_GREEN, OVERLAY_RED, RADIUS, SCREEN_MARGIN } from '../theme/tokens';
import { formatDistance, formatDuration } from '../utils/format';

const GOOGLE_MAPS_API_KEY =
  (Constants.expoConfig?.extra?.googleMapsApiKey as string | undefined) ?? '';

type Props = NativeStackScreenProps<RootStackParamList, 'ARNavigation'>;

// How often the phone's tilt is read, and how much of each reading is taken.
// 20Hz is well under the sensor's rate but well over what the eye needs, and
// taking a quarter of each reading settles in about a fifth of a second -
// quick enough to feel attached to the phone, slow enough not to shiver.
const PITCH_UPDATE_MS = 50;
const PITCH_SMOOTHING = 0.25;

// Clearance between the safe area and the instruction banner, which is the
// topmost thing on this screen.
const BANNER_TOP_GAP = 4;

// Where the anchored chevrons are planted along the route: a close, tight run
// starting just in front of the walker's feet.
//
// The spacing is what decides how near the first one can be. Anchors sit on a
// fixed lattice measured from the route's start, so the nearest one lands
// anywhere between the lead distance and one spacing beyond it - at 2m spacing
// that meant the first chevron could be three and a half metres off, which
// reads as the run starting somewhere up the street rather than at your feet.
//
// The horizon is set by what a flat shape on the ground can still say, not by
// how far ahead the route is known. Past about eight metres a chevron lying on
// the pavement has foreshortened into a bar a few points deep - it is still
// drawn, still fading, still costing a projection every frame, and it no longer
// reads as an arrow pointing anywhere. The native side now grows the far ones
// to hold that off (see GroundChevron.maxScale), and this is where that stops
// being enough. The compass-drawn fallback has always stopped at five.
const ANCHOR_SPACING_M = 1.2;
const ANCHOR_LEAD_M = 0.8;
const ANCHOR_HORIZON_M = 8;

// How far *behind* the walker's position along the route to start looking for
// anchors, before filtering by true distance.
//
// Rounding a corner is why this exists. The walker's place on the route is
// found by projecting them onto it, and on the outside of a turn that
// projection sticks to the corner vertex while they keep moving - so measuring
// the run from it leaves the nearest chevron several metres ahead just as they
// need it most. Reaching back a little and then filtering on real distance
// closes that gap. On a straight stretch the extra points fall behind the
// camera and are never drawn.
const ANCHOR_LOOKBACK_M = 2.5;

// How far the run may be shifted sideways to sit under the walker, and how much
// that shift has to change before it is worth re-planting the anchors.
//
// Walking routes are drawn down the middle of the road, not along the pavement
// anyone actually walks on, so chevrons laid exactly on the route line appear
// out in the traffic or across the street. Shifting the whole visible run by
// the walker's own offset from that line puts it back on the pavement they are
// standing on.
//
// Capped, because past a few metres the offset stops meaning "which side of the
// road" and starts meaning "not on this road at all" - and then the honest
// thing is to draw the real route and let them walk back to it.
const MAX_PATH_OFFSET_M = 8;
const OFFSET_DEADBAND_M = 1.5;

// How much of each new reading the offset takes, and how big it has to get
// before it is believed at all.
//
// These two exist because the offset is a *signed* quantity read off a noisy
// fix, and that combination is dangerous in a way an unsigned one is not. A
// pose good to five metres, measuring a walker who is genuinely three metres
// left of the route line, will regularly report them three metres to the right
// - and the correction then does not merely fail to help, it actively drives
// the whole run across the road onto the opposite pavement. A wrong sign is
// worse than no correction at all.
//
// Smoothing is the answer to the noise: the walker's true offset barely changes
// along a leg, so averaging many fixes converges on it while the error, which
// changes constantly, averages away. Deliberately slow - this has a whole leg
// to settle and nothing to gain from tracking a single fix.
//
// The floor is the answer to the sign. Below it the reading is smaller than the
// thing measuring it and its sign carries no information, so the run stays on
// the route line - which is at least a place the walker can see is a
// compromise, rather than a confident statement about the wrong pavement.
const OFFSET_SMOOTHING = 0.12;
const OFFSET_CONFIDENT_FRACTION = 0.6;
const OFFSET_MIN_CONFIDENT_M = 1.2;

// Anchors are matched by id on the native side, so one whose coordinate has
// changed must change id too - otherwise the old anchor is judged still wanted
// and quietly kept at the old place. The sideways shift is therefore folded
// into the id, which makes moving the run retire every id in it and plant a
// fresh set. That is the intended behaviour, not a workaround: the run really
// has moved, and pretending otherwise is what would look wrong.
//
// Lattice indices are the distance along the route divided by the spacing, so
// they stay far below the stride for any walkable route.
const OFFSET_ID_STRIDE = 1_000_000;
const OFFSET_HALF_METRES = 32;

// The destination marker's anchor id. Negative, so it can never collide with a
// lattice id however the run is shifted - those are always a non-negative index
// plus a non-negative multiple of the stride.
const DESTINATION_ANCHOR_ID = -1;

// How close the walker has to be before the destination is anchored at all.
//
// Not a rendering limit. An anchor is placed against a pose whose error grows
// with range, so a pin dropped from four hundred metres away would be planted
// with confidence in the wrong building. Within this range the geospatial fix
// is worth the certainty a pin implies.
const DESTINATION_ANCHOR_RANGE_M = 60;

// How long to wait for a scan to succeed before falling back to compass-drawn
// arrows, and how long the no-coverage explanation stays up.
const SCAN_PATIENCE_MS = 30_000;
const NO_COVERAGE_NOTICE_MS = 6_000;

function offsetKeyFor(lateralMeters: number): number {
  return (
    Math.min(
      OFFSET_HALF_METRES,
      Math.max(-OFFSET_HALF_METRES, Math.round(lateralMeters * 2)),
    ) + OFFSET_HALF_METRES
  );
}

// When the geospatial pose is good enough to plant anchors on. Looser than the
// test screen's thresholds, because these two readings do different jobs here:
// once an anchor is down ARKit holds it still regardless, so what the accuracy
// governs is how truly the run of them lands on the pavement, not whether it
// stays put. Beyond these the placement is worth less than the compass-drawn
// fallback, which at least starts from where the walker actually is.
//
// Five metres was too loose, and field-walking a route showed why. Five metres
// is wider than the road: at that accuracy the fix cannot tell which pavement
// the walker is on, so the chevrons were being planted - confidently, and held
// rock-steady by ARKit once down - out in the traffic or on the far side of the
// street. Three is roughly what ARCore reports once VPS has actually localised
// against Street View imagery, and above it the pose is really the phone's own
// GPS wearing a geospatial label.
//
// This does mean the anchored run appears less often. That is the trade being
// made deliberately: the compass fallback is drawn relative to where the walker
// is standing, so it is vague about direction but never on the wrong pavement,
// which is the better failure of the two.
const TRUST_ANCHORS_ACCURACY_M = 3;
const TRUST_ANCHORS_HEADING_DEG = 15;

// And when to stop trusting it - deliberately worse than the figures above
// rather than equal to them.
//
// Reported accuracy wanders continuously, so a single threshold would be
// crossed back and forth while walking, and each crossing swaps the chevrons
// between two sources that disagree by metres. The walker would read that as
// the arrows jumping, which is the fault this whole change exists to remove. A
// gap between switching on and switching off means the pose has to genuinely
// deteriorate, not merely wobble, before the fallback takes over.
const DISTRUST_ANCHORS_ACCURACY_M = 6;
const DISTRUST_ANCHORS_HEADING_DEG = 25;

export function ARNavigationScreen({ route, navigation }: Props) {
  const { route: walkingRoute } = route.params;
  const insets = useSafeAreaInsets();
  const { T, F, scaled, hazardActive, mobilityAid, spokenTurns, hazardCues } = useSettings();
  const [position, setPosition] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState(0);
  // How far the phone is tilted down from level. Measured, so the ground
  // arrows sit on the actual ground instead of wherever a fixed guess put
  // them - look up at the buildings and they slide off the bottom of the
  // frame, which is where the pavement has gone.
  const [pitch, setPitch] = useState(DEFAULT_CAMERA_PITCH_DEG);
  // The banner's own height, so the pills can sit under it rather than at a
  // guessed offset that a longer street name would push them into.
  const [bannerHeight, setBannerHeight] = useState(0);
  // What the AR session reports: where on Earth it has placed itself, and
  // where each anchored route point currently lands on screen.
  const [geospatial, setGeospatial] = useState<GeospatialUpdate | null>(null);
  const [projectedAnchors, setProjectedAnchors] = useState<ProjectedAnchor[]>([]);

  // Held steady across renders. The anchor event arrives every camera frame, so
  // this component re-renders at 60Hz; fresh closures each time would hand the
  // native view new props sixty times a second for no change in behaviour.
  const handleGeospatialUpdate = useCallback(
    (event: { nativeEvent: GeospatialUpdate }) => setGeospatial(event.nativeEvent),
    [],
  );
  const handleAnchorsUpdate = useCallback(
    (event: { nativeEvent: { anchors: ProjectedAnchor[] } }) =>
      setProjectedAnchors(event.nativeEvent.anchors),
    [],
  );

  const activeClasses = useMemo(
    () => HAZARD_CLASSES.filter((hazardClass) => hazardActive[hazardClass]),
    [hazardActive],
  );

  useEffect(() => {
    let positionSubscription: Location.LocationSubscription | undefined;
    let headingSubscription: Location.LocationSubscription | undefined;

    (async () => {
      positionSubscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 2 },
        (update) =>
          setPosition({ latitude: update.coords.latitude, longitude: update.coords.longitude }),
      );
      headingSubscription = await Location.watchHeadingAsync((update) =>
        setHeading(update.trueHeading >= 0 ? update.trueHeading : update.magHeading),
      );
    })();

    return () => {
      positionSubscription?.remove();
      headingSubscription?.remove();
    };
  }, []);

  // Device attitude, for the camera's tilt.
  //
  // `beta` is the phone's front-to-back rotation: 90 degrees with the screen
  // upright, which is where the rear camera looks straight out at the horizon
  // and the tilt is zero. So tilt is what's left of a right angle.
  //
  // Low-pass filtered, because raw attitude jitters by a degree or two even
  // held still, and a jittering tilt makes the whole run of chevrons shiver.
  useEffect(() => {
    DeviceMotion.setUpdateInterval(PITCH_UPDATE_MS);
    const subscription = DeviceMotion.addListener(({ rotation }) => {
      if (!rotation) return;
      const measured = 90 - (rotation.beta * 180) / Math.PI;
      setPitch((current) => current + (measured - current) * PITCH_SMOOTHING);
    });
    return () => subscription.remove();
  }, []);

  // Whether to draw the anchored chevrons or fall back to the compass-drawn
  // ones. Both readings matter: the position fixes where the anchors go, and
  // the heading fixes which way the AR session thinks north is - a yaw error
  // swings the whole run of them sideways even when each is individually held
  // still.
  //
  // Held as state with a gap between the two thresholds, so this answer changes
  // only when the pose really has: see the constants above.
  const [anchorsTrusted, setAnchorsTrusted] = useState(false);

  useEffect(() => {
    if (!geospatial) return;

    const usable = geospatial.tracking && geospatial.horizontalAccuracy > 0;
    if (
      usable &&
      geospatial.horizontalAccuracy <= TRUST_ANCHORS_ACCURACY_M &&
      geospatial.headingAccuracy <= TRUST_ANCHORS_HEADING_DEG
    ) {
      setAnchorsTrusted(true);
    } else if (
      !usable ||
      geospatial.horizontalAccuracy > DISTRUST_ANCHORS_ACCURACY_M ||
      geospatial.headingAccuracy > DISTRUST_ANCHORS_HEADING_DEG
    ) {
      setAnchorsTrusted(false);
    }
  }, [geospatial]);

  // Whether a scan is genuinely in progress, which is when the arrows are
  // withheld: showing the compass-drawn run under a panel asking the user to
  // scan says two contradictory things at once, and the run it would show is
  // the less accurate of the two anyway.
  //
  // Deliberately narrower than "not localised". Somewhere with no Street View
  // coverage will never localise however long the phone is waved about, and a
  // walker left with no arrows at all in that case is worse off than one given
  // compass arrows and told they are approximate.
  const hopeless = geospatial?.vpsAvailability === 'unavailable';
  const [scanAbandoned, setScanAbandoned] = useState(false);
  const [noCoverageNoticeSeen, setNoCoverageNoticeSeen] = useState(false);

  // A scan that has not succeeded in this long is not going to during this
  // walk - a window looking onto a courtyard, a street Street View never drove.
  // The guidance falls back rather than leaving the walker with nothing.
  useEffect(() => {
    if (anchorsTrusted || hopeless || !isARGeospatialSupported) {
      setScanAbandoned(false);
      return;
    }
    const timeout = setTimeout(() => setScanAbandoned(true), SCAN_PATIENCE_MS);
    return () => clearTimeout(timeout);
  }, [anchorsTrusted, hopeless]);

  // The no-coverage explanation is worth reading once, not for the whole walk -
  // it dims the camera, and the camera is the screen.
  useEffect(() => {
    if (!hopeless) {
      setNoCoverageNoticeSeen(false);
      return;
    }
    const timeout = setTimeout(() => setNoCoverageNoticeSeen(true), NO_COVERAGE_NOTICE_MS);
    return () => clearTimeout(timeout);
  }, [hopeless]);

  const scanning =
    isARGeospatialSupported && !anchorsTrusted && !hopeless && !scanAbandoned;
  const promptVisible =
    scanning || (isARGeospatialSupported && !anchorsTrusted && hopeless && !noCoverageNoticeSeen);

  // Nothing is drawn over the camera while the scan prompt is up.
  //
  // The prompt asks the user to point the phone at the buildings around them.
  // Chevrons on the pavement and boxes round potholes are both answers to a
  // different question - "where do I walk" - and putting them on screen while
  // the app is still asking for something contradicts the request and buries
  // the thing that is being asked about.
  //
  // Keyed on the prompt being *visible*, not on `scanning`. The two differ in
  // the case that matters: where there is no Street View coverage, scanning has
  // already given up but the prompt stays up for a few seconds to say so, and
  // guidance appearing under that notice while it explains why guidance is
  // approximate is the wrong order to say two things in.
  const guiding = !promptVisible;

  // Fed by the AR view below, which runs the same model over ARKit's frames.
  const { detections, onHazards } = useHazardDetections(guiding, activeClasses);

  // Where the anchors are measured from.
  //
  // The AR session's own fix, not the phone's, whenever it is trustworthy. This
  // is the single most important line for how the chevrons look: ARCore
  // localises to well under a metre where the GPS fix is five to ten, and since
  // the run is laid out relative to where the walker is, a fix that says they
  // are eight metres back puts the whole run eight metres too far up the road.
  const anchorOrigin = useMemo<LatLng | null>(
    () =>
      anchorsTrusted && geospatial
        ? { latitude: geospatial.latitude, longitude: geospatial.longitude }
        : position,
    [anchorsTrusted, geospatial, position],
  );

  // How far the walker is standing to one side of the drawn route.
  //
  // Two values, not one. The ref is the running estimate and moves on every
  // fix; the state is the quantised figure the anchors are actually built from
  // and moves rarely, because every change to it re-plants the whole run. Kept
  // in a ref rather than a second piece of state so that averaging a fix does
  // not re-render the screen - at these update rates that would be a render per
  // fix to change a number nothing is reading yet.
  const smoothedOffset = useRef(0);
  const [pathOffset, setPathOffset] = useState(0);

  useEffect(() => {
    if (!anchorOrigin) return;

    const measured = lateralOffsetFromRoute(walkingRoute.coordinates, anchorOrigin);
    if (measured === undefined) return;

    // Past the cap this has stopped meaning "the other pavement" and started
    // meaning "not on this road", and the honest answer then is the real route.
    const sample = Math.abs(measured) <= MAX_PATH_OFFSET_M ? measured : 0;

    smoothedOffset.current += (sample - smoothedOffset.current) * OFFSET_SMOOTHING;

    // How big the estimate has to be before its sign is worth acting on. Scaled
    // by what the pose says about itself, so a metre of offset is believed on a
    // VPS fix good to half a metre and ignored on one that is guessing - with a
    // floor under it, because a fix that reports implausibly good accuracy
    // should not be able to switch the check off.
    const uncertainty = anchorsTrusted && geospatial ? geospatial.horizontalAccuracy : 0;
    const confident = Math.max(
      OFFSET_MIN_CONFIDENT_M,
      uncertainty * OFFSET_CONFIDENT_FRACTION,
    );
    const target =
      Math.abs(smoothedOffset.current) >= confident ? smoothedOffset.current : 0;

    setPathOffset((current) => {
      if (Math.abs(target - current) <= OFFSET_DEADBAND_M) return current;
      // Snapped to half a metre. The offset is baked into each anchor's id, so
      // every change re-plants the run - quantising keeps that to the rare
      // occasions it is warranted.
      return Math.round(target * 2) / 2;
    });
  }, [walkingRoute.coordinates, anchorOrigin, anchorsTrusted, geospatial]);

  // The route points to anchor, as a fixed lattice measured from the start of
  // the route rather than from the walker.
  //
  // That is what makes the ids stable. Numbering from the walker would renumber
  // every point on every fix, and since the native side matches anchors by id,
  // renumbering means destroying and re-creating anchors that had not moved -
  // the exact churn that makes AR markers jump. Measured from the route's
  // start, a point keeps its id for the whole walk; advancing simply drops one
  // off the back of the window and adds one at the front.
  const routeAnchors = useMemo<GeoAnchor[]>(() => {
    if (!anchorOrigin) return [];

    const along = distanceAlongRoute(walkingRoute.coordinates, anchorOrigin);
    const first = Math.ceil((along - ANCHOR_LOOKBACK_M) / ANCHOR_SPACING_M);
    const last = Math.floor((along + ANCHOR_HORIZON_M) / ANCHOR_SPACING_M);
    const shift = offsetKeyFor(pathOffset) * OFFSET_ID_STRIDE;

    const planted: GeoAnchor[] = [];
    for (let index = first; index <= last; index += 1) {
      const point = pointBesideRoute(
        walkingRoute.coordinates,
        index * ANCHOR_SPACING_M,
        pathOffset,
      );
      // Undefined means the route has run out, so the run of chevrons stops at
      // the destination instead of pointing past it.
      if (!point) break;

      // Measured from the walker, not along the route. A chevron under their
      // own feet is not guidance, and around a corner the two distances differ
      // by several metres.
      if (distanceMeters(anchorOrigin, point) < ANCHOR_LEAD_M) continue;

      planted.push({ id: index + shift, latitude: point.latitude, longitude: point.longitude });
    }

    // The destination itself, once it is close enough to point at with any
    // authority. Anchored on its true coordinate with no pavement shift: the
    // chevrons are shifted because a route line is a rough guide to which side
    // of the road to walk on, but the destination is an actual place.
    if (distanceMeters(anchorOrigin, walkingRoute.destination) <= DESTINATION_ANCHOR_RANGE_M) {
      planted.push({
        id: DESTINATION_ANCHOR_ID,
        kind: 'destination',
        latitude: walkingRoute.destination.latitude,
        longitude: walkingRoute.destination.longitude,
      });
    }

    return planted;
  }, [walkingRoute.coordinates, walkingRoute.destination, anchorOrigin, pathOffset]);

  // Two directions matter, not one: the way the route runs from here to the
  // next point, and the way it runs after that point. The first is where the
  // walker should be heading right now; the second is the turn they are being
  // warned about. Both are expressed relative to the way they are facing, so
  // they can be drawn straight onto the camera.
  // Memoised on the fix rather than recomputed per render: the AR session
  // reports anchor positions every frame, so this component now renders at the
  // camera's rate, and both of these walk the whole route polyline.
  const targetIndex = useMemo(
    () =>
      position !== null ? nextRoutePointIndex(walkingRoute.coordinates, position) : undefined,
    [walkingRoute.coordinates, position],
  );
  const target = targetIndex !== undefined ? walkingRoute.coordinates[targetIndex] : undefined;

  const bearingToNext =
    position && target ? relativeBearing(heading, bearingBetween(position, target)) : undefined;
  const onwardBearing =
    targetIndex !== undefined
      ? routeBearingAfter(walkingRoute.coordinates, targetIndex)
      : undefined;
  const bearingAfterNext =
    onwardBearing !== undefined ? relativeBearing(heading, onwardBearing) : undefined;
  const metersToTarget = position && target ? distanceMeters(position, target) : undefined;

  // The change of direction *across* the next point - not where that point
  // happens to lie relative to the walker's shoulders. `relativeBearing(a, b)`
  // is b - a, so this is (direction after) minus (direction before): positive
  // means the route swings right.
  const vertexTurn =
    bearingToNext !== undefined && bearingAfterNext !== undefined
      ? relativeBearing(bearingToNext, bearingAfterNext)
      : bearingToNext;

  // The banner works in steps, not polyline vertices. Vertices sit a few
  // metres apart, so a banner counting down to one would read "12 m" forever;
  // what a walker wants is the distance to the actual manoeuvre and the name
  // of the street it puts them on.
  const stepIndex = useMemo(
    () => (position ? currentStepIndex(walkingRoute, position) : undefined),
    [walkingRoute, position],
  );
  const step = stepIndex !== undefined ? walkingRoute.steps[stepIndex] : undefined;
  const nextStep = stepIndex !== undefined ? walkingRoute.steps[stepIndex + 1] : undefined;

  const metersToManeuver =
    position && step ? distanceMeters(position, step.end) : metersToTarget;

  // Measured between the two legs' own end-to-end directions, so it describes
  // the manoeuvre the distance above is counting down to, rather than whatever
  // slight bend the nearest vertex happens to sit on.
  const stepTurn =
    step && nextStep
      ? relativeBearing(
          bearingBetween(step.start, step.end),
          bearingBetween(nextStep.start, nextStep.end),
        )
      : undefined;

  const turnAngle = stepTurn ?? vertexTurn;

  // Which of the fixed banner glyphs to show. The API's own code wins where
  // there is one; the measured angle covers routes without them; and once
  // there is no step left to turn into, the manoeuvre is arriving.
  const maneuver: Maneuver =
    step && !nextStep
      ? 'arrive'
      : (maneuverFromApi(nextStep?.maneuver) ?? maneuverFromAngle(turnAngle));
  const maneuverIcon = MANEUVER_ICONS[maneuver];
  // The road being turned onto, which is the one worth naming while
  // approaching a corner. Falls back to the road underfoot on the last leg,
  // where there is nothing left to turn onto.
  const road = nextStep?.road ?? step?.road;

  // Spoken guidance, each half gated on its own preference so either can be
  // silenced without losing the other - the whole point of splitting the two
  // cue types in Settings.
  useSpokenTurnCues({
    enabled: spokenTurns,
    maneuver,
    road,
    metersToManeuver,
    stepIndex,
  });
  // Silent while the prompt is up as well, so a hazard is not called out over
  // an instruction to scan. `detections` is already empty then, but saying so
  // here keeps the spoken and the drawn guidance switching on together rather
  // than one depending on the other staying empty.
  useSpokenHazardCues(hazardCues && guiding, detections);

  const progress = useTripProgress(walkingRoute, position);
  const remainingMeters = walkingRoute.distanceMeters * (1 - progress);
  // Rescaled to the pace implied by the Mobility aid setting, so the time
  // left here matches the estimate the user chose this route on.
  const remainingSeconds =
    routeDurationSeconds(walkingRoute.durationSeconds, mobilityAid, walkingRoute.accessibleFor) *
    (1 - progress);

  const exit = () => navigation.goBack();

  // ARKit runs the camera where it exists, because only one thing can hold it
  // and the arrows need the pose. Elsewhere the plain preview stands in, and
  // the chevrons fall back to being drawn from the compass.
  const surface = isARGeospatialSupported ? (
    <ARGeospatialView
      style={StyleSheet.absoluteFill}
      apiKey={GOOGLE_MAPS_API_KEY}
      anchors={routeAnchors}
      onGeospatialUpdate={handleGeospatialUpdate}
      onAnchorsUpdate={handleAnchorsUpdate}
      onHazards={onHazards}
    />
  ) : undefined;

  return (
    <CameraStage isActive surface={surface}>
      {/* Under the hazard overlay: a hazard on the path is the more urgent of
          the two, and must never end up behind a chevron pointing at it.

          One of the two, never both - they draw the same run of chevrons from
          different sources, and showing them together would read as a double
          image wherever the two disagreed, which is precisely where it would
          matter most.

          No `guiding` check here, unlike the compass run below: both halves of
          `promptVisible` require `!anchorsTrusted`, so the prompt cannot be up
          at the same moment these are drawn. Adding the condition would read as
          a case that can happen. */}
      {anchorsTrusted && (
        <>
          <GroundChevrons anchors={projectedAnchors} color={T.green} />
          {/* Over the chevrons: the run leads to the pin, so the pin should
              never be behind it. */}
          <DestinationPin
            anchors={projectedAnchors}
            label={walkingRoute.destinationName}
          />
        </>
      )}

      {/* The compass-drawn run, for when the anchored one is not coming: no
          coverage here, no AR at all on this platform, or a scan that has gone
          on long enough to stop being worth waiting for. Never while the prompt
          is up - see `guiding`. */}
      {!anchorsTrusted && guiding && (
        <GroundArrows
          bearingToNext={bearingToNext}
          metersToNext={metersToTarget}
          bearingAfterNext={bearingAfterNext}
          pitchDegrees={pitch}
          color={T.green}
        />
      )}

      <HazardOverlay detections={detections} />

      {/* Above the overlays but below the banner and the sheet: it is asking
          for something, so it must not sit under the thing it is asking about,
          and it must not bury the instruction or the way out of the route. */}
      <ScanPrompt
        visible={promptVisible}
        vpsAvailability={geospatial?.vpsAvailability}
        horizontalAccuracy={geospatial?.horizontalAccuracy}
        tracking={geospatial?.tracking}
      />

      {/* Below the banner, not above it: the instruction is what the screen is
          for, so it takes the top of the frame and the cue switches sit under
          it. Offset by the banner's measured height rather than a constant,
          since a long street name can wrap it onto another line.
          The route is left via "End" on the sheet below - a second, smaller
          exit control up here was a redundant way to lose the route. Both cue
          types are live on a route, so both get a pill. */}
      <View style={[styles.topRow, { top: insets.top + BANNER_TOP_GAP + bannerHeight + 8 }]}>
        <HazardTypeBar />
        <VoiceCueBar cues={['turns', 'hazards']} />
      </View>

      {/* Laid out the way a turn-by-turn banner is: the manoeuvre arrow, then
          the distance to it as the headline - that is the thing being read at
          a glance while walking - then the street it puts you on, then what
          that street heads towards. The instruction in words comes last, for
          anyone who can't read a small rotated glyph. */}
      <View
        style={[styles.banner, { top: insets.top + BANNER_TOP_GAP }]}
        onLayout={(e) => setBannerHeight(e.nativeEvent.layout.height)}
      >
        <AppIcon name={maneuverIcon} size={scaled(46)} color="#fff" />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerDistance, { fontSize: F.h1 }]} numberOfLines={1}>
            {metersToManeuver !== undefined ? formatDistance(metersToManeuver) : '—'}
          </Text>
          <Text style={[styles.bannerRoad, { fontSize: F.h2 }]} numberOfLines={1}>
            {road ?? MANEUVER_LABELS[maneuver]}
          </Text>
          {road && (
            <Text style={[styles.bannerToward, { fontSize: F.sm }]} numberOfLines={1}>
              {MANEUVER_LABELS[maneuver]}
            </Text>
          )}
        </View>
      </View>

      {/* Progress is the bar itself rather than a rule under it.

          A 5px track is a detail you have to look for; a bar that fills up as
          you walk is read peripherally, which is the only way it will ever be
          read by someone doing the thing it measures. It also frees the
          vertical space the track and its margin were using, so the bar is
          shorter while saying more.

          `accessibilityValue` carries the same thing for VoiceOver, which
          cannot see a fill at all. */}
      <View
        style={[styles.sheet, { bottom: insets.bottom > 0 ? insets.bottom : 32 }]}
        accessibilityValue={{ text: `${Math.round(progress * 100)} percent of the route walked` }}
      >
        <View
          style={[
            styles.sheetFill,
            { backgroundColor: OVERLAY_GREEN, width: `${Math.round(progress * 100)}%` },
          ]}
        />
        <View style={styles.sheetRow}>
          <View style={styles.sheetText}>
            <Text style={[styles.destination, { fontSize: F.body }]} numberOfLines={1}>
              {walkingRoute.destinationName}
            </Text>
            <Text style={[styles.remaining, { fontSize: F.tinySm }]} numberOfLines={1}>
              {formatDuration(remainingSeconds)} · {formatDistance(remainingMeters)} remaining
            </Text>
          </View>
          <Pressable
            onPress={exit}
            style={styles.endButton}
            accessibilityRole="button"
            accessibilityLabel="End navigation"
          >
            <Text style={[styles.endButtonText, { fontSize: F.sm }]}>End</Text>
          </Pressable>
        </View>
      </View>
    </CameraStage>
  );
}

// How far along the route the walker is, as a 0-1 fraction. Measured by
// walked distance rather than vertex index: polyline vertices bunch up around
// corners, so counting them would make the remaining distance jump backwards
// and forwards as the walker rounds a bend. Falls back to 0 until the first
// location fix arrives.
function useTripProgress(
  walkingRoute: { coordinates: LatLng[] },
  position: LatLng | null,
): number {
  return useMemo(() => {
    const { coordinates } = walkingRoute;
    if (!position || coordinates.length < 2) return 0;

    // Cumulative distance to each vertex, and which vertex the walker is
    // nearest to, in one pass.
    let travelled = 0;
    let total = 0;
    let nearestDistance = Infinity;

    for (let i = 1; i < coordinates.length; i += 1) {
      const toHere = distanceMeters(position, coordinates[i - 1]);
      if (toHere < nearestDistance) {
        nearestDistance = toHere;
        travelled = total;
      }
      total += distanceMeters(coordinates[i - 1], coordinates[i]);
    }
    if (distanceMeters(position, coordinates[coordinates.length - 1]) < nearestDistance) {
      travelled = total;
    }

    if (total === 0) return 0;
    return Math.min(1, Math.max(0, travelled / total));
  }, [walkingRoute, position]);
}

// Which step of the directions the walker is currently on - the leg whose end
// they are walking towards.
//
// Chosen by how far off each step's span they are, rather than by nearest
// endpoint: a step is a stretch of road, and someone standing in the middle of
// a long one is far from both of its ends. Walking to the start and then to
// the end of the step you are on covers the step's own length and no more, so
// the excess over that length is zero on the right step and grows with
// distance on every other one.
//
// Undefined when the route carries no steps at all, which is what the banner
// falls back to plain turn wording for.
function currentStepIndex(walkingRoute: WalkingRoute, position: LatLng): number | undefined {
  const { steps } = walkingRoute;
  if (!steps || steps.length === 0) return undefined;

  let best = 0;
  let bestExcess = Infinity;

  steps.forEach((step: RouteStep, index: number) => {
    const excess = Math.max(
      0,
      distanceMeters(position, step.start) +
        distanceMeters(position, step.end) -
        step.distanceMeters,
    );
    if (excess < bestExcess) {
      bestExcess = excess;
      best = index;
    }
  });

  return best;
}

const styles = StyleSheet.create({
  topRow: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    flexDirection: 'row',
    // Top-aligned, so opening the hazard dropdown grows it downwards over the
    // camera rather than dragging the sound bar down beside it.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  banner: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    backgroundColor: 'rgba(20,20,20,0.78)',
    borderRadius: RADIUS.section,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  bannerText: { flex: 1 },
  bannerDistance: { color: '#fff', fontWeight: '700' },
  bannerRoad: { color: '#fff', fontWeight: '600', marginTop: 1 },
  bannerToward: { color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  sheet: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    backgroundColor: 'rgba(20,20,20,0.78)',
    borderRadius: RADIUS.section,
    paddingVertical: 16,
    paddingHorizontal: 18,
    // Clips the fill to the rounded corners - without it the walked portion
    // squares off the left end of the bar.
    overflow: 'hidden',
  },
  sheetFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    // Held well down, so it reads as a tint on the bar rather than as a green
    // panel with text on it. The text has to stay legible across the boundary,
    // and it crosses that boundary at some point on every walk.
    opacity: 0.3,
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sheetText: { flex: 1 },
  destination: { color: '#fff', fontWeight: '700' },
  remaining: { color: 'rgba(255,255,255,0.72)', marginTop: 2 },
  endButton: {
    backgroundColor: OVERLAY_RED,
    borderRadius: RADIUS.small,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  endButtonText: { color: '#fff', fontWeight: '700' },
});
