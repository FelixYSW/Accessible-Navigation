/**
 * _layout.tsx — Root Layout
 *
 * Wraps the entire app in the providers required by:
 *  - react-native-gesture-handler  (GestureHandlerRootView)
 *  - @gorhom/bottom-sheet v5        (BottomSheetModalProvider)
 *
 * Also imports the NativeWind v4 global CSS entry point.
 * The Stack navigator renders index.tsx as the single screen with no header.
 */

import '../../../global.css'; // NativeWind v4 — MUST be the first import

import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';

export default function RootLayout(): React.JSX.Element {
  return (
    /*
     * GestureHandlerRootView must wrap the ENTIRE tree.
     * flex: 1 ensures it fills the screen so child layouts don't collapse.
     */
    <GestureHandlerRootView style={styles.root}>
      {/*
       * BottomSheetModalProvider required by @gorhom/bottom-sheet v5
       * for BottomSheetModal. The non-modal <BottomSheet> component
       * used in index.tsx does NOT require this provider, but we keep it
       * here for forward-compatibility.
       */}
      <BottomSheetModalProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0f172a' },
            animation: 'none', // single-screen app — no transition animation
          }}
        />
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
