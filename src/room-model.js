const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

const finiteOr = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function transformPoint(matrix, point) {
  const m = Array.isArray(matrix) && matrix.length === 16 ? matrix : IDENTITY_MATRIX;
  const x = finiteOr(point?.x);
  const y = finiteOr(point?.y);
  const z = finiteOr(point?.z);

  // ARKit serializes simd_float4x4 in column-major order.
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14]
  };
}

export function normalizeScanPayload(payload, capturedAt = new Date().toISOString()) {
  if (!payload || !Array.isArray(payload.planes)) {
    throw new TypeError("The native scanner returned an invalid plane list.");
  }

  const surfaces = payload.planes.flatMap((plane, index) => {
    const alignment = plane?.alignment;
    if (alignment !== "horizontal" && alignment !== "vertical") return [];

    const extent = plane.extent || {};
    const width = finiteOr(extent.x);
    const secondary = finiteOr(alignment === "horizontal" ? extent.z : extent.y);
    if (width < 0.05 || secondary < 0.05) return [];

    const transform = Array.isArray(plane.transform) && plane.transform.length === 16
      ? plane.transform.map(value => finiteOr(value))
      : [...IDENTITY_MATRIX];
    const localCenter = {
      x: finiteOr(plane.center?.x),
      y: finiteOr(plane.center?.y),
      z: finiteOr(plane.center?.z)
    };

    return [{
      id: String(plane.id || `surface-${index + 1}`),
      alignment,
      role: alignment === "horizontal" ? "floor" : "wall",
      width,
      depth: alignment === "horizontal" ? secondary : 0,
      height: alignment === "vertical" ? secondary : 0,
      center: transformPoint(transform, localCenter),
      transform,
      included: true,
      confirmed: false,
      area: width * secondary
    }];
  });

  return {
    schemaVersion: 1,
    source: "ARKit world tracking plane detection",
    units: "meters",
    capturedAt,
    tracking: String(payload.tracking || "unknown"),
    surfaces
  };
}

export function getConfirmedSurfaces(surfaces = []) {
  return surfaces.filter(surface =>
    surface.included === true &&
    surface.confirmed === true &&
    surface.role !== "ignore"
  );
}

export function createRoomModelExport(scan) {
  const surfaces = Array.isArray(scan?.surfaces) ? scan.surfaces : [];
  const serialize = surface => ({
    id: surface.id,
    alignment: surface.alignment,
    role: surface.role,
    dimensions: {
      width: surface.width,
      depth: surface.role === "floor" ? surface.depth : undefined,
      height: surface.role === "wall" ? surface.height : undefined
    },
    center: { ...surface.center },
    transform: [...surface.transform],
    included: surface.included,
    confirmed: surface.confirmed
  });

  return {
    schemaVersion: 1,
    source: "ARKit world tracking plane detection",
    deviceCapability: "Camera-based ARKit; no LiDAR or RoomPlan",
    units: "meters",
    capturedAt: scan?.capturedAt || new Date().toISOString(),
    tracking: scan?.tracking || "unknown",
    accuracyNote: "These are camera-based plane estimates, not a complete room reconstruction or a certified measurement. Confirm and correct every surface before relying on it.",
    observations: surfaces.map(serialize),
    model: {
      type: "confirmed-plane-shell",
      surfaces: getConfirmedSurfaces(surfaces).map(serialize)
    }
  };
}
