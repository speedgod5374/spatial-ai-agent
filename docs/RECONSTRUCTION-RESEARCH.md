# Camera-only room reconstruction: research and implementation plan

This document records the reconstruction methods used in established multi-view systems and how Spatial Studio should apply them to a standard iPhone 17 (camera + ARKit tracking, no LiDAR).

## 1. What working systems do

### Classical photogrammetry: COLMAP

COLMAP is a widely used open-source Structure-from-Motion (SfM) and Multi-View Stereo (MVS) pipeline. SfM first detects and matches visual features across overlapping photos, geometrically verifies those matches, and estimates camera poses plus a sparse 3D scene. MVS then estimates denser depth/normal information, fuses the views into a dense point cloud, and can reconstruct a surface mesh.

COLMAP's capture guidance is directly relevant to this app:
- Capture views with good visual texture; blank walls provide few matching features.
- Keep lighting reasonably consistent and avoid strong reflections/specular surfaces.
- Keep high overlap between consecutive viewpoints; a surface should appear in multiple images.
- Move the camera between images. Rotating in place gives little parallax and is weak evidence for metric 3D structure.
- More images are not automatically better; redundant frames increase processing time.

References:
- [COLMAP tutorial](https://colmap.github.io/tutorial.html)
- [COLMAP reconstruction overview](https://colmap.github.io/)

### Modern multi-view neural geometry: VGGT

VGGT (CVPR 2025) predicts camera parameters, depth maps, point maps, and point tracks from one or many images in a feed-forward model. It demonstrates that modern models can estimate several related 3D outputs together rather than predicting each depth map independently.

This makes VGGT a worthwhile alternative to benchmark against DA3 for Spatial Studio, not an automatic replacement. The actual room-capture dataset, GPU memory, metric scale, and failure cases must decide which model is better.

References:
- [CVPR 2025 paper](https://openaccess.thecvf.com/content/CVPR2025/html/Wang_VGGT_Visual_Geometry_Grounded_Transformer_CVPR_2025_paper.html)
- [Official project and code](https://github.com/facebookresearch/vggt)

### Pose-conditioned depth and geometry: Depth Anything 3

The current worker uses DA3-LARGE-1.1 with camera intrinsics and extrinsics. The official API describes pose-conditioned inference and the `align_to_input_ext_scale` option. When enabled, the API replaces predicted camera extrinsics with supplied extrinsics and rescales predicted depth to match their scale.

That is useful when ARKit poses are trustworthy, but it also means ARKit drift can be inherited by the final geometry. The next backend experiment should compare:
1. DA3 aligned to the supplied ARKit poses (the current behavior).
2. DA3's internally estimated poses aligned to the input poses through its documented pose-alignment path.

Compare camera consistency, wall/floor planarity, scale error against measured room dimensions, and visual completeness. Do not choose based only on which GLB looks denser.

References:
- [Depth Anything 3 API](https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/docs/API.md)
- [DA3-LARGE-1.1 model card](https://huggingface.co/depth-anything/DA3-LARGE-1.1)

### Multi-view depth fusion: Open3D

Open3D's TSDF integration combines RGB-D frames using camera intrinsics and poses. It integrates noisy depth observations into a shared volume and extracts smoother geometry. This is a useful downstream pattern once Spatial Studio has depth maps that are mutually aligned and expressed in a consistent scale.

It should not be applied blindly to arbitrary monocular depth predictions: a model's per-frame depth can contain scale or shape inconsistencies. First validate pose alignment and depth consistency, then fuse. Keep a confidence mask so low-confidence pixels do not contribute as strongly.

References:
- [Open3D RGB-D integration](https://www.open3d.org/docs/latest/tutorial/pipelines/rgbd_integration.html)
- [Open3D TSDF integration](https://www.open3d.org/docs/latest/tutorial/t_reconstruction_system/integration.html)

## 2. What this means for Spatial Studio

### Capture must provide parallax, not just a panorama

The previous capture rule accepted a frame after either about 22 cm of translation or a turn of about 0.25 radians. That could produce many images from nearly one camera position. The capture rule is now translation-based: after the first frame, the phone must move at least about 22 cm from the previous accepted keyframe, with a minimum time gap. Users should still turn toward each wall, but do so while walking around the room.

The review screen reports:
- total camera-path length;
- horizontal span of the phone's path on the ARKit X/Z axes;
- captured viewpoints and sampled heading directions.

These are diagnostics of camera movement, **not a percentage of room coverage**. A large camera path can still miss a wall, and a small path can revisit the same area.

### Keep three layers separate

1. **Capture evidence:** original JPEGs, timestamp, ARKit camera-to-world pose, scaled intrinsics, tracking state, and image-quality hints.
2. **Observed geometry:** depth/point maps, ARKit plane patches, fused point cloud, and confidence values. These are still estimates.
3. **Editable room model:** user-reviewable floor, walls, ceiling, openings, and obstacles with dimensions. This layer should preserve which measurements came from sensors, model inference, or user edits.

Do not turn an uncertain point cloud into a precise floor plan without a review step.

### Regularize room structure after multi-view fusion

Once the point cloud/depth fusion is stable:
- estimate a dominant gravity-aligned floor plane;
- find vertical wall-plane candidates;
- merge nearby, nearly coplanar patches;
- estimate wall intersections/corners and room polygon;
- infer ceiling height only when the data supports it;
- detect likely openings only with image/geometry evidence;
- keep clutter and furniture as separate obstacle/object candidates.

Use ARKit's plane anchors as optional hints. Apple describes them as areas that appear planar in camera imagery; their estimates can change as ARKit refines observations. They are not a complete room shell.

Reference: [Apple plane detection](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/planedetection-swift.struct) and [world tracking guidance](https://developer.apple.com/documentation/arkit/understanding-world-tracking).

## 3. A test plan before claiming accuracy

Build a small repeatable validation set rather than judging scans only by appearance:

1. Scan the same room three times from the same starting point and route.
2. Measure reference wall lengths and room height independently.
3. Include a furnished room, a sparse room with plain walls, and a room with reflective surfaces.
4. For every capture, record camera-path length, horizontal path span, frame count, skipped/low-detail counts, and tracking interruptions.
5. Compare DA3 pose-locked and pose-aligned modes, and then benchmark VGGT on the same selected views if the GPU supports it.
6. Compare estimated dimensions, wall/floor alignment, missing surfaces, and repeatability.
7. Keep the uncertainty visible. Do not advertise centimeter accuracy until repeated measurements support it.

## 4. Current project status

- The iOS app captures ARKit-tracked images and camera calibration.
- The keyframe rule now favors translated viewpoints over rotation-only panoramas.
- A camera-path summary is shown during scan review.
- The FastAPI worker currently returns a DA3 GLB preview only.
- No production room-shell extraction, object recognition, furniture segmentation, upload workflow, or device-tested metric accuracy is claimed.
