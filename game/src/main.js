// Emberline Depot — boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. Rounds, money, the charge, grenades and every shot are resolved
// here; the modules own their own state. ?shot=start|buy|play|plant with &seed=N sets up
// a deterministic frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range } from './rng.js';
import { createWorld, SITES, SPAWNS } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponSet, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const BUY_TIME = 15;
const ROUND_TIME = 100;
const WIN_SCORE = 5;
const MAX_ROUNDS = 9;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const PLANT_REWARD = 300;
const GRENADE_FUSE = 1.2;
const GRENADE_RADIUS = 6;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 26, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const effects = createEffects(scene);
const bomb = createBomb(scene, audio);
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders);
const weapons = createWeaponSet(camera, () => audio.dryFire());
const hud = createHud({ onBuy: buyItem });
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// Invisible hitboxes that track the player, so bot shots resolve against the same
// honest raycast as the player's own shots (torso + head, for headshot damage).
const playerHitTorso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.95, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
const playerHitHead = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.36), new THREE.MeshBasicMaterial({ visible: false }));
playerHitTorso.userData.part = 'torso';
playerHitHead.userData.part = 'head';
scene.add(playerHitTorso, playerHitHead);

const bots = createBots(scene, world.colliders, world.shootables, random, {
  shoot: onBotShoot,
  defused: onBotDefused,
});

// The raycast target lists. Bot hit meshes only exist once the bots are spawned, so
// these are rebuilt at the start of every round — a list built at boot would be empty
// and no shot could ever hit a bot.
let playerShootTargets = world.shootables.slice();
let botShootTargets = world.shootables.slice();
function refreshShootTargets() {
  const botMeshes = bots.bots.flatMap((b) => b.hitMeshes);
  playerShootTargets = world.shootables.concat(botMeshes);
  botShootTargets = world.shootables.concat(botMeshes, [playerHitTorso, playerHitHead]);
}

const game = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1,
  score: { van: 0, sen: 0 },
  money: 800,
  roundTimer: ROUND_TIME,
  buyTimer: BUY_TIME,
  roundEndAt: 0,
  bombPlanted: false,
  bombSite: null,
  survived: true,
  elapsed: 0,
  frozen: false,
  started: false,
  matchOver: false,
  plantProgress: 0,
  plantSite: null,
  plantStart: null,
};
const grenades = [];
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
let prevFiring = false;
let accumulator = 0;
let lastTime = performance.now();

function syncCamera() {
  if (!player.state.alive && game.phase === 'live') {
    // Spectate the first living teammate.
    const mate = bots.bots.find((b) => b.side === 'attack' && b.alive);
    if (mate) {
      camera.position.set(mate.position.x, mate.position.y + 1.55, mate.position.z);
      camera.rotation.set(0, mate.yaw, 0, 'YXZ');
      return;
    }
  }
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function syncPlayerHitboxes() {
  const p = player.state;
  playerHitTorso.position.set(p.position.x, p.position.y + 1.05, p.position.z);
  playerHitHead.position.set(p.position.x, p.position.y + 1.53, p.position.z);
}

function hudRefresh() {
  const def = weapons.def();
  hud.setHealth(player.state.health);
  hud.setAmmo(weapons.ammo[weapons.current].mag, weapons.ammo[weapons.current].reserve, def.name, weapons.grenades);
  hud.setMoney(game.money);
  hud.setScore(game.score.van, game.score.sen, game.round);
  if (game.phase === 'buy') hud.setTimer(game.buyTimer, 'BUY');
  else if (game.bombPlanted) hud.setTimer(bomb.state.timeLeft, 'CHARGE');
  else hud.setTimer(game.roundTimer, 'ROUND');
  hud.setBomb(game.bombPlanted ? `CHARGE PLANTED — ${game.bombSite.name}` : 'CHARGE NOT PLANTED');
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    game.started = true;
    hud.hideOverlay();
    hud.hideBanner();
  } else if (game.phase === 'live' || game.phase === 'buy') {
    hud.showOverlay(game.started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.phase === 'matchEnd') {
    startMatch();
    input.requestLock();
    return;
  }
  if (game.phase === 'menu') {
    startMatch();
  }
  input.requestLock();
});

function startMatch() {
  game.score = { van: 0, sen: 0 };
  game.money = 800;
  game.round = 1;
  game.matchOver = false;
  weapons.resetLoadout();
  startRound();
}

