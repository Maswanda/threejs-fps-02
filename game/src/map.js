// Emberline Depot: an original freight yard. Attackers (Vanguard) spawn south, defenders
// (Sentinel) spawn north. Site A is the warehouse north-east, Site B the container yard
// north-west, and a gantry crane marks mid. Three lanes connect them: west containers,
// east warehouse side, and the open central yard. Every box is a collider and a surface
// a bullet stops on; the waypoint graph is what the bots walk.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [width, height, depth, x, y, z, material]
const BOXES = [
  // Floor and outer walls (48 x 34 m, 5 m walls, open to the dusk sky).
  [48, 0.4, 34, 0, -0.2, 0, 'ground'],
  [48, 5, 0.4, 0, 2.5, -17, 'surface'],
  [48, 5, 0.4, 0, 2.5, 17, 'surface'],
  [0.4, 5, 34, -24, 2.5, 0, 'surface'],
  [0.4, 5, 34, 24, 2.5, 0, 'surface'],
  // Warehouse A (north-east): west wall with a door gap, south wall with a door gap.
  [0.4, 4.4, 3.4, 9, 2.2, -14.6, 'surface'],
  [0.4, 4.4, 3.4, 9, 2.2, -7.4, 'surface'],
  [4, 4.4, 0.4, 11.5, 2.2, -6, 'surface'],
  [4, 4.4, 0.4, 19.5, 2.2, -6, 'surface'],
  [2, 1, 2, 13, 0.5, -13.5, 'crate'],
  [1.6, 1, 1.6, 18.5, 0.5, -9.5, 'crate'],
  [3, 1.8, 1.2, 12, 0.9, -8.6, 'containerC'],
  [1.2, 1.2, 1.2, 20.5, 0.6, -14.5, 'crate'],
  // Container yard B (north-west): stacked containers and a long row.
  [6, 2.6, 2.6, -18, 1.3, -13.5, 'containerA'],
  [6, 2.6, 2.6, -18, 3.9, -13.5, 'containerB'],
  [2.6, 2.6, 6, -12, 1.3, -8, 'containerC'],
  [2.6, 2.6, 5, -19.5, 1.3, -6, 'containerB'],
  [3, 1.2, 2, -14, 0.6, -11.5, 'crate'],
  // Gantry crane at mid: four legs, a top beam, a suspended load.
  [0.8, 7, 0.8, -3, 3.5, -1.2, 'hairline'],
  [0.8, 7, 0.8, 3, 3.5, -1.2, 'hairline'],
  [0.8, 7, 0.8, -3, 3.5, 1.2, 'hairline'],
  [0.8, 7, 0.8, 3, 3.5, 1.2, 'hairline'],
  [8, 0.8, 2.6, 0, 7.2, 0, 'hairline'],
  [1.5, 1.5, 1.5, 0, 5.2, 0, 'containerA'],
  // Mid cover: crates and a low wall.
  [2.4, 1.1, 1.2, -4, 0.55, 3, 'crate'],
  [2.4, 1.1, 1.2, 4, 0.55, 3, 'crate'],
  [2, 0.9, 2, 0, 0.45, -3, 'crate'],
  [8, 1.0, 0.6, 0, 0.5, 6, 'surface'],
  // Sightline pillars north of mid.
  [1.2, 4, 1.2, -8, 2, -8, 'surface'],
  [1.2, 4, 1.2, 8, 2, -8, 'surface'],
  // West lane cover.
  [2, 1.1, 2, -14, 0.55, 4, 'crate'],
  [1.6, 1.1, 1.6, -18, 0.55, 0, 'crate'],
  [2, 1.1, 1.2, -10, 0.55, -4, 'crate'],
  // East lane cover.
  [2, 1.1, 2, 14, 0.55, 4, 'crate'],
  [1.6, 1.1, 1.6, 18, 0.55, 0, 'crate'],
  [2, 1.1, 1.2, 10, 0.55, -4, 'crate'],
  [2, 1.8, 2, 20, 0.9, 8, 'containerC'],
  // Attacker-side cover.
  [2, 1.1, 2, -6, 0.55, 10, 'crate'],
  [2, 1.1, 2, 6, 0.55, 10, 'crate'],
  [3, 1.1, 1.2, 0, 0.55, 12, 'crate'],
  // Defender-side cover.
  [2, 1.1, 2, -6, 0.55, -13, 'crate'],
  [2, 1.1, 2, 6, 0.55, -13, 'crate'],
];

export const SITES = {
  A: { x: 15, z: -11, r: 3.2, name: 'A' },
  B: { x: -15, z: -11, r: 3.2, name: 'B' },
};

