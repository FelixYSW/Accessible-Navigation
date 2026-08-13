// Dynamic Expo config so the Google Maps API key can be injected at build time
// from an environment variable (populated from a GitHub Actions secret in CI,
// or a local .env when developing), rather than being committed to the repo.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

// OpenRouteService, used for accessibility-aware routing when a mobility aid
// is set. Optional: without it the app still routes via Google and still
// screens those routes against OpenStreetMap, it just can't offer a route
// planned around barriers. Free key from openrouteservice.org/dev/#/signup.
const ORS_API_KEY = process.env.ORS_API_KEY ?? '';

module.exports = {
  expo: {
    name: 'Accessible-Navigation',
    slug: 'Accessible-Navigation',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    scheme: 'accessible-navigation',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.felixyap.accessiblenavigation',
      infoPlist: {
        NSCameraUsageDescription:
          'This app uses the camera to detect sidewalk hazards such as potholes, slippery surfaces, and obstacles in real time.',
        NSLocationWhenInUseUsageDescription:
          'This app uses your location to calculate walking routes and warn you about nearby hazards.',
        NSMotionUsageDescription:
          'This app reads how your phone is tilted so the on-screen direction arrows sit on the ground ahead of you.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.felixyap.accessiblenavigation',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      // react-native-vision-camera v5 ships no Expo config plugin; camera
      // permission text is instead set directly via ios.infoPlist above.
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Accessible Navigation uses your location to plan routes and detect nearby hazards.',
        },
      ],
      [
        'react-native-maps',
        {
          iosGoogleMapsApiKey: GOOGLE_MAPS_API_KEY,
          androidGoogleMapsApiKey: GOOGLE_MAPS_API_KEY,
        },
      ],
    ],
    extra: {
      googleMapsApiKey: GOOGLE_MAPS_API_KEY,
      openRouteServiceApiKey: ORS_API_KEY,
    },
  },
};
