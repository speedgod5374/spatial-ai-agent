import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createRoomModelExport, getConfirmedSurfaces, normalizeScanPayload } from "./room-model.js";
import { buildCaptureArchive } from "./scan-archive.js";
import { analyzeCameraPath } from "./capture-diagnostics.js";
import { classifyPointCloudObjects } from "./object-classifier.js";
import { buildRoomEnvelope } from "./room-visualization.js";
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
      <div class="text-[10px] uppercase tracking-wider font-semibold text-[#547565]">Room scan</div>
      <h2 class="text-base font-semibold mt-1">Capture your space</h2>
      <p class="text-xs text-[#778279] mt-1">Create a set of room views for 3D reconstruction.</p>
    </div>
    <span id="scan-availability" class="text-[10px] rounded-full px-3 py-1.5 bg-[#f1f3f4] text-[#5f6368]">Checking device…</span>
  </div>
  <div class="grid sm:grid-cols-[1fr_auto] gap-3 items-center rounded-xl bg-[#f7f8f6] border border-[#e8ece7] p-3">
    <div class="text-xs text-[#5f6368] leading-relaxed">
      <strong class="text-[#344139]">For best results:</strong> move slowly around the room, changing position between views. Keep walls and furniture visible, with good lighting.
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
      <div class="flex items-center gap-2">
        <button id="scan-rescan" type="button" class="border border-[#dce3dc] bg-white rounded-lg px-3 py-2 text-[11px] text-[#526257]">Rescan</button>
        <button id="scan-fit-view" type="button" class="border border-[#dce3dc] bg-white rounded-lg px-3 py-2 text-[11px] text-[#526257]">Fit model</button>
      </div>
    </div>
    <div class="rounded-xl border border-[#e5eae3] bg-white p-3 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] uppercase tracking-wider font-semibold text-[#7d897f]">Horizontal viewpoint directions</span>
        <span id="scan-direction-count" class="text-[10px] text-[#647067]">Not available</span>
      </div>
      <div id="scan-direction-indicator" class="grid grid-cols-8 gap-1.5" role="img" aria-label="Horizontal viewpoint direction indicators"></div>
      <p class="text-[10px] text-[#89938b]">Direction samples are not a room-coverage score.</p>
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
      <p id="scan-capture-export-status" class="text-[10px] text-[#7d897f]">Camera views and calibration data.</p>
    </div>
    <section class="rounded-xl border border-[#e5eae3] bg-white p-3 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="text-[10px] uppercase tracking-wider font-semibold text-[#547565]">Object shapes</div>
          <h3 class="text-sm font-semibold mt-1">Possible furniture</h3>
        </div>
        <span id="scan-object-count" class="text-[10px] text-[#7a857d]">0 candidates</span>
      </div>
      <p class="text-[10px] text-[#89938b]">Rough 3D clusters are matched to basic furniture shapes by their dimensions. Review or change each suggested label.</p>
      <div id="scan-object-list" class="space-y-2">
        <p class="text-xs text-[#89938b]">No compact object shapes found yet.</p>
      </div>
    </section>
    <details id="scan-plane-details" class="hidden rounded-xl border border-[#e5eae3] bg-[#fbfcfa] p-3">
      <summary class="cursor-pointer text-xs font-semibold text-[#526257]">Room visualization and scan data</summary>
    <div class="mt-3 rounded-xl border border-[#e5eae3] bg-[#f7f8f5] overflow-hidden">
      <div class="px-3 py-2 border-b border-[#e5eae3] flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-[10px] uppercase tracking-wider font-semibold text-[#7d897f]">Room visualization</div>
          <p class="text-[10px] text-[#89938b] mt-1">Switch between a transparent 3D room envelope and a top-down floor plan.</p>
        </div>
        <div class="inline-flex rounded-lg border border-[#e1e7df] bg-white p-1 gap-1" role="group" aria-label="Room visualization mode">
          <button id="scan-view-3d" type="button" aria-pressed="true" class="rounded-md px-3 py-2 text-[11px] font-semibold bg-[#3f5f50] text-white">3D view</button>
          <button id="scan-view-floorplan" type="button" aria-pressed="false" class="rounded-md px-3 py-2 text-[11px] font-semibold text-[#66736a]">Floor plan</button>
        </div>
      </div>
      <div class="relative">
        <canvas id="scan-model-canvas" class="block w-full h-[300px]"></canvas>
        <svg id="scan-floorplan-canvas" class="hidden w-full h-[300px] bg-[#f7f8f5]" viewBox="0 0 800 520" role="img" aria-label="Approximate top-down room floor plan"></svg>
      </div>
      <div id="scan-model-caption" class="px-3 py-2 border-t border-[#e5eae3] text-[10px] leading-relaxed text-[#7f8a81]">The room envelope is estimated from observed ARKit surfaces; it is not a complete room mesh.</div>
    </div>
    <div id="scan-surfaces" class="space-y-2 mt-3"></div>
    </details>
    <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
      <p id="scan-export-status" class="text-[10px] text-[#7d897f]">Optional geometry hints only. These are not a complete room model.</p>
      <button id="scan-export" type="button" disabled class="bg-[#214b39] disabled:opacity-40 text-white text-xs font-semibold rounded-lg px-4 py-3 min-h-[44px]">Export scan model (.json)</button>
    </div>
  </div>
`;

const reconstructionPanel = document.createElement("section");
reconstructionPanel.id = "scan-reconstruction";
reconstructionPanel.className = "rounded-xl border border-[#e5eae3] bg-white p-3 space-y-3";
reconstructionPanel.innerHTML = `
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <div class="text-[10px] uppercase tracking-wider font-semibold text-[#547565]">3D reconstruction</div>
      <h3 class="text-sm font-semibold mt-1">Build a 3D preview</h3>
      <p class="text-[11px] text-[#778279] mt-1">Send the captured views to your GPU worker to generate a point-cloud preview.</p>
    </div>
    <span id="reconstruction-engine-status" class="text-[10px] bg-[#f1f3f4] text-[#667067] px-2.5 py-1.5 rounded-full">On-device capture</span>
  </div>
  <details id="reconstruction-settings" class="rounded-lg border border-[#e8ece7] bg-[#f8faf7] p-3">
    <summary class="cursor-pointer text-xs font-semibold text-[#526257]">Advanced reconstruction service (not used)</summary>
    <div class="grid gap-2 mt-3">
      <label class="text-[10px] text-[#69766d]">Worker address
        <input id="reconstruction-worker-url" type="url" inputmode="url" autocomplete="url" placeholder="http://your-computer.local:8000" class="mt-1 w-full border border-[#dfe5de] bg-white p-2.5 text-xs rounded-md">
      </label>
      <label class="text-[10px] text-[#69766d]">Worker API key
        <input id="reconstruction-worker-key" type="password" autocomplete="off" placeholder="Enter the key configured on your worker" class="mt-1 w-full border border-[#dfe5de] bg-white p-2.5 text-xs rounded-md">
      </label>
      <p class="text-[10px] leading-relaxed text-[#818c82]">This legacy remote worker is disabled in the current on-device workflow.</p>
      <button id="reconstruction-check-worker" type="button" class="border border-[#dce3dc] bg-white rounded-md px-3 py-2.5 text-xs font-semibold text-[#526257]">Check worker connection</button>
    </div>
  </details>
  <div class="flex flex-wrap items-center gap-2">
    <button id="reconstruction-run" type="button" disabled class="bg-[#214b39] disabled:opacity-40 text-white text-xs font-semibold rounded-lg px-4 py-3 min-h-[44px]">Reconstruct 3D preview</button>
    <span id="reconstruction-working" style="display:none" class="items-center gap-2 text-[11px] text-[#477151]"><span class="h-2 w-2 rounded-full bg-[#477151] animate-pulse"></span>Processing scan</span>
    <span id="reconstruction-status" class="text-[11px] text-[#7a857d]" role="status" aria-live="polite">The iPhone builds a sparse 3D feature preview locally. This is not yet a dense room mesh.</span>
  </div>
  <div id="reconstruction-result" class="hidden rounded-lg border border-[#e5eae3] overflow-hidden">
    <div class="px-3 py-2 flex items-center justify-between gap-2 border-b border-[#e5eae3] bg-[#f8faf7]">
      <span class="text-[10px] uppercase tracking-wider font-semibold text-[#647067]">Generated 3D point cloud</span>
      <span class="text-[10px] text-[#89938b]">Drag to orbit · pinch to zoom</span>
    </div>
    <canvas id="reconstruction-canvas" class="block w-full h-[320px]"></canvas>
    <p id="reconstruction-result-meta" class="px-3 py-2 border-t border-[#e5eae3] text-[10px] text-[#7d897f]">Preview geometry is not an editable architectural model. Check walls and dimensions before using it for layout.</p>
  </div>
`;
reconstructionPanel.hidden = true;
panel.append(reconstructionPanel);

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
const detectedObjectList = panel.querySelector("#scan-object-list");
const detectedObjectCount = panel.querySelector("#scan-object-count");
const planeDetails = panel.querySelector("#scan-plane-details");
const scanModelCanvas = panel.querySelector("#scan-model-canvas");
const floorPlanSvg = panel.querySelector("#scan-floorplan-canvas");
const scanView3DButton = panel.querySelector("#scan-view-3d");
const scanViewFloorPlanButton = panel.querySelector("#scan-view-floorplan");
const scanModelCaption = panel.querySelector("#scan-model-caption");
const startButton = panel.querySelector("#scan-start");
const scanButton = document.getElementById("scan-button");

const reconstructionWorkerUrlInput = panel.querySelector("#reconstruction-worker-url");
const reconstructionWorkerKeyInput = panel.querySelector("#reconstruction-worker-key");
const reconstructionCheckButton = panel.querySelector("#reconstruction-check-worker");
const reconstructionRunButton = panel.querySelector("#reconstruction-run");
const reconstructionStatus = panel.querySelector("#reconstruction-status");
const reconstructionWorking = panel.querySelector("#reconstruction-working");
const reconstructionEngineStatus = panel.querySelector("#reconstruction-engine-status");
const reconstructionResult = panel.querySelector("#reconstruction-result");
const reconstructionResultMeta = panel.querySelector("#reconstruction-result-meta");
panel.querySelector("#reconstruction-settings").hidden = true;
reconstructionCheckButton.hidden = true;
reconstructionRunButton.hidden = true;
const reconstructionCanvas = panel.querySelector("#reconstruction-canvas");
const savedWorkerUrl = "";
if (savedWorkerUrl) reconstructionWorkerUrlInput.value = savedWorkerUrl;
reconstructionWorkerUrlInput.addEventListener("change", () => {
  localStorage.setItem("spatialStudio.reconstructionWorkerUrl", reconstructionWorkerUrlInput.value.trim());
});

let scan = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let modelGroup = null;
let animationStarted = false;
let resizeObserver = null;
let scanViewMode = "3d";
let roomEnvelope = null;

let reconstructionBusy = false;
let reconstructionRenderer = null;
let reconstructionScene = null;
let reconstructionCamera = null;
let reconstructionControls = null;
let reconstructionGroup = null;
let reconstructionAnimationStarted = false;
let reconstructionResizeObserver = null;

function setStatus(message) {
  status.textContent = message;
}

function getWorkerBaseUrl() {
  const raw = reconstructionWorkerUrlInput.value.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Enter your reconstruction worker address first.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Enter a valid worker address, including http:// or https://.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("The worker address must use http:// or https://.");
  }
  return raw;
}

async function checkReconstructionWorker(updateStatus = true) {
  const baseUrl = getWorkerBaseUrl();
  if (updateStatus) reconstructionStatus.textContent = "Checking GPU worker…";
  const response = await fetch(baseUrl + "/health", { cache: "no-store" });
  const health = await response.json().catch(() => ({}));
  if (!response.ok || health.status !== "ok") {
    throw new Error(health.detail || "The worker did not return a healthy status.");
  }
  if (health.cudaAvailable !== true) {
    reconstructionEngineStatus.textContent = "GPU unavailable";
    throw new Error("Worker is reachable, but it cannot see an NVIDIA CUDA GPU. Start it on the computer with the NVIDIA GPU.");
  }
  reconstructionEngineStatus.textContent = health.modelLoaded ? "GPU ready · model loaded" : "GPU ready · model loads on first scan";
  if (updateStatus) {
    reconstructionStatus.textContent = health.modelLoaded
      ? "GPU worker connected and model loaded."
      : "GPU worker connected. The first reconstruction will download/load the model.";
  }
  return { baseUrl, health };
}

function initializeReconstructionViewer() {
  if (reconstructionRenderer) return;
  reconstructionScene = new THREE.Scene();
  reconstructionScene.background = new THREE.Color(0xf3f5f1);
  reconstructionCamera = new THREE.PerspectiveCamera(48, 1, 0.01, 1000);
  reconstructionCamera.position.set(3, 2, 3);
  reconstructionRenderer = new THREE.WebGLRenderer({ canvas: reconstructionCanvas, antialias: true });
  reconstructionRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  reconstructionScene.add(new THREE.HemisphereLight(0xffffff, 0x8d998e, 1.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
  keyLight.position.set(4, 8, 5);
  reconstructionScene.add(keyLight);
  reconstructionGroup = new THREE.Group();
  reconstructionScene.add(reconstructionGroup);
  reconstructionControls = new OrbitControls(reconstructionCamera, reconstructionRenderer.domElement);
  reconstructionControls.enableDamping = true;
  reconstructionResizeObserver = new ResizeObserver(() => {
    const width = Math.max(reconstructionCanvas.clientWidth, 1);
    const height = Math.max(reconstructionCanvas.clientHeight, 1);
    reconstructionRenderer.setSize(width, height, false);
    reconstructionCamera.aspect = width / height;
    reconstructionCamera.updateProjectionMatrix();
  });
  reconstructionResizeObserver.observe(reconstructionCanvas);
  if (!reconstructionAnimationStarted) {
    reconstructionAnimationStarted = true;
    const animate = () => {
      requestAnimationFrame(animate);
      reconstructionControls?.update();
      if (reconstructionRenderer && reconstructionScene && reconstructionCamera) {
        reconstructionRenderer.render(reconstructionScene, reconstructionCamera);
      }
    };
    animate();
  }
}

function disposeReconstructionObject(root) {
  root?.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
    else object.material?.dispose?.();
  });
}

async function displayReconstruction(blob) {
  initializeReconstructionViewer();
  reconstructionGroup.children.slice().forEach(child => {
    disposeReconstructionObject(child);
    reconstructionGroup.remove(child);
  });
  const objectUrl = URL.createObjectURL(blob);
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  reconstructionGroup.add(gltf.scene);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  if (bounds.isEmpty()) throw new Error("The reconstruction file loaded but contains no visible 3D geometry.");
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.5);
  reconstructionControls.target.copy(center);
  reconstructionCamera.position.set(center.x + span * 1.8, center.y + span * 1.35, center.z + span * 1.8);
  reconstructionCamera.near = Math.max(span / 1000, 0.001);
  reconstructionCamera.far = Math.max(span * 30, 100);
  reconstructionCamera.updateProjectionMatrix();
  reconstructionControls.update();
  reconstructionResult.classList.remove("hidden");
  requestAnimationFrame(() => {
    const width = Math.max(reconstructionCanvas.clientWidth, 1);
    const height = Math.max(reconstructionCanvas.clientHeight, 1);
    reconstructionRenderer.setSize(width, height, false);
    reconstructionCamera.aspect = width / height;
    reconstructionCamera.updateProjectionMatrix();
  });
}

async function reconstructCapturedRoom() {
  if (!scan?.frames || scan.frames.length < 6) {
    reconstructionStatus.textContent = "Capture at least 6 camera viewpoints before reconstructing.";
    return;
  }
  if (reconstructionBusy) return;
  reconstructionBusy = true;
  reconstructionRunButton.disabled = true;
  reconstructionWorking.style.display = "inline-flex";
  reconstructionCheckButton.disabled = true;
  reconstructionResult.classList.add("hidden");
  reconstructionEngineStatus.textContent = "Connecting…";
  try {
    const { baseUrl, health } = await checkReconstructionWorker(false);
    reconstructionStatus.textContent = "Preparing " + scan.frames.length + " camera views and calibration data…";
    const archive = buildCaptureArchive(scan);
    const form = new FormData();
    form.append("capture", archive, "spatial-studio-capture-bundle.zip");
    const headers = {};
    const apiKey = reconstructionWorkerKeyInput.value.trim();
    if (apiKey) headers["X-API-Key"] = apiKey;
    reconstructionStatus.textContent = "Uploading " + scan.frames.length + " views to the GPU worker…";
    const response = await fetch(baseUrl + "/reconstruct", {
      method: "POST",
      headers,
      body: form
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.detail || ("Reconstruction worker returned HTTP " + response.status + "."));
    }
    reconstructionStatus.textContent = "GPU inference finished · Loading the generated 3D geometry…";
    const blob = await response.blob();
    if (blob.size < 100 || (blob.type && !blob.type.includes("gltf") && !blob.type.includes("octet-stream"))) {
      throw new Error("The worker response was not a valid GLB 3D file.");
    }
    await displayReconstruction(blob);
    const engine = response.headers.get("X-Reconstruction-Engine") || "Depth Anything 3";
    const frameCount = response.headers.get("X-Captured-Frames") || String(scan.frames.length);
    const warnings = response.headers.get("X-Scan-Quality-Warnings");
    let warningText = "";
    if (warnings) {
      try {
        const parsed = JSON.parse(warnings);
        if (Array.isArray(parsed) && parsed.length) warningText = " · Review scan warnings: " + parsed.join("; ");
      } catch { /* Header is optional diagnostic metadata. */ }
    }
    reconstructionResultMeta.textContent =
      engine + " · " + frameCount + " views processed" + warningText +
      ". This is a visual point-cloud preview, not an editable architectural model or verified measurement.";
    reconstructionEngineStatus.textContent = "Preview generated";
    reconstructionStatus.textContent = "3D preview ready. Drag the model to inspect it.";
    reconstructionResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The reconstruction could not be completed.";
    reconstructionStatus.textContent = message;
    reconstructionEngineStatus.textContent = "Reconstruction unavailable";
  } finally {
    reconstructionBusy = false;
    reconstructionWorking.style.display = "none";
    reconstructionRunButton.disabled = !scan?.frames || scan.frames.length < 6;
    reconstructionCheckButton.disabled = false;
  }
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
      createCheckbox("Include in room envelope", surface.included, value => { surface.included = value; updateModel(); }),
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
  reconstructionRunButton.disabled = frameCount < 6 || reconstructionBusy;
  const objectCount = scan?.detectedObjects?.length || 0;
  exportButton.disabled = confirmed.length === 0 && objectCount === 0;
  exportStatus.textContent = confirmed.length || objectCount
    ? `${confirmed.length} confirmed surfaces and ${objectCount} labeled object shapes will be included in the scan export.`
    : `${scan?.pointCloud?.length || 0} local feature points captured. No object shapes or confirmed surfaces are ready to export.`;
  captureExportStatus.textContent = frameCount
    ? `${frameCount} camera views, ARKit poses, intrinsics, and local feature points are ready for export.`
    : "The bundle contains JPEG views, camera poses, and calibration for reconstruction.";
}

function sampledDirectionLabel(currentScan) {
  return currentScan?.captureQuality ? `${currentScan.directionBuckets.length}/8 directions` : "directions unavailable";
}

function renderDetectedObjects() {
  const candidates = scan?.detectedObjects || [];
  detectedObjectCount.textContent = candidates.length + (candidates.length === 1 ? " candidate" : " candidates");
  detectedObjectList.replaceChildren();

  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "text-xs text-[#89938b]";
    empty.textContent = "No compact object shapes were separated from the scan. Try moving closer to furniture and capturing it from several sides.";
    detectedObjectList.append(empty);
    return;
  }

  const categories = ["Table", "Chair", "Sofa", "Bed", "Cabinet", "Object"];
  candidates.forEach((candidate, index) => {
    const card = document.createElement("article");
    card.className = "flex flex-wrap items-center justify-between gap-3 border border-[#edf0ec] rounded-lg p-3";
    const description = document.createElement("div");
    description.className = "min-w-0 flex-1";
    const title = document.createElement("p");
    title.className = "text-xs font-semibold text-[#344139]";
    title.textContent = "Shape " + (index + 1) + " · " + candidate.category + " candidate";
    const dims = candidate.dimensions;
    const meta = document.createElement("p");
    meta.className = "text-[10px] text-[#7d897f] mt-1";
    meta.textContent = dims.width.toFixed(2) + " × " + dims.depth.toFixed(2) + " × " +
      dims.height.toFixed(2) + " m · " + candidate.pointCount + " visual points";
    description.append(title, meta);

    const select = document.createElement("select");
    select.className = "max-w-[125px] bg-white px-2 py-2 text-[11px]";
    select.setAttribute("aria-label", "Classify shape " + (index + 1));
    categories.forEach(category => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.append(option);
    });
    select.value = categories.includes(candidate.category) ? candidate.category : "Object";
    select.addEventListener("change", () => {
      candidate.category = select.value;
      title.textContent = "Shape " + (index + 1) + " · " + candidate.category;
      updateModel();
    });
    card.append(description, select);
    detectedObjectList.append(card);
  });
}

function renderCapturedFrames() {
  frameStrip.replaceChildren();
  const frames = scan?.frames || [];
  const darkSkipped = scan?.captureQuality?.darkFramesSkipped || 0;
  const lowDetail = scan?.captureQuality?.lowDetailFramesCaptured || 0;
  const directionSummary = scan?.captureQuality
    ? `${scan.directionBuckets.length}/8 horizontal directions sampled`
    : "direction metrics unavailable";
  const cameraPath = analyzeCameraPath(frames);
  const pathSummary = cameraPath.validPoseCount >= 2
    ? `Path ${cameraPath.pathLengthMeters.toFixed(1)} m · span ${cameraPath.horizontalSpanXMeters.toFixed(1)} × ${cameraPath.horizontalSpanZMeters.toFixed(1)} m`
    : "Path unavailable";
  captureSummary.textContent = frames.length
    ? `${frames.length} views · ${sampledDirectionLabel(scan)} · ${pathSummary}${darkSkipped ? ` · ${darkSkipped} dark skipped` : ""}${lowDetail ? ` · ${lowDetail} low detail` : ""}`
    : "No camera views captured.";

  const directionIndicator = panel.querySelector("#scan-direction-indicator");
  const directionCount = panel.querySelector("#scan-direction-count");
  directionIndicator.replaceChildren();
  const sampled = new Set(scan?.directionBuckets || []);
  directionCount.textContent = scan?.captureQuality
    ? `${sampled.size} of 8 sampled`
    : "Metrics unavailable";
  for (let direction = 0; direction < 8; direction += 1) {
    const cell = document.createElement("span");
    cell.className = sampled.has(direction)
      ? "h-2.5 rounded-sm bg-[#477151]"
      : "h-2.5 rounded-sm bg-[#e8ece7]";
    cell.title = `Direction ${direction + 1}: ${sampled.has(direction) ? "sampled" : "not sampled"}`;
    directionIndicator.append(cell);
  }

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

function svgNode(name, attributes = {}, text = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

function updateFloorPlan() {
  if (!floorPlanSvg) return;
  floorPlanSvg.replaceChildren();
  floorPlanSvg.setAttribute("viewBox", "0 0 800 520");

  const room = roomEnvelope || buildRoomEnvelope(scan);
  if (!room) {
    floorPlanSvg.append(
      svgNode("rect", { x: 0, y: 0, width: 800, height: 520, fill: "#f7f8f5" }),
      svgNode("text", {
        x: 400, y: 238, "text-anchor": "middle",
        fill: "#526257", "font-size": 20, "font-weight": 600
      }, "More scan coverage needed"),
      svgNode("text", {
        x: 400, y: 272, "text-anchor": "middle",
        fill: "#879189", "font-size": 13
      }, "Capture floor area and walls from more than one side.")
    );
    return;
  }

  const viewWidth = 800;
  const viewHeight = 520;
  const padding = 92;
  const scale = Math.min(
    (viewWidth - padding * 2) / Math.max(room.width, 0.1),
    (viewHeight - padding * 2) / Math.max(room.depth, 0.1)
  );
  const drawnWidth = room.width * scale;
  const drawnDepth = room.depth * scale;
  const left = (viewWidth - drawnWidth) / 2;
  const top = (viewHeight - drawnDepth) / 2;
  const mapX = x => left + (x - room.min.x) * scale;
  const mapZ = z => top + (room.max.z - z) * scale;

  floorPlanSvg.append(
    svgNode("rect", { x: 0, y: 0, width: viewWidth, height: viewHeight, fill: "#f7f8f5" }),
    svgNode("text", {
      x: 28, y: 34, fill: "#526257", "font-size": 14, "font-weight": 700
    }, "TOP VIEW"),
    svgNode("text", {
      x: 28, y: 54, fill: "#89938b", "font-size": 11
    }, "Estimated footprint · dimensions in meters")
  );

  const gridStep = Math.max(0.5, Math.ceil(Math.max(room.width, room.depth) / 10 * 2) / 2);
  for (let x = Math.ceil(room.min.x / gridStep) * gridStep; x <= room.max.x + 0.001; x += gridStep) {
    const px = mapX(x);
    floorPlanSvg.append(svgNode("line", {
      x1: px, y1: top, x2: px, y2: top + drawnDepth,
      stroke: "#e4eae2", "stroke-width": 1
    }));
  }
  for (let z = Math.ceil(room.min.z / gridStep) * gridStep; z <= room.max.z + 0.001; z += gridStep) {
    const py = mapZ(z);
    floorPlanSvg.append(svgNode("line", {
      x1: left, y1: py, x2: left + drawnWidth, y2: py,
      stroke: "#e4eae2", "stroke-width": 1
    }));
  }

  floorPlanSvg.append(svgNode("rect", {
    x: left, y: top, width: drawnWidth, height: drawnDepth,
    fill: "#edf2ec", stroke: "#aab8ab", "stroke-width": 2,
    "stroke-dasharray": "7 5"
  }));

  room.wallSegments.forEach(segment => {
    floorPlanSvg.append(svgNode("line", {
      x1: mapX(segment.start.x), y1: mapZ(segment.start.z),
      x2: mapX(segment.end.x), y2: mapZ(segment.end.z),
      stroke: "#526b59", "stroke-width": 9, "stroke-linecap": "round"
    }));
  });

  const objectColors = {
    Table: "#b78b53",
    Chair: "#668ca7",
    Sofa: "#789078",
    Bed: "#9580a3",
    Cabinet: "#7d8e90",
    Object: "#92978d"
  };
  (scan?.detectedObjects || []).forEach((candidate, index) => {
    const dims = candidate.dimensions || {};
    const center = candidate.center || [];
    const width = Number(dims.width);
    const depth = Number(dims.depth);
    if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(Number(center[0])) || !Number.isFinite(Number(center[2]))) return;
    const rectWidth = Math.max(5, width * scale);
    const rectDepth = Math.max(5, depth * scale);
    const x = mapX(Number(center[0])) - rectWidth / 2;
    const y = mapZ(Number(center[2])) - rectDepth / 2;
    const color = objectColors[candidate.category] || objectColors.Object;
    floorPlanSvg.append(
      svgNode("rect", {
        x, y, width: rectWidth, height: rectDepth, rx: 3,
        fill: color, "fill-opacity": 0.2, stroke: color, "stroke-width": 2
      }),
      svgNode("text", {
        x: x + rectWidth / 2, y: y + rectDepth / 2 + 4,
        "text-anchor": "middle", fill: "#344139", "font-size": 10, "font-weight": 600
      }, String(index + 1))
    );
  });

  floorPlanSvg.append(
    svgNode("text", {
      x: 28, y: 486, fill: "#7d897f", "font-size": 11
    }, room.assumedHeight ? "Room height is illustrative; ARKit did not establish full ceiling height." : "Furniture outlines are rough shape candidates; review their dimensions."),
    svgNode("text", {
      x: 772, y: 486, "text-anchor": "end", fill: "#526257", "font-size": 12, "font-weight": 700
    }, room.width.toFixed(1) + " m × " + room.depth.toFixed(1) + " m")
  );
}

function setScanViewMode(mode) {
  scanViewMode = mode === "floorplan" ? "floorplan" : "3d";
  const isFloorPlan = scanViewMode === "floorplan";
  scanModelCanvas.hidden = isFloorPlan;
  floorPlanSvg.hidden = !isFloorPlan;
  scanView3DButton.setAttribute("aria-pressed", String(!isFloorPlan));
  scanViewFloorPlanButton.setAttribute("aria-pressed", String(isFloorPlan));
  scanView3DButton.className = "rounded-md px-3 py-2 text-[11px] font-semibold " +
    (!isFloorPlan ? "bg-[#3f5f50] text-white" : "text-[#66736a]");
  scanViewFloorPlanButton.className = "rounded-md px-3 py-2 text-[11px] font-semibold " +
    (isFloorPlan ? "bg-[#3f5f50] text-white" : "text-[#66736a]");
  if (isFloorPlan) {
    updateFloorPlan();
  } else {
    requestAnimationFrame(resizeRenderer);
  }
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

  // Show one estimated room volume instead of every individual ARKit plane patch.
  // The original plane observations remain available below for review and export.
  roomEnvelope = buildRoomEnvelope(scan);
  if (roomEnvelope) {
    const width = Math.max(roomEnvelope.width, 0.08);
    const height = Math.max(roomEnvelope.height, 0.08);
    const depth = Math.max(roomEnvelope.depth, 0.08);
    const center = new THREE.Vector3(
      (roomEnvelope.min.x + roomEnvelope.max.x) / 2,
      (roomEnvelope.min.y + roomEnvelope.max.y) / 2,
      (roomEnvelope.min.z + roomEnvelope.max.z) / 2
    );
    const roomGeometry = new THREE.BoxGeometry(width, height, depth);
    const roomFill = new THREE.Mesh(
      roomGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x8fae98,
        transparent: true,
        opacity: 0.075,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    roomFill.position.copy(center);
    roomFill.name = "estimated-transparent-room-envelope";
    modelGroup.add(roomFill);

    const roomEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(roomGeometry),
      new THREE.LineBasicMaterial({ color: 0x64816b, transparent: true, opacity: 0.9 })
    );
    roomEdges.position.copy(center);
    modelGroup.add(roomEdges);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({
        color: 0xb9c9b9,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center.x, roomEnvelope.floorY + 0.004, center.z);
    modelGroup.add(floor);
    scanModelCaption.textContent =
      "Estimated room envelope · " + roomEnvelope.width.toFixed(1) + " × " +
      roomEnvelope.depth.toFixed(1) + " × " + roomEnvelope.height.toFixed(1) + " m. " +
      (roomEnvelope.assumedHeight ? "Height is illustrative because a full wall-to-ceiling extent was not detected. " : "") +
      "This is a bounding volume from observed ARKit planes, not a complete reconstructed mesh.";
  } else {
    scanModelCaption.textContent =
      "There is not enough floor-and-wall coverage to estimate a room volume yet. Continue scanning from more sides; the individual ARKit observations remain available below.";
  }
  scanViewFloorPlanButton.disabled = !roomEnvelope;
  scanViewFloorPlanButton.title = roomEnvelope ? "Show top-down floor plan" : "More floor and wall coverage is needed first";
  updateFloorPlan();
  if (scanViewMode === "floorplan") setScanViewMode("floorplan");

  // ARKit rawFeaturePoints are world-space visual landmarks collected on-device.
  // Render them as a sparse point cloud; do not present them as a dense room mesh.
  if (Array.isArray(scan.pointCloud) && scan.pointCloud.length) {
    const positions = new Float32Array(scan.pointCloud.length * 3);
    scan.pointCloud.forEach((point, index) => {
      positions[index * 3] = point[0];
      positions[index * 3 + 1] = point[1];
      positions[index * 3 + 2] = point[2];
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x39765a,
      size: 0.012,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.38
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.name = "on-device-arkit-feature-cloud";
    modelGroup.add(cloud);
  }

  const categoryColors = {
    Table: 0xc89a58,
    Chair: 0x668caa,
    Sofa: 0x7b8f78,
    Bed: 0x9b86ac,
    Cabinet: 0x8a9698,
    Object: 0x9b9b91,
    Other: 0x9b9b91
  };
  (scan.detectedObjects || []).forEach(candidate => {
    const dims = candidate.dimensions;
    const center = candidate.center;
    if (!dims || !center) return;
    const geometry = new THREE.BoxGeometry(
      Math.max(dims.width, 0.08),
      Math.max(dims.height, 0.08),
      Math.max(dims.depth, 0.08)
    );
    const color = categoryColors[candidate.category] || categoryColors.Object;
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        depthWrite: false
      })
    );
    fill.position.set(center[0], center[1], center[2]);
    modelGroup.add(fill);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color })
    );
    fill.add(edges);
  });

  if (fit) fitModelView();
  updateFloorPlan();
  updateExportState();
}

async function deliverFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });

  // WKWebView's synthetic download links are unreliable on iOS. Prefer the
  // native share sheet so the user can choose Save to Files.
  if (typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      }
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  // Browser fallback. Keep the object URL alive long enough for iOS Safari
  // and desktop browsers to finish consuming the download.
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "download";
}

async function downloadJSON() {
  if (!scan) return;
  try {
    const payload = createRoomModelExport(scan);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const result = await deliverFile(blob, "spatial-studio-room-model.json");
    exportStatus.textContent = result === "cancelled"
      ? "Save cancelled."
      : result === "shared"
        ? "Choose Save to Files in the iOS share sheet."
        : "JSON export started.";
  } catch (error) {
    exportStatus.textContent = error instanceof Error ? error.message : "Could not export the room hints.";
  }
}

async function downloadCaptureBundle() {
  if (!scan?.frames?.length) return;
  captureExportButton.disabled = true;
  captureExportStatus.textContent = "Packaging captured images and calibration…";
  try {
    const blob = buildCaptureArchive(scan);
    const result = await deliverFile(blob, "spatial-studio-capture-bundle.zip");
    captureExportStatus.textContent = result === "cancelled"
      ? "Save cancelled. Your captured scan is still available here; tap Export to try again."
      : result === "shared"
        ? "Choose Save to Files in the iOS share sheet to store the ZIP."
        : "ZIP export started. Check your browser downloads.";
  } catch (error) {
    captureExportStatus.textContent = error instanceof Error ? error.message : "Could not create or share the capture bundle.";
  } finally {
    captureExportButton.disabled = false;
  }
}

function showScan(scanPayload) {
  scan = normalizeScanPayload(scanPayload);
  scan.detectedObjects = classifyPointCloudObjects(scan.pointCloud);
  reconstructionResult.classList.add("hidden");
  reconstructionEngineStatus.textContent = "Worker not checked";
  if (!scan.frames.length && !scan.surfaces.length && !scan.pointCloud.length) {
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
    `${scan.frames.length} views · ${scan.pointCloud.length} 3D feature points · ${scan.detectedObjects.length} possible objects · ${scan.surfaces.length} surface hints (${floors} horizontal, ${walls} vertical)`;
  review.classList.remove("hidden");
  renderCapturedFrames();
  renderDetectedObjects();
  planeDetails.classList.toggle("hidden", scan.surfaces.length === 0 && scan.pointCloud.length === 0);
  planeDetails.open = scan.surfaces.length > 0 || scan.pointCloud.length > 0;
  panel.querySelector("#scan-fit-view").classList.toggle("hidden", scan.surfaces.length === 0 && scan.pointCloud.length === 0);
  if (scan.surfaces.length) renderSurfaceList();
  else surfaceList.replaceChildren();
  if (scan.surfaces.length || scan.pointCloud.length) updateModel(true);
  updateExportState();
  setStatus(captureWarning
    ? `${captureWarning} A sparse ARKit feature cloud was built locally; a dense room mesh is not available yet.`
    : `Scan complete. Found ${scan.detectedObjects.length} possible furniture shapes. Labels are rough shape-based guesses, so review them before using the model.`);
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
panel.querySelector("#scan-rescan").addEventListener("click", startScan);
panel.querySelector("#scan-fit-view").addEventListener("click", () => fitModelView());
scanView3DButton.addEventListener("click", () => setScanViewMode("3d"));
scanViewFloorPlanButton.addEventListener("click", () => setScanViewMode("floorplan"));
exportButton.addEventListener("click", downloadJSON);
captureExportButton.addEventListener("click", downloadCaptureBundle);
reconstructionCheckButton.addEventListener("click", async () => {
  reconstructionCheckButton.disabled = true;
  try {
    await checkReconstructionWorker(true);
  } catch (error) {
    reconstructionEngineStatus.textContent = "Not connected";
    reconstructionStatus.textContent = error instanceof Error ? error.message : "Could not connect to the worker.";
  } finally {
    reconstructionCheckButton.disabled = false;
  }
});
reconstructionRunButton.addEventListener("click", reconstructCapturedRoom);

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
  reconstructionResizeObserver?.disconnect();
  reconstructionControls?.dispose();
  reconstructionRenderer?.dispose();
});
