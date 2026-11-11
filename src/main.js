import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  clampFurniturePosition,
  findFurniturePlacement,
  furnitureOverlaps,
  getFurnitureFootprint
} from './layout-geometry.js';

const $ = (id) => document.getElementById(id);
const notice = (message) => {
  const el = $('notice');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => el.classList.add('hidden'), 3200);
};

const state = {
  room: { width: 4.5, length: 5.2, height: 2.8 },
  furniture: [],
  selectedId: null,
  activeTab: 'viewer',
  cameraStream: null
};

const container = $('three-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1f3f4);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(6.5, 5.5, 7.5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8993a3, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(4, 8, 5);
keyLight.castShadow = true;
scene.add(keyLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.7, 0);
controls.maxPolarAngle = Math.PI * 0.49;

const roomGroup = new THREE.Group();
scene.add(roomGroup);
const furnitureGroup = new THREE.Group();
scene.add(furnitureGroup);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragPoint = new THREE.Vector3();
let dragging = false;
let dragOffset = new THREE.Vector3();

const catalog = [
  { type: 'sofa', name: 'Two-seat sofa', w: 1.9, d: 0.85, h: 0.82, color: 0x8c9baa, price: 399 },
  { type: 'desk', name: 'Work desk', w: 1.4, d: 0.7, h: 0.75, color: 0xb38a62, price: 179 },
  { type: 'bed', name: 'Double bed', w: 1.9, d: 1.4, h: 0.55, color: 0x9cabc0, price: 499 },
  { type: 'chair', name: 'Accent chair', w: 0.75, d: 0.75, h: 0.85, color: 0xc69b78, price: 129 },
  { type: 'table', name: 'Coffee table', w: 1.0, d: 0.6, h: 0.42, color: 0x9b7959, price: 89 },
  { type: 'lamp', name: 'Floor lamp', w: 0.35, d: 0.35, h: 1.55, color: 0x343a40, price: 59 }
];

function resizeRenderer() {
  const w = Math.max(container.clientWidth, 1);
  const h = Math.max(container.clientHeight, 1);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resizeRenderer).observe(container);
resizeRenderer();

function buildRoom() {
  while (roomGroup.children.length) {
    const child = roomGroup.children.pop();
    child.geometry?.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
  }
  const { width, length, height } = state.room;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({ color: 0xe5e1d8, roughness: 0.9, side: THREE.DoubleSide })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'room-floor';
  roomGroup.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
  back.position.set(0, height / 2, -length / 2);
  roomGroup.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-width / 2, height / 2, 0);
  roomGroup.add(left);
  const grid = new THREE.GridHelper(Math.max(width, length), Math.round(Math.max(width, length) * 2), 0x9aa6b2, 0xd5dbe1);
  grid.position.y = 0.006;
  roomGroup.add(grid);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, length)),
    new THREE.LineBasicMaterial({ color: 0x8b98a5 })
  );
  edges.position.y = height / 2;
  roomGroup.add(edges);
  $('dimension-tag').textContent = `${width.toFixed(1)}m × ${length.toFixed(1)}m × ${height.toFixed(1)}m`;
}

function makeFurniture(item) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.72 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(item.w, item.h, item.d), material);
  body.position.y = item.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const outline = new THREE.BoxHelper(body, 0x1a73e8);
  outline.visible = false;
  group.add(outline);
  group.userData.itemId = item.id;
  group.position.set(item.x, 0, item.z);
  group.rotation.y = item.rotation || 0;
  furnitureGroup.add(group);
  return group;
}

function renderFurniture() {
  furnitureGroup.clear();
  state.furniture.forEach(makeFurniture);
  renderFurnitureList();
  $('object-count').textContent = String(state.furniture.length);
  $('anchor-count').textContent = `${state.furniture.length} items`;
  $('export-button').disabled = state.furniture.length === 0;
  updateSelection();
}

