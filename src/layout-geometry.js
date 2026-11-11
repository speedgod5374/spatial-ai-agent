const EPSILON = 1e-6;

export function getFurnitureFootprint(item) {
  const angle = Number(item.rotation) || 0;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const width = Math.max(0, Number(item.w) || 0);
  const depth = Math.max(0, Number(item.d) || 0);
  return {
    width: width * cosine + depth * sine,
    depth: depth * cosine + width * sine
  };
}

export function clampFurniturePosition(item, x, z, room) {
  const footprint = getFurnitureFootprint(item);
  const halfWidth = footprint.width / 2;
  const halfDepth = footprint.depth / 2;
  if (footprint.width > room.width || footprint.depth > room.length) return null;
  return {
    x: Math.max(-room.width / 2 + halfWidth, Math.min(room.width / 2 - halfWidth, x)),
    z: Math.max(-room.length / 2 + halfDepth, Math.min(room.length / 2 - halfDepth, z))
  };
}

export function furnitureOverlaps(item, position, others, gap = 0.06) {
  const footprint = getFurnitureFootprint(item);
  return others.some(other => {
    if (other.id === item.id) return false;
    const otherFootprint = getFurnitureFootprint(other);
    const dx = Math.abs(position.x - other.x);
    const dz = Math.abs(position.z - other.z);
    return dx < (footprint.width + otherFootprint.width) / 2 + gap - EPSILON
      && dz < (footprint.depth + otherFootprint.depth) / 2 + gap - EPSILON;
  });
}

export function findFurniturePlacement(item, room, others, preferred = { x: 0, z: 0 }, step = 0.2) {
  const start = clampFurniturePosition(item, preferred.x, preferred.z, room);
  if (!start) return null;
  if (!furnitureOverlaps(item, start, others)) return start;

  const maxRadius = Math.ceil(Math.max(room.width, room.length) / step);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    const candidates = [];
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
        candidates.push({ x: start.x + x * step, z: start.z + z * step });
      }
    }
    candidates.sort((a, b) =>
      Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z)
    );
    for (const candidate of candidates) {
      const clamped = clampFurniturePosition(item, candidate.x, candidate.z, room);
      if (clamped && !furnitureOverlaps(item, clamped, others)) return clamped;
    }
  }
  return null;
}
