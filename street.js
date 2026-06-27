const streetDom = {
  shell: document.querySelector("#street-shell"),
  canvas: document.querySelector("#street-canvas"),
  open: document.querySelector("#btn-street-toggle"),
  close: document.querySelector("#btn-street-close"),
  sync: document.querySelector("#btn-street-sync"),
  imagery: document.querySelector("#btn-street-imagery"),
  status: document.querySelector("#street-status"),
  roads: document.querySelector("#street-roads"),
  buildings: document.querySelector("#street-buildings"),
  lat: document.querySelector("#street-lat"),
  lon: document.querySelector("#street-lon"),
  address: document.querySelector("#street-address"),
  imageLink: document.querySelector("#street-image-link"),
};

const sctx = streetDom.canvas.getContext("2d");

const streetState = {
  active: false,
  initialized: false,
  loading: false,
  width: 1,
  height: 1,
  dpr: 1,
  keys: new Set(),
  pointerDown: false,
  lastPointer: { x: 0, y: 0 },
  yaw: 0,
  pitch: 0,
  camera: { x: 0, z: 0, y: 1.8 },
  origin: { lat: 0, lon: 0 },
  current: { lat: 0, lon: 0 },
  roads: [],
  buildings: [],
  flats: [],
  trees: [],
  counts: { roads: 0, buildings: 0 },
  dataSource: "procedural",
  lastTime: 0,
  reloadRadius: 800,
  animationId: 0,
  lastImageryKey: "",
  addressCache: new Map(),
  lastAddressKey: "",
  lastAddressLookupAt: 0,
  addressTimer: 0,
  addressRequestId: 0,
};

const ROAD_WIDTHS = {
  motorway: 16,
  trunk: 14,
  primary: 13,
  secondary: 11,
  tertiary: 9,
  residential: 7,
  living_street: 6,
  service: 4.5,
  pedestrian: 5,
  footway: 2.4,
  path: 2.4,
  cycleway: 2.8,
  steps: 2,
  track: 3.5,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash2(x, y, salt = 0) {
  let h = Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(y), 668265263) ^ Math.imul(salt, 1442695041);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, z, scale, salt) {
  const sx = x / scale;
  const sz = z / scale;
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  const fx = smooth(sx - ix);
  const fz = smooth(sz - iz);
  const a = hash2(ix, iz, salt);
  const b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt);
  const d = hash2(ix + 1, iz + 1, salt);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

function terrainHeight(x, z) {
  const n1 = valueNoise(x + streetState.origin.lon * 80, z + streetState.origin.lat * 80, 210, 6);
  const n2 = valueNoise(x, z, 58, 19);
  return (n1 - 0.5) * 7 + (n2 - 0.5) * 2.4;
}

function getAtlasCenter() {
  return window.InfiniteAtlas?.getCenter?.() || { lat: 40.7128, lon: -74.006, zoom: 12 };
}

function localFromLatLon(lat, lon) {
  const metersPerLon = 111320 * Math.cos((streetState.origin.lat * Math.PI) / 180);
  return {
    x: (lon - streetState.origin.lon) * metersPerLon,
    z: -(lat - streetState.origin.lat) * 110540,
  };
}

function latLonFromLocal(x, z) {
  const metersPerLon = 111320 * Math.cos((streetState.origin.lat * Math.PI) / 180);
  return {
    lat: streetState.origin.lat - z / 110540,
    lon: streetState.origin.lon + x / metersPerLon,
  };
}

function setStatus(text) {
  streetDom.status.textContent = text;
}

function setCounts(roads, buildings) {
  streetState.counts.roads = roads;
  streetState.counts.buildings = buildings;
  streetDom.roads.textContent = String(roads);
  streetDom.buildings.textContent = String(buildings);
}

function setAddress(text) {
  streetDom.address.textContent = text;
  streetDom.address.title = text;
}

function initStreet() {
  if (streetState.initialized) return;
  window.addEventListener("resize", resizeStreet);
  streetDom.canvas.addEventListener("pointerdown", onPointerDown);
  streetDom.canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", () => {
    streetState.pointerDown = false;
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  streetState.initialized = true;
  resizeStreet();
}

