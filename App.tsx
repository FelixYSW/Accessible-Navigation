import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SettingsProvider, useSettings } from './src/theme/SettingsContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemedApp />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

// Split out so it can read the settings context that `App` provides. Dark Mode
// has to reach the navigator's own background and the OS status bar, not just
// the screens - otherwise the gaps between screens flash light-mode white
// during transitions.
function ThemedApp() {
  const { T, darkMode, ready } = useSettings();

  const navigationTheme = {
    ...(darkMode ? DarkTheme : DefaultTheme),
    colors: {
      ...(darkMode ? DarkTheme : DefaultTheme).colors,
      background: T.pageBg,
      card: T.card,
      text: T.text,
      border: T.sep,
      primary: T.accent,
    },
  };

  // Hold the first frame until stored preferences have been read, so a user
  // with Dark Mode saved doesn't get a light-mode flash on launch.
  if (!ready) return null;

  return (
    <>
      <NavigationContainer theme={navigationTheme}>
        <RootNavigator />
      </NavigationContainer>
      <StatusBar style={darkMode ? 'light' : 'dark'} />
    </>
  );
}
