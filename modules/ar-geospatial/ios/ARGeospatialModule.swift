import ExpoModulesCore

public class ARGeospatialModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ARGeospatial")

    View(ARGeospatialView.self) {
      Events("onGeospatialUpdate", "onAnchorsUpdate")

      // The Cloud API key with the ARCore API enabled on it. Passed in from JS
      // rather than read from the Info.plist so it keeps coming from the same
      // build-time environment variable as every other key in this app.
      Prop("apiKey") { (view: ARGeospatialView, key: String) in
        view.setApiKey(key)
      }

      // The route points to anchor, nearest first.
      Prop("anchors") { (view: ARGeospatialView, anchors: [GeoAnchorRecord]) in
        view.setAnchors(anchors)
      }
    }
  }
}
