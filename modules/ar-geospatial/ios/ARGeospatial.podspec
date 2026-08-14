Pod::Spec.new do |s|
  s.name           = 'ARGeospatial'
  s.version        = '1.0.0'
  s.summary        = 'ARKit camera with ARCore Geospatial pose and anchors'
  s.description    = 'Runs an ARKit world-tracking session and feeds its frames to an ' \
                     'ARCore GARSession, reporting the geospatial pose and projecting ' \
                     'geospatial anchors into screen coordinates for the JS layer to draw.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = 'MIT'
  s.source         = { git: '' }

  # ARCore's iOS SDK needs 12.0 or later; this matches what Expo's generated
  # project already targets, which is higher.
  s.platforms      = { ios: '15.1' }
  s.swift_version  = '5.9'

  # ARCore ships as static frameworks, and a pod that depends on them has to
  # say so or the linker pulls the symbols in twice.
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ARCore/Geospatial'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  # ARCore's frameworks carry Objective-C categories, and the linker drops
  # those from a static library unless it is told to load every object file.
  # Google's setup guide calls this out as a requirement; without it the build
  # links but the SDK fails at runtime with unrecognised selectors.
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS' => '$(inherited) -ObjC',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'

  # The trained hazard model, copied into the app bundle and compiled to
  # .mlmodelc on first launch.
  #
  # It ships through the pod rather than through a config plugin because the
  # generated iOS project is thrown away and rebuilt on every prebuild, so
  # anything added to it by hand does not survive - whereas this directory is
  # committed, and CocoaPods copies it in every time.
  #
  # The glob matters: a missing file makes CocoaPods warn and carry on, so the
  # app still builds before the model has been trained. The detector reports the
  # absence instead of silently finding nothing.
  s.resources = ['HazardDetector.mlpackage']
end
