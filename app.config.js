// Dynamic Expo config so the Google Maps API key can be injected at build time
// from an environment variable (populated from a GitHub Actions secret in CI,
// or a local .env when developing), rather than being committed to the repo.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

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
        ITSAppUsesNonExemptEncryption: false,
      },
      config: {
        googleMapsApiKey: GOOGLE_MAPS_API_KEY,
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
      config: {
        googleMaps: {
          apiKey: GOOGLE_MAPS_API_KEY,
        },
      },
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
      'react-native-maps',
    ],
    extra: {
      googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    },
  },
};
