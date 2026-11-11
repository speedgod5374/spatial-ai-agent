import test from "node:test";
import assert from "node:assert/strict";
import { buildCaptureArchive, createStoredZip } from "../src/scan-archive.js";

test("creates a ZIP archive with valid local and end-of-central-directory signatures", () => {
  const archive = createStoredZip([
    { name: "hello.txt", data: new TextEncoder().encode("hello") }
  ]);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(archive.length - 22, true), 0x06054b50);
  assert.ok(new TextDecoder().decode(archive).includes("hello.txt"));
});

test("capture bundle includes image files and strips base64 out of the manifest", async () => {
  const blob = buildCaptureArchive({
    source: "ARKit guided multi-view camera capture",
    captureMethod: "ARKit world-tracked keyframes",
    frames: [{
      id: "frame-001",
      filename: "frames/frame-001.jpg",
      imageBase64: "aGVsbG8=",
      timestamp: 12.5,
      cameraTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      intrinsics: [[500, 0, 480], [0, 500, 320], [0, 0, 1]],
      imageWidth: 960,
      imageHeight: 640
    }]
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.equal(blob.type, "application/zip");
  assert.ok(text.includes("capture.json"));
  assert.ok(text.includes("frames/frame-001.jpg"));
  assert.ok(text.includes('"cameraTransform"'));
  assert.ok(text.includes('"intrinsics"'));
  assert.ok(text.includes('"status": "not-generated"'));
  assert.ok(!text.includes("aGVsbG8="));
});

test("rejects missing capture frames", () => {
  assert.throws(() => buildCaptureArchive({ frames: [] }), /does not contain camera frames/i);
});

test("rejects unsafe ZIP entry paths", () => {
  assert.throws(
    () => createStoredZip([{ name: "../escape.txt", data: "no" }]),
    /safe relative filename/i
  );
});
