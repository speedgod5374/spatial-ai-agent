from __future__ import annotations

import numpy as np


# ARKit camera coordinates: +X right, +Y up, -Z forward.
# OpenCV camera coordinates: +X right, +Y down, +Z forward.
ARKIT_CAMERA_TO_OPENCV = np.diag([1.0, -1.0, -1.0, 1.0])


def arkit_column_major_to_matrix(values: list[float]) -> np.ndarray:
    """Decode the 16 floats emitted by Swift's simd_float4x4 column serialization."""
    matrix_values = np.asarray(values, dtype=np.float64)
    if matrix_values.size != 16 or not np.isfinite(matrix_values).all():
        raise ValueError("cameraToWorldARKit must contain 16 finite numbers.")

    matrix = matrix_values.reshape((4, 4), order="F")
    if not np.allclose(matrix[3], [0.0, 0.0, 0.0, 1.0], atol=1e-3):
        raise ValueError("cameraToWorldARKit is not a valid homogeneous transform.")
    return matrix


def arkit_camera_to_world_to_opencv_world_to_camera(values: list[float]) -> np.ndarray:
    """
    Convert ARKit camera-to-world into OpenCV world-to-camera.

    First map the OpenCV camera's local axes into ARKit camera axes, then invert
    the camera-to-world pose. DA3 documents its input extrinsics as world-to-camera.
    """
    camera_to_world_arkit = arkit_column_major_to_matrix(values)
    world_to_camera_arkit = np.linalg.inv(camera_to_world_arkit)
    world_to_camera_opencv = ARKIT_CAMERA_TO_OPENCV @ world_to_camera_arkit
    return world_to_camera_opencv.astype(np.float32)


def validate_intrinsics(value: object) -> np.ndarray:
    matrix = np.asarray(value, dtype=np.float64)
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        raise ValueError("intrinsics must be a finite 3x3 matrix.")
    if matrix[0, 0] <= 0 or matrix[1, 1] <= 0 or abs(matrix[2, 2] - 1.0) > 1e-3:
        raise ValueError("intrinsics has invalid focal lengths or homogeneous scale.")
    return matrix.astype(np.float32)
