import React from 'react';
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
  // A traffic cone, which is what the lucide barrier is drawing and a better
  // picture of a blocked pavement than any warning triangle.
  construction: { sf: 'cone', lucide: Construction },
  'corner-left-down': { sf: 'arrow.turn.left.down', lucide: CornerLeftDown },
  'corner-right-down': { sf: 'arrow.turn.right.down', lucide: CornerRightDown },
  'corner-up-left': { sf: 'arrow.turn.up.left', lucide: CornerUpLeft },
  'corner-up-right': { sf: 'arrow.turn.up.right', lucide: CornerUpRight },
  crosshair: { sf: 'scope', lucide: Crosshair },
  droplets: { sf: 'drop', lucide: Droplets },
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
} satisfies Record<string, { sf: SFSymbol; lucide: LucideIcon }>;

export type AppIconName = keyof typeof ICONS;

// Roughly the visual weight of a lucide icon at its default 2px stroke. SF's
// `regular` is noticeably lighter beside the rest of this app's chrome.
const DEFAULT_WEIGHT: SymbolWeight = 'medium';

// lucide's default. Only the fallback uses it - an SF symbol carries its weight
// as a property of the glyph rather than as a stroke width.
const LUCIDE_STROKE = 2;

interface AppIconProps {
  name: AppIconName;
  size: number;
  color: string;
  weight?: SymbolWeight;
}

export function AppIcon({ name, size, color, weight = DEFAULT_WEIGHT }: AppIconProps) {
  const { sf, lucide: Fallback } = ICONS[name];

  return (
    <SymbolView
      name={sf}
      size={size}
      tintColor={color}
      weight={weight}
      fallback={<Fallback size={size} color={color} strokeWidth={LUCIDE_STROKE} />}
    />
  );
}
