import unittest

import numpy as np

from scan_quality import analyze_camera_poses


def pose(x: float, y: float, z: float) -> list[float]:
    matrix = np.eye(4)
    matrix[:3, 3] = [x, y, z]
    return matrix.reshape(-1, order="F").tolist()


class ScanQualityTests(unittest.TestCase):
    def test_detects_turn_in_place_capture(self) -> None:
        result = analyze_camera_poses([pose(0, 0, 0)] * 8)
        self.assertEqual(result["poseCount"], 8)
        self.assertEqual(result["pathLengthMeters"], 0)
        self.assertTrue(any("turn-in-place" in warning for warning in result["warnings"]))

    def test_measures_translation_and_horizontal_spread(self) -> None:
        result = analyze_camera_poses([
            pose(0, 0, 0),
            pose(0.5, 0, 0),
            pose(0.5, 0, -0.7),
        ])
        self.assertAlmostEqual(result["pathLengthMeters"], 1.2, places=3)
        self.assertAlmostEqual(result["horizontalSpanXMeters"], 0.5, places=3)
        self.assertAlmostEqual(result["horizontalSpanZMeters"], 0.7, places=3)
        self.assertEqual(result["warnings"], [])

    def test_reports_large_gaps(self) -> None:
        result = analyze_camera_poses([pose(0, 0, 0), pose(1.5, 0, 0)])
        self.assertEqual(result["largeGapCount"], 1)
        self.assertTrue(any("exceed 1.2 m" in warning for warning in result["warnings"]))

    def test_rejects_malformed_pose(self) -> None:
        with self.assertRaises(ValueError):
            analyze_camera_poses([[0.0] * 15])


if __name__ == "__main__":
    unittest.main()
