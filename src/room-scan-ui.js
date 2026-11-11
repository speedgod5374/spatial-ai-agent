import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createRoomModelExport, getConfirmedSurfaces, normalizeScanPayload } from "./room-model.js";
import { buildCaptureArchive } from "./scan-archive.js";
import { isNativeARKitAvailable, scanRoomWithARKit } from "./native-scanner.js";

const originalScanButton = document.getElementById("scan-button");
if (originalScanButton) {
  // Remove the old getUserMedia click handler. A browser camera preview is not an ARKit scan.
  const nativeScanButton = originalScanButton.cloneNode(true);
  originalScanButton.replaceWith(nativeScanButton);
  nativeScanButton.addEventListener("click", startScan);
}

const viewer = document.getElementById("tab-viewer");
if (!viewer) throw new Error("Spatial Studio viewer is unavailable.");

const panel = document.createElement("section");
panel.id = "room-scan-workspace";
panel.className = "material-card col-span-full p-4 space-y-4";
panel.innerHTML = `
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="text-[11px] uppercase tracking-wider font-semibold text-[#477151]">Room capture · camera-based 3D</div>
      <h2 class="text-base font-semibold mt-1">Guided multi-view room capture</h2>
      <p class="text-xs text-[#5f6368] leading-relaxed mt-1 max-w-2xl">The iPhone records overlapping camera views with ARKit camera positions and calibration. This creates the input for 3D reconstruction; the image capture itself is not yet a finished room mesh.</p>
    </div>
    <span id="scan-availability" class="text-[10px] rounded-full px-3 py-1.5 bg-[#f1f3f4] text-[#5f6368]">Checking device…</span>
  </div>
  <div class="grid sm:grid-cols-[1fr_auto] gap-3 items-center rounded-xl bg-[#f7f8f6] border border-[#e8ece7] p-3">
    <div class="text-xs text-[#5f6368] leading-relaxed">
      <strong class="text-[#344139]">Scan guidance:</strong> start near the doorway, then slowly walk around the room. Sweep across every wall, include the floor and ceiling, and revisit areas from another angle. Good lighting and visible room details help tracking.
      <div class="mt-1 text-[10px] text-[#89938b]">Privacy: selected still frames stay on-device and are not uploaded automatically.</div>
    </div>
    <button id="scan-start" type="button" class="bg-[#214b39] text-white text-xs font-semibold rounded-lg px-4 py-3 min-h-[44px] whitespace-nowrap">Start room scan</button>
  </div>
  <p id="scan-status" class="text-xs text-[#5f6368]" role="status" aria-live="polite">Checking native scanner availability…</p>
  <div id="scan-review" class="hidden space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold">Review captured viewpoints</h3>
        <p id="scan-summary" class="text-[11px] text-[#7a857d] mt-1"></p>
      </div>
      <button id="scan-fit-view" type="button" class="border border-[#dce3dc] bg-white rounded-lg px-3 py-2 text-[11px] text-[#526257]">Fit model</button>
    </div>
    <div class="rounded-xl border border-[#e5eae3] bg-white p-3 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-[10px] uppercase tracking-wider font-semibold text-[#7d897f]">Camera keyframes</div>
          <p id="scan-capture-summary" class="text-[11px] text-[#647067] mt-1">No views captured yet.</p>
        </div>
        <button id="scan-export-capture" type="button" disabled class="bg-[#214b39] disabled:opacity-40 text-white text-xs font-semibold rounded-lg px-4 py-3 min-h-[44px]">Export capture bundle (.zip)</button>
      </div>
      <div id="scan-frame-strip" class="flex gap-2 overflow-x-auto py-1"></div>
      <p id="scan-capture-export-status" class="text-[10px] text-[#7d897f]">The bundle contains JPEG views, camera poses, and calibration for reconstruction.</p>
    </div>
    <details id="scan-plane-details" class="hidden rounded-xl border border-[#e5eae3] bg-[#fbfcfa] p-3">
      <summary class="cursor-pointer text-xs font-semibold text-[#526257]">Optional ARKit plane hints (not a 3D room reconstruction)</summary>
    <div class="mt-3 rounded-xl border border-[#e5eae3] bg-[#f7f8f5] overflow-hidden">
      <div class="px-3 py-2 border-b border-[#e5eae3] flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-wider font-semibold text-[#7d897f]">ARKit plane patches · approximate geometry</span>
        <span class="text-[10px] text-[#89938b]">Drag to orbit · pinch/scroll to zoom</span>
      </div>
      <canvas id="scan-model-canvas" class="block w-full h-[300px]"></canvas>
      <div class="px-3 py-2 border-t border-[#e5eae3] text-[10px] text-[#7f8a81]">Green = confirmed · Amber = not yet confirmed · Only confirmed surfaces are included in the exported model.</div>
    </div>
    <div id="scan-surfaces" class="space-y-2 mt-3"></div>
    </details>
    <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
      <p id="scan-export-status" class="text-[10px] text-[#7d897f]">Optional geometry hints only. These are not a complete room model.</p>
      <button id="scan-export" type="button" disabled class="bg-[#214b39] disabled:opacity-40 text-white text-xs font-semibold rounded-lg px-4 py-3 min-h-[44px]">Export confirmed plane hints (.json)</button>
    </div>
  </div>
`;
viewer.prepend(panel);

