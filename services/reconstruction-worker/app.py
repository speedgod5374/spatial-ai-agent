from __future__ import annotations

import io
import json
import os
import secrets
import shutil
import tempfile
import threading
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
import torch
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from geometry import (
    arkit_camera_to_world_to_opencv_world_to_camera,
    validate_intrinsics,
)


MODEL_ID = os.getenv("DA3_MODEL_ID", "depth-anything/DA3-LARGE-1.1")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
MAX_UNCOMPRESSED_BYTES = int(os.getenv("MAX_UNCOMPRESSED_BYTES", str(70 * 1024 * 1024)))
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
MAX_FRAMES = int(os.getenv("MAX_FRAMES", "32"))
MIN_FRAMES = int(os.getenv("MIN_FRAMES", "6"))
PROCESS_RES = int(os.getenv("DA3_PROCESS_RES", "504"))
API_KEY = os.getenv("RECONSTRUCTION_API_KEY", "")
MODEL_LOCK = threading.Lock()
MODEL_LOAD_LOCK = threading.Lock()

Image.MAX_IMAGE_PIXELS = 20_000_000

app = FastAPI(
    title="Spatial Studio Reconstruction Worker",
    version="0.1.0",
    description="GPU worker that converts Spatial Studio multi-view captures into a preview GLB.",
)
_model: Any | None = None


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Set RECONSTRUCTION_API_KEY before enabling the reconstruction endpoint.",
        )
    if not x_api_key or not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid reconstruction API key.")


def load_model() -> Any:
    global _model
    with MODEL_LOAD_LOCK:
        if _model is not None:
            return _model

        if not torch.cuda.is_available():
            raise HTTPException(
                status_code=503,
                detail="A CUDA GPU is required for this reconstruction worker.",
            )

        try:
            from depth_anything_3.api import DepthAnything3

            device = torch.device("cuda")
            loaded = DepthAnything3.from_pretrained(MODEL_ID)
            loaded = loaded.to(device=device)
            loaded.eval()
            _model = loaded
            return _model
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Could not load {MODEL_ID}: {type(exc).__name__}: {exc}",
            ) from exc


def run_reconstruction(
    model: Any,
    image_paths: list[str],
    extrinsics: np.ndarray,
    intrinsics: np.ndarray,
    output_dir: Path,
) -> None:
    with MODEL_LOCK:
        model.inference(
            image=image_paths,
            extrinsics=extrinsics,
            intrinsics=intrinsics,
            align_to_input_ext_scale=True,
            ref_view_strategy="saddle_balanced",
            process_res=PROCESS_RES,
            export_dir=str(output_dir),
            export_format="glb",
            num_max_points=800_000,
            show_cameras=False,
        )


def safe_zip_name(name: str) -> bool:
    parts = name.split("/")
    path = PurePosixPath(name)
    return (
        bool(name)
        and not path.is_absolute()
        and "\\" not in name
        and all(part not in {"", ".", ".."} for part in parts)
        and not name.startswith("/")
    )


