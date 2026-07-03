const canvas = document.querySelector("#world");
const ctx = canvas.getContext("2d");

const ui = {
  lat: document.querySelector("#lat-readout"),
  lon: document.querySelector("#lon-readout"),
  zoom: document.querySelector("#zoom-readout"),
  sector: document.querySelector("#sector-readout"),
  speed: document.querySelector("#speed-readout"),
  region: document.querySelector("#region-name"),
  random: document.querySelector("#btn-random"),
  zoomIn: document.querySelector("#btn-zoom-in"),
  zoomOut: document.querySelector("#btn-zoom-out"),
  home: document.querySelector("#btn-home"),
  map: document.querySelector("#btn-map"),
  mapBlend: document.querySelector("#map-blend"),
  relief: document.querySelector("#relief"),
  preset: document.querySelector("#preset"),
  coordForm: document.querySelector("#coord-form"),
  coords: document.querySelector("#coords"),
  camera: document.querySelector("#camera"),
  cameraPanel: document.querySelector("#camera-panel"),
  cameraStatus: document.querySelector("#camera-status"),
  cameraToggle: document.querySelector("#btn-camera-toggle"),
  cameraClose: document.querySelector("#btn-camera-close"),
};

const TILE_SIZE = 256;
const MAX_TILE_ZOOM = 17;
const MIN_ZOOM = 2;
const MAX_ZOOM = 15;
const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const state = {
  centerX: lonToWorldX(0, 3),
  centerY: latToWorldY(0, 3),
  zoom: 3,
  width: 1,
  height: 1,
  dpr: 1,
  dragging: false,
  dragStart: null,
  showMap: true,
  mapBlend: 0.72,
  relief: 0.64,
  keys: new Set(),
  tileCache: new Map(),
  tileQueue: new Set(),
  cameraStream: null,
  cameraReady: false,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value, max) {
  return ((value % max) + max) % max;
}

function worldScale(z) {
  return TILE_SIZE * 2 ** z;
}

function lonToWorldX(lon, z) {
  return ((lon + 180) / 360) * worldScale(z);
}

