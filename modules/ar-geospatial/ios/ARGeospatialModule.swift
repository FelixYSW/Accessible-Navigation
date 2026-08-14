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

      // The route points to anchor, in route order, each with an id that is
      // stable for as long as that point is wanted.
      Prop("anchors") { (view: ARGeospatialView, anchors: [GeoAnchorRecord]) in
        view.setAnchors(anchors)
      }

      // Plain ARKit anchors planted straight ahead, for the Geospatial test
      // screen to judge the tracking against. Off on a real route.
      Prop("showControlAnchors") { (view: ARGeospatialView, show: Bool) in
        view.setShowControlAnchors(show)
      }
    }
  }
}