function resizeStreet() {
  if (streetDom.shell.classList.contains("is-hidden")) return;
  streetState.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  streetState.width = Math.floor(streetDom.shell.clientWidth || window.innerWidth);
  streetState.height = Math.floor(streetDom.shell.clientHeight || window.innerHeight);
  streetDom.canvas.width = Math.floor(streetState.width * streetState.dpr);
  streetDom.canvas.height = Math.floor(streetState.height * streetState.dpr);
  streetDom.canvas.style.width = `${streetState.width}px`;
  streetDom.canvas.style.height = `${streetState.height}px`;
  sctx.setTransform(streetState.dpr, 0, 0, streetState.dpr, 0, 0);
}

function onPointerDown(event) {
  if (!streetState.active) return;
  streetState.pointerDown = true;
  streetState.lastPointer.x = event.clientX;
  streetState.lastPointer.y = event.clientY;
  streetDom.canvas.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
  if (!streetState.active || !streetState.pointerDown) return;
  const dx = event.clientX - streetState.lastPointer.x;
  const dy = event.clientY - streetState.lastPointer.y;
  streetState.lastPointer.x = event.clientX;
  streetState.lastPointer.y = event.clientY;
  streetState.yaw -= dx * 0.0042;
  streetState.pitch = clamp(streetState.pitch - dy * 0.004, -0.55, 0.55);
}

