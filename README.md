# Spatial Studio — LiDAR starter

This is a starter integration for the Spatial Studio prototype you shared. It keeps the web interface and Three.js viewer, and adds an iOS-native scanning path based on Apple's RoomPlan framework.

## The important hosting distinction

- **GitHub Pages remains the public web preview.** It can host the HTML/CSS/JavaScript viewer, and this project includes a GitHub Actions workflow to publish the Vite build.
- **GitHub Pages cannot itself run Apple's RoomPlan framework.** RoomPlan is an iOS native framework that uses the device camera and LiDAR hardware.
- **The LiDAR scanner runs inside an iOS app.** Capacitor packages the same web frontend in a native iOS shell and exposes a small Swift plugin called `RoomPlan` to JavaScript.

The web page intentionally does not pretend that opening a camera is the same as LiDAR scanning. On GitHub Pages, the Scan Room button explains that native iOS scanning is unavailable. The web page can still import a scan JSON file exported by the iOS app.

## What is implemented in this starter

1. A Three.js room viewer with orbit and zoom controls.
2. A JavaScript-to-native Capacitor bridge (`RoomPlan.isSupported()` and `RoomPlan.scanRoom()`).
3. A native Swift RoomPlan scanner using Apple's `RoomCaptureView` coaching interface.
4. A structured JSON payload containing recognized walls, floors, doors, windows, openings, and object bounding boxes, including dimensions and 4×4 transforms in meters.
5. A native USDZ export attempt and local JSON/USDZ file storage in the iOS app's Documents/Scans folder.
6. Import/export of the JSON scan data in the web UI.
7. A GitHub Pages Actions workflow for the browser version.

This is an integration starter, not a fully tested production app. It needs to be added to an Xcode project and tested on a real supported device. I cannot compile or validate the Swift target in this Linux environment.

## 1. Run the web preview locally

Install Node.js 22 or later, then from this project directory run:

```bash
npm install
npm run dev
```

Vite prints a local development URL. Open it in a browser. The 3D viewer works, but native LiDAR scanning will be unavailable in the browser.

To build the static website:

```bash
npm run build
```

The deployable website is generated in `dist/`.

## 2. Publish the web version on GitHub Pages

1. Put these files in your GitHub repository's root directory.
2. Push the project to the `main` branch.
3. In GitHub, open **Settings → Pages**.
4. Set the build/deployment source to **GitHub Actions**.
5. Push again or manually run the **Deploy Spatial Studio web preview to GitHub Pages** workflow.

The workflow builds the Vite site and publishes `dist/`. If your default branch is not `main`, edit `.github/workflows/deploy-pages.yml` and change the branch name.

## 3. Create the native iOS app

**You need a Mac with Xcode 26 or later** to create, compile, sign, and run the iOS application with this Capacitor 8 starter. The GitHub Pages website alone cannot access RoomPlan.

From the project directory on the Mac:

```bash
npm install
npx cap add ios
```

Then:

1. Open the generated project with `npx cap open ios`.
2. In Xcode, find the app target's `App` group.
3. Add `native/ios/RoomPlanPlugin.swift` to the iOS app target. Make sure **Copy items if needed** is selected and the app target is checked.
4. Replace the generated `ViewController.swift` with `native/ios/ViewController.swift` (or merge the `capacitorDidLoad()` override into your existing `CAPBridgeViewController` subclass).
5. In the app target's **Info** settings, add `NSCameraUsageDescription` with this value: `Spatial Studio uses the camera and LiDAR scanner to measure and reconstruct your room.` The same text is in `native/ios/InfoPlist-additions.txt`.
6. Set the iOS Deployment Target to **iOS 16.0 or later**.
7. Select a physical LiDAR-equipped iPhone or iPad Pro as the run destination. RoomPlan's `RoomCaptureSession.isSupported` check will return false on unsupported devices; the iOS Simulator is not a substitute for testing the LiDAR scan.
8. Run the app from Xcode and tap **Scan Room**.

After adding or changing web assets, run:

```bash
npm run cap:sync:ios
npx cap open ios
```

The JS side registers a Capacitor plugin named `RoomPlan`, which must exactly match `jsName` in `RoomPlanPlugin.swift`.

## 4. Data contract passed from Swift to Three.js

The plugin resolves `scanRoom()` with an object shaped like this:

```json
{
  "room": {
    "schemaVersion": 1,
    "source": "Apple RoomPlan",
    "roomId": "...",
    "units": "meters",
    "elements": [
      {
        "id": "...",
        "kind": "wall",
        "category": "...",
        "dimensions": [3.2, 2.6, 0.08],
        "transform": [16 column-major matrix values],
        "confidence": "..."
      }
    ],
    "counts": {
      "walls": 4,
      "floors": 1,
      "doors": 1,
      "windows": 2,
      "openings": 0,
      "objects": 3
    }
  }
}
```

The dimensions and transforms come from RoomPlan's processed result. The web viewer represents each detected element using a box based on its dimensions and transform. It is a first editable-geometry foundation, not a photorealistic mesh renderer. The full USDZ file is also saved by the iOS app, but the current browser viewer does not yet load that USDZ file.

## 5. Next steps after the first physical scan works

1. Verify the scale and coordinate orientation against a room with known measurements.
2. Add a native method to list/share the saved JSON and USDZ files from `Documents/Scans`.
3. Add a USDZ preview/import pipeline if the viewer needs the richer exported model.
4. Add manual correction controls because scan measurements and object recognition are estimates.
5. Add Android depth scanning separately with ARCore; do not assume Apple's RoomPlan plugin will work on Android.

## Notes and limits

- RoomPlan requires a supported Apple device with LiDAR. The native code checks this with `RoomCaptureSession.isSupported` before starting.
- RoomPlan object detections are not guaranteed to identify every object. The detected furniture geometry is represented initially as bounding boxes; replace those with catalog models later.
- The confidence values returned by RoomPlan are kept as raw category confidence labels where available. This starter does not invent an overall numeric accuracy percentage.
- Do not treat the scan as a certified architectural survey. Let the user review and correct measurements before using them for purchases or fit decisions.
