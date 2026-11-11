const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function write32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function joinBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Builds a standards-compliant ZIP archive with "store" compression.
 * Keeping JPEGs uncompressed avoids wasting CPU and does not change image quality.
 */
export function createStoredZip(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("A ZIP archive needs at least one file.");
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const pathParts = typeof file?.name === "string" ? file.name.split("/") : [];
    if (!file || typeof file.name !== "string" || !file.name || file.name.startsWith("/") ||
        file.name.includes("\\") || pathParts.some(part => !part || part === "..")) {
      throw new TypeError("Every ZIP entry needs a safe relative filename.");
    }
    const nameBytes = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data ?? ""));
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0);
    write32(localView, 14, checksum);
    write32(localView, 18, data.length);
    write32(localView, 22, data.length);
    write16(localView, 26, nameBytes.length);
    write16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0);
    write32(centralView, 16, checksum);
    write32(centralView, 20, data.length);
    write32(centralView, 24, data.length);
    write16(centralView, 28, nameBytes.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
  }

  const centralDirectory = joinBytes(centralParts);
  const localFileData = joinBytes(localParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralDirectory.length);
  write32(endView, 16, localFileData.length);
  write16(endView, 20, 0);

  return joinBytes([localFileData, centralDirectory, end]);
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value) {
    throw new TypeError("A captured frame is missing its JPEG image data.");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Packages camera frames and calibration into a dataset ready for a 3D pipeline.
 * This does not run reconstruction; it preserves the inputs needed by that stage.
 */
export function buildCaptureArchive(scan) {
  const frames = Array.isArray(scan?.frames) ? scan.frames : [];
  if (frames.length < 1) {
    throw new TypeError("This scan does not contain camera frames to export.");
  }

  const manifest = {
    schemaVersion: 1,
    format: "spatial-studio-multiview-capture",
    captureMethod: scan.captureMethod || "ARKit world-tracked keyframes",
    source: scan.source || "ARKit guided multi-view camera capture",
    units: "meters",
    imageOrientation: "sensor-native",
    cameraCoordinateSystem: "ARKit camera-to-world, column-major 4x4; +X right, +Y up, -Z forward",
    reconstructionExtrinsicsConvention: "OpenCV world-to-camera 4x4; derive by converting ARKit camera axes before inversion",
    frameCount: frames.length,
    frames: frames.map(({ imageBase64, ...metadata }) => metadata),
    planeHints: Array.isArray(scan.rawPlanes) ? scan.rawPlanes : [],
    directionBuckets: Array.isArray(scan.directionBuckets)
      ? scan.directionBuckets
      : (Array.isArray(scan.captureQuality?.directionBuckets) ? scan.captureQuality.directionBuckets : []),
    captureQuality: scan.captureQuality || null,
    reconstruction: {
      status: "not-generated",
      note: "This archive contains camera images, camera poses, intrinsics, and optional ARKit plane hints. A server-side multi-view reconstruction step is still required to generate a room mesh."
    }
  };

  const files = [{
    name: "capture.json",
    data: encoder.encode(JSON.stringify(manifest, null, 2))
  }];

  frames.forEach((frame, index) => {
    const fallbackName = `frames/frame-${String(index + 1).padStart(3, "0")}.jpg`;
    const filename = typeof frame.filename === "string" && frame.filename.startsWith("frames/")
      ? frame.filename
      : fallbackName;
    files.push({ name: filename, data: decodeBase64(frame.imageBase64) });
  });

  return new Blob([createStoredZip(files)], { type: "application/zip" });
}
