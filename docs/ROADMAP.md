# Spatial Studio: AR Room Scanning MVP

## Product direction

For now, Spatial Studio has one goal:

**Scan a room with a phone and turn that scan into a simple 3D model of the room.**

The first version is about room geometry only. It should capture the floor and walls, assemble them into a 3D room shell, and let the user inspect and correct the result.

Out of scope for this MVP:
- Furniture recognition or object detection.
- Furniture catalogs, shopping, or recommendations.
- User accounts, cloud databases, or project syncing.
- AI-based room or furniture analysis.

The existing website is a 3D editor prototype. Its camera preview is not a room scan. A real iPhone AR scan needs native iOS ARKit access; a normal GitHub Pages website running in Safari cannot directly call ARKit.

## Device and technology constraints

The target test device is the **regular iPhone 17**, not an iPhone 17 Pro.

- The regular iPhone 17 has no LiDAR scanner.
- Apple's RoomPlan framework requires a device with a LiDAR scanner. Do not build the MVP around RoomPlan on the regular iPhone 17.
- A native app can use ARKit world tracking and horizontal/vertical plane detection with the camera and motion sensors.
- Plane detection finds and tracks flat surfaces; it is not the same as a complete, dense 3D scan of every surface in a room.
- Tracking and plane estimates can improve as the user moves, and performance depends on lighting and visible visual detail.

Official references:
- [iPhone 17 technical specifications](https://www.apple.com/iphone-17/specs/)
- [RoomPlan device support](https://developer.apple.com/documentation/roomplan/roomcapturesession/issupported)
- [ARKit plane detection](https://developer.apple.com/documentation/arkit/tracking-and-visualizing-planes)
- [ARKit world tracking](https://developer.apple.com/documentation/arkit/understanding-world-tracking)

## MVP implementation plan

### Phase 1 — Native AR scanning foundation

- Keep the existing website as the landing page and 3D model viewer where practical.
- Add a native iOS scanning app or native iOS component. Choose the smallest maintainable route after inspecting the current project structure.
- Use ARKit world tracking with horizontal and vertical plane detection.
- Request camera and motion/world-sensing permissions clearly.
- Add scan instructions and live tracking feedback. Guide the user to move slowly, cover the room perimeter, and revisit surfaces that have not been detected.
- Handle unsupported devices, denied permissions, interrupted sessions, and poor tracking.

**Acceptance checks:** the scanner starts on a physical regular iPhone 17, clearly reports tracking status, and displays detected floor and wall surfaces. A browser camera preview must never be presented as ARKit scanning.

### Phase 2 — Reconstruct a simple 3D room

- Collect detected floor and wall plane data during the scan.
- Convert confirmed plane boundaries into a basic room shell made from a floor and wall surfaces.
- Let the user confirm or adjust wall boundaries, wall height, and uncertain measurements before finalizing.
- Clearly distinguish detected values from user-edited or inferred values.
- Show the completed room in a rotatable 3D preview.
- Prefer a simple portable model format that can be displayed by the existing Three.js viewer, such as GLB, or a small documented JSON representation if that is more practical initially.

**Accuracy rule:** do not promise exact measurements or a fully complete automatic scan from camera-only plane detection. If a wall, corner, or dimension is uncertain, show that uncertainty and let the user correct it. A simplified room shell is an acceptable first milestone.

### Phase 3 — Test and improve the scan

- Test on the regular iPhone 17 in several real rooms.
- Check whether floors and walls are detected consistently and whether the reconstructed room closes correctly.
- Test different lighting conditions, blank walls, clutter, mirrors, and interrupted scans.
- Measure and document practical dimension error against manually checked room measurements.
- Improve scan guidance and correction tools based on failed scans.

## First milestone

A user opens the native scanner on an iPhone 17, walks around a room while the app tracks the camera and detects surfaces, confirms or corrects the detected floor and walls, and receives a basic rotatable 3D model of that room.

Do not add databases, accounts, AI furniture recognition, furniture catalogs, or shopping features until this room-scanning milestone works reliably.
