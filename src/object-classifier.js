const DEFAULTS = {
  voxelSize: 0.24,
  minimumPoints: 7,
  minimumVoxels: 4,
  maximumObjects: 30,
  maximumSpan: 3.2
};

const finitePoint = point =>
  Array.isArray(point) &&
  point.length >= 3 &&
  point.slice(0, 3).every(value => Number.isFinite(Number(value)));

const keyOf = (x, y, z) => x + "," + y + "," + z;

function classifyDimensions(width, depth, height) {
  const major = Math.max(width, depth);
  const minor = Math.min(width, depth);
  const ratio = major / Math.max(minor, 0.01);

  // These are broad furniture-size heuristics, not a trained object detector.
  if (height >= 0.22 && height <= 0.9 && major >= 1.45 && minor >= 0.72) {
    return { category: "Bed", confidence: 0.52 };
  }
  if (height >= 0.5 && height <= 1.25 && major >= 1.2 && major <= 3.0 &&
      minor >= 0.48 && minor <= 1.45 && ratio <= 3.8) {
    return { category: "Sofa", confidence: 0.48 };
  }
  if (height >= 0.62 && height <= 1.45 && major >= 0.28 &&
      major <= 0.95 && minor >= 0.25 && minor <= 0.9) {
    return { category: "Chair", confidence: 0.42 };
  }
  if (height >= 0.45 && height <= 1.15 && major >= 0.9 &&
      major <= 2.4 && minor >= 0.34 && minor <= 1.35 && ratio <= 3.4) {
    return { category: "Table", confidence: 0.46 };
  }
  if (height >= 0.85 && height <= 2.45 && major >= 0.32 &&
      major <= 1.8 && minor >= 0.22 && minor <= 1.15) {
    return { category: "Cabinet", confidence: 0.4 };
  }
  return { category: "Object", confidence: 0.25 };
}

/**
 * Finds compact connected groups in ARKit's sparse world-space feature points.
 * Bounding boxes are rough shape candidates. They are not surface reconstructions.
 */
export function classifyPointCloudObjects(points, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const voxelSize = Math.max(0.08, Number(settings.voxelSize) || DEFAULTS.voxelSize);
  const voxels = new Map();

  for (const point of Array.isArray(points) ? points : []) {
    if (!finitePoint(point)) continue;
    const x = Number(point[0]);
    const y = Number(point[1]);
    const z = Number(point[2]);
    const cell = [Math.floor(x / voxelSize), Math.floor(y / voxelSize), Math.floor(z / voxelSize)];
    const key = keyOf(...cell);
    let voxel = voxels.get(key);
    if (!voxel) {
      voxel = { cell, points: [] };
      voxels.set(key, voxel);
    }
    voxel.points.push([x, y, z]);
  }

  const visited = new Set();
  const candidates = [];
  const neighborOffsets = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x || y || z) neighborOffsets.push([x, y, z]);
      }
    }
  }

  for (const [startKey, startVoxel] of voxels) {
    if (visited.has(startKey)) continue;
    const queue = [startVoxel];
    visited.add(startKey);
    const cluster = [];
    let clusterVoxelCount = 0;

    while (queue.length) {
      const voxel = queue.pop();
      clusterVoxelCount += 1;
      cluster.push(...voxel.points);
      const [cx, cy, cz] = voxel.cell;
      for (const [dx, dy, dz] of neighborOffsets) {
        const neighborKey = keyOf(cx + dx, cy + dy, cz + dz);
        if (visited.has(neighborKey)) continue;
        const neighbor = voxels.get(neighborKey);
        if (neighbor) {
          visited.add(neighborKey);
          queue.push(neighbor);
        }
      }
    }

    if (cluster.length < settings.minimumPoints ||
        clusterVoxelCount < settings.minimumVoxels ||
        cluster.length > 1800) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of cluster) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    const size = max.map((value, axis) => value - min[axis]);
    const [width, height, depth] = [size[0], size[1], size[2]];
    if (size.some(span => span < 0.16 || span > settings.maximumSpan)) continue;
    const volume = width * height * depth;
    if (volume < 0.012 || volume > 5.5) continue;

    const classification = classifyDimensions(width, depth, height);
    candidates.push({
      id: "shape-" + candidates.length,
      category: classification.category,
      confidence: classification.confidence,
      pointCount: cluster.length,
      center: min.map((value, axis) => (value + max[axis]) / 2),
      dimensions: { width, height, depth },
      bounds: { min, max },
      source: "ARKit sparse feature-point cluster",
      reviewRequired: true
    });
  }

  return candidates
    .sort((a, b) => b.pointCount - a.pointCount)
    .slice(0, settings.maximumObjects)
    .map((candidate, index) => ({ ...candidate, id: "shape-" + (index + 1) }));
}
