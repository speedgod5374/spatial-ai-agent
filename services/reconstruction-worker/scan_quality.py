from __future__ import annotations

from typing import Any

import numpy as np


def analyze_camera_poses(camera_to_world_poses: list[list[float]]) -> dict[str, Any]:
    """Measure camera translation coverage; this is not a room-coverage score."""
    positions: list[np.ndarray] = []
    for index, values in enumerate(camera_to_world_poses):
        matrix_values = np.asarray(values, dtype=np.float64)
        if matrix_values.size != 16 or not np.isfinite(matrix_values).all():
            raise ValueError(f"Camera pose {index + 1} must contain 16 finite values.")
        matrix = matrix_values.reshape((4, 4), order="F")
        if not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-3):
            raise ValueError(f"Camera pose {index + 1} is not a homogeneous transform.")
        positions.append(matrix[:3, 3])

    if not positions:
        return {
            "poseCount": 0,
            "pathLengthMeters": 0.0,
            "horizontalSpanXMeters": 0.0,
            "horizontalSpanZMeters": 0.0,
            "verticalSpanMeters": 0.0,
            "medianStepMeters": 0.0,
            "duplicateStepCount": 0,
            "largeGapCount": 0,
            "warnings": ["No camera positions were supplied."],
        }

    points = np.stack(positions)
    steps = np.linalg.norm(np.diff(points, axis=0), axis=1)
    warnings: list[str] = []
    path_length = float(steps.sum())
    span_x = float(np.ptp(points[:, 0]))
    span_z = float(np.ptp(points[:, 2]))
    span_y = float(np.ptp(points[:, 1]))
    median_step = float(np.median(steps)) if len(steps) else 0.0
    duplicate_steps = int(np.count_nonzero(steps < 0.03))
    large_gaps = int(np.count_nonzero(steps > 1.2))

    if path_length < 0.5:
        warnings.append("Camera translation was very small; this may be mostly a turn-in-place capture.")
    if max(span_x, span_z) < 0.5:
        warnings.append("The camera path has little horizontal spread; multiple room sides may be missing.")
    if duplicate_steps:
        warnings.append(f"{duplicate_steps} consecutive camera pose pair(s) moved less than 3 cm.")
    if large_gaps:
        warnings.append(f"{large_gaps} camera movement gap(s) exceed 1.2 m; intermediate views may be missing.")

    return {
        "poseCount": len(points),
        "pathLengthMeters": round(path_length, 3),
        "horizontalSpanXMeters": round(span_x, 3),
        "horizontalSpanZMeters": round(span_z, 3),
        "verticalSpanMeters": round(span_y, 3),
        "medianStepMeters": round(median_step, 3),
        "duplicateStepCount": duplicate_steps,
        "largeGapCount": large_gaps,
        "warnings": warnings,
    }
