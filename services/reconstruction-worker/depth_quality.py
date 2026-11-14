from __future__ import annotations

from typing import Any

import numpy as np


def analyze_depth_predictions(depth: object, confidence: object | None = None) -> dict[str, Any]:
    """Summarize predicted depth validity without treating it as metric accuracy."""
    depth_array = np.asarray(depth, dtype=np.float32)
    if depth_array.ndim != 3 or depth_array.shape[0] < 1:
        raise ValueError("Depth predictions must have shape (frames, height, width).")
    if depth_array.shape[1] < 1 or depth_array.shape[2] < 1:
        raise ValueError("Depth predictions must have non-empty image dimensions.")

    valid = np.isfinite(depth_array) & (depth_array > 0)
    valid_values = depth_array[valid]
    frame_valid_fractions = valid.reshape(depth_array.shape[0], -1).mean(axis=1)
    warnings: list[str] = []

    if valid_values.size == 0:
        depth_percentiles = [None, None, None]
        warnings.append("No finite positive depth values were produced.")
    else:
        p5, p50, p95 = np.percentile(valid_values, [5, 50, 95]).tolist()
        depth_percentiles = [round(float(value), 5) for value in (p5, p50, p95)]

    low_valid_frames = int(np.count_nonzero(frame_valid_fractions < 0.5))
    if low_valid_frames:
        warnings.append(
            f"{low_valid_frames} frame(s) have valid positive depth for less than half their pixels."
        )

    confidence_median = None
    confidence_valid_fraction = None
    if confidence is not None:
        confidence_array = np.asarray(confidence, dtype=np.float32)
        if confidence_array.shape != depth_array.shape:
            warnings.append("Confidence map dimensions do not match the depth maps; confidence was not summarized.")
        else:
            confidence_valid = np.isfinite(confidence_array)
            confidence_values = confidence_array[confidence_valid]
            confidence_valid_fraction = round(float(confidence_valid.mean()), 4)
            if confidence_values.size:
                confidence_median = round(float(np.median(confidence_values)), 5)
            else:
                warnings.append("The confidence maps contain no finite values.")

    return {
        "frameCount": int(depth_array.shape[0]),
        "imageSize": [int(depth_array.shape[2]), int(depth_array.shape[1])],
        "validDepthFractionMedian": round(float(np.median(frame_valid_fractions)), 4),
        "lowValidDepthFrameCount": low_valid_frames,
        "depthPercentiles": depth_percentiles,
        "confidenceMedian": confidence_median,
        "confidenceValidFraction": confidence_valid_fraction,
        "warnings": warnings,
        "interpretation": "Prediction-health diagnostics only; these values do not establish metric accuracy or room coverage.",
    }