def parse_capture_archive(archive_bytes: bytes, workdir: Path) -> tuple[list[str], np.ndarray, np.ndarray, dict]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(archive_bytes))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="The upload is not a valid ZIP archive.") from exc

    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_FRAMES + 2:
            raise HTTPException(status_code=400, detail="The archive contains too many entries.")

        total_size = 0
        by_name = {}
        for info in infos:
            if not safe_zip_name(info.filename):
                raise HTTPException(status_code=400, detail="The ZIP contains an unsafe file path.")
            if info.is_dir():
                continue
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise HTTPException(status_code=400, detail="Symbolic links are not allowed in capture ZIPs.")
            total_size += info.file_size
            if total_size > MAX_UNCOMPRESSED_BYTES:
                raise HTTPException(status_code=413, detail="The uncompressed capture is too large.")
            if info.filename in by_name:
                raise HTTPException(status_code=400, detail="The ZIP contains duplicate filenames.")
            by_name[info.filename] = info

        if "capture.json" not in by_name:
            raise HTTPException(status_code=400, detail="capture.json is missing from the archive.")

        try:
            manifest = json.loads(archive.read(by_name["capture.json"]))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail="capture.json is invalid.") from exc

        if not isinstance(manifest, dict):
            raise HTTPException(status_code=400, detail="capture.json must contain a JSON object.")
        if manifest.get("format") != "spatial-studio-multiview-capture":
            raise HTTPException(status_code=400, detail="Unsupported capture bundle format.")

        frame_metadata = manifest.get("frames")
        if not isinstance(frame_metadata, list) or not MIN_FRAMES <= len(frame_metadata) <= MAX_FRAMES:
            raise HTTPException(
                status_code=400,
                detail=f"The capture must contain between {MIN_FRAMES} and {MAX_FRAMES} viewpoints.",
            )

        image_paths: list[str] = []
        extrinsics: list[np.ndarray] = []
        intrinsics: list[np.ndarray] = []

        for frame_number, frame in enumerate(frame_metadata, start=1):
            if not isinstance(frame, dict):
                raise HTTPException(status_code=400, detail=f"Frame {frame_number} metadata must be an object.")
            filename = frame.get("filename")
            if not isinstance(filename, str) or not filename.startswith("frames/") or filename not in by_name:
                raise HTTPException(status_code=400, detail=f"Image file for frame {frame_number} is missing.")
            if not filename.lower().endswith((".jpg", ".jpeg")):
                raise HTTPException(status_code=400, detail=f"Frame {frame_number} is not a JPEG image.")

            info = by_name[filename]
            if info.file_size <= 0 or info.file_size > MAX_IMAGE_BYTES:
                raise HTTPException(status_code=413, detail=f"Frame {frame_number} has an invalid file size.")

            image_bytes = archive.read(info)
            try:
                with Image.open(io.BytesIO(image_bytes)) as image:
                    image.verify()
                with Image.open(io.BytesIO(image_bytes)) as image:
                    image = image.convert("RGB")
                    width, height = image.size
                    if width < 160 or height < 160:
                        raise HTTPException(status_code=400, detail=f"Frame {frame_number} is too small.")
                    if width * height > 20_000_000:
                        raise HTTPException(status_code=413, detail=f"Frame {frame_number} exceeds the pixel limit.")
                    try:
                        declared_width = int(frame.get("imageWidth", width))
                        declared_height = int(frame.get("imageHeight", height))
                    except (TypeError, ValueError) as exc:
                        raise HTTPException(status_code=400, detail=f"Frame {frame_number} has invalid dimensions.") from exc
                    if (declared_width, declared_height) != (width, height):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Frame {frame_number} dimensions do not match capture.json.",
                        )
                    target = workdir / f"frame-{frame_number:03d}.jpg"
                    image.save(target, format="JPEG", quality=95, optimize=True)
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
                raise HTTPException(status_code=400, detail=f"Frame {frame_number} is not a readable image.") from exc

            if frame.get("imageOrientation", "sensor-native") != "sensor-native":
                raise HTTPException(status_code=400, detail=f"Frame {frame_number} uses an unsupported image orientation.")
            pose_values = frame.get("cameraToWorldARKit") or frame.get("cameraTransform")
            if not isinstance(pose_values, list) or len(pose_values) != 16:
                raise HTTPException(status_code=400, detail=f"Frame {frame_number} is missing its ARKit camera pose.")
            try:
                world_to_camera = arkit_camera_to_world_to_opencv_world_to_camera(pose_values)
                camera_intrinsics = validate_intrinsics(frame.get("intrinsics"))
            except (ValueError, np.linalg.LinAlgError) as exc:
                raise HTTPException(status_code=400, detail=f"Frame {frame_number} has invalid calibration: {exc}") from exc

            image_paths.append(str(target))
            extrinsics.append(world_to_camera)
            intrinsics.append(camera_intrinsics)

        return image_paths, np.stack(extrinsics), np.stack(intrinsics), manifest


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_ID,
        "modelLoaded": _model is not None,
        "cudaAvailable": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "unavailable",
        "minimumFrames": MIN_FRAMES,
        "maximumFrames": MAX_FRAMES,
    }


@app.post("/reconstruct", dependencies=[Depends(require_api_key)])
async def reconstruct(capture: UploadFile = File(...)) -> FileResponse:
    if capture.content_type not in {"application/zip", "application/x-zip-compressed", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Upload the .zip capture bundle.")

    archive_bytes = await capture.read(MAX_UPLOAD_BYTES + 1)
    if len(archive_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The capture ZIP exceeds the upload limit.")
    if not archive_bytes:
        raise HTTPException(status_code=400, detail="The capture ZIP is empty.")

    temp_root = Path(tempfile.mkdtemp(prefix="spatial-studio-"))
    try:
        input_dir = temp_root / "input"
        output_dir = temp_root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        image_paths, extrinsics, intrinsics, manifest = parse_capture_archive(archive_bytes, input_dir)

        model = await run_in_threadpool(load_model)
        await run_in_threadpool(
            run_reconstruction,
            model,
            image_paths,
            extrinsics,
            intrinsics,
            output_dir,
        )

        glb_files = sorted(output_dir.rglob("*.glb"), key=lambda path: path.stat().st_size, reverse=True)
        if not glb_files:
            raise HTTPException(status_code=500, detail="DA3 completed but did not export a GLB file.")

        result_path = glb_files[0]
        if result_path.stat().st_size < 100:
            raise HTTPException(status_code=500, detail="The generated GLB file is unexpectedly small.")

        response_headers = {
            "X-Reconstruction-Engine": MODEL_ID,
            "X-Captured-Frames": str(len(image_paths)),
            "X-Alignment-Mode": "ARKit camera poses aligned to DA3 reconstruction scale",
            "X-Depth-Confidence": "See model output; review geometry before measuring furniture fit.",
        }
        return FileResponse(
            path=result_path,
            media_type="model/gltf-binary",
            filename="spatial-studio-room-preview.glb",
            headers=response_headers,
            background=BackgroundTask(shutil.rmtree, temp_root, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(temp_root, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_root, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"Reconstruction failed: {type(exc).__name__}: {exc}",
        ) from exc
    finally:
        await capture.close()
