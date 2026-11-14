import test from "node:test";
import assert from "node:assert/strict";

import { buildRoomEnvelope, getSurfaceWorldCorners } from "./room-visualization.js";

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

test("converts a horizontal ARKit floor patch into world-space corners", () => {
  const corners = getSurfaceWorldCorners({
    alignment: "horizontal",
    width: 4,
    depth: 5,
    center: { x: 0, y: 0, z: 0 },
    transform: identity
  });
  assert.equal(corners.length, 4);
  assert.deepEqual(
    corners.map(point => [point.x, point.y, point.z]).sort((a, b) => a[0] - b[0] || a[2] - b[2]),
    [[-2, 0, -2.5], [-2, 0, 2.5], [2, 0, -2.5], [2, 0, 2.5]]
  );
});

test("builds one room envelope from floor and vertical wall observations", () => {
  const scan = {
    surfaces: [
      {
        alignment: "horizontal", role: "floor", included: true,
        width: 4, depth: 5, center: { x: 0, y: 0, z: 0 }, transform: identity
      },
      {
        alignment: "vertical", role: "wall", included: true,
        width: 4, height: 2.6, center: { x: 0, y: 1.3, z: -2.5 }, transform: identity
      }
    ],
    pointCloud: []
  };
  const room = buildRoomEnvelope(scan);
  assert.ok(room);
  assert.equal(room.width, 4);
  assert.equal(room.depth, 5);
  assert.equal(room.height, 2.6);
  assert.equal(room.assumedHeight, false);
  assert.equal(room.wallSegments.length, 1);
});

test("uses sparse feature points only when plane observations cannot establish a footprint", () => {
  const scan = {
    surfaces: [{
      alignment: "vertical", role: "wall", included: true,
      width: 3, height: 2, center: { x: 0, y: 1, z: 0 }, transform: identity
    }],
    pointCloud: [
      [-2, 0, -2], [2, 0, -2], [-2, 0, 2], [2, 0, 2],
      [-2, 2, -2], [2, 2, -2], [-2, 2, 2], [2, 2, 2]
    ]
  };
  const room = buildRoomEnvelope(scan);
  assert.ok(room);
  assert.equal(room.usedFeaturePointFallback, true);
  assert.ok(Math.abs(room.width - 3) < 0.001);
  assert.ok(Math.abs(room.depth - 4) < 0.001);
});

test("returns no envelope when scan data cannot establish a two-dimensional footprint", () => {
  const room = buildRoomEnvelope({
    surfaces: [{
      alignment: "vertical", role: "wall", included: true,
      width: 3, height: 2, center: { x: 0, y: 1, z: 0 }, transform: identity
    }],
    pointCloud: []
  });
  assert.equal(room, null);
});

test("uses a clearly marked illustrative height for a floor-only scan", () => {
  const room = buildRoomEnvelope({
    surfaces: [{
      alignment: "horizontal", role: "floor", included: true,
      width: 4, depth: 5, center: { x: 0, y: 0, z: 0 }, transform: identity
    }],
    pointCloud: []
  });
  assert.equal(room.assumedHeight, true);
  assert.equal(room.height, 2.4);
});
