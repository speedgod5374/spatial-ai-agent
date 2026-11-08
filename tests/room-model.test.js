import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoomModelExport,
  getConfirmedSurfaces,
  normalizeScanPayload,
  transformPoint
} from "../src/room-model.js";

const translatedMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  4, 1.5, -2, 1
];

test("transforms an ARKit local center into world coordinates", () => {
  assert.deepEqual(
    transformPoint(translatedMatrix, { x: 1, y: 0.5, z: 2 }),
    { x: 5, y: 2, z: 0 }
  );
});

test("normalizes horizontal planes as floor candidates", () => {
  const scan = normalizeScanPayload({
    tracking: "normal",
    planes: [{
      id: "floor-1",
      alignment: "horizontal",
      extent: { x: 4.2, y: 0, z: 3.1 },
      center: { x: 0, y: 0, z: 0 },
      transform: translatedMatrix
    }]
  }, "2026-11-08T09:00:00.000Z");

  assert.equal(scan.surfaces.length, 1);
  assert.equal(scan.surfaces[0].role, "floor");
  assert.equal(scan.surfaces[0].width, 4.2);
  assert.equal(scan.surfaces[0].depth, 3.1);
  assert.deepEqual(scan.surfaces[0].center, { x: 4, y: 1.5, z: -2 });
  assert.equal(scan.surfaces[0].confirmed, false);
});

test("normalizes vertical planes as wall candidates", () => {
  const scan = normalizeScanPayload({
    planes: [{
      id: "wall-1",
      alignment: "vertical",
      extent: { x: 3.4, y: 2.5, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      transform: translatedMatrix
    }]
  });

  assert.equal(scan.surfaces[0].role, "wall");
  assert.equal(scan.surfaces[0].width, 3.4);
  assert.equal(scan.surfaces[0].height, 2.5);
});

test("ignores unknown alignments and unusable plane extents", () => {
  const scan = normalizeScanPayload({
    planes: [
      { alignment: "unknown", extent: { x: 2, y: 2, z: 2 } },
      { alignment: "horizontal", extent: { x: 0, y: 0, z: 0 } }
    ]
  });
  assert.deepEqual(scan.surfaces, []);
});

test("exports only included and user-confirmed surfaces into the model", () => {
  const surfaces = [
    { id: "a", role: "floor", alignment: "horizontal", width: 4, depth: 3, center: { x: 0, y: 0, z: 0 }, transform: translatedMatrix, included: true, confirmed: true },
    { id: "b", role: "wall", alignment: "vertical", width: 3, height: 2.5, center: { x: 0, y: 1, z: 0 }, transform: translatedMatrix, included: true, confirmed: false },
    { id: "c", role: "ignore", alignment: "vertical", width: 2, height: 2, center: { x: 0, y: 0, z: 0 }, transform: translatedMatrix, included: true, confirmed: true },
    { id: "d", role: "wall", alignment: "vertical", width: 2, height: 2, center: { x: 0, y: 0, z: 0 }, transform: translatedMatrix, included: false, confirmed: true }
  ];

  assert.deepEqual(getConfirmedSurfaces(surfaces).map(surface => surface.id), ["a"]);
  const exported = createRoomModelExport({ surfaces, capturedAt: "2026-11-08T09:00:00.000Z" });
  assert.equal(exported.observations.length, 4);
  assert.deepEqual(exported.model.surfaces.map(surface => surface.id), ["a"]);
  assert.match(exported.accuracyNote, /not a complete room reconstruction/i);
});
