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
  BrickWall,
  CornerLeftDown,
  CornerRightDown,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Droplets,
  IterationCcw,
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
  // A wall across the way: the pathway-obstruction class.
  //
  // The hard part of this glyph is that the class has no single object in it.
  // It is trained on COCO - people, bicycles, parked cars, benches, bins, dogs -
  // so anything depicting a *thing* names one uncommon member and misdescribes
  // all the rest. A traffic cone said roadworks. A closed pedestrian gate said
  // gate, and a gate is something you open.
  //
  // A wall says one thing and nothing else: you are not getting through here.
  // It names no object and implies no cause, which is exactly right for a class
  // whose members have nothing in common except being in the way.
  //
  // It also solves the size problem rather than living with it. These are drawn
  // at 13px on a detection box, and this used to be the most detailed of the
  // four - a gate and a figure, at a size where neither resolves. A rectangle
  // with a few courses in it is now the simplest.
  //
  // Lucide-only for the reason `map-pin` is: SF Symbols has no wall, and the
  // nearest thing in its catalogue is the gate this replaces.
  blocked: { sf: 'pedestrian.gate.closed', lucide: BrickWall, lucideOnly: true },
  'corner-left-down': { sf: 'arrow.turn.left.down', lucide: CornerLeftDown },
  'corner-right-down': { sf: 'arrow.turn.right.down', lucide: CornerRightDown },
  'corner-up-left': { sf: 'arrow.turn.up.left', lucide: CornerUpLeft },
  'corner-up-right': { sf: 'arrow.turn.up.right', lucide: CornerUpRight },
  crosshair: { sf: 'scope', lucide: Crosshair },
  // Water lying on the ground: the slippery-surface class.
  //
  // Lucide-only, like `map-pin` and `blocked`, and for the same kind of reason.
  // SF `humidity` is one droplet with a level marked inside it - a *reading*,
  // the glyph a weather app puts next to a percentage. That is a measurement of
  // the air, not a warning about the pavement. The lucide pair are two loose
  // droplets with nothing measuring them, which is what water on a surface looks
  // like.
  //
  // Two, not three, in case that matters later - lucide has no three-droplet
  // glyph.
  droplets: { sf: 'humidity', lucide: Droplets, lucideOnly: true },
  // The destination, in the directions banner once the route is arriving or
  // arrived.
  //
  // The one icon in the set that deliberately does not use its SF symbol.
  //
  // SF Symbols has no teardrop map pin. Its whole `mappin` family is a push-pin
  // seen side-on - a ball on a straight spike - which is a different object that
  // happens to share a name, and at banner size it reads closer to a lollipop
  // than to a place. `mappin.and.ellipse` adds a ring under the spike and is what
  // Apple Maps uses, but it is still a push-pin.
  //
  // Lucide's is the teardrop with a hole through it, which is exactly the shape
  // the 3D pin in the AR view is modelled on. The banner and the thing standing
  // on the pavement in front of the walker are the same instruction seen twice,
  // and they should be the same shape - that matters more here than following the
  // platform's own icon set.
  //
  // `sf` is kept as the nearest equivalent, unused for drawing but there so the
  // entry stays the same shape as every other one.
  'map-pin': { sf: 'mappin.and.ellipse', lucide: MapPin, lucideOnly: true },
  rabbit: { sf: 'hare', lucide: Rabbit },
  radar: { sf: 'dot.radiowaves.forward', lucide: Radar },
  'scan-eye': { sf: 'dot.viewfinder', lucide: ScanEye },
  'triangle-alert': { sf: 'exclamationmark.triangle', lucide: TriangleAlert },
  turtle: { sf: 'tortoise', lucide: Turtle },
  // Head pointing down, which on a heads-up view means back towards the
  // walker - the whole content of a turn-around instruction.
  //
  // `arrow.uturn.left` and `.right` were the obvious picks and were wrong.
  // The suffix in that family names where the *arrowhead* ends up, so those
  // two point left and right - which on a screen whose up is straight ahead
  // reads as an ordinary left or right turn, exactly the instruction a u-turn
  // is not. The loop being on the correct side does not rescue it: a walker
  // glancing at a banner reads the head, not the curve.
  //
  // One symbol for both, because the app already gives both the same words -
  // MANEUVER_LABELS says "Turn around" either way - and a glyph that split a
  // hair the label does not would be inventing a distinction rather than
  // showing one. Which way to swing is in the band on the ground.
  uturn: { sf: 'arrow.uturn.down', lucide: IterationCcw },
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
  // A curving road receding into the distance, which is nearer to what the card
  // is asking for than the abstract S-curve it replaced: that one was a route
  // *between two points*, drawn with a dot at each end, and this screen has no
  // route and no destination - it is about the strip of ground immediately
  // ahead. The lanes also give the shape some perspective, so it reads as
  // something you are standing on rather than a line on a map.
  //
  // The lucide fallback stays ScanEye. It stands in for the whole layered icon
  // on Android rather than for the inner glyph, and what that icon means there
  // is "scanning", which has not changed.
  'scan-path': {
    sf: 'viewfinder',
    inner: 'road.lanes.curved.right',
    lucide: ScanEye,
  },
} satisfies Record<
  string,
  { sf: SFSymbol; inner?: SFSymbol; lucide: LucideIcon; lucideOnly?: boolean }