const status = panel.querySelector("#scan-status");
const availabilityBadge = panel.querySelector("#scan-availability");
const review = panel.querySelector("#scan-review");
const surfaceList = panel.querySelector("#scan-surfaces");
const exportButton = panel.querySelector("#scan-export");
const exportStatus = panel.querySelector("#scan-export-status");
const captureExportButton = panel.querySelector("#scan-export-capture");
const captureExportStatus = panel.querySelector("#scan-capture-export-status");
const captureSummary = panel.querySelector("#scan-capture-summary");
const frameStrip = panel.querySelector("#scan-frame-strip");
const planeDetails = panel.querySelector("#scan-plane-details");
const startButton = panel.querySelector("#scan-start");
const scanButton = document.getElementById("scan-button");

let scan = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let modelGroup = null;
let animationStarted = false;
let resizeObserver = null;

function setStatus(message) {
  status.textContent = message;
}

function createNumberField(labelText, value, onChange, min = 0.1, max = 30) {
  const label = document.createElement("label");
  label.className = "block text-[10px] text-[#7c877f]";
  const title = document.createElement("span");
  title.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "0.01";
  input.value = Number(value).toFixed(2);
  input.className = "mt-1 w-full border rounded-lg p-2 text-xs text-[#344139] bg-white";
  input.addEventListener("change", () => {
    const next = Number(input.value);
    if (!Number.isFinite(next) || next < min || next > max) {
      input.value = Number(value).toFixed(2);
      setStatus(`Enter a value between ${min} and ${max} meters for ${labelText.toLowerCase()}.`);
      return;
    }
    onChange(next);
  });
  label.append(title, input);
  return label;
}

function createCheckbox(labelText, checked, onChange) {
  const label = document.createElement("label");
  label.className = "inline-flex items-center gap-2 text-[11px] text-[#56635a]";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  return label;
}

