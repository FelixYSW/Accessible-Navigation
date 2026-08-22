import React from 'react';
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import type { SFSymbol } from 'sf-symbols-typescript';
import { symbolFor } from '../components/AppIcon';
import { MapScreen } from '../screens/MapScreen';
import { HazardDetectionScreen } from '../screens/HazardDetectionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useSettings } from '../theme/SettingsContext';

export type TabParamList = {
  Navigate: undefined;
  HazardDetection: undefined;
  Settings: undefined;
};

// SF Symbols rather than the lucide icons the rest of the app uses.
//
// Not a preference: a native tab bar takes either an SF Symbol name or an image
// file, and lucide renders as React components, so there is nothing to hand it.
//
// The Hazard Detection item is taken from the icon on that screen's own intro
// card rather than named here, so the tab and the card it opens cannot drift
// apart. It arrives unframed - see `symbolFor` for why the viewfinder is
// dropped, and note that it could not be kept in any case, since a tab item
// takes one symbol and the card's icon is two stacked.
const TAB_ICONS: Record<keyof TabParamList, SFSymbol> = {
  Navigate: 'location.fill',
  HazardDetection: symbolFor('scan-path'),
  Settings: 'gearshape.fill',
};

const Tab = createNativeBottomTabNavigator<TabParamList>();

// The real UIKit tab bar, not a drawing of one.
//
// It replaces a hand-built bar that had to reimplement the platform's own
// behaviour - the blur behind it, the press states, the way the labels sit
// under the icons - and could only ever approximate it. What is gained beyond
// the look is everything UIKit does without being asked: the iOS 26 material,
// VoiceOver's own tab-bar rotor, and the system's handling of the home
// indicator area.
//
// The one thing that had to be checked before adopting it was whether the app's
// own Text Size setting could still drive the labels. It can: `tabLabelStyle`
// takes a font size, the same way the native segmented control in Settings
// takes one through `fontStyle`. Without that this would have been the only
// control in the app that ignored the setting.
export function TabNavigator() {
  const { T, F } = useSettings();

  return (
    <Tab.Navigator
      // An explicit fill rather than the system blur.
      //
      // A translucent bar takes its material from the trait collection, and this
      // app pins `userInterfaceStyle` while carrying its own Dark Mode
      // preference - so the blur would stay light while everything above it went
      // dark. Consistency with the in-app theme is worth more here than the
      // material, and it is the same reason the segmented control in Settings is
      // told which appearance to use.
      tabBarStyle={{ backgroundColor: T.card }}
      tabBarActiveTintColor={T.accent}
      tabBarInactiveTintColor={T.tabIdle}
      // Follows the Text Size setting, as every other label in the app does.
      tabLabelStyle={{ fontSize: F.micro, fontWeight: '600' }}
      hapticFeedbackEnabled
    >
      <Tab.Screen
        name="Navigate"
        component={MapScreen}
        options={{
          tabBarLabel: 'Navigate',
          tabBarIcon: () => ({ sfSymbol: TAB_ICONS.Navigate }),
        }}
      />
      <Tab.Screen
        name="HazardDetection"
        component={HazardDetectionScreen}
        options={{
          // The full name, matching the screen it opens. It is long for a tab
          // item and UIKit truncates rather than wrapping, so this may shorten
          // itself at the larger Text Sizes - but a name that matches the
          // screen beats one that fits and does not.
          tabBarLabel: 'Hazard Detection',
          tabBarIcon: () => ({ sfSymbol: TAB_ICONS.HazardDetection }),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: () => ({ sfSymbol: TAB_ICONS.Settings }),
        }}
      />
    </Tab.Navigator>
  );
}