export const SPAWNS = {
  attack: [[-2, 13], [0, 14], [2, 13], [-4, 12], [4, 12]],
  defend: [[-2, -13], [0, -14], [2, -13], [-4, -12], [4, -12]],
};

// Waypoint graph the bots walk: id -> [x, z]. Edges are bidirectional.
const WAYPOINTS = {
  atk0: [0, 13], atkW: [-9, 11], atkE: [9, 11],
  laneW1: [-14, 7], laneW2: [-14, 0], laneW3: [-12, -5],
  laneE1: [14, 7], laneE2: [14, 0], laneE3: [12, -5],
  midS: [0, 8], mid: [0, 2], midN: [0, -5],
  siteB: [-15, -11], siteBIn: [-18, -12.5],
  siteA: [15, -11], siteAIn: [18, -13],
  def0: [0, -13], defW: [-8, -12], defE: [8, -12],
  yardW: [-19, -6], yardE: [19, -8],
};
const EDGES = [
  ['atk0', 'atkW'], ['atk0', 'atkE'], ['atk0', 'midS'],
  ['atkW', 'laneW1'], ['atkE', 'laneE1'],
  ['laneW1', 'laneW2'], ['laneE1', 'laneE2'],
  ['laneW2', 'laneW3'], ['laneE2', 'laneE3'],
  ['laneW3', 'siteB'], ['laneE3', 'siteA'],
  ['laneW2', 'mid'], ['laneE2', 'mid'],
  ['midS', 'mid'], ['mid', 'midN'],
  ['midN', 'defW'], ['midN', 'defE'], ['midN', 'def0'],
  ['defW', 'siteB'], ['defE', 'siteA'],
  ['siteB', 'siteBIn'], ['siteA', 'siteAIn'],
  ['laneW3', 'yardW'], ['yardW', 'siteB'],
  ['laneE3', 'yardE'], ['yardE', 'siteA'],
  ['defW', 'yardW'], ['defE', 'yardE'],
  ['def0', 'defW'], ['def0', 'defE'],
];
const ADJACENT = {};
for (const id of Object.keys(WAYPOINTS)) ADJACENT[id] = [];
for (const [a, b] of EDGES) {
  ADJACENT[a].push(b);
  ADJACENT[b].push(a);
}

export function findPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = { [fromId]: null };
  const queue = [fromId];
  while (queue.length) {
    const current = queue.shift();
    for (const next of ADJACENT[current] || []) {
      if (prev[next] !== undefined) continue;
      prev[next] = current;
      if (next === toId) {
        const path = [toId];
        let node = toId;
        while (prev[node] !== null) {
          node = prev[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [fromId, toId];
}

export function nearestWaypoint(x, z) {
  let best = null;
  let bestDist = Infinity;
  for (const [id, [wx, wz]] of Object.entries(WAYPOINTS)) {
    const d = (wx - x) * (wx - x) + (wz - z) * (wz - z);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

export function waypointPos(id) {
  const [x, z] = WAYPOINTS[id];
  return { x, z };
}

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#262a31';
  ctx.fillRect(0, 0, 256, 256);
  // Asphalt speckle.
  for (let i = 0; i < 900; i += 1) {
    const v = 30 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${v},${v + 3},${v + 7})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Faded yard lines.
  ctx.strokeStyle = 'rgba(242,163,60,0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(233,230,223,0.10)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function letterTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#f2a33c';
  ctx.font = 'bold 92px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: name === 'hairline' ? 0.25 : 0.03,
    });
  }
  const groundMaterial = new THREE.MeshStandardMaterial({
    map: groundTexture(),
    roughness: 0.95,
    metalness: 0.02,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      material === 'ground' ? groundMaterial : materials[material],
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  for (const [w, h, d, x, y, z, mat] of BOXES) box(w, h, d, x, y, z, mat);

  // Bomb site markers: an amber ring on the ground and a floating letter.
  const siteMarkers = {};
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    group.add(ring);
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: letterTexture(site.name), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    letter.position.set(site.x, 3.4, site.z);
    group.add(letter);
    siteMarkers[site.name] = { ring, letter };
  }

  // Dusk light: a low warm sun, cool sky fill, and amber sodium lamps over both sites.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8fa3b8'), new THREE.Color('#2a241d'), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.3);
  sun.position.set(-14, 18, 14);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5d7ea6'), 0.65);
  fill.position.set(12, 10, -12);
  scene.add(fill);
  for (const site of Object.values(SITES)) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 22, 16, 1.6);
    lamp.position.set(site.x, 4.6, site.z);
    scene.add(lamp);
  }
  const midLamp = new THREE.PointLight(new THREE.Color('#ffd9a0'), 14, 14, 1.6);
  midLamp.position.set(0, 6.4, 2);
  scene.add(midLamp);

  return { colliders, shootables, group, siteMarkers };
}
