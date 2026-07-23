// babel.config.js — must export a function so Expo can call it with the `api` object.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // NativeWind v4 must come BEFORE the main expo preset
      ['nativewind/babel'],
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      // react-native-reanimated MUST be the LAST plugin
      'react-native-reanimated/plugin',
    ],
  };
};
