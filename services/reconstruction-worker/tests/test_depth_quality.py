import unittest

import numpy as np

from depth_quality import analyze_depth_predictions


class DepthQualityTests(unittest.TestCase):
    def test_summarizes_valid_depth_and_confidence(self) -> None:
        depth = np.ones((3, 4, 5), dtype=np.float32)
        confidence = np.full((3, 4, 5), 0.8, dtype=np.float32)
        result = analyze_depth_predictions(depth, confidence)
        self.assertEqual(result["frameCount"], 3)
        self.assertEqual(result["imageSize"], [5, 4])
        self.assertEqual(result["validDepthFractionMedian"], 1.0)
        self.assertEqual(result["depthPercentiles"], [1.0, 1.0, 1.0])
        self.assertEqual(result["confidenceMedian"], 0.8)
        self.assertEqual(result["warnings"], [])

    def test_warns_when_depth_is_mostly_invalid(self) -> None:
        depth = np.full((2, 4, 4), np.nan, dtype=np.float32)
        depth[0, 0, 0] = 1.0
        result = analyze_depth_predictions(depth)
        self.assertEqual(result["lowValidDepthFrameCount"], 2)
        self.assertEqual(result["depthPercentiles"], [1.0, 1.0, 1.0])
        self.assertTrue(result["warnings"])

    def test_rejects_wrong_depth_shape(self) -> None:
        with self.assertRaises(ValueError):
            analyze_depth_predictions(np.ones((4, 4), dtype=np.float32))

    def test_ignores_mismatched_confidence_shape(self) -> None:
        result = analyze_depth_predictions(
            np.ones((2, 4, 4), dtype=np.float32),
            np.ones((1, 4, 4), dtype=np.float32),
        )
        self.assertIsNone(result["confidenceMedian"])
        self.assertTrue(any("dimensions do not match" in warning for warning in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
