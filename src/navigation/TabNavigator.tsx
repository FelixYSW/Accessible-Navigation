import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AppTabBar } from '../components/AppTabBar';
import { MapScreen } from '../screens/MapScreen';
import { HazardDetectionScreen } from '../screens/HazardDetectionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type TabParamList = {
  Navigate: undefined;
  HazardDetection: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export function TabNavigator() {
  return (
    <Tab.Navigator
      // Each screen draws its own chrome over a full-bleed map or camera view,
      // so the stock header is off everywhere.
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <AppTabBar {...props} />}
    >
      <Tab.Screen name="Navigate" component={MapScreen} />
      <Tab.Screen name="HazardDetection" component={HazardDetectionScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
