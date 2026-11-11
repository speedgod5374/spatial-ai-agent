# Spatial Studio

Spatial Studio is a Vite + Three.js room planner with a Capacitor iOS app for camera-based room capture on devices without LiDAR.

## Current capabilities

- Web-based 3D room planner with editable dimensions and furniture placement.
- Native iOS capture using ARKit world tracking.
- Automatic selection of overlapping camera keyframes as the user moves around a room.
- Each captured JPEG is paired with its ARKit camera pose, camera intrinsics, dimensions, and timestamp.
- Lightweight image checks skip very dark candidate frames and flag low-detail views for review.
- Eight relative horizontal heading buckets help report viewpoint variety; they are not a room-coverage score.
- Optional ARKit horizontal/vertical plane observations, clearly treated as hints rather than a complete room model.
- Actionable ARKit tracking feedback for initialization, excessive motion, insufficient visual features, and relocalization.
- Rotation-aware furniture footprints, room-boundary clamping, collision checks, and automatic nearest-clear placement in the planning model.
- Imported furniture is arranged into available positions instead of stacking every object at the room origin.
- Review screen with captured-view thumbnails.
- ZIP export containing the captured images and `capture.json` for a reconstruction pipeline.
- JSON export for manually confirmed ARKit plane hints.

## Important iPhone 17 limitation

The **standard iPhone 17 has no LiDAR scanner**. This project does not use Apple's LiDAR-dependent RoomPlan workflow.

The non-LiDAR path captures overlapping images and ARKit camera poses. It does **not** create a complete 3D room model on the phone. Camera-only reconstruction can struggle with blank walls, reflective surfaces, poor lighting, and tracking drift. The scanner's brightness and detail checks are simple capture hints, not guarantees of sharpness or reconstruction quality. Its heading buckets measure directional variety, not whether every part of the room was covered. Room measurements must be checked and corrected before furniture-fit decisions.

## 3D reconstruction prototype

A first GPU-worker implementation is in [services/reconstruction-worker](services/reconstruction-worker/README.md). It accepts the exported ZIP, converts ARKit camera poses to the OpenCV convention expected by DA3, and requests a GLB point-cloud preview from the Apache-2.0 DA3-LARGE-1.1 model.

The worker is not deployed or connected to the app. It requires a CUDA GPU and a protected API key. The GLB is a preliminary visual geometry result, **not** an editable floor plan, architectural mesh, or guaranteed measurement model. See [docs/CAMERA-ONLY-RECONSTRUCTION.md](docs/CAMERA-ONLY-RECONSTRUCTION.md) for the capture format, limitations, and next steps.

## Web development

Use Node.js 22 or later:

```bash
npm install
npm run dev
npm test
npm run build
```

The production web build is written to `dist/`. GitHub Pages can host the planner, but browser JavaScript cannot call native ARKit; room capture requires the installed iOS app.

## Native iOS setup

A Mac with Xcode and a physical iPhone are required to compile, sign, install, and test the scanner. Follow [docs/IOS-AR-SETUP.md](docs/IOS-AR-SETUP.md) for Capacitor setup, Swift plugin registration, camera permission, build steps, and physical-device checks.

## Privacy

Camera images and scan data are processed on-device during capture. Nothing is uploaded automatically. The user explicitly exports a capture ZIP. A future app-to-backend upload must include clear consent and use an authenticated server-side service; never embed the worker API key in the iOS app or a public Vite build.

## Product scope

This milestone focuses on reliable camera capture and the first geometry-reconstruction experiment. Furniture recognition, object-level editing, product catalogs, and AI redesign are separate stages and are not yet connected to this capture pipeline.