function renderFurnitureList() {
  const lists = [$('anchor-list'), $('layout-list')].filter(Boolean);
  const count = $('layout-count');
  if (count) count.textContent = `${state.furniture.length} ${state.furniture.length === 1 ? 'item' : 'items'}`;

  lists.forEach(list => {
    list.replaceChildren();
    if (!state.furniture.length) {
      const empty = document.createElement('div');
      empty.className = 'bg-[#f8f9fa] p-3 rounded-xl border border-[#e8eaed] text-xs text-[#5f6368]';
      empty.textContent = 'No furniture placed yet. Add an item from Store.';
      list.append(empty);
      return;
    }

    state.furniture.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'w-full text-left bg-[#f8f9fa] p-3 rounded-xl border border-[#e8eaed] text-xs flex justify-between items-center gap-3';
      button.setAttribute('aria-pressed', String(item.id === state.selectedId));
      button.classList.toggle('border-[#315e4b]', item.id === state.selectedId);
      const name = document.createElement('span');
      name.className = 'font-medium text-[#344139]';
      name.textContent = item.name;
      const meta = document.createElement('span');
      meta.className = 'text-right text-[#5f6368] whitespace-nowrap';
      meta.textContent = `${item.w.toFixed(2)} × ${item.d.toFixed(2)}m · X ${item.x.toFixed(2)}, Z ${item.z.toFixed(2)}`;
      button.append(name, meta);
      button.addEventListener('click', () => selectFurniture(item.id));
      list.append(button);
    });
  });
}

function updateSelection() {
  furnitureGroup.children.forEach(group => {
    const outline = group.children.find(child => child.isLineSegments);
    if (outline) outline.visible = group.userData.itemId === state.selectedId;
  });
  const selected = state.furniture.find(item => item.id === state.selectedId);
  $('selection-name').textContent = selected ? selected.name : 'Nothing selected';
  $('rotate-button').disabled = !selected;
  $('remove-button').disabled = !selected;
}

function selectFurniture(id) {
  state.selectedId = id;
  updateSelection();
}

function addFurniture(product) {
  const item = { ...product, id: crypto.randomUUID(), x: 0, z: 0, rotation: 0 };
  const position = findFurniturePlacement(item, state.room, state.furniture);
  if (!position) {
    notice(`${item.name} is too large to fit in this room.`);
    return;
  }
  Object.assign(item, position);
  state.furniture.push(item);
  state.selectedId = item.id;
  renderFurniture();
  setTab('layout');
  notice(`${item.name} placed with clearance from existing furniture.`);
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-button').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('text-[#1a73e8]', active);
    button.classList.toggle('font-semibold', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
  });
  if (tab === 'viewer') requestAnimationFrame(resizeRenderer);
  if (tab === 'layout') {
    $('room-width').value = state.room.width;
    $('room-length').value = state.room.length;
    $('room-height').value = state.room.height;
    updateSelection();
  }
}

