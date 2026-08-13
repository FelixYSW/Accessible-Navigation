import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import Svg, { Circle } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  ARGeospatialView,
  type GeospatialUpdate,
  type ProjectedAnchor,
} from '../../modules/ar-geospatial';
import { useSettings } from '../theme/SettingsContext';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'ARGeospatialTest'>;

// How far ahead the test anchors are planted, in metres. Close enough to walk
// to and check they stay put.
const TEST_ANCHOR_DISTANCES_M = [3, 6, 10];

// Below these the pose is not worth trusting - roughly Google's own figures
// for a good VPS localisation. Above them the screen says to keep scanning,
// which is what "point your phone at the buildings" means in Live View.
const GOOD_HORIZONTAL_ACCURACY_M = 3;
const GOOD_HEADING_ACCURACY_DEG = 10;

// A throwaway screen for one question: does ARCore's Geospatial API actually
// localise where this app will be used, and how accurately?
//
// It plants three anchors on the ground straight ahead of wherever the user is
// standing when it opens, then draws a dot wherever the AR session says each
// one now is. If the dots stay on the same patch of pavement as the phone is
// moved around, the tracking is holding; if they crawl, it isn't. Everything
// the pose reports is on screen next to them, because the numbers are the
// point - accuracy of 1m and accuracy of 10m look identical until you read it.
export function ARGeospatialTestScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { T, F } = useSettings();

  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [update, setUpdate] = useState<GeospatialUpdate | null>(null);
  const [anchors, setAnchors] = useState<ProjectedAnchor[]>([]);

  const apiKey = (Constants.expoConfig?.extra?.googleMapsApiKey as string | undefined) ?? '';

  // One fix, to decide where to plant the test anchors. Deliberately not a
  // watch: the anchors are meant to stay where they were put, so that walking
  // away from them shows whether they hold.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      if (cancelled) return;
      setOrigin({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const testAnchors = origin ? anchorsAhead(origin, update?.heading ?? 0) : [];

  const localised =
    update?.tracking === true &&
    update.horizontalAccuracy > 0 &&
    update.horizontalAccuracy <= GOOD_HORIZONTAL_ACCURACY_M &&
    update.headingAccuracy <= GOOD_HEADING_ACCURACY_DEG;

  if (Platform.OS !== 'ios') {
    return (
      <View style={[styles.unsupported, { backgroundColor: T.pageBg }]}>
        <Text style={{ color: T.text, fontSize: F.body, textAlign: 'center' }}>
          The Geospatial test is iOS-only for now.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.stage}>
      <ARGeospatialView
        style={StyleSheet.absoluteFill}
        apiKey={apiKey}
        anchors={testAnchors}
        onGeospatialUpdate={(event) => setUpdate(event.nativeEvent)}
        onAnchorsUpdate={(event) => setAnchors(event.nativeEvent.anchors)}
      />

      {/* Each anchor, where the session currently says it is. */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {anchors
          .filter((anchor) => anchor.visible)
          .map((anchor) => (
            <Circle
              key={anchor.index}
              cx={anchor.x}
              cy={anchor.y}
              r={Math.max(6, 40 / Math.max(1, anchor.distance))}
              fill={T.green}
              fillOpacity={0.85}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={1.5}
            />
          ))}
      </Svg>

      <View style={[styles.panel, { top: insets.top + 8 }]}>
        <Text style={[styles.heading, { fontSize: F.h2 }]}>
          {update?.error
            ? 'Error'
            : localised
              ? 'Localised'
              : 'Scanning — point at buildings'}
        </Text>

        {update?.error ? (
          <Text style={[styles.value, { fontSize: F.sm }]}>{update.error}</Text>
        ) : (
          <>
            <Row label="VPS here" value={update?.vpsAvailability ?? 'checking…'} fontSize={F.sm} />
            <Row label="Tracking" value={update?.trackingState ?? 'starting…'} fontSize={F.sm} />
            <Row
              label="Position ±"
              value={update ? `${update.horizontalAccuracy.toFixed(1)} m` : '—'}
              fontSize={F.sm}
            />
            <Row
              label="Heading ±"
              value={update ? `${update.headingAccuracy.toFixed(1)}°` : '—'}
              fontSize={F.sm}
            />
            <Row
              label="Lat, lng"
              value={
                update ? `${update.latitude.toFixed(6)}, ${update.longitude.toFixed(6)}` : '—'
              }
              fontSize={F.sm}
            />
            <Row
              label="Anchors visible"
              value={`${anchors.filter((a) => a.visible).length} of ${testAnchors.length}`}
              fontSize={F.sm}
            />
          </>
        )}
      </View>

      <Pressable
        style={[styles.close, { bottom: insets.bottom > 0 ? insets.bottom + 8 : 24 }]}
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Close the Geospatial test"
      >
        <Text style={[styles.closeText, { fontSize: F.body }]}>Close</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value, fontSize }: { label: string; value: string; fontSize: number }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { fontSize }]}>{label}</Text>
      <Text style={[styles.value, { fontSize }]}>{value}</Text>
    </View>
  );
}

// Test anchors in a line straight ahead of where the phone is pointing, so
// they land on the pavement in front of the user rather than inside a wall.
function anchorsAhead(
  origin: { latitude: number; longitude: number },
  headingDegrees: number,
): { latitude: number; longitude: number }[] {
  const heading = (headingDegrees * Math.PI) / 180;
  const metresPerDegreeLat = 111320;
  const metresPerDegreeLng = metresPerDegreeLat * Math.cos((origin.latitude * Math.PI) / 180);

  return TEST_ANCHOR_DISTANCES_M.map((distance) => ({
    latitude: origin.latitude + (Math.cos(heading) * distance) / metresPerDegreeLat,
    longitude: origin.longitude + (Math.sin(heading) * distance) / metresPerDegreeLng,
  }));
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#0a0a0a' },
  unsupported: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  panel: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    backgroundColor: 'rgba(20,20,20,0.8)',
    borderRadius: RADIUS.section,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  heading: { color: '#fff', fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 3 },
  label: { color: 'rgba(255,255,255,0.6)' },
  value: { color: '#fff', fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  close: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: RADIUS.button,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  closeText: { color: '#fff', fontWeight: '700' },
});
