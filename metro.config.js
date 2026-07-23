// metro.config.js — wires NativeWind v4 into Metro's transform pipeline.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  // The single global CSS entry point required by NativeWind v4
  input: './global.css',
});
