import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { LatLng, RouteStep, WalkingRoute } from '../types/route';
import { HAZARD_CLASSES } from '../types/hazard';
import {
  bearingBetween,
  distanceMeters,
  nextRoutePointIndex,
  relativeBearing,
  routeBearingAfter,
} from '../utils/geo';
import { useStubHazardDetector } from '../services/hazardDetector';
import { CameraStage } from '../components/CameraStage';
import { DEFAULT_CAMERA_PITCH_DEG, GroundArrows } from '../components/GroundArrows';
import {
  MANEUVER_ICONS,
  MANEUVER_LABELS,
  maneuverFromAngle,
  maneuverFromApi,
  type Maneuver,
} from '../components/maneuverIcons';
import { HazardOverlay } from '../components/HazardOverlay';
import { VoiceCuePill } from '../components/VoiceCuePill';
import { useSettings } from '../theme/SettingsContext';
import { routeDurationSeconds } from '../services/mobility';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';
import { formatDistance, formatDuration } from '../utils/format';

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

export function ARNavigationScreen({ route, navigation }: Props) {
  const { route: walkingRoute } = route.params;
  const insets = useSafeAreaInsets();
  const { T, F, scaled, hazardActive, mobilityAid } = useSettings();
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

  const activeClasses = useMemo(
    () => HAZARD_CLASSES.filter((hazardClass) => hazardActive[hazardClass]),
    [hazardActive],
  );
  const detections = useStubHazardDetector(true, activeClasses);

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

  // Two directions matter, not one: the way the route runs from here to the
  // next point, and the way it runs after that point. The first is where the
  // walker should be heading right now; the second is the turn they are being
  // warned about. Both are expressed relative to the way they are facing, so
  // they can be drawn straight onto the camera.
  const targetIndex =
    position !== null ? nextRoutePointIndex(walkingRoute.coordinates, position) : undefined;
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
  const stepIndex = position ? currentStepIndex(walkingRoute, position) : undefined;
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
  const ManeuverIcon = MANEUVER_ICONS[maneuver];
  // The road being turned onto, which is the one worth naming while
  // approaching a corner. Falls back to the road underfoot on the last leg,
  // where there is nothing left to turn onto.
  const road = nextStep?.road ?? step?.road;

  const progress = useTripProgress(walkingRoute, position);
  const remainingMeters = walkingRoute.distanceMeters * (1 - progress);
  // Rescaled to the pace implied by the Mobility aid setting, so the time
  // left here matches the estimate the user chose this route on.
  const remainingSeconds =
    routeDurationSeconds(
      walkingRoute.durationSeconds,
      mobilityAid,
      Boolean(walkingRoute.accessibleFor),
    ) *
    (1 - progress);

  const exit = () => navigation.goBack();

  return (
    <CameraStage isActive>
      {/* Under the hazard overlay: a hazard on the path is the more urgent of
          the two, and must never end up behind a chevron pointing at it. */}
      <GroundArrows
        bearingToNext={bearingToNext}
        metersToNext={metersToTarget}
        bearingAfterNext={bearingAfterNext}
        pitchDegrees={pitch}
        color={T.green}
      />

      <HazardOverlay detections={detections} />

      {/* Below the banner, not above it: the instruction is what the screen is
          for, so it takes the top of the frame and the cue switches sit under
          it. Offset by the banner's measured height rather than a constant,
          since a long street name can wrap it onto another line.
          The route is left via "End" on the sheet below - a second, smaller
          exit control up here was a redundant way to lose the route. Both cue
          types are live on a route, so both get a pill. */}
      <View style={[styles.topRow, { top: insets.top + BANNER_TOP_GAP + bannerHeight + 8 }]}>
        <VoiceCuePill cue="turns" />
        <VoiceCuePill cue="hazards" />
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
        <ManeuverIcon size={scaled(46)} color="#fff" strokeWidth={2.2} />
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

      <View style={[styles.sheet, { bottom: insets.bottom > 0 ? insets.bottom : 32 }]}>
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

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: T.green, width: `${Math.round(progress * 100)}%` },
            ]}
          />
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
    alignItems: 'center',
    justifyContent: 'flex-end',
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
    backgroundColor: 'rgba(20,20,20,0.72)',
    borderRadius: RADIUS.section,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sheetText: { flex: 1 },
  destination: { color: '#fff', fontWeight: '700' },
  remaining: { color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  endButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: RADIUS.small,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  endButtonText: { color: '#fff', fontWeight: '700' },
  progressTrack: {
    marginTop: 12,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
});
