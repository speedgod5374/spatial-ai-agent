import test from "node:test";
import assert from "node:assert/strict";
import { classifyPointCloudObjects } from "./object-classifier.js";

function boxPoints(width, height, depth, origin = [0, 0, 0], step = 0.1) {
  const points = [];
  for (let x = 0; x <= width + 1e-6; x += step) {
    for (let y = 0; y <= height + 1e-6; y += step) {
      for (let z = 0; z <= depth + 1e-6; z += step) {
        points.push([origin[0] + x, origin[1] + y, origin[2] + z]);
      }
    }
  }
  return points;
}

test("clusters a compact point group and suggests a table from its dimensions", () => {
  const points = boxPoints(1.0, 0.75, 0.6);
  const result = classifyPointCloudObjects(points, {
    voxelSize: 0.2,
    minimumPoints: 6,
    minimumVoxels: 4
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].category, "Table");
  assert.ok(result[0].dimensions.width > 0.9);
  assert.equal(result[0].reviewRequired, true);
});

test("suggests a chair for a compact upright shape", () => {
  const result = classifyPointCloudObjects(boxPoints(0.7, 0.9, 0.7), {
    voxelSize: 0.2,
    minimumPoints: 6
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].category, "Chair");
});

test("does not create candidates from too few points or a room-sized plane", () => {
  const sparse = [[0, 0, 0], [0.1, 0.1, 0.1], [0.2, 0.2, 0.2]];
  const wallLike = boxPoints(4.0, 2.4, 0.08, [0, 0, 0], 0.1);
  const result = classifyPointCloudObjects([...sparse, ...wallLike], {
    voxelSize: 0.2,
    minimumPoints: 6
  });

  assert.equal(result.length, 0);
});

test("returns separate candidate clusters and finite world-space bounds", () => {
  const points = [
    ...boxPoints(1.0, 0.75, 0.6, [0, 0, 0]),
    ...boxPoints(0.7, 0.9, 0.7, [3, 0, 0])
  ];
  const result = classifyPointCloudObjects(points, {
    voxelSize: 0.2,
    minimumPoints: 6
  });

  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map(item => item.category)), new Set(["Table", "Chair"]));
  for (const item of result) {
    assert.ok(item.bounds.min.every(Number.isFinite));
    assert.ok(item.bounds.max.every(Number.isFinite));
    assert.ok(item.pointCount >= 6);
  }
});
