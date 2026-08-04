import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import type { LatLng, WalkingRoute } from '../types/route';
import { findPlace, getWalkingRoute } from '../services/directions';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

export function MapScreen({ navigation }: Props) {
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [query, setQuery] = useState('');
  const [route, setRoute] = useState<WalkingRoute | null>(null);
  const [loading, setLoading] = useState(false);

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

  const handleSearch = async () => {
    if (!origin) {
      Alert.alert('Location not ready', 'Still determining your current location, try again shortly.');
      return;
    }
    if (!query.trim()) return;

    Keyboard.dismiss();
    setLoading(true);
    try {
      const place = await findPlace(query.trim());
      const walkingRoute = await getWalkingRoute(origin, place.location, place.name);
      setRoute(walkingRoute);
    } catch (error) {
      Alert.alert('Could not find route', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
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
        {route && (
          <>
            <Marker coordinate={route.destination} title={route.destinationName} />
            <Polyline coordinates={route.coordinates} strokeWidth={4} strokeColor="#0A84FF" />
          </>
        )}
      </MapView>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Search a destination"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <Pressable style={styles.searchButton} onPress={handleSearch} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>Go</Text>}
        </Pressable>
      </View>

      {route && (
        <View style={styles.routeCard}>
          <Text style={styles.routeTitle}>{route.destinationName}</Text>
          <Text style={styles.routeSubtitle}>
            {(route.distanceMeters / 1000).toFixed(1)} km · {Math.round(route.durationSeconds / 60)} min walk
          </Text>
          <Pressable
            style={styles.startButton}
            onPress={() => navigation.navigate('ARNavigation', { route })}
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
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  searchButton: {
    backgroundColor: '#0A84FF',
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  routeCard: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  routeTitle: { fontSize: 17, fontWeight: '700' },
  routeSubtitle: { fontSize: 14, color: '#555', marginTop: 2 },
  startButton: {
    marginTop: 12,
    backgroundColor: '#30D158',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  startButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
