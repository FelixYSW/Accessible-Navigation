import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MapScreen } from '../screens/MapScreen';
import { ARNavigationScreen } from '../screens/ARNavigationScreen';
import type { WalkingRoute } from '../types/route';

export type RootStackParamList = {
  Map: undefined;
  ARNavigation: { route: WalkingRoute };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Map">
      <Stack.Screen name="Map" component={MapScreen} options={{ title: 'Accessible Navigation' }} />
      <Stack.Screen
        name="ARNavigation"
        component={ARNavigationScreen}
        options={{ title: 'AR Hazard Detection', headerShown: false }}
      />
    </Stack.Navigator>
  );
}