function latToWorldY(lat, z) {
  const clipped = clamp(lat, -85.05112878, 85.05112878);
  const sin = Math.sin((clipped * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldScale(z);
}

function worldXToLon(x, z) {
  return (wrap(x, worldScale(z)) / worldScale(z)) * 360 - 180;
}

function worldYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / worldScale(z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function reprojectCenter(nextZoom) {
  const factor = 2 ** (nextZoom - state.zoom);
  state.centerX *= factor;
  state.centerY *= factor;
  state.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
}

function resize() {
  state.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  state.width = Math.floor(window.innerWidth);
  state.height = Math.floor(window.innerHeight);
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  draw();
}

function hash2(x, y, salt = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, scale, salt) {
  const sx = x / scale;
  const sy = y / scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = smooth(sx - ix);
  const fy = smooth(sy - iy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function terrainAt(wx, wy) {
  const n1 = valueNoise(wx, wy, 420, 9);
  const n2 = valueNoise(wx, wy, 145, 31);
  const n3 = valueNoise(wx, wy, 44, 67);
  const ridges = 1 - Math.abs(valueNoise(wx, wy, 90, 93) * 2 - 1);
  return clamp(n1 * 0.52 + n2 * 0.28 + n3 * 0.13 + ridges * 0.18 - 0.08, 0, 1);
}

function colorForTerrain(v, wetness, relief) {
  const boosted = clamp(v * (0.72 + relief * 0.55), 0, 1);
  if (boosted < 0.25) return lerpColor([13, 58, 72], [32, 103, 126], boosted / 0.25);
  if (boosted < 0.34) return lerpColor([42, 117, 115], [218, 197, 128], (boosted - 0.25) / 0.09);
  if (boosted < 0.58) return lerpColor([55, 122, 75], [119, 154, 79], (boosted - 0.34) / 0.24);
  if (boosted < 0.78) return lerpColor([114, 116, 78], [131, 116, 98], (boosted - 0.58) / 0.2);
  const snow = lerpColor([132, 130, 122], [239, 244, 232], (boosted - 0.78) / 0.22);
  return wetness > 0.7 ? lerpColor(snow, [205, 231, 236], 0.28) : snow;
}

function lerpColor(a, b, t) {
  const k = clamp(t, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function rgb(color, alpha = 1) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function getTile(z, x, y) {
  const max = 2 ** z;
  if (y < 0 || y >= max) return null;
  const wrappedX = wrap(x, max);
  const key = `${z}/${wrappedX}/${y}`;
  const cached = state.tileCache.get(key);
  if (cached) return cached;
  if (state.tileQueue.has(key)) return null;

  state.tileQueue.add(key);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.referrerPolicy = "strict-origin-when-cross-origin";
  img.onload = () => {
    state.tileCache.set(key, img);
    state.tileQueue.delete(key);
    draw();
  };
  img.onerror = () => {
    state.tileQueue.delete(key);
  };
  img.src = MAP_TILE_URL.replace("{z}", z).replace("{x}", wrappedX).replace("{y}", y);
  return null;
}

function drawTerrain() {
  const block = state.zoom > 10 ? 18 : 14;
  const startWorldX = state.centerX - state.width / 2;
  const startWorldY = state.centerY - state.height / 2;
  ctx.fillStyle = "#07100f";
  ctx.fillRect(0, 0, state.width, state.height);

  for (let y = -block; y < state.height + block; y += block) {
    for (let x = -block; x < state.width + block; x += block) {
      const wx = startWorldX + x;
      const wy = startWorldY + y;
      const elevation = terrainAt(wx, wy);
      const wetness = valueNoise(wx, wy, 300, 121);
      ctx.fillStyle = rgb(colorForTerrain(elevation, wetness, state.relief));
      ctx.fillRect(x, y, block + 1, block + 1);
    }
  }

  drawContours(startWorldX, startWorldY);
  drawStars(startWorldX, startWorldY);
}

function drawContours(startWorldX, startWorldY) {
  ctx.save();
  ctx.globalAlpha = 0.18 + state.relief * 0.18;
  ctx.strokeStyle = "#f5f7de";
  ctx.lineWidth = 1;
  const spacing = 88 - state.relief * 32;
  for (let y = -spacing; y < state.height + spacing; y += spacing) {
    ctx.beginPath();
    for (let x = -20; x < state.width + 20; x += 12) {
      const wx = startWorldX + x;
      const wy = startWorldY + y;
      const lift = (terrainAt(wx, wy) - 0.5) * 38 * state.relief;
      if (x === -20) ctx.moveTo(x, y + lift);
      else ctx.lineTo(x, y + lift);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawStars(startWorldX, startWorldY) {
  const sectorSize = 768;
  const sx0 = Math.floor(startWorldX / sectorSize) - 1;
  const sy0 = Math.floor(startWorldY / sectorSize) - 1;
  const sx1 = Math.floor((startWorldX + state.width) / sectorSize) + 1;
  const sy1 = Math.floor((startWorldY + state.height) / sectorSize) + 1;
  ctx.save();
  for (let sy = sy0; sy <= sy1; sy += 1) {
    for (let sx = sx0; sx <= sx1; sx += 1) {
      const count = 3 + Math.floor(hash2(sx, sy, 707) * 7);
      for (let i = 0; i < count; i += 1) {
        const px = sx * sectorSize + hash2(sx, sy, 800 + i) * sectorSize - startWorldX;
        const py = sy * sectorSize + hash2(sx, sy, 900 + i) * sectorSize - startWorldY;
        const radius = 1.3 + hash2(sx, sy, 1000 + i) * 2.4;
        ctx.fillStyle = `rgba(246, 200, 95, ${0.28 + hash2(sx, sy, 1100 + i) * 0.42})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawTiles() {
  if (!state.showMap || state.mapBlend <= 0) return;

  const z = clamp(Math.round(state.zoom), MIN_ZOOM, MAX_TILE_ZOOM);
  const factor = 2 ** (z - state.zoom);
  const tileStartX = (state.centerX - state.width / 2) * factor;
  const tileStartY = (state.centerY - state.height / 2) * factor;
  const x0 = Math.floor(tileStartX / TILE_SIZE) - 1;
  const y0 = Math.floor(tileStartY / TILE_SIZE) - 1;
  const x1 = Math.floor((tileStartX + state.width * factor) / TILE_SIZE) + 1;
  const y1 = Math.floor((tileStartY + state.height * factor) / TILE_SIZE) + 1;

  ctx.save();
  ctx.globalAlpha = state.mapBlend;
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      const img = getTile(z, tx, ty);
      if (!img) continue;
      const sx = (tx * TILE_SIZE - tileStartX) / factor;
      const sy = (ty * TILE_SIZE - tileStartY) / factor;
      const size = TILE_SIZE / factor;
      ctx.drawImage(img, sx, sy, size + 1, size + 1);
    }
  }
  ctx.restore();
}

function drawCameraGhost() {
  if (!state.cameraReady || !ui.camera || ui.cameraPanel.classList.contains("is-hidden")) return;
  const w = Math.min(state.width * 0.34, 440);
  const h = w * 0.5625;
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(ui.camera, state.width - w - 28, state.height - h - 118, w, h);
  ctx.restore();
}

function drawVignette() {
  const gradient = ctx.createRadialGradient(
    state.width / 2,
    state.height / 2,
    state.height * 0.22,
    state.width / 2,
    state.height / 2,
    Math.max(state.width, state.height) * 0.72,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.46)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
}

function draw() {
  drawTerrain();
  drawTiles();
  drawCameraGhost();
  drawVignette();
  updateReadout();
}

function updateReadout() {
  const { lat, lon } = getCenterGeo();
  const sectorSize = 8192;
  const sx = Math.floor(state.centerX / sectorSize);
  const sy = Math.floor(state.centerY / sectorSize);
  ui.lat.textContent = lat.toFixed(4);
  ui.lon.textContent = lon.toFixed(4);
  ui.zoom.textContent = state.zoom.toFixed(1);
  ui.sector.textContent = `${sx} / ${sy}`;
  ui.region.textContent = describeRegion(lat, lon, sx, sy);
  window.dispatchEvent(new CustomEvent("atlas:change", { detail: { lat, lon, zoom: state.zoom, sectorX: sx, sectorY: sy } }));
}

function getCenterGeo() {
  const maxY = worldScale(state.zoom);
  const wrappedY = clamp(state.centerY, 0, maxY);
  return {
    lat: worldYToLat(wrappedY, state.zoom),
    lon: worldXToLon(state.centerX, state.zoom),
    zoom: state.zoom,
  };
}

function describeRegion(lat, lon, sx, sy) {
  if (Math.abs(lat) < 0.35 && Math.abs(lon) < 0.35) return "Equatorial origin, procedural sea lanes";
  if (lat > 65) return "Arctic generated frontier";
  if (lat < -65) return "Antarctic generated frontier";
  if (Math.abs(sx) > 8 || Math.abs(sy) > 4) return `Deep synthetic sector ${sx}:${sy}`;
  if (Math.abs(lon) > 170) return "Dateline crossing, map wraps into open terrain";
  if (lat > 20 && lat < 40 && lon > 10 && lon < 45) return "Sahara and generated dune fields";
  if (lat > -12 && lat < 6 && lon > -76 && lon < -48) return "Amazon basin and synthetic wetlands";
  return "Mapped Earth blended with procedural terrain";
}

function panBy(dx, dy) {
  state.centerX += dx;
  state.centerY += dy;
  const maxY = worldScale(state.zoom);
  state.centerY = clamp(state.centerY, -maxY * 2, maxY * 3);
  draw();
}

function jumpTo(lat, lon, zoom = state.zoom) {
  reprojectCenter(clamp(Number(zoom), MIN_ZOOM, MAX_ZOOM));
  state.centerX = lonToWorldX(Number(lon), state.zoom);
  state.centerY = latToWorldY(Number(lat), state.zoom);
  draw();
}

function randomJump() {
  const lat = clamp((Math.random() * 170) - 85, -84, 84);
  const lon = (Math.random() * 720) - 360;
  const zoom = 5 + Math.random() * 7;
  jumpTo(lat, lon, zoom);
}

async function toggleCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    state.cameraReady = false;
    ui.camera.srcObject = null;
    ui.cameraPanel.classList.add("is-hidden");
    ui.cameraToggle.classList.remove("is-active");
    ui.cameraStatus.textContent = "Camera off";
    draw();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    ui.cameraStatus.textContent = "Camera unavailable in this browser";
    return;
  }

  try {
    ui.cameraStatus.textContent = "Requesting camera permission";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.cameraStream = stream;
    ui.camera.srcObject = stream;
    ui.cameraPanel.classList.remove("is-hidden");
    ui.cameraToggle.classList.add("is-active");
    ui.cameraStatus.textContent = "Live camera overlay";
    await ui.camera.play();
    state.cameraReady = true;
    draw();
  } catch (error) {
    ui.cameraStatus.textContent = error?.name === "NotAllowedError" ? "Camera permission denied" : "Camera failed to start";
    state.cameraReady = false;
    ui.cameraToggle.classList.remove("is-active");
    draw();
  }
}

function step() {
  const speed = (0.5 + state.zoom * 0.16) * (state.keys.has("Shift") ? 3.4 : 1);
  let dx = 0;
  let dy = 0;
  if (state.keys.has("ArrowLeft") || state.keys.has("a")) dx -= speed;
  if (state.keys.has("ArrowRight") || state.keys.has("d")) dx += speed;
  if (state.keys.has("ArrowUp") || state.keys.has("w")) dy -= speed;
  if (state.keys.has("ArrowDown") || state.keys.has("s")) dy += speed;
  if (dx || dy) {
    panBy(dx, dy);
    ui.speed.textContent = `${(state.keys.has("Shift") ? 3.4 : 1).toFixed(1)}x`;
  } else {
    ui.speed.textContent = "1.0x";
  }
  requestAnimationFrame(step);
}

window.addEventListener("resize", resize);

canvas.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  state.dragStart = { x: event.clientX, y: event.clientY, cx: state.centerX, cy: state.centerY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging || !state.dragStart) return;
  state.centerX = state.dragStart.cx - (event.clientX - state.dragStart.x);
  state.centerY = state.dragStart.cy - (event.clientY - state.dragStart.y);
  draw();
});

canvas.addEventListener("pointerup", () => {
  state.dragging = false;
  state.dragStart = null;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const oldZoom = state.zoom;
  const nextZoom = clamp(state.zoom + (event.deltaY < 0 ? 0.4 : -0.4), MIN_ZOOM, MAX_ZOOM);
  const beforeX = state.centerX + event.clientX - state.width / 2;
  const beforeY = state.centerY + event.clientY - state.height / 2;
  reprojectCenter(nextZoom);
  const factor = 2 ** (state.zoom - oldZoom);
  state.centerX += beforeX * factor - state.centerX - (event.clientX - state.width / 2);
  state.centerY += beforeY * factor - state.centerY - (event.clientY - state.height / 2);
  draw();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (document.body.classList.contains("street-active")) return;
  if (event.target instanceof HTMLInputElement) return;
  state.keys.add(event.key.length === 1 ? event.key.toLowerCase() : event.key);
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
});

document.querySelectorAll("[data-pan]").forEach((button) => {
  button.addEventListener("click", () => {
    const [x, y] = button.dataset.pan.split(",").map(Number);
    panBy(x * 220, y * 220);
  });
});

ui.zoomIn.addEventListener("click", () => {
  reprojectCenter(state.zoom + 1);
  draw();
});

ui.zoomOut.addEventListener("click", () => {
  reprojectCenter(state.zoom - 1);
  draw();
});

ui.home.addEventListener("click", () => jumpTo(0, 0, 3));
ui.random.addEventListener("click", randomJump);
ui.map.addEventListener("click", () => {
  state.showMap = !state.showMap;
  ui.map.classList.toggle("is-active", state.showMap);
  draw();
});

ui.mapBlend.addEventListener("input", () => {
  state.mapBlend = Number(ui.mapBlend.value) / 100;
  draw();
});

ui.relief.addEventListener("input", () => {
  state.relief = Number(ui.relief.value) / 100;
  draw();
});

ui.preset.addEventListener("change", () => {
  const [lat, lon, zoom] = ui.preset.value.split(",").map(Number);
  jumpTo(lat, lon, zoom);
});

ui.coordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const parts = ui.coords.value.split(",").map((part) => Number(part.trim()));
  if (parts.length >= 2 && parts.every(Number.isFinite)) {
    jumpTo(parts[0], parts[1], Math.max(state.zoom, 9));
  }
});

ui.cameraToggle.addEventListener("click", toggleCamera);
ui.cameraClose.addEventListener("click", toggleCamera);

const streetInvestigateAtlasApi = {
  getCenter: getCenterGeo,
  jumpTo,
  setMapVisible(show) {
    state.showMap = Boolean(show);
    ui.map.classList.toggle("is-active", state.showMap);
    draw();
  },
};

window.StreetInvestigate = { ...(window.StreetInvestigate || {}), atlas: streetInvestigateAtlasApi };
window.StreetInvestigateAtlas = streetInvestigateAtlasApi;

resize();
step();