>;

export type AppIconName = keyof typeof ICONS;

// The single SF Symbol behind an icon, for the places that cannot take a React
// component - which in practice means the native tab bar, whose item takes one
// symbol name or one image and never a stack of either.
//
// Layered icons answer with their inner glyph rather than their frame. The
// frame is the part that says "the camera is looking at this"; the inner glyph
// is the part that says what. A tab item is not a camera and has no room for
// brackets around a 25pt mark, so it wants the subject on its own.
// The SF name behind an icon, for the places that need a *name* rather than a
// drawing - the tab bar, which takes symbols by string.
//
// Deliberately ignores `lucideOnly`, because there is nothing else it could
// return: a caller that wants a symbol name cannot be handed a React component.
// So an icon marked lucideOnly will silently come back as the SF symbol it does
// not use if it is ever asked for this way. None of the three currently marked
// are - the tab bar asks only for `scan-path` - but that is a fact about today,
// not a guarantee. Anything added to the tab bar should be checked against the
// flag first.
export function symbolFor(name: AppIconName): SFSymbol {
  const entry: { sf: SFSymbol; inner?: SFSymbol } = ICONS[name];
  return entry.inner ?? entry.sf;
}

// Roughly the visual weight of a lucide icon at its default 2px stroke. SF's
// `regular` is noticeably lighter beside the rest of this app's chrome.
const DEFAULT_WEIGHT: SymbolWeight = 'medium';

// lucide's default. Only the fallback uses it - an SF symbol carries its weight
// as a property of the glyph rather than as a stroke width.
const LUCIDE_STROKE = 2;

// How much of the frame the inner symbol fills, for the layered icons.
//
// The earlier 0.42 was measured against the viewfinder's *clear square* - the
// gap between opposing brackets - which is the wrong box to fit into. The
// brackets only occupy the four corners, so a centred glyph grows towards the
// empty midpoints of the edges and has room well past that square before its
// own corners reach a bracket elbow. At 0.55 it fills a little over half the
// frame's width and around half again as much area as it did, which is what
// makes the frame read as something wrapped around a subject rather than a
// large box with a small mark in it.
const INNER_FRACTION = 0.55;

interface AppIconProps {
  name: AppIconName;
  size: number;
  color: string;
  weight?: SymbolWeight;
}

export function AppIcon({ name, size, color, weight = DEFAULT_WEIGHT }: AppIconProps) {
  const entry: {
    sf: SFSymbol;
    inner?: SFSymbol;
    lucide: LucideIcon;
    lucideOnly?: boolean;
  } = ICONS[name];
  const { sf, lucide: Fallback } = entry;
  const fallback = <Fallback size={size} color={color} strokeWidth={LUCIDE_STROKE} />;

  // A few icons have no SF equivalent worth using - see `map-pin`. They take the
  // lucide drawing on every platform rather than only where the symbol is
  // missing, which is the difference between a fallback and a choice.
  if (entry.lucideOnly) return fallback;

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
