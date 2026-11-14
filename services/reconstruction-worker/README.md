# Spatial Studio reconstruction worker

This is the first server-side reconstruction experiment for non-LiDAR room captures.

## What it does

- Accepts the ZIP exported by the Spatial Studio iOS app.
- Validates the manifest, image paths, JPEG data, camera poses, and intrinsics.
- Converts ARKit camera-to-world poses into OpenCV world-to-camera matrices.
- Runs the multi-view Depth Anything 3 model and requests a GLB point-cloud preview.
- Returns the GLB file to the caller.

The output is a **visual geometry preview**, not a finished architectural room model. It does not yet identify walls, doors, windows, furniture, or guarantee metric measurement accuracy. A later geometry-processing step must regularize the preview into editable room surfaces and validate dimensions.

## Model choice

The default is `depth-anything/DA3-LARGE-1.1`: a multi-view depth and camera-pose model with pose conditioning. The Hugging Face model card lists this refreshed checkpoint as Apache-2.0. The earlier DA3-LARGE model card used a non-commercial license; do not silently substitute it for the 1.1 checkpoint in a commercial product.

## Requirements

Use a Linux machine with an NVIDIA CUDA GPU. Model inference does not run on the iPhone or in the browser. Install a CUDA-compatible PyTorch, torchvision, and xformers build that match the host's driver and CUDA runtime, following the official PyTorch installation selector.

The reconstruction worker code uses Python 3.10 or newer (the upstream Depth Anything 3 project supports Python 3.9–3.13) and the upstream project lists PyTorch, torchvision, xformers, NumPy below 2, OpenCV, Open3D, Pillow, and other runtime packages. Install it from the official repository:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
# Install a CUDA-compatible torch / torchvision / xformers set first.
git clone https://github.com/ByteDance-Seed/Depth-Anything-3.git vendor/Depth-Anything-3
python -m pip install -e vendor/Depth-Anything-3
python -m pip install -r services/reconstruction-worker/requirements.txt
```

The first model load downloads the checkpoint from Hugging Face. Ensure the worker has enough disk space for the environment and model weights, and enough GPU memory for multi-view inference. The model is not yet benchmarked against Spatial Studio captures; an 8 GB GPU may run out of memory with a full 32-frame scan. If that happens, reduce the capture frame limit or use a GPU with more memory after measuring the quality trade-off.

## Run locally

From the repository root:

```bash
export PYTHONPATH="$PWD/services/reconstruction-worker"
export RECONSTRUCTION_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
printf 'API key for the iPhone app: %s\\n' "$RECONSTRUCTION_API_KEY"
uvicorn app:app --app-dir services/reconstruction-worker --host 0.0.0.0 --port 8000
```

Check the worker:

```bash
curl http://127.0.0.1:8000/health
```

### Connect the iPhone app over your local network

1. Run the worker on the computer with the NVIDIA GPU. Keep the terminal open while scanning.
2. Find that computer's local-network IP address with `hostname -I` (Linux), or use its local Bonjour hostname if available.
3. Keep the iPhone and computer on the same Wi-Fi network. Make sure the computer firewall allows inbound TCP connections on port 8000 from your private network.
4. In the installed iPhone app, finish a scan, open **Connect reconstruction worker**, and enter `http://COMPUTER-LAN-IP:8000` plus the API key from the worker terminal environment.
5. Tap **Check worker connection**, then **Reconstruct 3D preview**. The app sends the ZIP only after this explicit tap and displays the returned GLB.

The API key is entered into the app for the current session only; the app does not store it. The worker enables CORS for the Capacitor app origin and the project's GitHub Pages origin. For iOS local HTTP access, add `NSLocalNetworkUsageDescription` and `NSAppTransportSecurity.NSAllowsLocalNetworking = YES` to the iOS app target as described in `native/ios/InfoPlist-additions.txt`.

Do not expose this development worker directly to the public internet. For production, put it behind an authenticated backend with per-user access and short-lived permissions.
```

Submit a capture bundle:

```bash
curl -X POST http://127.0.0.1:8000/reconstruct \
  -H "X-API-Key: $RECONSTRUCTION_API_KEY" \
  -F "capture=@spatial-studio-capture-bundle.zip" \
  --output spatial-studio-room-preview.glb