function buildPanels() {
  const dashboard = document.querySelector('#app-shell > .flex-1');
  if (!dashboard) return;
  const viewerSections = [...dashboard.children];
  const viewer = document.createElement('div');
  viewer.id = 'tab-viewer';
  viewer.className = 'tab-panel space-y-4';
  viewerSections.forEach(section => viewer.appendChild(section));
  dashboard.appendChild(viewer);

  const layout = document.createElement('section');
  layout.id = 'tab-layout';
  layout.className = 'tab-panel hidden space-y-4';
  layout.innerHTML = `
    <div class="material-card p-4 space-y-3">
      <h2 class="text-sm font-semibold">Room dimensions</h2>
      <p class="text-xs text-[#5f6368]">Enter approximate measurements in meters. This creates a scaled planning model, not an automatic scan.</p>
      <div class="grid grid-cols-3 gap-2">
        <label class="text-xs">Width (m)<input id="room-width" type="number" min="1" max="30" step="0.1" value="4.5" class="mt-1 w-full border rounded-lg p-2"></label>
        <label class="text-xs">Length (m)<input id="room-length" type="number" min="1" max="30" step="0.1" value="5.2" class="mt-1 w-full border rounded-lg p-2"></label>
        <label class="text-xs">Height (m)<input id="room-height" type="number" min="1.8" max="8" step="0.1" value="2.8" class="mt-1 w-full border rounded-lg p-2"></label>
      </div>
      <button id="build-room-button" class="w-full bg-[#1a73e8] text-white rounded-full p-3 text-xs font-semibold">Build 3D room</button>
    </div>
    <div class="material-card p-4 space-y-3">
      <h2 class="text-sm font-semibold">Selected furniture</h2>
      <p id="selection-name" class="text-xs text-[#5f6368]">Nothing selected</p>
      <div class="grid grid-cols-2 gap-2">
        <button id="rotate-button" class="border rounded-full p-3 text-xs" disabled>Rotate 15°</button>
        <button id="remove-button" class="border rounded-full p-3 text-xs" disabled>Remove item</button>
      </div>
      <p class="text-[11px] text-[#5f6368]">Tip: select an item, then drag it across the floor in the 3D viewer.</p>
    </div>
    <div class="material-card p-4 space-y-2">
      <div class="flex justify-between"><h2 class="text-sm font-semibold">Room objects</h2><span id="layout-count" class="text-xs text-[#5f6368]">0 items</span></div>
      <div id="layout-list" class="space-y-2 text-xs"></div>
    </div>`;
  dashboard.appendChild(layout);

  const store = document.createElement('section');
  store.id = 'tab-store';
  store.className = 'tab-panel hidden space-y-4';
  store.innerHTML = `
    <div class="material-card p-4 space-y-2">
      <h2 class="text-sm font-semibold">Furniture catalog</h2>
      <p class="text-xs text-[#5f6368]">Sample planning objects. These are not live retail listings or purchasable products yet.</p>
    </div>
    <div id="store-grid" class="grid grid-cols-2 gap-3"></div>`;
  dashboard.appendChild(store);

  const nav = $('bottom-nav');
  if (nav) {
    nav.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  }
  $('build-room-button').addEventListener('click', () => {
    const width = Number($('room-width').value);
    const length = Number($('room-length').value);
    const height = Number($('room-height').value);
    if (![width, length, height].every(Number.isFinite) || width < 1 || length < 1 || height < 1.8 || width > 30 || length > 30 || height > 8) {
      notice('Enter valid room dimensions: width/length 1–30m, height 1.8–8m.');
      return;
    }
    const nextRoom = { width, length, height };
    const reflowedFurniture = [];
    for (const item of state.furniture) {
      const position = findFurniturePlacement(
        item,
        nextRoom,
        reflowedFurniture,
        { x: item.x, z: item.z }
      );
      if (!position) {
        notice(`The new room dimensions cannot fit all furniture. Remove or resize an item first.`);
        return;
      }
      reflowedFurniture.push({ ...item, ...position });
    }
    state.room = nextRoom;
    state.furniture = reflowedFurniture;
    buildRoom();
    renderFurniture();
    $('detected-space-name').textContent = 'Manually measured room';
    $('confidence-label').textContent = 'User-entered dimensions';
    $('scan-message').textContent = 'Room geometry was generated from your measurements. It has not been automatically scanned.';
    notice('3D room updated.');
    setTab('viewer');
  });
  $('rotate-button').addEventListener('click', () => {
    const item = state.furniture.find(x => x.id === state.selectedId);
    if (!item) return;
    const nextRotation = (item.rotation + Math.PI / 12) % (Math.PI * 2);
    const rotated = { ...item, rotation: nextRotation };
    const position = clampFurniturePosition(rotated, item.x, item.z, state.room);
    if (!position || furnitureOverlaps(rotated, position, state.furniture)) {
      notice("That rotation would overlap another item or cross the room boundary.");
      return;
    }
    item.rotation = nextRotation;
    Object.assign(item, position);
    renderFurniture();
  });
  $('remove-button').addEventListener('click', () => {
    state.furniture = state.furniture.filter(x => x.id !== state.selectedId);
    state.selectedId = null;
    renderFurniture();
  });
  $('store-grid').innerHTML = catalog.map((item, index) => `
    <article class="material-card p-3 space-y-2">
      <div class="h-20 rounded-xl flex items-center justify-center" style="background:#f1f3f4"><div class="rounded-lg shadow-sm" style="width:50px;height:34px;background:#${item.color.toString(16).padStart(6,'0')}"></div></div>
      <h3 class="text-xs font-semibold">${item.name}</h3>
      <p class="text-[11px] text-[#5f6368]">${item.w} × ${item.d} × ${item.h}m</p>
      <p class="text-xs font-medium">Sample price: $${item.price}</p>
      <button type="button" data-add-index="${index}" class="w-full bg-[#1a73e8] text-white rounded-full py-2 text-xs">Add to room</button>
    </article>`).join('');
  $('store-grid').querySelectorAll('[data-add-index]').forEach(button => button.addEventListener('click', () => addFurniture(catalog[Number(button.dataset.addIndex)])));
}

