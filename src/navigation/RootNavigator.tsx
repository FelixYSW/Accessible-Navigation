import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { ARNavigationScreen } from '../screens/ARNavigationScreen';
import { ARGeospatialTestScreen } from '../screens/ARGeospatialTestScreen';
import type { WalkingRoute } from '../types/route';

export type RootStackParamList = {
  Tabs: undefined;
  ARNavigation: { route: WalkingRoute };
  /** Development-only: measures how well ARCore's Geospatial API localises
   *  here, before any of the navigation is rebuilt on top of it. */
  ARGeospatialTest: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// AR Navigation sits above the tabs rather than inside them: it is a
// full-bleed, single-purpose mode entered from a chosen route, and the design
// hides the tab bar for its duration.
export function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Tabs" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen
        name="ARNavigation"
        component={ARNavigationScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="ARGeospatialTest"
        component={ARGeospatialTestScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
