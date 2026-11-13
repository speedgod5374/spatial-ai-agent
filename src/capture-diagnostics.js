/**
 * Summarizes the ARKit camera trajectory from captured camera-to-world poses.
 * This describes where the phone moved, not which parts of the room were seen.
 */
export function analyzeCameraPath(frames = []) {
  const positions = (Array.isArray(frames) ? frames : []).map(frame => {
    const matrix = Array.isArray(frame?.cameraToWorldARKit)
      ? frame.cameraToWorldARKit
      : frame?.cameraTransform;
    if (!Array.isArray(matrix) || matrix.length !== 16) return null;
    const values = matrix.slice(12, 15).map(Number);
    if (!values.every(Number.isFinite)) return null;
    return { x: values[0], y: values[1], z: values[2] };
  });

  let pathLengthMeters = 0;
  let translationSteps = 0;
  let previous = null;
  const valid = positions.filter(Boolean);

  for (const position of positions) {
    if (!position) {
      previous = null;
      continue;
    }
    if (previous) {
      const dx = position.x - previous.x;
      const dy = position.y - previous.y;
      const dz = position.z - previous.z;
      const distance = Math.hypot(dx, dy, dz);
      pathLengthMeters += distance;
      if (distance >= 0.2) translationSteps += 1;
    }
    previous = position;
  }

  if (valid.length === 0) {
    return {
      validPoseCount: 0,
      pathLengthMeters: 0,
      horizontalSpanXMeters: 0,
      horizontalSpanZMeters: 0,
      maximumDistanceFromStartMeters: 0,
      translationSteps: 0
    };
  }

  const xs = valid.map(point => point.x);
  const zs = valid.map(point => point.z);
  const origin = valid[0];
  const maximumDistanceFromStartMeters = Math.max(
    0,
    ...valid.map(point => Math.hypot(
      point.x - origin.x,
      point.y - origin.y,
      point.z - origin.z
    ))
  );

  return {
    validPoseCount: valid.length,
    pathLengthMeters,
    horizontalSpanXMeters: Math.max(...xs) - Math.min(...xs),
    horizontalSpanZMeters: Math.max(...zs) - Math.min(...zs),
    maximumDistanceFromStartMeters,
    translationSteps
  };
}
