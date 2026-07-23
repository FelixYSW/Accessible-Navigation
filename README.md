# AccessibleNav — iOS AR Wayfinding App (FYP)

An iOS-only accessible navigation app built with Expo SDK 57, combining live camera AR hazard detection, Apple Maps (MapKit) walking directions, and Google Places search — all structured around a typed state machine.

> **University Final Year Project** — all business logic is separated into custom hooks; components are purely presentational.

---

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| Framework | Expo / React Native | SDK 57 / 0.76 |
| Language | TypeScript | ~5.7 |
| Styling | NativeWind v4 + TailwindCSS | ^4.x |
| Navigation | Expo Router | ~4.0 |
| Camera | react-native-vision-camera | ^4.6 |
| Frame Processor | react-native-worklets-core | ^1.3 |
| Maps | react-native-maps (MapKit) | 1.20.1 |
| Bottom Sheet | @gorhom/bottom-sheet | ^5.0 |
| Gestures | react-native-gesture-handler | ~2.21 |
| Animation | react-native-reanimated | ~3.16 |
| Audio | expo-speech | ~13.1 |
| Storage | react-native-mmkv | ^3.3 |
| Location | expo-location | ~18.1 |

---

## Project Structure

```
src/
├── app/
│   ├── _layout.tsx           ← GestureHandlerRootView + BottomSheetModalProvider + Stack
│   └── index.tsx             ← Orchestrator screen (hooks → UI, no logic)
├── components/
│   ├── CameraView.tsx        ← Vision Camera + Frame Processor + AR overlay + Speech
│   ├── MacroMapView.tsx      ← Apple MapKit polylines + fitToCoordinates
│   └── SearchBar.tsx         ← Places API autocomplete + MMKV history
└── hooks/
    ├── useLocation.ts        ← Foreground location permission + coords
    ├── useDirections.ts      ← Directions API + polyline decoder
    └── useAppStateMachine.ts ← State machine: default | preview | navigating
.github/
└── workflows/
    └── build-ios.yml         ← 3-layer cached GitHub Actions build
```

---

## App State Machine

```
        selectPlace()              startNavigation()
 default ──────────────► preview ────────────────► navigating
    ▲                       │                           │
    │         clearPlace()  │        cancelRoute()      │
    └───────────────────────┴───────────────────────────┘
```

| State | Background | Bottom Sheet Snap | Content |
|---|---|---|---|
| `default` | CameraView (live feed) | 25% | SearchBar + history |
| `preview` | MacroMapView (MapKit) | 45% | Destination, routes, ETA, Start CTA |
| `navigating` | CameraView + AR overlay | 15% | Live ETA, Cancel CTA |

---

## Getting Started

### Prerequisites
- **macOS** with Xcode 15 or 16 installed
- **Node.js** 20+
- **CocoaPods** (`sudo gem install cocoapods`)
- An iOS device or Simulator running iOS 16+
- A Google Cloud API key with **Places API (New)** and **Directions API** enabled

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd "Accessible Navigation"
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and paste your real Google API key
```

### 3. Generate iOS Project & Run

```bash
# Generates the ./ios Xcode project (run once, or after native dep changes)
npx expo prebuild --clean --platform ios

# Install CocoaPods
cd ios && pod install && cd ..

# Build & launch on Simulator or device
npm run ios
```

> **Note:** Expo Go is **not supported** — the app uses native modules that require a Development Build.

---

## CI/CD — GitHub Actions

Push to `main` or `master` to trigger an unsigned iOS Release build.

### What the workflow does

1. Checks out code on `macos-14` (Apple Silicon)
2. **Caches** Node modules, CocoaPods, and Xcode DerivedData (3-layer strategy)
3. `npm ci` → `expo prebuild` → `pod install`
4. `xcodebuild archive` with `CODE_SIGNING_ALLOWED=NO` (no certificates required)
5. Packages `.app` into a `Payload/` zip as `AccessibleNav.ipa`
6. Uploads the `.ipa` as a **7-day GitHub Actions artifact**

### Installing via Sideloadly

1. Download the artifact zip from the Actions tab
2. Extract `AccessibleNav.ipa`
3. Open [Sideloadly](https://sideloadly.io/) and drag the `.ipa` in
4. Connect your device and install

---

## Key Design Decisions

### No Google Maps Native SDK
`react-native-maps` is configured **without** a `provider` prop. On iOS, this defaults to Apple MapKit — no `PROVIDER_GOOGLE`, no Google Maps iOS SDK linked, no GoogleService-Info.plist required.

### Hazard Detection Simulation
The Vision Camera frame processor simulates object detection using a 15-second time guard. A real implementation would integrate a Core ML model via a native VisionCamera plugin. This is clearly documented in `CameraView.tsx` for academic transparency.

### MMKV over AsyncStorage
`react-native-mmkv` is used for search history persistence. It is synchronous, ~30× faster than AsyncStorage, and does not require `await` calls in the UI thread.

### API Key Security
`process.env.EXPO_PUBLIC_GOOGLE_API_KEY` is read at runtime from the Metro bundler environment. The key is never hardcoded. `.env` is git-ignored. The `.env.example` file shows the required variable name.

---

## TypeScript Check

```bash
npm run ts:check
```

---

## Accessibility

- All interactive elements have `accessibilityRole` and `accessibilityLabel` props
- The AR overlay uses `accessibilityLiveRegion="polite"` for VoiceOver announcements
- Audio hazard warnings via `expo-speech` provide non-visual feedback
- Route alternatives have descriptive labels read by VoiceOver
