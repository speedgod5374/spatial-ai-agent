import unittest

import numpy as np

from geometry import (
    arkit_camera_to_world_to_opencv_world_to_camera,
    arkit_column_major_to_matrix,
    validate_intrinsics,
)


def flatten_column_major(matrix: np.ndarray) -> list[float]:
    return matrix.reshape(-1, order="F").tolist()


class CameraGeometryTests(unittest.TestCase):
    def test_identity_pose_converts_to_opencv_camera_axes(self) -> None:
        result = arkit_camera_to_world_to_opencv_world_to_camera(
            flatten_column_major(np.eye(4))
        )
        np.testing.assert_allclose(
            result,
            np.diag([1.0, -1.0, -1.0, 1.0]),
            atol=1e-6,
        )

    def test_translated_pose_is_inverted(self) -> None:
        camera_to_world = np.eye(4)
        camera_to_world[:3, 3] = [1.0, 2.0, 3.0]
        result = arkit_camera_to_world_to_opencv_world_to_camera(
            flatten_column_major(camera_to_world)
        )
        expected = np.diag([1.0, -1.0, -1.0, 1.0]) @ np.linalg.inv(camera_to_world)
        np.testing.assert_allclose(result, expected, atol=1e-6)

    def test_rejects_invalid_pose(self) -> None:
        with self.assertRaises(ValueError):
            arkit_column_major_to_matrix([0.0] * 15)

    def test_validates_intrinsics(self) -> None:
        matrix = validate_intrinsics([[500, 0, 480], [0, 500, 320], [0, 0, 1]])
        self.assertEqual(matrix.shape, (3, 3))
        with self.assertRaises(ValueError):
            validate_intrinsics([[1, 0], [0, 1]])


if __name__ == "__main__":
    unittest.main()