function renderSurfaceList() {
  if (!scan) return;
  surfaceList.replaceChildren();

  scan.surfaces.forEach((surface, index) => {
    const card = document.createElement("article");
    card.className = "rounded-xl border border-[#e5eae3] bg-white p-3 space-y-3";

    const header = document.createElement("div");
    header.className = "flex flex-wrap items-center justify-between gap-2";
    const title = document.createElement("div");
    title.className = "text-xs font-semibold text-[#344139]";
    title.textContent = `${surface.alignment === "horizontal" ? "Horizontal surface" : "Vertical surface"} ${index + 1}`;

    const role = document.createElement("select");
    role.className = "border border-[#dfe5de] rounded-lg bg-white px-2 py-2 text-[11px] text-[#435147]";
    const options = surface.alignment === "horizontal"
      ? [["floor", "Floor candidate"], ["ignore", "Ignore surface"]]
      : [["wall", "Wall candidate"], ["ignore", "Ignore surface"]];
    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      role.append(option);
    });
    role.value = surface.role;
    role.addEventListener("change", () => {
      surface.role = role.value;
      updateModel();
    });
    header.append(title, role);

    const dimensions = document.createElement("div");
    dimensions.className = "grid grid-cols-2 sm:grid-cols-3 gap-2";
    dimensions.append(
      createNumberField("Width (m)", surface.width, value => { surface.width = value; updateModel(); }),
      surface.alignment === "horizontal"
        ? createNumberField("Depth (m)", surface.depth, value => { surface.depth = value; updateModel(); })
        : createNumberField("Height (m)", surface.height, value => { surface.height = value; updateModel(); })
    );

    const centerTitle = document.createElement("div");
    centerTitle.className = "text-[10px] uppercase tracking-wider text-[#8a948c] font-semibold";
    centerTitle.textContent = "Surface center · world coordinates (m)";
    const centerFields = document.createElement("div");
    centerFields.className = "grid grid-cols-3 gap-2";
    centerFields.append(
      createNumberField("X", surface.center.x, value => { surface.center.x = value; updateModel(); }, -30, 30),
      createNumberField("Y", surface.center.y, value => { surface.center.y = value; updateModel(); }, -30, 30),
      createNumberField("Z", surface.center.z, value => { surface.center.z = value; updateModel(); }, -30, 30)
    );

    const checks = document.createElement("div");
    checks.className = "flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#eef1ed] pt-2";
    checks.append(
      createCheckbox("Show in preview", surface.included, value => { surface.included = value; updateModel(); }),
      createCheckbox("I reviewed this surface", surface.confirmed, value => {
        surface.confirmed = value;
        updateModel();
        renderSurfaceList();
      })
    );

    const note = document.createElement("p");
    note.className = "text-[10px] leading-relaxed text-[#929b93]";
    note.textContent = "ARKit detected a flat patch, not a guaranteed full wall or floor. Adjust its size and center to match the room. Confirm only after checking it visually.";

    card.append(header, dimensions, centerTitle, centerFields, checks, note);
    surfaceList.append(card);
  });

  updateExportState();
}

function updateExportState() {
  const confirmed = scan ? getConfirmedSurfaces(scan.surfaces) : [];
  const frameCount = scan?.frames?.length || 0;
  exportButton.disabled = confirmed.length === 0;
  captureExportButton.disabled = frameCount < 1;
  exportStatus.textContent = confirmed.length
    ? `${confirmed.length} confirmed surface${confirmed.length === 1 ? "" : "s"} will be exported as editable plane hints.`
    : "No confirmed plane hints yet. The capture bundle is the important reconstruction input.";
  captureExportStatus.textContent = frameCount
    ? `${frameCount} camera views with ARKit poses and intrinsics are ready. A reconstruction server still needs to process this bundle.`
    : "The bundle contains JPEG views, camera poses, and calibration for reconstruction.";
}

