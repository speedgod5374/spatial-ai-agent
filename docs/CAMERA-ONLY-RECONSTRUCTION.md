# Camera-only room capture and reconstruction pipeline

## Current capture implementation

The standard iPhone 17 does not provide LiDAR, so Spatial Studio does not use RoomPlan or claim to generate a LiDAR-quality room mesh.

The native iOS scanner now performs guided, multi-view camera capture:

1. ARKit tracks the phone's position and orientation in a local world coordinate system.
2. The scanner evaluates each new frame and keeps a keyframe after sufficient translation or rotation, with a minimum time gap between samples.
3. Each selected camera image is downscaled to a maximum dimension of 1024 pixels and encoded as JPEG.
4. Every image is paired with its ARKit camera transform, scaled camera-intrinsic matrix, dimensions, timestamp, and tracking state.
5. Optional horizontal and vertical ARKit plane observations are retained as hints. They are not treated as a room mesh.
6. The native Capacitor plugin returns the capture records to the web app. Nothing is uploaded automatically.
7. The review screen shows a sample of the captured images and can export a ZIP bundle.

The capture currently allows up to 32 keyframes. It requires at least 6 before Finish is accepted. These are engineering guardrails for the prototype, not a claim that six images are sufficient to reconstruct every room.

## Capture bundle format

The export `spatial-studio-capture-bundle.zip` contains:

- `frames/frame-001.jpg`, etc.: captured camera images.
- `capture.json`: capture method, image dimensions, camera poses, 3×3 intrinsics, timestamps, ARKit plane hints, and reconstruction status.

The camera transforms are serialized in ARKit's column-major 4×4 matrix order. The intrinsic matrices are stored as 3×3 row arrays and scaled to match the exported JPEG dimensions. Images are kept in the camera's sensor-native orientation; the manifest records this so the reconstruction backend can apply the correct orientation convention.

The ZIP currently uses uncompressed ZIP entries ("store" mode). JPEGs are already compressed, so recompressing them would add CPU work without materially reducing the bundle.

## Recommended reconstruction backend

The app-side capture data is designed to feed a server-side multi-view reconstruction job. The recommended experiment is:

1. Validate and normalize the JPEGs and camera metadata.
2. Run a multi-view depth / geometry model such as Depth Anything 3 on a GPU-capable worker.
3. Use ARKit camera poses as pose priors where the model accepts them, and compare the model's own camera estimates against the ARKit estimates.
4. Fuse the per-view depth predictions into a point cloud or mesh.
5. Regularize the geometry into a room representation: floor plane, wall planes, corners, ceiling, openings, and major obstacles.
6. Export both a visual mesh (for example GLB) and a separate editable room layout with explicit dimensions and confidence values.

Do not assume the first predicted mesh is dimensionally correct. Camera-only monocular depth can be scale-ambiguous or drift, and plain, reflective, transparent, or poorly lit surfaces can produce weak geometry. Use ARKit tracking as a constraint, retain per-surface confidence, and ask the user to correct dimensions before furniture placement.

## Not yet implemented

- No DA3 model is installed or running in this repository.
- No GPU inference host, upload endpoint, job queue, or reconstruction API is connected.
- No room mesh or editable floor-plan is generated from the image bundle yet.
- No furniture recognition is currently part of the capture pipeline.
- The client does not upload images automatically. A future upload must be an explicit user action with a clear privacy notice and a secure backend.

## Physical-device test checklist

- [ ] Build and run the current native plugin on a physical iPhone 17.
- [ ] Confirm that the capture counter increments only when the camera moves enough to provide a new viewpoint.
- [ ] Walk a full circle around a room and confirm that images show overlapping views of every wall.
- [ ] Confirm that camera tracking limitations pause or reduce frame capture rather than recording unreliable poses.
- [ ] Finish returns at least 6 frames and the optional ARKit plane hints.
- [ ] The review screen displays captured image thumbnails.
- [ ] Export the ZIP and verify that it contains all JPEGs and a valid `capture.json`.
- [ ] Compare exported image orientation and intrinsics against the saved image dimensions.
- [ ] Test the ZIP with an archive utility before connecting it to a reconstruction server.
