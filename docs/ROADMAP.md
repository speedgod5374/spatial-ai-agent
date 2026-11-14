# Spatial Studio — AR-first MVP roadmap

## Product goal

Scan a physical room with the standard iPhone 17 and produce a basic, editable 3D representation of the floor and detected walls.

## Target-device reality

The standard iPhone 17 has no LiDAR scanner. Do not use or advertise Apple's LiDAR-dependent RoomPlan workflow for this device.

The MVP uses native ARKit world tracking and camera-based horizontal/vertical plane detection. ARKit reports candidate flat surface patches; it does not promise complete room geometry. The user must review and correct uncertain surfaces.

## MVP stages

1. **Native capture**
   - Capacitor iOS wrapper and local Swift plugin.
   - Camera permission, device capability check, AR tracking status, scan guidance, finish/cancel, and error states.
   - Horizontal and vertical ARPlaneAnchor observations only.

2. **Surface review**
   - Return plane extents, centers, and transforms in meters.
   - Let the user assign floor/wall/ignore, edit dimensions and world-space centers, and explicitly confirm surfaces.
   - Clearly mark every unconfirmed observation.

3. **Room-shell preview and export**
   - Preview included surface patches in Three.js.
   - Export JSON with raw observations separated from confirmed model surfaces.
   - Keep the web planner available when native scanning is not present.

4. **Physical-device validation**
   - Build in Xcode and test on a standard iPhone 17.
   - Compare repeated scans with manually measured reference dimensions.
   - Record which surfaces are consistently detected and where users need to correct geometry.
   - Do not claim a complete room mesh or centimeter-level accuracy without evidence.

## Out of scope for this milestone

- Database integration, user accounts, cloud sync, or server storage.
- Furniture recognition, object detection, product catalogs, or recommendations.
- RoomPlan, LiDAR mesh reconstruction, or unsupported depth-sensor claims.
- Automatic completion of hidden or undetected wall boundaries.

## Higher-fidelity path

If a later product version needs more complete parametric room reconstruction, evaluate a LiDAR-equipped iPhone Pro or iPad Pro and Apple's RoomPlan on that hardware. That is a separate device path and is not available on the standard iPhone 17.
