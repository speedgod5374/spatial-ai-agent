import test from "node:test";
import assert from "node:assert/strict";

import { analyzeCameraPath } from "./capture-diagnostics.js";

function pose(x, y = 0, z = 0) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1
  ];
}

test("measures camera translation from column-major ARKit poses", () => {
  const result = analyzeCameraPath([
    { cameraToWorldARKit: pose(0, 1, 0) },
    { cameraToWorldARKit: pose(0.25, 1, 0) },
    { cameraToWorldARKit: pose(0.25, 1, -0.5) }
  ]);

  assert.equal(result.validPoseCount, 3);
  assert.equal(result.translationSteps, 2);
  assert.equal(result.horizontalSpanXMeters, 0.25);
  assert.equal(result.horizontalSpanZMeters, 0.5);
  assert.equal(result.pathLengthMeters, 0.75);
  assert.equal(result.maximumDistanceFromStartMeters, Math.hypot(0.25, 0.5));
});

test("supports legacy cameraTransform pose field", () => {
  const result = analyzeCameraPath([{ cameraTransform: pose(1, 2, 3) }]);
  assert.equal(result.validPoseCount, 1);
  assert.equal(result.pathLengthMeters, 0);
});

test("does not connect path segments across invalid poses", () => {
  const result = analyzeCameraPath([
    { cameraToWorldARKit: pose(0) },
    { cameraToWorldARKit: [1, 2] },
    { cameraToWorldARKit: pose(1) }
  ]);

  assert.equal(result.validPoseCount, 2);
  assert.equal(result.pathLengthMeters, 0);
  assert.equal(result.translationSteps, 0);
});

test("returns zero metrics when no valid poses exist", () => {
  assert.deepEqual(analyzeCameraPath([]), {
    validPoseCount: 0,
    pathLengthMeters: 0,
    horizontalSpanXMeters: 0,
    horizontalSpanZMeters: 0,
    maximumDistanceFromStartMeters: 0,
    translationSteps: 0
  });
});
