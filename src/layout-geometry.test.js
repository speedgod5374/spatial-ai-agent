import test from "node:test";
import assert from "node:assert/strict";

import {
  clampFurniturePosition,
  findFurniturePlacement,
  furnitureOverlaps,
  getFurnitureFootprint
} from "./layout-geometry.js";

const room = { width: 4, length: 5 };
const sofa = { id: "sofa", w: 2, d: 1, rotation: 0, x: 0, z: 0 };

test("rotated furniture footprint accounts for its actual orientation", () => {
  const footprint = getFurnitureFootprint({ w: 2, d: 1, rotation: Math.PI / 2 });
  assert.ok(Math.abs(footprint.width - 1) < 1e-9);
  assert.ok(Math.abs(footprint.depth - 2) < 1e-9);
});

test("clamps rotated furniture inside room boundaries", () => {
  const rotated = { ...sofa, rotation: Math.PI / 2 };
  const position = clampFurniturePosition(rotated, 99, -99, room);
  assert.ok(Math.abs(position.x) <= 1.5 + 1e-9);
  assert.ok(Math.abs(position.z) <= 1.5 + 1e-9);
});

test("detects overlap and allows a small clearance", () => {
  const chair = { id: "chair", w: 0.8, d: 0.8, rotation: 0, x: 0.5, z: 0 };
  assert.equal(furnitureOverlaps(chair, { x: 0.5, z: 0 }, [sofa]), true);
  assert.equal(furnitureOverlaps(chair, { x: 1.55, z: 0 }, [sofa]), false);
});

test("finds the nearest available position when the preferred position is occupied", () => {
  const chair = { id: "chair", w: 0.8, d: 0.8, rotation: 0 };
  const position = findFurniturePlacement(chair, room, [sofa], { x: 0, z: 0 });
  assert.ok(position);
  assert.equal(furnitureOverlaps(chair, position, [sofa]), false);
});

test("returns null when no non-overlapping placement exists", () => {
  const huge = { id: "huge", w: 10, d: 10, rotation: 0 };
  assert.equal(findFurniturePlacement(huge, room, []), null);
});
