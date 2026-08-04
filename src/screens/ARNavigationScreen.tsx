import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import * as Location from 'expo-location';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { LatLng } from '../types/route';
import { bearingBetween, nextRoutePoint, relativeBearing } from '../utils/geo';
import { useStubHazardDetector } from '../services/hazardDetector';
import { HazardOverlay } from '../components/HazardOverlay';

type Props = NativeStackScreenProps<RootStackParamList, 'ARNavigation'>;

export function ARNavigationScreen({ route, navigation }: Props) {
  const { route: walkingRoute } = route.params;
  const { hasPermission, requestPermission } = useCameraPermission();
  const [position, setPosition] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState(0);

  const detections = useStubHazardDetector(hasPermission);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

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
  const arrowBearing =
    position && target ? relativeBearing(heading, bearingBetween(position, target)) : undefined;

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera access is required for hazard detection.</Text>
        <Pressable style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Camera Access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera style={StyleSheet.absoluteFill} isActive device="back" />
      <HazardOverlay detections={detections} arrowBearing={arrowBearing} />

      <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>Exit</Text>
      </Pressable>

      <View style={styles.destinationBanner}>
        <Text style={styles.destinationText}>To: {walkingRoute.destinationName}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#000',
  },
  permissionText: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  permissionButton: {
    backgroundColor: '#0A84FF',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  permissionButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backButton: {
    position: 'absolute',
    top: 56,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  destinationBanner: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  destinationText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