function startRound() {
  game.phase = 'buy';
  game.buyTimer = BUY_TIME;
  game.roundTimer = ROUND_TIME;
  game.bombPlanted = false;
  game.bombSite = null;
  game.plantProgress = 0;
  game.plantSite = null;
  bomb.reset();
  grenades.length = 0;
  const spawn = SPAWNS.attack[Math.floor(random() * SPAWNS.attack.length)];
  player.reset(spawn[0], spawn[1], 0);
  if (!game.survived) weapons.resetLoadout();
  else weapons.refillAmmo();
  bots.spawn('attack', SPAWNS.attack);
  bots.spawn('defend', SPAWNS.defend);
  refreshShootTargets();
  hud.hideBanner();
  hud.showBuy(game.money, weapons.owned, weapons.grenades);
  hud.setHint('Buy phase — B for shop, then push a site. Hold E at A or B to plant.');
  hudRefresh();
}

function endBuy() {
  if (game.phase !== 'buy') return;
  game.phase = 'live';
  hud.hideBuy();
  hud.setHint('Plant the charge at A or B. Eliminate Sentinel or detonate the charge.');
  audio.roundStart();
  hudRefresh();
}

function buyItem(id) {
  if (game.phase !== 'buy') return;
  if (id === 'grenade') {
    if (game.money < GRENADE.price || !weapons.buyGrenade()) return;
    game.money -= GRENADE.price;
  } else {
    const def = WEAPONS[id];
    if (!def || game.money < def.price || weapons.owned[id]) return;
    game.money -= def.price;
    weapons.buy(id);
    weapons.switchTo(id);
  }
  audio.buy();
  hud.showBuy(game.money, weapons.owned, weapons.grenades);
  hudRefresh();
}

function endRound(winner, reason) {
  if (game.phase !== 'live') return;
  game.phase = 'roundEnd';
  game.roundEndAt = game.elapsed + 3.5;
  game.survived = player.state.alive;
  if (winner === 'van') {
    game.score.van += 1;
    game.money += WIN_REWARD;
  } else {
    game.score.sen += 1;
    game.money += LOSS_REWARD;
  }
  const title = winner === 'van' ? 'Vanguard wins the round' : 'Sentinel wins the round';
  hud.showBanner(title, reason);
  if (winner === 'van') audio.roundWin();
  else audio.roundLose();
  input.releaseLock();
  hudRefresh();
}

function endMatch() {
  game.phase = 'matchEnd';
  game.matchOver = true;
  const { van, sen } = game.score;
  const text = van === sen
    ? `Draw — Vanguard ${van} : ${sen} Sentinel. The depot keeps its secrets.`
    : van > sen
      ? `Vanguard takes the match ${van} : ${sen}. The depot is yours.`
      : `Sentinel takes the match ${van} : ${sen}. The depot holds.`;
  hud.showOverlay('matchEnd', text);
  input.releaseLock();
}

function nextAfterRound() {
  const { van, sen } = game.score;
  if (van >= WIN_SCORE || sen >= WIN_SCORE || game.round >= MAX_ROUNDS) {
    endMatch();
    return;
  }
  game.round += 1;
  startRound();
}

function onBotDefused(bot) {
  if (!game.bombPlanted) return;
  bomb.defused();
  game.bombPlanted = false;
  hud.killfeed(bot.name, 'Charge', false, 'defend');
  endRound('sen', `${bot.name} defused the charge.`);
}

function onBombExplode() {
  game.bombPlanted = false;
  effects.explosion(tmpVec.set(game.bombSite.x, 0.6, game.bombSite.z));
  audio.explosion();
  endRound('van', 'The charge detonated.');
}

function falloff(dist, range) {
  return Math.max(0.5, 1 - dist / (range * 1.6));
}

function resolveShot(from, dir, maxDist, damageBase, headMult, targets) {
  raycaster.set(from, dir);
  raycaster.far = maxDist;
  scene.updateMatrixWorld(true);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return { point: tmpVec.copy(from).addScaledVector(dir, maxDist).clone(), hit: null };
  const point = hit.point.clone();
  if (hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const part = hit.object.userData.part;
    const dist = from.distanceTo(point);
    const damage = Math.round(damageBase * (part === 'head' ? headMult : 1) * falloff(dist, maxDist));
    const killed = bots.damage(bot, damage, part);
    return { point, hit: { kind: 'bot', bot, part, damage, killed } };
  }
  if (hit.object === playerHitTorso || hit.object === playerHitHead) {
    const part = hit.object.userData.part;
    const dist = from.distanceTo(point);
    const damage = Math.round(damageBase * (part === 'head' ? headMult : 1) * falloff(dist, maxDist));
    return { point, hit: { kind: 'player', part, damage } };
  }
  return { point, hit: { kind: 'world' } };
}

