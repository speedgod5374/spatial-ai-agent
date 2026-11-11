import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScanPayload, transformPoint } from "./room-model.js";

test("normalizes capture quality and unique horizontal direction buckets", () => {
  const scan = normalizeScanPayload({
    planes: [],
    frames: [{ imageBase64: "aGVsbG8=", viewDirectionBucket: 2 }],
    directionBuckets: [0, 2, 2, 8, -1, "3"],
    captureQuality: {
      method: "sampled-luma-and-local-gradient",
      darkFramesSkipped: 3,
      lowDetailFramesCaptured: 1,
      directionBuckets: [0, 2, 2, 8],
      note: "Capture guidance only."
    }
  });

  assert.equal(scan.frameCount, 1);
  assert.deepEqual(scan.directionBuckets, [0, 2, 3]);
  assert.equal(scan.captureQuality.darkFramesSkipped, 3);
  assert.equal(scan.captureQuality.lowDetailFramesCaptured, 1);
  assert.equal(scan.captureQuality.method, "sampled-luma-and-local-gradient");
});

test("keeps older scan payloads compatible when quality fields are absent", () => {
  const scan = normalizeScanPayload({ planes: [], frames: [] });

  assert.deepEqual(scan.directionBuckets, []);
  assert.equal(scan.captureQuality, null);
});

test("transforms ARKit local points using column-major matrices", () => {
  const result = transformPoint(
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1],
    { x: 1, y: 2, z: 3 }
  );

  assert.deepEqual(result, { x: 3, y: 5, z: 7 });
});
