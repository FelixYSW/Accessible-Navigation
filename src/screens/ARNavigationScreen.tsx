import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import * as Location from 'expo-location';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { LatLng } from '../types/route';
import { HAZARD_CLASSES } from '../types/hazard';
import { bearingBetween, distanceMeters, nextRoutePoint, relativeBearing } from '../utils/geo';
import { useStubHazardDetector } from '../services/hazardDetector';
import { CameraStage } from '../components/CameraStage';
import { GroundArrows } from '../components/GroundArrows';
import { HazardOverlay } from '../components/HazardOverlay';
import { VoiceCuePill } from '../components/VoiceCuePill';
import { useSettings } from '../theme/SettingsContext';
import { routeDurationSeconds } from '../services/mobility';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';
import { formatDistance, formatDuration } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'ARNavigation'>;

// Turns sharper than this are called out as a turn; anything straighter reads
// as "Continue straight".
const TURN_THRESHOLD_DEGREES = 25;

export function ARNavigationScreen({ route, navigation }: Props) {
  const { route: walkingRoute } = route.params;
  const insets = useSafeAreaInsets();
  const { T, F, scaled, hazardActive, mobilityAid } = useSettings();
  const [position, setPosition] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState(0);

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

  const target = position ? nextRoutePoint(walkingRoute.coordinates, position) : undefined;
  const turnAngle =
    position && target ? relativeBearing(heading, bearingBetween(position, target)) : undefined;
  const metersToTarget = position && target ? distanceMeters(position, target) : undefined;

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
      <GroundArrows turnAngle={turnAngle} metersToTarget={metersToTarget} color={T.green} />

      <HazardOverlay detections={detections} />

      {/* The route is left via "End" on the sheet below - a second, smaller
          exit control at the top was a redundant way to lose the route. Both
          cue types are live on a route, so both get a pill. */}
      <View style={[styles.topRow, { top: insets.top + 4 }]}>
        <VoiceCuePill cue="turns" />
        <VoiceCuePill cue="hazards" />
      </View>

      {/* The instruction reads as one line across the top, the way it does on
          a driving screen: the arrow says which way, the words say the same
          thing again for anyone who can't read a small rotated glyph, and the
          distance says when. */}
      <View style={[styles.banner, { top: insets.top + 60 }]}>
        <TurnArrow color={T.green} angle={turnAngle ?? 0} width={scaled(44)} />
        <View style={styles.bannerText}>
          <Text style={[styles.turnInstruction, { fontSize: F.h2 }]} numberOfLines={1}>
            {describeTurn(turnAngle)}
          </Text>
          {metersToTarget !== undefined && (
            <Text style={[styles.turnDistance, { fontSize: F.sm }]} numberOfLines={1}>
              in {formatDistance(metersToTarget)}
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

function describeTurn(angle: number | undefined): string {
  if (angle === undefined) return 'Getting your position';
  if (Math.abs(angle) <= TURN_THRESHOLD_DEGREES) return 'Continue straight';
  if (Math.abs(angle) >= 135) return 'Turn around';
  return angle > 0 ? 'Turn right' : 'Turn left';
}

// The design's chevron: two strokes meeting at a point, rotated to indicate
// which way to go (0 = straight ahead, positive = right). Sized from the
// outside so it grows with the instruction underneath it - it is the largest
// thing on the screen and the last one that should stay small.
function TurnArrow({ color, angle, width }: { color: string; angle: number; width: number }) {
  return (
    <Svg
      width={width}
      height={Math.round((width * 34) / 40)}
      viewBox="0 0 72 60"
      style={{ transform: [{ rotate: `${angle}deg` }] }}
    >
      <Path
        d="M36 4 L14 46 M36 4 L58 46"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
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
  turnInstruction: { color: '#fff', fontWeight: '700' },
  turnDistance: { color: 'rgba(255,255,255,0.65)', marginTop: 2 },
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