function onBotShoot(bot, muzzlePos, dir) {
  const result = resolveShot(muzzlePos, dir, 80, 11 + random() * 6, 2.5, botShootTargets);
  effects.tracer(muzzlePos, result.point);
  if (result.hit && result.hit.kind === 'player') {
    const died = player.damage(result.hit.damage);
    hud.damageFlash();
    audio.hurt();
    if (died) {
      hud.killfeed(bot.name, 'You', result.hit.part === 'head', 'defend');
      hud.setHint(`Down — spectating ${bots.bots.find((b) => b.side === 'attack' && b.alive)?.name ?? 'no one'}.`);
    }
  } else if (result.hit && result.hit.kind === 'bot') {
    const victim = result.hit.bot;
    if (victim.side === 'attack') {
      effects.blood(result.point);
      if (result.hit.killed) hud.killfeed(bot.name, victim.name, result.hit.part === 'head', 'defend');
    } else {
      effects.blood(result.point);
      if (result.hit.killed) hud.killfeed(bot.name, victim.name, result.hit.part === 'head', 'defend');
    }
  } else if (result.hit && result.hit.kind === 'world') {
    effects.impact(result.point);
  }
  audio.distantShot();
}

function shootPlayer(spread) {
  const def = weapons.def();
  if (!weapons.takeRound()) return;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.5);
  muzzle.y -= 0.12;
  const result = resolveShot(camera.position, direction, def.range, def.damage, def.headMult, playerShootTargets);
  effects.tracer(muzzle, result.point);
  if (result.hit && result.hit.kind === 'bot') {
    const victim = result.hit.bot;
    effects.blood(result.point);
    hud.hitMarker(result.hit.killed);
    if (result.hit.killed) {
      game.money += KILL_REWARD;
      hud.killfeed('You', victim.name, result.hit.part === 'head', 'attack');
      audio.kill();
    } else {
      audio.hit();
    }
  } else if (result.hit && result.hit.kind === 'world') {
    effects.impact(result.point);
  }
  weapons.pullTrigger();
  player.recoil(def.kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(def.id);
  hudRefresh();
}

function throwGrenade() {
  if (game.phase !== 'live' || !player.state.alive) return;
  if (!weapons.throwGrenade()) return;
  audio.grenadePin();
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.5 }),
  );
  mesh.position.copy(camera.position).addScaledVector(direction, 0.4);
  scene.add(mesh);
  grenades.push({
    mesh,
    pos: mesh.position,
    vel: direction.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: GRENADE_FUSE,
    bounced: 0,
  });
  hudRefresh();
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  effects.explosion(g.pos);
  audio.explosion();
  const victims = [];
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.position.distanceTo(g.pos);
    if (d > GRENADE_RADIUS) continue;
    const damage = Math.round(120 * (1 - d / GRENADE_RADIUS) + 10);
    const killed = bots.damage(bot, damage, 'torso');
    victims.push({ bot, killed });
    if (killed && bot.side === 'defend') {
      game.money += KILL_REWARD;
      hud.killfeed('You', bot.name, false, 'attack');
    }
  }
  const pd = player.state.position.distanceTo(g.pos);
  if (pd < GRENADE_RADIUS && player.state.alive) {
    const damage = Math.min(80, Math.round(110 * (1 - pd / GRENADE_RADIUS) + 10));
    const died = player.damage(damage);
    hud.damageFlash();
    audio.hurt();
    if (died) hud.setHint('Down — spectating a teammate.');
  }
  void victims;
}

