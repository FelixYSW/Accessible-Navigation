import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SymbolView, type SymbolWeight } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Compass,
  Construction,
  CornerLeftDown,
  CornerRightDown,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Droplets,
  IterationCcw,
  IterationCw,
  MapPin,
  Rabbit,
  Radar,
  ScanEye,
  TriangleAlert,
  Turtle,
  Volume2,
  VolumeX,
  WavesHorizontal,
  type LucideIcon,
} from 'lucide-react-native';

// Every icon in the app, as an SF Symbol with the lucide icon it replaced kept
// alongside it.
//
// The lucide entry is not dead weight - it is what `SymbolView` renders through
// its `fallback` when the platform has no symbol, which is every platform but
// iOS. So this swap costs Android nothing: it keeps exactly the icons it has
// today, and iOS gets the system set.
//
// Outline variants throughout, not `.fill`. lucide is a stroke-drawn set and
// filled SF symbols beside it read as a different family - the aim here is that
// the change is barely noticeable, not that it announces itself.
const ICONS = {
  'arrow-up': { sf: 'arrow.up', lucide: ArrowUp },
  'arrow-up-left': { sf: 'arrow.up.left', lucide: ArrowUpLeft },
  'arrow-up-right': { sf: 'arrow.up.right', lucide: ArrowUpRight },
  'chevron-down': { sf: 'chevron.down', lucide: ChevronDown },
  'chevron-up': { sf: 'chevron.up', lucide: ChevronUp },
  compass: { sf: 'location.circle', lucide: Compass },
  // A barrier across a pedestrian's path - the closest thing in the catalogue
  // to what this class actually means.
  //
  // A traffic cone was the literal translation of the lucide barrier and the
  // wrong idea: the class is trained on COCO - people, bicycles, parked cars,
  // benches, bins, dogs - so a cone depicts one uncommon member of it and
  // implies roadworks for all the rest.
  //
  // The one thing to watch is size. This is the most detailed of the four
  // hazard glyphs and it is drawn at 13px on a detection box, where a gate and
  // a figure have to resolve into something recognisable. It is the right
  // meaning; if it does not hold together that small, `nosign` is the legible
  // fallback that says less.
  construction: { sf: 'pedestrian.gate.closed', lucide: Construction },
  'corner-left-down': { sf: 'arrow.turn.left.down', lucide: CornerLeftDown },
  'corner-right-down': { sf: 'arrow.turn.right.down', lucide: CornerRightDown },
  'corner-up-left': { sf: 'arrow.turn.up.left', lucide: CornerUpLeft },
  'corner-up-right': { sf: 'arrow.turn.up.right', lucide: CornerUpRight },
  crosshair: { sf: 'scope', lucide: Crosshair },
  droplets: { sf: 'humidity', lucide: Droplets },
  'map-pin': { sf: 'mappin', lucide: MapPin },
  rabbit: { sf: 'hare', lucide: Rabbit },
  radar: { sf: 'dot.radiowaves.forward', lucide: Radar },
  'scan-eye': { sf: 'dot.viewfinder', lucide: ScanEye },
  'triangle-alert': { sf: 'exclamationmark.triangle', lucide: TriangleAlert },
  turtle: { sf: 'tortoise', lucide: Turtle },
  'uturn-left': { sf: 'arrow.uturn.left', lucide: IterationCcw },
  'uturn-right': { sf: 'arrow.uturn.right', lucide: IterationCw },
  'volume-off': { sf: 'speaker.slash', lucide: VolumeX },
  'volume-on': { sf: 'speaker.wave.2', lucide: Volume2 },
  waves: { sf: 'water.waves', lucide: WavesHorizontal },

  // Two symbols stacked, because Apple ships neither of these as a compound.
  //
  // The `.viewfinder` family is one of the smallest in the catalogue - 26
  // entries against 1,801 for `.circle` - and it contains no buildings and no
  // path. Apple's own compounds are drawn to fit their frame; these are only
  // centred and scaled into it, so they are used at the one size that suits
  // them, on a card, and not at 15px in a pill.
  'scan-buildings': { sf: 'viewfinder', inner: 'building.2.fill', lucide: Radar },
  'scan-path': {
    sf: 'viewfinder',
    inner: 'point.bottomleft.forward.to.point.topright.scurvepath.fill',
    lucide: ScanEye,
  },
} satisfies Record<string, { sf: SFSymbol; inner?: SFSymbol; lucide: LucideIcon }>;

export type AppIconName = keyof typeof ICONS;

// Roughly the visual weight of a lucide icon at its default 2px stroke. SF's
// `regular` is noticeably lighter beside the rest of this app's chrome.
const DEFAULT_WEIGHT: SymbolWeight = 'medium';

// lucide's default. Only the fallback uses it - an SF symbol carries its weight
// as a property of the glyph rather than as a stroke width.
const LUCIDE_STROKE = 2;

// How much of the frame the inner symbol fills, for the layered icons.
// The viewfinder's clear area is a little under half its width, and an inner
// glyph any larger starts touching the corner brackets.
const INNER_FRACTION = 0.42;

interface AppIconProps {
  name: AppIconName;
  size: number;
  color: string;
  weight?: SymbolWeight;
}

export function AppIcon({ name, size, color, weight = DEFAULT_WEIGHT }: AppIconProps) {
  const entry: { sf: SFSymbol; inner?: SFSymbol; lucide: LucideIcon } = ICONS[name];
  const { sf, lucide: Fallback } = entry;
  const fallback = <Fallback size={size} color={color} strokeWidth={LUCIDE_STROKE} />;

  // Layered icons are iOS-only rather than per-view. `SymbolView` renders its
  // own fallback when a platform has no symbol, so stacking two of them
  // elsewhere would stack two lucide icons on top of each other.
  if (entry.inner && Platform.OS !== 'ios') return fallback;

  if (entry.inner) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <SymbolView
          name={sf}
          size={size}
          tintColor={color}
          weight={weight}
          style={StyleSheet.absoluteFill}
        />
        <SymbolView
          name={entry.inner}
          size={size * INNER_FRACTION}
          tintColor={color}
          weight={weight}
        />
      </View>
    );
  }

  return (
    <SymbolView name={sf} size={size} tintColor={color} weight={weight} fallback={fallback} />
  );
}
