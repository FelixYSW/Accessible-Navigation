const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Adds `use_modular_headers!` to the generated Podfile.
//
// ARCore's Geospatial subspec depends on ARCore/GARSession, which depends on
// Firebase/RemoteConfig - so this app links Firebase and GoogleUtilities even
// though neither appears anywhere in package.json. Those pods ship without
// module maps of their own, and a Swift target importing them in a static
// build fails to resolve them. `use_modular_headers!` makes CocoaPods generate
// the module maps for every pod, which is the long-standing remedy.
//
// It is applied as a config plugin rather than by editing ios/Podfile because
// this project has no committed ios/ directory: CI runs `expo prebuild` on
// every build, which regenerates the Podfile from scratch. An edit made to the
// generated file would be discarded on the next run.
const withModularHeaders = (config) =>
  withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes('use_modular_headers!')) {
        return modConfig;
      }

      // Inserted straight after the platform declaration, which is where it
      // has to be: it applies to the whole file and must be read before any
      // target block.
      const platformLine = /^(platform :ios.*)$/m;
      if (!platformLine.test(contents)) {
        throw new Error(
          'withModularHeaders: no `platform :ios` line found in the generated Podfile, ' +
            'so there is nowhere safe to insert use_modular_headers!.',
        );
      }

      fs.writeFileSync(
        podfilePath,
        contents.replace(platformLine, '$1\n\n# Added by plugins/withModularHeaders.js\nuse_modular_headers!'),
        'utf8',
      );

      return modConfig;
    },
  ]);

module.exports = withModularHeaders;