function grenadeStep(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    const next = tmpVec.copy(g.pos).addScaledVector(g.vel, dt);
    // Simple bounce: test the next position against world colliders, axis by axis.
    const probe = new THREE.Box3(
      new THREE.Vector3(next.x - 0.09, next.y - 0.09, next.z - 0.09),
      new THREE.Vector3(next.x + 0.09, next.y + 0.09, next.z + 0.09),
    );
    let hitAxis = null;
    for (const c of world.colliders) {
      if (!probe.intersectsBox(c)) continue;
      if (g.vel.x !== 0 && Math.abs(next.x - g.pos.x) > 0.001) hitAxis = 'x';
      else if (g.vel.z !== 0 && Math.abs(next.z - g.pos.z) > 0.001) hitAxis = 'z';
      else hitAxis = 'y';
      break;
    }
    if (hitAxis === 'x') {
      g.vel.x *= -0.45;
      next.x = g.pos.x;
    } else if (hitAxis === 'z') {
      g.vel.z *= -0.45;
      next.z = g.pos.z;
    } else if (hitAxis === 'y') {
      g.vel.y *= -0.45;
      next.y = g.pos.y + 0.1;
      if (Math.abs(g.vel.y) > 1.5) audio.bounce();
    }
    g.pos.copy(next);
    if (g.pos.y < 0.09) {
      g.pos.y = 0.09;
      g.vel.y = Math.abs(g.vel.y) > 1.5 ? -g.vel.y * 0.45 : 0;
      g.vel.x *= 0.8;
      g.vel.z *= 0.8;
    }
    if (g.fuse <= 0) {
      explodeGrenade(g);
      grenades.splice(i, 1);
    }
  }
}

function plantStep(dt, pressed) {
  if (game.phase !== 'live' || !player.state.alive || game.bombPlanted) {
    game.plantProgress = 0;
    hud.setPlantProgress(null);
    return;
  }
  const p = player.state.position;
  let site = null;
  for (const s of Object.values(SITES)) {
    if (Math.hypot(p.x - s.x, p.z - s.z) <= s.r) {
      site = s;
      break;
    }
  }
  const holding = input.state.keys.has('KeyE');
  if (!site || !holding) {
    if (game.plantProgress > 0) hud.setHint('Planting interrupted.');
    game.plantProgress = 0;
    game.plantSite = null;
    hud.setPlantProgress(null);
    return;
  }
  if (game.plantSite !== site) {
    game.plantSite = site;
    game.plantStart = { x: p.x, z: p.z };
    game.plantProgress = 0;
  }
  if (Math.hypot(p.x - game.plantStart.x, p.z - game.plantStart.z) > 1.4) {
    game.plantProgress = 0;
    game.plantStart = { x: p.x, z: p.z };
    hud.setHint('Hold still to plant the charge.');
    hud.setPlantProgress(null);
    return;
  }
  game.plantProgress += dt;
  hud.setPlantProgress(Math.min(1, game.plantProgress / bomb.plantTime));
  hud.setHint(`Planting the charge at ${site.name}… keep holding E.`);
  if (game.plantProgress >= bomb.plantTime) {
    bomb.plant(site);
    game.bombPlanted = true;
    game.bombSite = site;
    game.money += PLANT_REWARD;
    game.plantProgress = 0;
    hud.setPlantProgress(null);
    hud.setHint('Charge planted — defend it until it blows.');
    hudRefresh();
  }
  void pressed;
}

function checkRoundEnd() {
  if (game.phase !== 'live') return;
  const attackers = bots.aliveCount('attack') + (player.state.alive ? 1 : 0);
  const defenders = bots.aliveCount('defend');
  if (defenders === 0) {
    endRound('van', 'Sentinel eliminated.');
    return;
  }
  if (attackers === 0 && !game.bombPlanted) {
    endRound('sen', 'Vanguard eliminated.');
    return;
  }
  if (!game.bombPlanted && game.roundTimer <= 0) {
    endRound('sen', 'Time expired — the charge was never planted.');
  }
}

