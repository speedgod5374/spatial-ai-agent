const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function transformDirection(matrix, point) {
  const m = Array.isArray(matrix) && matrix.length === 16 ? matrix : IDENTITY;
  return {
    x: m[0] * point.x + m[4] * point.y + m[8] * point.z,
    y: m[1] * point.x + m[5] * point.y + m[9] * point.z,
    z: m[2] * point.x + m[6] * point.y + m[10] * point.z
  };
}

/**
 * Returns the four corners of an ARKit plane patch in world coordinates.
 * These are used to estimate a room envelope; they are not a room mesh.
 */
export function getSurfaceWorldCorners(surface) {
  if (!surface || !surface.center || !Array.isArray(surface.transform)) return [];
  const horizontal = surface.alignment === "horizontal";
  const width = finite(surface.width);
  const secondary = finite(horizontal ? surface.depth : surface.height);
  if (width < 0.05 || secondary < 0.05) return [];

  const center = {
    x: finite(surface.center.x),
    y: finite(surface.center.y),
    z: finite(surface.center.z)
  };
  const corners = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      const local = horizontal
        ? { x: a * width / 2, y: 0, z: b * secondary / 2 }
        : { x: a * width / 2, y: b * secondary / 2, z: 0 };
      const offset = transformDirection(surface.transform, local);
      corners.push({
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z
      });
    }
  }
  return corners;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function rangeFrom(values, low = 0.05, high = 0.95) {
  const min = percentile(values, low);
  const max = percentile(values, high);
  return min === null || max === null ? null : { min, max, span: max - min };
}

function wallSegmentFrom(surface) {
  const corners = getSurfaceWorldCorners(surface);
  if (surface.alignment !== "vertical" || corners.length !== 4) return null;
  const projected = [];
  corners.forEach(point => {
    if (!projected.some(other => Math.hypot(other.x - point.x, other.z - point.z) < 0.02)) {
      projected.push({ x: point.x, z: point.z });
    }
  });
  if (projected.length < 2) return null;
  let farthest = null;
  let farthestDistance = 0;
  for (let i = 0; i < projected.length; i += 1) {
    for (let j = i + 1; j < projected.length; j += 1) {
      const distance = Math.hypot(projected[i].x - projected[j].x, projected[i].z - projected[j].z);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = [projected[i], projected[j]];
      }
    }
  }
  return farthestDistance > 0.2 ? { start: farthest[0], end: farthest[1] } : null;
}

/**
 * Builds an approximate bounding volume from observed plane patches.
 * Feature points are used only as a fallback for missing/degenerate axes.
 */
export function buildRoomEnvelope(scan) {
  const surfaces = (Array.isArray(scan?.surfaces) ? scan.surfaces : [])
    .filter(surface => surface && surface.included !== false && surface.role !== "ignore");
  const corners = surfaces.flatMap(getSurfaceWorldCorners);
  const points = (Array.isArray(scan?.pointCloud) ? scan.pointCloud : [])
    .filter(point => Array.isArray(point) && point.length >= 3 && point.slice(0, 3).every(value => Number.isFinite(Number(value))))
    .map(point => ({ x: Number(point[0]), y: Number(point[1]), z: Number(point[2]) }));

  const values = axis => corners.map(point => point[axis]);
  const pointValues = axis => points.map(point => point[axis]);
  let xRange = rangeFrom(values("x"), 0, 1);
  let zRange = rangeFrom(values("z"), 0, 1);
  let usedFeaturePointFallback = false;

  if (!xRange || xRange.span < 0.5) {
    xRange = rangeFrom(pointValues("x"));
    usedFeaturePointFallback = Boolean(xRange);
  }
  if (!zRange || zRange.span < 0.5) {
    zRange = rangeFrom(pointValues("z"));
    usedFeaturePointFallback = usedFeaturePointFallback || Boolean(zRange);
  }
  if (!xRange || !zRange || xRange.span < 0.5 || zRange.span < 0.5) return null;

  const planeY = rangeFrom(values("y"), 0, 1);
  const pointY = rangeFrom(pointValues("y"));
  const horizontalFloors = surfaces.filter(surface => surface.alignment === "horizontal");
  const floorYs = horizontalFloors.map(surface => finite(surface.center?.y)).sort((a, b) => a - b);
  const floorY = floorYs.length
    ? floorYs[Math.floor(floorYs.length / 2)]
    : planeY?.min ?? pointY?.min ?? 0;

  let height = planeY?.span || 0;
  let maxY = planeY?.max ?? floorY;
  let assumedHeight = false;
  if (height < 1.5 && pointY && pointY.span >= 1.5) {
    height = pointY.span;
    maxY = Math.max(floorY + height, pointY.max);
    usedFeaturePointFallback = true;
  }
  if (height < 1.5) {
    height = 2.4;
    maxY = floorY + height;
    assumedHeight = true;
  } else {
    height = Math.max(height, maxY - floorY);
    maxY = floorY + height;
  }

  const min = { x: xRange.min, y: floorY, z: zRange.min };
  const max = { x: xRange.max, y: maxY, z: zRange.max };
  const wallSegments = surfaces.map(wallSegmentFrom).filter(Boolean);
  return {
    min,
    max,
    width: xRange.span,
    depth: zRange.span,
    height,
    floorY,
    wallSegments,
    assumedHeight,
    usedFeaturePointFallback,
    source: corners.length ? "ARKit plane observations" : "ARKit feature-point fallback"
  };
}