function renderCapturedFrames() {
  frameStrip.replaceChildren();
  const frames = scan?.frames || [];
  const darkSkipped = scan?.captureQuality?.darkFramesSkipped || 0;
  const lowDetail = scan?.captureQuality?.lowDetailFramesCaptured || 0;
  const directionSummary = scan?.captureQuality
    ? `${scan.directionBuckets.length}/8 horizontal directions sampled`
    : "direction metrics unavailable";
  captureSummary.textContent = frames.length
    ? `${frames.length} viewpoints · ${directionSummary} · ${darkSkipped} dark views skipped · ${lowDetail} low-detail views flagged.`
    : "No camera views were returned by the scanner.";
  frames.slice(0, 12).forEach((frame, index) => {
    if (!frame.imageBase64) return;
    const card = document.createElement("div");
    card.className = "w-28 shrink-0 space-y-1";
    const image = document.createElement("img");
    image.src = `data:image/jpeg;base64,${frame.imageBase64}`;
    image.alt = `Captured room viewpoint ${index + 1}`;
    image.loading = "lazy";
    image.className = "h-20 w-28 rounded-lg object-cover border border-[#e5eae3] bg-[#f1f3ef]";
    const caption = document.createElement("p");
    caption.className = frame.quality?.lowDetail
      ? "text-[10px] text-[#9a743c] font-medium"
      : "text-[10px] text-[#7d897f]";
    caption.textContent = frame.quality?.lowDetail ? `View ${index + 1} · Low detail` : `View ${index + 1}`;
    if (frame.quality) {
      image.title = `Sampled brightness: ${Math.round(frame.quality.meanLuma)} · Local detail score: ${Number(frame.quality.textureScore).toFixed(1)}`;
    }
    card.append(image, caption);
    frameStrip.append(card);
  });
}

function initializeRenderer() {
  if (renderer) return;
  const canvas = panel.querySelector("#scan-model-canvas");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f6f2);
  camera = new THREE.PerspectiveCamera(48, 1, 0.01, 200);
  camera.position.set(4, 3, 4);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d998e, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(4, 8, 5);
  scene.add(keyLight);
  scene.add(new THREE.GridHelper(10, 20, 0xaab5aa, 0xdce2da));
  modelGroup = new THREE.Group();
  scene.add(modelGroup);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);
  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(canvas);
  resizeRenderer();
  if (!animationStarted) {
    animationStarted = true;
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
  }
}

function resizeRenderer() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function clearModel() {
  while (modelGroup?.children.length) {
    const child = modelGroup.children[0];
    modelGroup.remove(child);
    child.traverse(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose?.();
    });
  }
}

function fitModelView() {
  if (!modelGroup || !camera || !controls) return;
  const bounds = new THREE.Box3().setFromObject(modelGroup);
  if (bounds.isEmpty()) {
    controls.target.set(0, 1, 0);
    camera.position.set(4, 3, 4);
    controls.update();
    return;
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1);
  controls.target.copy(center);
  camera.position.set(center.x + span * 1.7, center.y + span * 1.2, center.z + span * 1.7);
  camera.near = Math.max(span / 100, 0.01);
  camera.far = Math.max(span * 20, 100);
  camera.updateProjectionMatrix();
  controls.update();
}

function updateModel(fit = false) {
  if (!scan) return;
  initializeRenderer();
  clearModel();

  scan.surfaces.forEach(surface => {
    if (!surface.included || surface.role === "ignore") return;
    const planeDepth = surface.alignment === "horizontal" ? surface.depth : surface.height;
    if (!(surface.width > 0) || !(planeDepth > 0)) return;

    const geometry = new THREE.PlaneGeometry(surface.width, planeDepth);
    const confirmed = surface.confirmed;
    const color = confirmed ? 0x6f9c78 : 0xc49a5d;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.8,
      transparent: true,
      opacity: confirmed ? 0.72 : 0.3,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    const anchorTransform = new THREE.Matrix4().fromArray(surface.transform);
    const orientation = new THREE.Quaternion().setFromRotationMatrix(anchorTransform);
    if (surface.alignment === "horizontal") {
      orientation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    }
    mesh.position.set(surface.center.x, surface.center.y, surface.center.z);
    mesh.quaternion.copy(orientation);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: confirmed ? 0x3d704b : 0xa77a3e })
    );
    mesh.add(outline);
    modelGroup.add(mesh);
  });

  if (fit) fitModelView();
  updateExportState();
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJSON() {
  if (!scan) return;
  const payload = createRoomModelExport(scan);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  triggerDownload(blob, "spatial-studio-room-hints.json");
}