function onKeyDown(event) {
  if (!streetState.active || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  streetState.keys.add(event.key.length === 1 ? event.key.toLowerCase() : event.key);
}

function onKeyUp(event) {
  streetState.keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
}

async function activateStreet() {
  initStreet();
  streetState.active = true;
  document.body.classList.add("street-active");
  streetDom.shell.classList.remove("is-hidden");
  streetDom.open.classList.add("is-active");
  resizeStreet();
  await loadCurrentAtlasLocation();
  streetState.lastTime = performance.now();
  cancelAnimationFrame(streetState.animationId);
  streetState.animationId = requestAnimationFrame(tickStreet);
}

function closeStreet() {
  streetState.active = false;
  cancelAnimationFrame(streetState.animationId);
  clearTimeout(streetState.addressTimer);
  document.body.classList.remove("street-active");
  streetDom.shell.classList.add("is-hidden");
  streetDom.open.classList.remove("is-active");
  if (window.InfiniteAtlas?.jumpTo) window.InfiniteAtlas.jumpTo(streetState.current.lat, streetState.current.lon, Math.max(getAtlasCenter().zoom, 15));
}

async function loadCurrentAtlasLocation() {
  const center = getAtlasCenter();
  await loadWorld(center.lat, center.lon, { resetPlayer: true });
}

async function loadWorld(lat, lon, options = {}) {
  if (streetState.loading) return;
  streetState.loading = true;
  streetState.origin = { lat, lon };
  hideImagery();
  streetState.lastAddressKey = "";
  setAddress("Locating");
  setStatus("Streaming OSM");

  try {
    const data = await fetchOsm(lat, lon, 560);
    const built = buildOsmWorld(data, options);
    if (built.roads === 0 && built.buildings === 0) {
      streetState.dataSource = "procedural";
      buildProceduralWorld(options);
      setStatus("Procedural frontier");
    } else {
      streetState.dataSource = "osm";
      setStatus("OSM geometry live");
    }
  } catch {
    streetState.dataSource = "procedural";
    buildProceduralWorld(options);
    setStatus("Procedural frontier");
  } finally {
    streetState.loading = false;
  }
}

async function fetchOsm(lat, lon, radius) {
  const query = `
    [out:json][timeout:22];
    (
      way(around:${radius},${lat},${lon})["highway"];
      way(around:${radius},${lat},${lon})["building"];
      way(around:${radius},${lat},${lon})["natural"="water"];
      way(around:${radius},${lat},${lon})["leisure"="park"];
      way(around:${radius},${lat},${lon})["landuse"="grass"];
      node(around:${radius},${lat},${lon})["natural"="tree"];
    );
    (._;>;);
    out body;
  `;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) throw new Error(`Overpass ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Overpass unavailable");
}

function clearWorld() {
  streetState.roads = [];
  streetState.buildings = [];
  streetState.flats = [];
  streetState.trees = [];
}

function buildOsmWorld(data, options) {
  clearWorld();
  const nodes = new Map();
  const ways = [];
  let treeCount = 0;

  for (const element of data.elements || []) {
    if (element.type === "node") {
      nodes.set(element.id, element);
      if (element.tags?.natural === "tree") {
        const point = localFromLatLon(element.lat, element.lon);
        streetState.trees.push({ x: point.x, z: point.z, height: 5 + hash2(element.id, 3, 2) * 8 });
        treeCount += 1;
      }
    } else if (element.type === "way") {
      ways.push(element);
    }
  }

  let roads = 0;
  let buildings = 0;
  let spawn = null;

  for (const way of ways) {
    const points = (way.nodes || []).map((id) => nodes.get(id)).filter(Boolean).map((node) => localFromLatLon(node.lat, node.lon));
    if (points.length < 2) continue;
    if (way.tags?.highway) {
      streetState.roads.push({
        points,
        width: ROAD_WIDTHS[way.tags.highway] || 5.5,
        color: isPath(way.tags.highway) ? "#b7a26a" : "#303735",
      });
      roads += 1;
      spawn ||= nearestPoint(points, { x: 0, z: 0 });
    } else if (way.tags?.building && points.length >= 4 && isClosed(points)) {
      streetState.buildings.push({
        points: points.slice(0, -1),
        height: buildingHeight(way.tags),
        color: buildingColor(way.id || buildings),
      });
      buildings += 1;
    } else if (way.tags?.natural === "water" && isClosed(points)) {
      streetState.flats.push({ points: points.slice(0, -1), color: "rgba(52, 109, 124, 0.78)", lift: 0.04 });
    } else if ((way.tags?.leisure === "park" || way.tags?.landuse === "grass") && isClosed(points)) {
      streetState.flats.push({ points: points.slice(0, -1), color: "rgba(79, 141, 74, 0.55)", lift: 0.03 });
    }
  }

  if (treeCount < 12) addProceduralTrees(32);
  addDistantCity();
  setCounts(roads, buildings);
  placePlayer(options.resetPlayer ? (spawn || { x: 0, z: 0 }) : null);
  return { roads, buildings };
}

function buildProceduralWorld(options) {
  clearWorld();
  let roads = 0;
  let buildings = 0;

  for (let i = -5; i <= 5; i += 1) {
    const offset = i * 92;
    streetState.roads.push({ points: [{ x: -760, z: offset }, { x: 760, z: offset }], width: i === 0 ? 10 : 6, color: "#303735" });
    streetState.roads.push({ points: [{ x: offset, z: -760 }, { x: offset, z: 760 }], width: i === 0 ? 10 : 6, color: "#303735" });
    roads += 2;
  }

  for (let gx = -6; gx <= 6; gx += 1) {
    for (let gz = -6; gz <= 6; gz += 1) {
      if (Math.abs(gx) < 1 && Math.abs(gz) < 1) continue;
      if (hash2(gx, gz, 88) < 0.34) continue;
      const cx = gx * 92 + (hash2(gx, gz, 12) - 0.5) * 18;
      const cz = gz * 92 + (hash2(gx, gz, 13) - 0.5) * 18;
      const sx = 16 + hash2(gx, gz, 14) * 30;
      const sz = 16 + hash2(gx, gz, 15) * 30;
      const height = 8 + hash2(gx, gz, 16) * 56;
      streetState.buildings.push({
        points: rectPoints(cx, cz, sx, sz),
        height,
        color: buildingColor(gx * 1000 + gz),
      });
      buildings += 1;
    }
  }

  addProceduralTrees(180);
  addDistantCity();
  setCounts(roads, buildings);
  placePlayer(options.resetPlayer ? { x: 0, z: 0 } : null);
}

function addDistantCity() {
  for (let i = 0; i < 42; i += 1) {
    const angle = hash2(i, 2, 400) * Math.PI * 2;
    const radius = 820 + hash2(i, 3, 401) * 520;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const sx = 18 + hash2(i, 4, 402) * 42;
    const sz = 18 + hash2(i, 5, 403) * 42;
    const height = 28 + hash2(i, 6, 404) * 150;
    streetState.buildings.push({
      points: rectPoints(cx, cz, sx, sz),
      height,
      color: "rgba(120, 138, 131, 0.42)",
      distant: true,
    });
  }
}

function addProceduralTrees(count) {
  for (let i = 0; i < count; i += 1) {
    const x = (hash2(i, 11, 1) - 0.5) * 1500;
    const z = (hash2(i, 13, 2) - 0.5) * 1500;
    if (Math.abs(x) < 48 || Math.abs(z) < 48) continue;
    streetState.trees.push({ x, z, height: 5 + hash2(i, 17, 3) * 8 });
  }
}

function rectPoints(cx, cz, sx, sz) {
  return [
    { x: cx - sx / 2, z: cz - sz / 2 },
    { x: cx + sx / 2, z: cz - sz / 2 },
    { x: cx + sx / 2, z: cz + sz / 2 },
    { x: cx - sx / 2, z: cz + sz / 2 },
  ];
}

function isPath(type) {
  return type === "footway" || type === "path" || type === "cycleway" || type === "steps";
}

function isClosed(points) {
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.z - last.z) < 2;
}

function buildingHeight(tags) {
  if (tags.height) {
    const parsed = Number(String(tags.height).replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return clamp(parsed, 3, 180);
  }
  if (tags["building:levels"]) {
    const parsed = Number(tags["building:levels"]);
    if (Number.isFinite(parsed) && parsed > 0) return clamp(parsed * 3.2, 3, 180);
  }
  return 7 + Math.random() * 14;
}

function buildingColor(seed) {
  const r = Math.round(112 + hash2(seed, 1, 10) * 64);
  const g = Math.round(100 + hash2(seed, 2, 11) * 62);
  const b = Math.round(82 + hash2(seed, 3, 12) * 48);
  return `rgb(${r}, ${g}, ${b})`;
}

function nearestPoint(points, target) {
  let best = points[0];
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.x - target.x, point.z - target.z);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return { ...best };
}

function placePlayer(spawn) {
  if (spawn) {
    streetState.camera.x = spawn.x;
    streetState.camera.z = spawn.z;
  }
  streetState.camera.y = terrainHeight(streetState.camera.x, streetState.camera.z) + 1.75;
  updateCurrentPosition();
}

function updateCurrentPosition() {
  streetState.current = latLonFromLocal(streetState.camera.x, streetState.camera.z);
  streetDom.lat.textContent = streetState.current.lat.toFixed(5);
  streetDom.lon.textContent = streetState.current.lon.toFixed(5);
  scheduleAddressLookup();
}

function addressKeyFor(lat, lon) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function scheduleAddressLookup() {
  if (!streetState.active) return;
  const { lat, lon } = streetState.current;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const key = addressKeyFor(lat, lon);
  if (key === streetState.lastAddressKey) return;
  streetState.lastAddressKey = key;

  if (streetState.addressCache.has(key)) {
    setAddress(streetState.addressCache.get(key));
    return;
  }

  setAddress("Locating");
  clearTimeout(streetState.addressTimer);
  const elapsed = Date.now() - streetState.lastAddressLookupAt;
  const delay = Math.max(0, 1500 - elapsed);
  streetState.addressTimer = setTimeout(() => lookupAddress(key, lat, lon), delay);
}

async function lookupAddress(key, lat, lon) {
  if (!streetState.active || key !== streetState.lastAddressKey) return;
  streetState.lastAddressLookupAt = Date.now();
  const requestId = ++streetState.addressRequestId;

  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(lat),
      lon: String(lon),
      zoom: "18",
      addressdetails: "1",
      namedetails: "0",
      "accept-language": navigator.language || "en",
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const data = await response.json();
    const address = formatAddress(data) || `Near ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    streetState.addressCache.set(key, address);
    if (requestId === streetState.addressRequestId && key === streetState.lastAddressKey) setAddress(address);
  } catch {
    const fallback = streetState.dataSource === "procedural" ? "Unmapped procedural sector" : `Near ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    streetState.addressCache.set(key, fallback);
    if (requestId === streetState.addressRequestId && key === streetState.lastAddressKey) setAddress(fallback);
  }
}

function formatAddress(data) {
  const address = data?.address || {};
  const house = address.house_number;
  const road = address.road || address.pedestrian || address.footway || address.path || address.cycleway;
  const place = address.neighbourhood || address.suburb || address.city_district || address.city || address.town || address.village;
  const region = address.state || address.region;
  const postcode = address.postcode;
  const country = address.country_code ? address.country_code.toUpperCase() : address.country;
  const firstLine = [house, road].filter(Boolean).join(" ");
  const secondLine = [place, region, postcode].filter(Boolean).join(", ");
  const compact = [firstLine, secondLine, country].filter(Boolean).join(" | ");
  if (compact) return compact;
  return data?.display_name || "";
}

function updateCamera(delta) {
  const baseSpeed = streetState.keys.has("Shift") ? 28 : 9.5;
  const speed = baseSpeed * delta;
  let forward = 0;
  let strafe = 0;
  if (streetState.keys.has("w") || streetState.keys.has("ArrowUp")) forward += 1;
  if (streetState.keys.has("s") || streetState.keys.has("ArrowDown")) forward -= 1;
  if (streetState.keys.has("a") || streetState.keys.has("ArrowLeft")) strafe -= 1;
  if (streetState.keys.has("d") || streetState.keys.has("ArrowRight")) strafe += 1;

  const sin = Math.sin(streetState.yaw);
  const cos = Math.cos(streetState.yaw);
  if (forward || strafe) {
    streetState.camera.x += (sin * forward + cos * strafe) * speed;
    streetState.camera.z += (cos * forward - sin * strafe) * speed;
  }
  const groundY = terrainHeight(streetState.camera.x, streetState.camera.z) + 1.75;
  streetState.camera.y += (groundY - streetState.camera.y) * 0.24;
  updateCurrentPosition();

  const distance = Math.hypot(streetState.camera.x, streetState.camera.z);
  if (distance > streetState.reloadRadius && !streetState.loading) {
    loadWorld(streetState.current.lat, streetState.current.lon, { resetPlayer: true });
  }
}

function projectPoint(x, y, z) {
  const dx = x - streetState.camera.x;
  const dz = z - streetState.camera.z;
  const sin = Math.sin(streetState.yaw);
  const cos = Math.cos(streetState.yaw);
  const right = dx * cos - dz * sin;
  const forward = dx * sin + dz * cos;
  if (forward <= 1.4) return null;
  const focal = streetState.width * 0.88;
  const scale = focal / forward;
  const horizon = streetState.height * (0.52 + streetState.pitch * 0.54);
  return {
    x: streetState.width / 2 + right * scale,
    y: horizon + (streetState.camera.y - y) * scale,
    scale,
    depth: forward,
  };
}

function drawStreetFrame() {
  const w = streetState.width;
  const h = streetState.height;
  drawSky(w, h);
  drawGround(w, h);

  const items = [];
  for (const flat of streetState.flats) addFlatItems(items, flat);
  for (const road of streetState.roads) addRoadItems(items, road);
  for (const building of streetState.buildings) addBuildingItems(items, building);
  for (const tree of streetState.trees) addTreeItems(items, tree);

  items.sort((a, b) => b.depth - a.depth);
  for (const item of items) item.draw();
  drawReticle();
}

function drawSky(w, h) {
  const sky = sctx.createLinearGradient(0, 0, 0, h * 0.64);
  sky.addColorStop(0, "#a9c8d1");
  sky.addColorStop(0.55, "#d7d7bf");
  sky.addColorStop(1, "#b6c09d");
  sctx.fillStyle = sky;
  sctx.fillRect(0, 0, w, h);

  const sunX = w * 0.78;
  const sunY = h * 0.16;
  const glow = sctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, w * 0.32);
  glow.addColorStop(0, "rgba(255, 236, 170, 0.55)");
  glow.addColorStop(1, "rgba(255, 236, 170, 0)");
  sctx.fillStyle = glow;
  sctx.fillRect(0, 0, w, h);
}

function drawGround(w, h) {
  const horizon = h * (0.52 + streetState.pitch * 0.54);
  const ground = sctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, "#7f956e");
  ground.addColorStop(1, "#435843");
  sctx.fillStyle = ground;
  sctx.fillRect(0, horizon, w, h - horizon);

  sctx.strokeStyle = "rgba(246, 247, 222, 0.08)";
  sctx.lineWidth = 1;
  for (let d = 30; d <= 720; d += 45) {
    const left = projectPoint(-900, terrainHeight(-900, d), d);
    const right = projectPoint(900, terrainHeight(900, d), d);
    if (left && right) {
      sctx.beginPath();
      sctx.moveTo(left.x, left.y);
      sctx.lineTo(right.x, right.y);
      sctx.stroke();
    }
  }
}

function addFlatItems(items, flat) {
  const projected = flat.points.map((p) => projectPoint(p.x, terrainHeight(p.x, p.z) + flat.lift, p.z));
  if (projected.some((point) => !point)) return;
  const depth = projected.reduce((sum, point) => sum + point.depth, 0) / projected.length;
  items.push({
    depth,
    draw() {
      sctx.fillStyle = flat.color;
      sctx.beginPath();
      projected.forEach((point, index) => {
        if (index === 0) sctx.moveTo(point.x, point.y);
        else sctx.lineTo(point.x, point.y);
      });
      sctx.closePath();
      sctx.fill();
    },
  });
}

function addRoadItems(items, road) {
  for (let i = 0; i < road.points.length - 1; i += 1) {
    const a = road.points[i];
    const b = road.points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) continue;
    const nx = (-dz / len) * road.width * 0.5;
    const nz = (dx / len) * road.width * 0.5;
    const corners = [
      { x: a.x + nx, z: a.z + nz },
      { x: b.x + nx, z: b.z + nz },
      { x: b.x - nx, z: b.z - nz },
      { x: a.x - nx, z: a.z - nz },
    ];
    const projected = corners.map((p) => projectPoint(p.x, terrainHeight(p.x, p.z) + 0.1, p.z));
    if (projected.some((point) => !point)) continue;
    const depth = projected.reduce((sum, point) => sum + point.depth, 0) / 4;
    items.push({
      depth,
      draw() {
        sctx.fillStyle = road.color;
        sctx.beginPath();
        projected.forEach((point, index) => {
          if (index === 0) sctx.moveTo(point.x, point.y);
          else sctx.lineTo(point.x, point.y);
        });
        sctx.closePath();
        sctx.fill();
        sctx.strokeStyle = "rgba(255,255,255,0.16)";
        sctx.lineWidth = Math.max(1, 2.2 / Math.max(1, depth * 0.015));
        sctx.stroke();
      },
    });
  }
}

function addBuildingItems(items, building) {
  const points = building.points;
  if (points.length < 3) return;
  const baseY = points.reduce((sum, p) => sum + terrainHeight(p.x, p.z), 0) / points.length;
  const topY = baseY + building.height;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const p1 = projectPoint(a.x, baseY, a.z);
    const p2 = projectPoint(b.x, baseY, b.z);
    const p3 = projectPoint(b.x, topY, b.z);
    const p4 = projectPoint(a.x, topY, a.z);
    if (!p1 || !p2 || !p3 || !p4) continue;
    const depth = (p1.depth + p2.depth + p3.depth + p4.depth) / 4;
    const shade = 0.72 + (i % 3) * 0.12;
    items.push({
      depth,
      draw() {
        sctx.fillStyle = shadeColor(building.color, shade);
        sctx.beginPath();
        sctx.moveTo(p1.x, p1.y);
        sctx.lineTo(p2.x, p2.y);
        sctx.lineTo(p3.x, p3.y);
        sctx.lineTo(p4.x, p4.y);
        sctx.closePath();
        sctx.fill();
        sctx.strokeStyle = building.distant ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.16)";
        sctx.stroke();
        drawWindows(p1, p2, p3, p4, depth, building.distant);
      },
    });
  }

  const roof = points.map((p) => projectPoint(p.x, topY, p.z));
  if (!roof.some((point) => !point)) {
    const depth = roof.reduce((sum, point) => sum + point.depth, 0) / roof.length;
    items.push({
      depth: depth + 0.01,
      draw() {
        sctx.fillStyle = building.distant ? "rgba(151, 139, 111, 0.38)" : "rgba(192, 166, 108, 0.72)";
        sctx.beginPath();
        roof.forEach((point, index) => {
          if (index === 0) sctx.moveTo(point.x, point.y);
          else sctx.lineTo(point.x, point.y);
        });
        sctx.closePath();
        sctx.fill();
      },
    });
  }
}

function shadeColor(color, factor) {
  if (color.startsWith("rgba")) return color;
  const match = color.match(/\d+/g);
  if (!match) return color;
  const [r, g, b] = match.map(Number);
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

function drawWindows(p1, p2, p3, p4, depth, distant) {
  if (distant || depth > 420) return;
  const floors = clamp(Math.floor(Math.abs(p1.y - p4.y) / 18), 1, 8);
  const cols = clamp(Math.floor(Math.abs(p2.x - p1.x) / 22), 1, 7);
  if (floors < 2 && cols < 2) return;
  sctx.fillStyle = "rgba(246, 226, 151, 0.22)";
  for (let row = 1; row <= floors; row += 1) {
    const tv = row / (floors + 1);
    for (let col = 1; col <= cols; col += 1) {
      const tu = col / (cols + 1);
      const bottom = interp2(p1, p2, tu);
      const top = interp2(p4, p3, tu);
      const center = interp2(bottom, top, tv);
      const size = clamp(90 / depth, 1.3, 4);
      sctx.fillRect(center.x - size, center.y - size * 0.7, size * 2, size * 1.4);
    }
  }
}

function interp2(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function addTreeItems(items, tree) {
  const baseY = terrainHeight(tree.x, tree.z);
  const base = projectPoint(tree.x, baseY, tree.z);
  const top = projectPoint(tree.x, baseY + tree.height, tree.z);
  if (!base || !top) return;
  const depth = base.depth;
  const crown = Math.max(5, tree.height * base.scale * 0.45);
  items.push({
    depth,
    draw() {
      sctx.strokeStyle = "#5d432e";
      sctx.lineWidth = clamp(24 / depth, 1.5, 5);
      sctx.beginPath();
      sctx.moveTo(base.x, base.y);
      sctx.lineTo(top.x, top.y + crown * 0.28);
      sctx.stroke();
      sctx.fillStyle = "rgba(49, 103, 64, 0.88)";
      sctx.beginPath();
      sctx.moveTo(top.x, top.y - crown * 0.8);
      sctx.lineTo(top.x - crown * 0.75, top.y + crown * 0.6);
      sctx.lineTo(top.x + crown * 0.75, top.y + crown * 0.6);
      sctx.closePath();
      sctx.fill();
    },
  });
}

function drawReticle() {
  const x = streetState.width / 2;
  const y = streetState.height / 2;
  sctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  sctx.lineWidth = 1;
  sctx.beginPath();
  sctx.moveTo(x - 7, y);
  sctx.lineTo(x - 2, y);
  sctx.moveTo(x + 2, y);
  sctx.lineTo(x + 7, y);
  sctx.moveTo(x, y - 7);
  sctx.lineTo(x, y - 2);
  sctx.moveTo(x, y + 2);
  sctx.lineTo(x, y + 7);
  sctx.stroke();
}

async function findImagery() {
  if (!streetState.active) return;
  const key = `${streetState.current.lat.toFixed(4)},${streetState.current.lon.toFixed(4)}`;
  if (key === streetState.lastImageryKey && !streetDom.imageLink.classList.contains("is-hidden")) return;
  streetState.lastImageryKey = key;
  setStatus("Searching imagery");
  try {
    const url = `https://api.panoramax.xyz/api/search?place_position=${streetState.current.lon},${streetState.current.lat}&place_distance=300&limit=1`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Panoramax ${response.status}`);
    const data = await response.json();
    const feature = data.features?.[0];
    const href = feature?.links?.viewer?.href || feature?.assets?.hd?.href || feature?.assets?.sd?.href;
    if (!href) throw new Error("No imagery nearby");
    streetDom.imageLink.href = href;
    streetDom.imageLink.classList.remove("is-hidden");
    setStatus("Street imagery nearby");
  } catch {
    hideImagery();
    setStatus(streetState.dataSource === "procedural" ? "Procedural frontier" : "OSM geometry live");
  }
}

function hideImagery() {
  streetDom.imageLink.classList.add("is-hidden");
  streetDom.imageLink.href = "#";
}

function tickStreet(time) {
  if (!streetState.active) return;
  const delta = Math.min((time - streetState.lastTime) / 1000, 0.05) || 0.016;
  streetState.lastTime = time;
  updateCamera(delta);
  drawStreetFrame();
  streetState.animationId = requestAnimationFrame(tickStreet);
}

streetDom.open.addEventListener("click", () => {
  if (streetState.active) closeStreet();
  else activateStreet();
});
streetDom.close.addEventListener("click", closeStreet);
streetDom.sync.addEventListener("click", loadCurrentAtlasLocation);
streetDom.imagery.addEventListener("click", findImagery);

window.InfiniteStreet = {
  activate: activateStreet,
  close: closeStreet,
  reload: loadCurrentAtlasLocation,
  getPosition: () => ({ ...streetState.current }),
};
