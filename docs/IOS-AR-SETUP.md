# Native iOS ARKit scanner setup

This repository is currently a Vite + Capacitor web project. The scanner source below is a native Swift component; it cannot be compiled or tested in GitHub Pages or a browser.

## What this prototype does

- Starts an ARKit world-tracking session.
- Requests horizontal and vertical plane detection.
- Visualizes detected plane anchors in the camera view.
- Returns the observed plane extents and anchor positions to JavaScript when the user finishes.

It is a **plane-detection prototype**, not a complete 3D room reconstruction. ARKit plane anchors may be partial, split, merged, or missed. The returned measurements are estimates and must be reviewed. This does not use RoomPlan or LiDAR.

## Device requirements

- iPhone or iPad that supports ARKit world tracking.
- For the current target, a regular iPhone 17 can use ARKit world tracking and plane detection despite not having LiDAR.
- A Mac with Xcode is required to generate, compile, sign, install, and test the native iOS app.
- Physical-device testing is required; simulator results are not sufficient for room scanning.

## Xcode integration

1. On a Mac, clone the repository and run `npm install`.
2. Run `npm run cap:add:ios` once to generate the native iOS project.
3. Add `ios/SpatialScannerPlugin.swift` to the **App** target in Xcode (use **Copy items if needed**).
4. Register the local Capacitor plugin with the app's Capacitor bridge using the registration pattern supported by the installed Capacitor 8 template. Confirm the plugin is listed in the bridge before testing.
5. Add `NSCameraUsageDescription` to the iOS app's Info settings, for example: "Spatial Studio uses the camera to detect room surfaces and create a 3D room model."
6. Run `npm run cap:sync:ios`, open the project with `npm run cap:open:ios`, select the iPhone 17, then build and run.
7. Tap **Scan Room**, slowly move the phone to view the floor and each wall, and tap **Finish scan**.

## Current limitations

- The plugin returns plane observations, not a watertight mesh or a guaranteed rectangular room outline.
- It does not automatically infer corners, doors, windows, ceiling shape, or occluded wall sections.
- The web 3D viewer still needs a follow-up reconstruction step that turns confirmed floor and wall observations into a room shell. Users must be able to correct uncertain boundaries.
- The Swift file is a starter implementation and has not been compiled in this environment. Validate Capacitor plugin registration and Swift API compatibility in Xcode before treating it as production-ready.
- No scan data is uploaded; the plugin returns observations to the local app only.