async function downloadCaptureBundle() {
  if (!scan?.frames?.length) return;
  captureExportButton.disabled = true;
  captureExportStatus.textContent = "Packaging captured images and calibration…";
  try {
    const blob = buildCaptureArchive(scan);
    triggerDownload(blob, "spatial-studio-capture-bundle.zip");
    captureExportStatus.textContent = "Capture bundle created. It is ready to upload when the reconstruction service is connected.";
  } catch (error) {
    captureExportStatus.textContent = error instanceof Error ? error.message : "Could not create the capture bundle.";
  } finally {
    captureExportButton.disabled = false;
  }
}

function showScan(scanPayload) {
  scan = normalizeScanPayload(scanPayload);
  if (!scan.frames.length && !scan.surfaces.length) {
    review.classList.add("hidden");
    setStatus("The scanner returned no usable camera views. Try again with slower movement and better lighting.");
    return;
  }

  const floors = scan.surfaces.filter(surface => surface.alignment === "horizontal").length;
  const walls = scan.surfaces.filter(surface => surface.alignment === "vertical").length;
  const directionCount = scan.directionBuckets?.length || 0;
  const darkSkipped = scan.captureQuality?.darkFramesSkipped || 0;
  const lowDetail = scan.captureQuality?.lowDetailFramesCaptured || 0;
  const directionSummary = scan.captureQuality
    ? `${directionCount}/8 horizontal view directions sampled (directional variety, not room coverage)`
    : "direction metrics unavailable";
  const captureWarning = (darkSkipped || lowDetail)
    ? `Capture complete. ${darkSkipped} too-dark views were skipped and ${lowDetail} low-detail views were kept as warnings. Review the thumbnails and rescan dim or visually plain areas.`
    : null;
  panel.querySelector("#scan-summary").textContent =
    `${scan.frames.length} camera viewpoints · ${directionSummary} · ${scan.surfaces.length} optional plane hints (${floors} horizontal, ${walls} vertical). A 3D room mesh has not been generated yet.`;
  review.classList.remove("hidden");
  renderCapturedFrames();
  planeDetails.classList.toggle("hidden", scan.surfaces.length === 0);
  panel.querySelector("#scan-fit-view").classList.toggle("hidden", scan.surfaces.length === 0);
  if (scan.surfaces.length) {
    renderSurfaceList();
    updateModel(true);
  } else {
    surfaceList.replaceChildren();
  }
  updateExportState();
  setStatus(captureWarning
    ? `${captureWarning} Exporting the bundle only packages the images and calibration; a separate 3D reconstruction service is still required.`
    : "Camera capture finished. Export the capture bundle to provide the images and camera calibration to a 3D reconstruction service.");
  review.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function startScan() {
  startButton.disabled = true;
  if (scanButton) scanButton.disabled = true;
  setStatus("Starting the camera and preparing guided multi-view capture…");
  try {
    const result = await scanRoomWithARKit();
    showScan(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The scan could not be started.";
    setStatus(message);
  } finally {
    startButton.disabled = false;
    if (scanButton) scanButton.disabled = false;
  }
}

startButton.addEventListener("click", startScan);
panel.querySelector("#scan-fit-view").addEventListener("click", () => fitModelView());
exportButton.addEventListener("click", downloadJSON);
captureExportButton.addEventListener("click", downloadCaptureBundle);

async function checkAvailability() {
  const result = await isNativeARKitAvailable();
  if (result.available) {
    availabilityBadge.textContent = "Native ARKit ready";
    availabilityBadge.className = "text-[10px] rounded-full px-3 py-1.5 bg-[#edf4ed] text-[#477151]";
    setStatus("Ready. Start a scan in the installed iOS app.");
  } else {
    availabilityBadge.textContent = "iOS app required";
    availabilityBadge.className = "text-[10px] rounded-full px-3 py-1.5 bg-[#f8f2e8] text-[#9a743c]";
    setStatus(result.reason);
  }
}

checkAvailability();
window.addEventListener("resize", resizeRenderer);
window.addEventListener("pagehide", () => {
  resizeObserver?.disconnect();
  controls?.dispose();
  renderer?.dispose();
});
