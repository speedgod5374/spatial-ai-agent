# Native iOS ARKit room scanning

## MVP goal

Capture camera-based ARKit plane observations on a supported iPhone, let the user review and correct those observations, then export an editable JSON representation of the confirmed floor and wall surfaces.

This is deliberately a **surface-based room-shell prototype**, not a full automatic room scan.

## Device and sensor limits

- Target device: standard iPhone 17.
- The standard iPhone 17 does **not** include a LiDAR scanner.
- Apple documents `RoomCaptureSession.isSupported` as true only when the device contains a LiDAR Scanner. RoomPlan is therefore not used by this target device.
- The native prototype uses `ARWorldTrackingConfiguration` with horizontal and vertical plane detection. ARKit adds `ARPlaneAnchor` observations when camera-image analysis finds areas that appear to be flat surfaces.
- Plane anchors can be partial, missed, split, merged, or confused with tabletops and other flat objects. They do not automatically provide a complete room outline, ceiling, corners, doors, windows, or hidden wall sections.

Apple references:
- [iPhone 17 technical specifications](https://www.apple.com/iphone-17/specs/)
- [ARKit plane detection](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/planedetection-swift.struct)
- [RoomPlan support check](https://developer.apple.com/documentation/RoomPlan/RoomCaptureSession/isSupported)

## Architecture

1. GitHub Pages continues to host the existing Vite/Three.js web planner.
2. The browser version never pretends its camera preview is an ARKit scan.
3. A Capacitor iOS wrapper hosts the same web app.
4. A local Swift Capacitor plugin opens a native ARSCNView, starts ARKit world tracking, and detects horizontal and vertical plane anchors.
5. The user finishes or cancels the native scan. The plugin returns plane extents, local centers, and anchor transforms in meters.
6. JavaScript converts the observations to editable surface records and previews the detected patches in Three.js.
7. The user chooses whether each observation represents a floor, a wall, or something to ignore; edits its dimensions and world-space center; and explicitly confirms it.
8. JSON export preserves all observations but places only included, confirmed surfaces in the model section.

No account, database, remote image upload, furniture recognition, or product service is used by this feature.

## Web development and tests

Use Node.js 22 or later:

```bash
npm install
npm run dev
npm test
npm run build
```

The web version can preview/import/export room data but cannot start native ARKit. The browser scan button explains this instead of opening a fake camera scan.

## Create the native iOS wrapper

A Mac with Xcode and a physical iPhone are required. This repository's current development environment is Linux and does not contain Xcode, so native compilation and device behavior have not been verified here.

On the Mac, from the repository root:

```bash
npm install
npm run cap:add:ios
```

Run `npm run cap:add:ios` only once, when the `ios/` platform does not already exist.

### Add the Swift files to the app target

1. Open the generated iOS project with `npm run cap:open:ios`.
2. In Xcode, select the **App** target and add `native/ios/SpatialScannerPlugin.swift` to the target. Choose **Copy items if needed** if Xcode asks.
3. Replace the generated `ios/App/App/ViewController.swift` with the contents of `native/ios/ViewController.swift`, or merge its `capacitorDidLoad()` override into the existing `CAPBridgeViewController` subclass.
4. Confirm the app's initial view controller still uses the class named `ViewController`. The override registers `SpatialScannerPlugin` with the Capacitor bridge.
5. In the App target's Info settings, add the `NSCameraUsageDescription` key. Use the wording in `native/ios/InfoPlist-additions.txt`.
6. Set the iOS deployment target to a version supported by the installed Capacitor 8 toolchain and ARKit SDK.
7. Select a physical standard iPhone 17 as the run destination. The app checks `ARWorldTrackingConfiguration.isSupported` at runtime; the simulator is not a substitute for room-scanning tests.

After changing web assets or Swift sources:

```bash
npm run cap:sync:ios
npm run cap:open:ios
```

Build and run from Xcode, approve camera access, and tap **Scan Room**. Walk slowly, scan the floor, then move around to show each wall. Finish the scan to return the observations to the web review panel.

## Manual physical-device test checklist

- [ ] The app launches on the standard iPhone 17.
- [ ] First scan requests camera access with the stated purpose.
- [ ] Denied/restricted camera access produces a clear error and does not crash.
- [ ] ARKit tracking status changes between normal and limited states as the phone moves.
- [ ] Horizontal and vertical plane counts update while scanning.
- [ ] Finish returns observations; Cancel returns to the editor without saving a scan.
- [ ] The review UI distinguishes horizontal and vertical surfaces.
- [ ] Users can ignore false detections, edit dimensions and world-space centers, and confirm only surfaces they recognize.
- [ ] The 3D preview reflects edits and only confirmed/included surfaces appear in the model export.
- [ ] JSON export opens and contains the raw observations plus the confirmed model surfaces.
- [ ] No camera frames or scan data are sent to a server.

## Accuracy and product limitations

- ARKit plane extents are estimates of detected flat patches, not guaranteed full wall or floor boundaries.
- The prototype does not join adjacent planes into inferred corners or fill unobserved gaps. It visualizes detected surface patches in their AR world positions.
- Wall height and width may describe only the visible portion of a wall.
- User edits and confirmations are required before export. The app must not advertise centimeter-level accuracy or treat this output as a certified architectural survey.
- A higher-fidelity automatic room model requires a device with LiDAR and a supported RoomPlan workflow, such as an appropriate iPhone Pro or iPad Pro. The standard iPhone 17 cannot use that LiDAR-dependent RoomPlan path.
- The Swift code is a native starter and must be compiled and tested in Xcode before it is treated as a working device feature.
