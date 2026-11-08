# Spatial Studio

Spatial Studio is a Vite + Three.js room planner with a Capacitor iOS wrapper path for camera-based ARKit room-surface capture.

## Current capabilities

- Web-based 3D room editor with editable dimensions and furniture placement.
- Import/export of room JSON.
- Native iOS ARKit prototype that detects horizontal and vertical plane observations.
- Review UI for changing a surface's role, dimensions, world-space center, and confirmation state.
- Three.js preview of the confirmed room-surface shell.
- JSON export that keeps raw observations separate from the confirmed model.

## Important iPhone 17 limitation

The **standard iPhone 17 has no LiDAR scanner**. This project does not use RoomPlan. Apple's `RoomCaptureSession.isSupported` check requires a device with a LiDAR Scanner.

The intended standard-iPhone-17 path uses ARKit world tracking and camera-based horizontal/vertical plane detection. This finds candidate flat surface patches; it does not guarantee a complete room outline or accurate reconstruction of every wall. The user must review and correct dimensions and positions before export.

The GitHub Pages website cannot call native ARKit. Its scan button explains that the installed iOS app is required; it does not present a browser camera preview as a room scan.

## Web development

Use Node.js 22 or later:

```bash
npm install
npm run dev
npm test
npm run build
```

The production web build is written to `dist/`.

## Native iOS setup

A Mac with Xcode and a physical iPhone are required to compile, sign, install, and test the native scanner. Follow [docs/IOS-AR-SETUP.md](docs/IOS-AR-SETUP.md) for Capacitor setup, Swift plugin registration, camera permission, and the physical-device checklist.

## Privacy

The native prototype processes camera frames through ARKit on-device. It returns plane measurements and transforms to the app; this feature does not upload camera frames or scan data to a backend. JSON export is initiated by the user and saved locally.

## Scope

The current scanning milestone is room geometry only. Database integration, user accounts, furniture recognition, product catalogs, and furniture recommendations are not part of this AR scanning implementation.