function step(dt) {
  game.elapsed += dt;
  const keys = input.state.keys;
  if (game.phase === 'buy') {
    game.buyTimer -= dt;
    player.step(dt, keys);
    weapons.step(dt);
    effects.step(dt);
    if (game.buyTimer <= 0) endBuy();
  } else if (game.phase === 'live') {
    if (!game.bombPlanted) game.roundTimer -= dt;
    player.step(dt, keys);
    weapons.step(dt);
    bots.setPlayerVelocity(player.state.velocity.x, player.state.velocity.z);
    bots.step(dt, game.elapsed, {
      player: player.state,
      bombPlanted: game.bombPlanted,
      bombSite: game.bombSite,
    });
    bomb.update(dt, onBombExplode);
    grenadeStep(dt);
    effects.step(dt);
    plantStep(dt);
    checkRoundEnd();
  } else if (game.phase === 'roundEnd') {
    effects.step(dt);
    if (game.elapsed >= game.roundEndAt) nextAfterRound();
  } else {
    effects.step(dt);
  }
  bots.setPlayerVelocity(player.state.velocity.x, player.state.velocity.z);
  syncPlayerHitboxes();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!game.frozen) {
    const look = input.takeLook();
    if (input.state.locked) player.look(look.x, look.y);
    const pressed = input.takePressed();
    if (pressed.has('KeyB') && game.phase === 'buy') {
      if (hud.buyOpen) hud.hideBuy();
      else hud.showBuy(game.money, weapons.owned, weapons.grenades);
    }
    if (pressed.has('KeyM')) audio.toggleMute();
    if (game.phase === 'buy') {
      if (pressed.has('Digit1')) weapons.switchTo('pistol');
      if (pressed.has('Digit2')) buyItem('smg');
      if (pressed.has('Digit3')) buyItem('rifle');
      if (pressed.has('Digit4')) buyItem('grenade');
    }
    if (pressed.has('KeyG')) throwGrenade();
    if (pressed.has('KeyR') && (game.phase === 'live' || game.phase === 'buy')) {
      if (weapons.reload()) audio.reload();
    }
    if (pressed.has('Digit1') && game.phase === 'live') weapons.switchTo('pistol');
    if (pressed.has('Digit2') && game.phase === 'live') weapons.switchTo('smg');
    if (pressed.has('Digit3') && game.phase === 'live') weapons.switchTo('rifle');
    if (input.state.firing && game.phase === 'live' && player.state.alive) {
      const def = weapons.def();
      if (weapons.ready() && (def.auto || !prevFiring)) shootPlayer(weapons.spread(player.groundSpeed()));
    }
    prevFiring = input.state.firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    // Crosshair spread follows movement + fire heat.
    hud.setCrosshair(6 + player.groundSpeed() * 1.6 + weapons.state.heat * 14);
    syncCamera();
    hudRefresh();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      game.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  startMatch();
  game.phase = 'live';
  hud.hideBuy();
  if (name === 'start') {
    game.phase = 'buy';
    player.reset(0.6, 13, 0);
    settle(20);
    hud.showOverlay('start');
    hud.setHint('');
  } else if (name === 'buy') {
    game.phase = 'buy';
    player.reset(0, 12, 0);
    settle(20);
    hud.showBuy(game.money, weapons.owned, weapons.grenades);
  } else if (name === 'play') {
    player.reset(0, 6, 0);
    // A defender holds the east lane; the player fires twice, one round lands.
    const defender = bots.bots.find((b) => b.side === 'defend');
    defender.position.set(3.5, 0, -7);
    defender.yaw = Math.PI;
    settle(24);
    const target = new THREE.Vector3(3.5, 1.2, -7);
    const dx = target.x - player.state.position.x;
    const dy = target.y - (player.state.position.y + player.state.eye);
    const dz = target.z - player.state.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    syncCamera();
    weapons.buy('rifle');
    weapons.switchTo('rifle');
    hud.setHint('Plant the charge at A or B. Eliminate Sentinel or detonate the charge.');
    shootPlayer(0);
    settle(8);
    shootPlayer(0);
    settle(6);
  } else if (name === 'plant') {
    const site = SITES.A;
    // Player south of the warehouse door gap, looking north through it at the planted
    // charge, a defender pushing in from the east, and a teammate guarding inside.
    player.reset(14.5, -2.5, 0);
    const aim = new THREE.Vector3(site.x, 1.2, site.z);
    const dx = aim.x - player.state.position.x;
    const dz = aim.z - player.state.position.z;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = -0.02;
    bomb.plant(site);
    game.bombPlanted = true;
    game.bombSite = site;
    game.money += PLANT_REWARD;
    const defender = bots.bots.find((b) => b.side === 'defend');
    defender.position.set(16, 0, -4);
    defender.yaw = Math.PI * 0.9;
    const mate = bots.bots.find((b) => b.side === 'attack');
    mate.position.set(18, 0, -9);
    mate.yaw = Math.PI * 0.5;
    settle(24);
    hud.setHint('Charge planted — defend it until it blows.');
  }
  hudRefresh();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.showOverlay('start');
syncCamera();
hudRefresh();
// Debug handle for automated play-testing (headless smoke tests read the live state).
window.__ember = { game, player, bots, weapons, bomb, grenades };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
