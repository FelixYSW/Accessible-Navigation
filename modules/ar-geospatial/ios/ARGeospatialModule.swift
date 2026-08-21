import ExpoModulesCore

public class ARGeospatialModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ARGeospatial")

    // Both views carry an explicit name. It would otherwise be inferred from
    // the class, but this module defines two views and the JS side asks for
    // each by name, so leaving it to inference would make a Swift class rename
    // silently break the lookup at runtime rather than loudly at build time.
    //
    // `ViewName` and not `Name`: inside a view block the builder only accepts a
    // ViewNameDefinition, which is what this factory returns. `Name` is the
    // module-level one and does not compile here.
    View(ARGeospatialView.self) {
      ViewName("ARGeospatialView")
      Events("onGeospatialUpdate", "onAnchorsUpdate", "onHazards")

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

      // Tap-to-place preview. Runs on ARKit alone, so it works indoors and
      // anywhere else the Geospatial API cannot localise.
      Prop("previewMode") { (view: ARGeospatialView, preview: Bool) in
        view.setPreviewMode(preview)
      }

      // Which component the next tap puts down: "chevron", "trail" or "pin".
      Prop("previewComponent") { (view: ARGeospatialView, component: String) in
        view.setPreviewComponent(component)
      }

      // Change this number to remove everything placed so far. A prop rather
      // than a method because this module's views are driven by props.
      Prop("previewClearToken") { (view: ARGeospatialView, token: Int) in
        view.setPreviewClearToken(token)
      }
    }

    // The Hazard Detection screen's camera: the same model as above, without
    // the AR session it has no use for.
    View(HazardCameraView.self) {
      ViewName("HazardCameraView")
      Events("onHazards")

      Prop("isActive") { (view: HazardCameraView, active: Bool) in
        view.setIsActive(active)
      }
    }
  }
}