function pickFurniture(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(furnitureGroup.children, true);
  if (!hits.length) return null;
  let target = hits[0].object;
  while (target.parent && !target.userData.itemId) target = target.parent;
  return target.userData.itemId ? target : null;
}
renderer.domElement.addEventListener('pointerdown', event => {
  const target = pickFurniture(event);
  if (!target) return;
  selectFurniture(target.userData.itemId);
  controls.enabled = false;
  dragging = true;
  raycaster.setFromCamera(pointer, camera);
  raycaster.ray.intersectPlane(floorPlane, dragPoint);
  dragOffset.set(target.position.x - dragPoint.x, 0, target.position.z - dragPoint.z);
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', event => {
  if (!dragging) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
  const item = state.furniture.find(x => x.id === state.selectedId);
  if (!item) return;
  const position = clampFurniturePosition(item, dragPoint.x + dragOffset.x, dragPoint.z + dragOffset.z, state.room);
  if (!position || furnitureOverlaps(item, position, state.furniture)) return;
  item.x = position.x;
  item.z = position.z;
  const group = furnitureGroup.children.find(g => g.userData.itemId === item.id);
  if (group) group.position.set(position.x, 0, position.z);
});
function stopDrag() { dragging = false; controls.enabled = true; }
renderer.domElement.addEventListener('pointerup', stopDrag);
renderer.domElement.addEventListener('pointercancel', stopDrag);

$('scan-button').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    notice('Camera access is unavailable in this browser. Open the HTTPS site in Safari.');
    return;
  }
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    let overlay = $('camera-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'camera-overlay';
      overlay.className = 'fixed inset-0 z-50 bg-black flex flex-col';
      overlay.innerHTML = '<video id="camera-video" autoplay playsinline class="w-full h-full object-cover"></video><div class="absolute top-4 left-4 right-4 flex justify-between items-center"><span class="bg-black/60 text-white text-xs px-3 py-2 rounded-full">Camera preview · not a 3D scan</span><button id="close-camera" class="bg-white text-black px-4 py-2 rounded-full text-xs">Close</button></div>';
      document.body.appendChild(overlay);
      $('close-camera').addEventListener('click', closeCamera);
    }
    $('camera-video').srcObject = state.cameraStream;
    $('system-status-text').textContent = 'Camera active';
  } catch (error) {
    const messages = { NotAllowedError: 'Camera permission was denied. Allow camera access for this website in Safari settings.', NotFoundError: 'No camera was found on this device.', NotReadableError: 'The camera is already being used by another app.' };
    notice(messages[error.name] || 'Could not open the camera. Check Safari permissions and try again.');
  }
});
function closeCamera() {
  state.cameraStream?.getTracks().forEach(track => track.stop());
  state.cameraStream = null;
  $('camera-overlay')?.remove();
  $('system-status-text').textContent = 'Ready';
}
window.addEventListener('pagehide', closeCamera);

$('import-button').addEventListener('click', () => $('import-input').click());
$('import-input').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const room = parsed.room || parsed;
    const dims = room.dimensions || room;
    if (Number.isFinite(dims.width) && Number.isFinite(dims.length)) {
      state.room.width = dims.width;
      state.room.length = dims.length;
      state.room.height = dims.height || state.room.height;
      buildRoom();
    }
    const elements = room.elements || parsed.elements || [];
    const recognized = elements.filter(el => el.kind === 'object' || el.category);
    state.furniture = [];
    recognized.forEach(el => {
      const d = el.dimensions || [1, 0.8, 0.8];
      const item = {
        id: crypto.randomUUID(),
        name: el.category || 'Scanned object',
        type: 'scanned',
        w: d[0] || 1,
        h: d[1] || 0.8,
        d: d[2] || 0.8,
        x: 0,
        z: 0,
        rotation: 0,
        color: 0x8c9baa
      };
      const position = findFurniturePlacement(item, state.room, state.furniture);
      if (position) {
        Object.assign(item, position);
        state.furniture.push(item);
      }
    });
    state.selectedId = null;
    renderFurniture();
    $('detected-space-name').textContent = 'Imported room data';
    $('confidence-label').textContent = 'Imported file';
    $('scan-message').textContent = 'Imported geometry is a planning representation. Review dimensions before relying on fit.';
    setTab('viewer');
    notice('Room data imported.');
  } catch {
    notice('That file is not valid Spatial Studio room JSON.');
  }
  event.target.value = '';
});
$('export-button').addEventListener('click', () => {
  const payload = {
    schemaVersion: 2,
    source: 'Spatial Studio web planner',
    room: state.room,
    furniture: state.furniture.map(item => ({
      ...item,
      footprint: getFurnitureFootprint(item)
    }))
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'spatial-studio-room.json'; a.click();
  URL.revokeObjectURL(url);
});

buildPanels();
buildRoom();
renderFurniture();
setTab('viewer');
$('system-status-text').textContent = 'Ready';

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
