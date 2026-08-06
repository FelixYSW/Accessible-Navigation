import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Navigation, ScanEye, Settings, type LucideIcon } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/SettingsContext';

const TAB_ICONS: Record<string, LucideIcon> = {
  Navigate: Navigation,
  HazardDetection: ScanEye,
  Settings: Settings,
};

const TAB_LABELS: Record<string, string> = {
  Navigate: 'Navigate',
  HazardDetection: 'Hazard Detection',
  Settings: 'Settings',
};

// Custom tab bar rather than the default one, so the icon and label always
// take their colour from a single computed value - an earlier version styled
// them from two separate sources and they could disagree about which tab was
// active.
export function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const { T, F } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: T.card,
          borderTopColor: T.sep,
          // The design's fixed 26px bottom padding is really clearance for the
          // home indicator, so it comes from the safe area instead - devices
          // without one only need a little breathing room.
          paddingBottom: insets.bottom > 0 ? insets.bottom + 6 : 16,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const color = focused ? T.accent : T.tabIdle;
        const Icon = TAB_ICONS[route.name];
        const label = TAB_LABELS[route.name] ?? route.name;

        return (
          <Pressable
            key={route.key}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={() => {
              // `navigate` on an already-focused tab is a no-op that still
              // fires listeners; emitting tabPress first keeps the standard
              // "tap the active tab to reset it" behaviour available.
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
          >
            <Icon size={24} color={color} strokeWidth={2} />
            <Text
              style={[styles.label, { color, fontSize: F.micro }]}
              numberOfLines={2}
              // Long labels ("Hazard Detection") must stay readable at the
              // Extra Large text size instead of being clipped mid-word.
              adjustsFontSizeToFit
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 4,
  },
  label: { fontWeight: '600', textAlign: 'center' },
});
