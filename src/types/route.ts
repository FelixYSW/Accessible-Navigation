export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface WalkingRoute {
  origin: LatLng;
  destination: LatLng;
  destinationName: string;
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
}
