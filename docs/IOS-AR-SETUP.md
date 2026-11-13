# Native iOS ARKit room scanning

## MVP goal

Capture overlapping room images on a standard iPhone 17, pair each image with its ARKit camera pose and calibrated intrinsics, and export a reconstruction-ready dataset. ARKit plane observations remain optional geometry hints.

The scanner does **not** generate the final room mesh on the phone. The multi-view images must be processed by a separate 3D reconstruction service. See [Camera-only room capture and reconstruction pipeline](./CAMERA-ONLY-RECONSTRUCTION.md) for the current capture format and recommended backend design.

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
4. A local Swift Capacitor plugin opens a native ARSCNView and starts ARKit world tracking.
5. The plugin selects a new camera keyframe after at least about 0.22 meters of camera translation (not rotation alone), downsizes each image to at most 1024 pixels on its longest side, and records the camera transform, intrinsics, image dimensions, and timestamp.
6. A lightweight luma sample skips very dark candidate images; a local-gradient heuristic flags low-detail views. These heuristics are capture guidance only, not blur detection or reconstruction confidence.
7. Accepted views are grouped into eight relative horizontal heading buckets. This reports directional variety only, not room coverage.
8. Horizontal and vertical ARKit plane anchors are collected as optional hints; they are not treated as a room mesh.
9. The plugin returns the JPEG data and metadata to the web app. The review UI displays sample frames and exports a ZIP containing the images plus `capture.json`.
8. The user can separately review and export optional, manually confirmed plane hints. The actual 3D reconstruction is a later server-side step.

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

After changing web assets or Swift sources, update the Swift file that is included in the Xcode target, then rebuild the web assets and sync Capacitor:

```bash
cp native/ios/SpatialScannerPlugin.swift ios/App/App/SpatialScannerPlugin.swift
npm run cap:sync:ios
npm run cap:open:ios
```

Build and run from Xcode, approve camera access, and tap **Scan Room**. Walk slowly, scan the floor, then move around to show each wall. Finish the scan to return the observations to the web review panel.

## Manual physical-device test checklist

- [ ] The app launches on the standard iPhone 17.
- [ ] First scan requests camera access with the stated purpose.
- [ ] Denied/restricted camera access produces a clear error and does not crash.
- [ ] ARKit tracking status changes between normal and limited states as the phone moves.
- [ ] The captured-view counter increments after the phone moves to a new position; turning in place alone does not add another keyframe.
- [ ] Very dark candidate views are skipped, and low-detail views are flagged in the review summary.
- [ ] The direction count changes as the phone turns; it is described as directional variety, not room coverage.
- [ ] Tracking-limited states pause keyframe capture until tracking returns to normal.
- [ ] Finish requires at least six viewpoints; Cancel discards the current scan.
- [ ] The review UI shows the captured image thumbnails.
- [ ] The capture ZIP opens and contains the JPEGs plus `capture.json` with poses and intrinsics.
- [ ] Optional ARKit plane hints remain clearly labeled as hints, not a complete room model.
- [ ] No camera frames or scan data are uploaded automatically or sent to a server.

## Accuracy and product limitations

- ARKit plane extents are estimates of detected flat patches, not guaranteed full wall or floor boundaries.
- The capture prototype does not yet fuse the images into a point cloud or mesh, infer room corners, or generate an editable floor plan. The ZIP is the input for that future reconstruction stage.
- Wall height and width may describe only the visible portion of a wall.
- User edits and confirmations are required before export. The app must not advertise centimeter-level accuracy or treat this output as a certified architectural survey.
- A higher-fidelity automatic room model requires a device with LiDAR and a supported RoomPlan workflow, such as an appropriate iPhone Pro or iPad Pro. The standard iPhone 17 cannot use that LiDAR-dependent RoomPlan path.
- The Swift code is a native starter and must be compiled and tested in Xcode before it is treated as a working device feature.