```

The API key is required for `/reconstruct`; if it is not configured, the endpoint stays disabled. Do not put this secret in a Vite `VITE_*` variable or commit it to the repository. The iOS app asks you to enter it for the current session. A production app should call this worker through an authenticated backend that issues short-lived permissions and handles user consent.

## API

- `GET /health`: worker, model, and CUDA status.
- `POST /reconstruct`: multipart field `capture` containing the exported ZIP; requires `X-API-Key`; returns a GLB preview.

Configuration variables:

- `DA3_MODEL_ID`: default `depth-anything/DA3-LARGE-1.1`.
- `DA3_PROCESS_RES`: default 504.
- `RECONSTRUCTION_API_KEY`: required to enable reconstruction.
- `MAX_UPLOAD_BYTES`: default 50 MiB.
- `MAX_UNCOMPRESSED_BYTES`: default 70 MiB.
- `MAX_FRAMES`: default 32.

## Capture quality diagnostics

Before model inference, the worker measures the uploaded camera trajectory from the ARKit camera-to-world transforms. The response includes these headers:

- `X-Camera-Path-Length-M`: total distance traveled between consecutive captured poses.
- `X-Camera-Span-X-M` and `X-Camera-Span-Z-M`: horizontal spread of the camera positions in ARKit world coordinates.
- `X-Scan-Quality-Warnings`: JSON array containing warnings for near-stationary captures, little horizontal spread, repeated positions, or large gaps between consecutive views.

These are **capture-path diagnostics, not a room-coverage score**. A large path does not prove that every wall was seen, and a small path may be reasonable for a small space. Warnings do not currently block reconstruction. The next stage should combine image visibility/overlap, tracking confidence, and depth consistency before deciding whether to accept or reject a scan.

## Reconstruction research notes

The current DA3 call is pose-conditioned: it supplies the ARKit-derived camera extrinsics and intrinsics. DA3 documents that `align_to_input_ext_scale=True` replaces predicted extrinsics with the supplied inputs and aligns depth scale to them. This means camera tracking errors can affect the output; the worker does not currently optimize or correct those poses.

A useful controlled benchmark is to compare:
1. DA3 with ARKit poses (current baseline).
2. DA3 with its own internally estimated poses.
3. VGGT predictions, optionally followed by bundle adjustment and export to COLMAP.

VGGT is relevant because its released pipeline predicts camera parameters, depth, point maps, and tracks, and its repository includes COLMAP export and optional bundle adjustment. However, checkpoint licensing must be checked before commercial use: the repository distinguishes its original non-commercial checkpoint from its commercial-use checkpoint. Do not assume all downloadable VGGT weights have the same license.

Only after camera/depth alignment is stable should depth maps be fused into a surface. Open3D's TSDF integration is designed to combine noisy depth images with known camera poses and smooth the resulting geometry. It is a later fusion stage, not a substitute for good camera calibration or pose alignment.

## Depth prediction health checks

After DA3 inference, the worker inspects the returned depth tensor and (when present) confidence map before returning the GLB. The response includes:

- `X-Depth-Valid-Fraction`: median fraction of finite, positive depth pixels across frames.
- `X-Depth-Quality`: compact JSON summary with frame count, processed image size, depth percentiles, confidence-map availability, and warnings.
- `X-Depth-Quality-Warnings`: JSON array of warnings, including frames with fewer than half their pixels containing valid depth.

These checks detect empty, malformed, or substantially invalid predictions. They **do not** establish that the predicted geometry is metrically accurate, correctly aligned between views, or a complete room reconstruction. Confidence values are reported descriptively rather than thresholded because their scale should be validated for the selected checkpoint before assigning a universal cutoff.

The worker still returns the GLB preview. Depth diagnostics are included in response headers for a future client review screen. Cross-view reprojection error and TSDF fusion remain future work; TSDF should only be attempted after pose and depth alignment have been benchmarked.

## Pose convention

ARKit frame metadata stores a column-major 4×4 camera-to-world transform. ARKit camera coordinates use +X right, +Y up, and -Z forward. DA3 documents input extrinsics as world-to-camera; the worker converts the pose to OpenCV camera coordinates (+X right, +Y down, +Z forward) before passing it to DA3. Intrinsics are scaled to the exact sensor-native JPEG size and are passed as a 3×3 matrix.

This conversion is a convention-based integration and must be verified against actual room captures before trusting the resulting geometry. The API deliberately keeps pose conversion isolated in `geometry.py` with unit tests.

## Tests

```bash
PYTHONPATH=services/reconstruction-worker python -m unittest discover -s services/reconstruction-worker/tests -v
```

Run with CUDA hardware before treating the worker as production-ready. This repository does not include a hosted GPU deployment or a reconstruction API URL yet.
