// global.d.ts — NativeWind v4 type augmentation so className prop is typed on
// all React Native core components (View, Text, TextInput, etc.).
/// <reference types="nativewind/types" />

// Declare the `process` global so TypeScript recognises process.env.EXPO_PUBLIC_*
// variables. We do NOT use @types/node here because it pulls in Node.js-specific
// globals (Buffer, require, etc.) that conflict with the React Native environment.
declare const process: {
  readonly env: {
    readonly EXPO_PUBLIC_GOOGLE_API_KEY?: string;
    readonly [key: string]: string | undefined;
  };
};
