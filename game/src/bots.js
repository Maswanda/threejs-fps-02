// Bots: both teams, one brain. A bot walks a waypoint path to its objective, holds angles,
// and fights what it sees: a reaction delay, then bursts with spread that grows with the
// target's speed and distance. Defenders converge to defuse once the charge is planted;
// attackers guard it. Shots are real raycasts resolved by main.js, so a bot can miss, hit
// cover, or hit a teammate in the way.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { findPath, nearestWaypoint, waypointPos } from './map.js';
import { range, intRange, pick } from './rng.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const WALK_SPEED = 3.3;
const ENGAGE_SPEED = 2.1;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.7;
const PERCEIVE_EVERY = 0.15;
const SIGHT_RANGE = 46;
const FOV_COS = -0.25;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.11;
const DEFUSE_TIME = 5;
const HEALTH = 100;

const ATTACK_NAMES = ['Ash', 'Bram', 'Cy', 'Dax'];
const DEFEND_NAMES = ['Echo', 'Frost', 'Ghost', 'Hawk', 'Ivy'];
const HOLD_POINTS = {
  defend: ['siteA', 'siteA', 'siteB', 'siteB', 'midN'],
  attack: ['siteA', 'siteB', 'siteA', 'siteB'],
};

function buildBody(side, name) {
  const group = new THREE.Group();
  const teamColor = side === 'attack' ? PALETTE.vanguard : PALETTE.sentinel;
  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.65, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a37e'), roughness: 0.6 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.5, metalness: 0.15 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), darkMat);
  legL.position.set(-0.12, 0.28, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), darkMat);
  legR.position.set(0.12, 0.28, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), torsoMat);
  torso.position.y = 1.0;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 0.34), darkMat);
  vest.position.y = 1.02;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), headMat);
  head.position.y = 1.53;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
  helmet.position.y = 1.55;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.22, 1.12, -0.3);
  group.add(legL, legR, torso, vest, head, helmet, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  group.userData.name = name;
  return { group, torso, head, gun };
}

export function createBots(scene, colliders, shootables, random, api) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = SIGHT_RANGE + 10;
  const probe = new THREE.Box3();
  const bots = [];
  const losFrom = new THREE.Vector3();
  const losDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function overlaps(x, z, lift) {
    probe.min.set(x - BOT_RADIUS, lift, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - lift, z + BOT_RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function canSee(from, to) {
    losFrom.copy(from);
    losDir.copy(to).sub(from);
    const dist = losDir.length();
    if (dist > SIGHT_RANGE) return false;
    losDir.normalize();
    raycaster.set(losFrom, losDir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(shootables, false);
    return hits.length === 0;
  }

  function makeBot(side, index, spawn) {
    const name = side === 'attack' ? ATTACK_NAMES[index] : DEFEND_NAMES[index];
    const body = buildBody(side, name);
    body.group.position.set(spawn[0], 0, spawn[1]);
    scene.add(body.group);
    const bot = {
      id: `${side}-${index}`,
      name,
      side,
      group: body.group,
      torso: body.torso,
      head: body.head,
      gun: body.gun,
      hitMeshes: [body.torso, body.head],
      position: body.group.position,
      yaw: side === 'attack' ? Math.PI : 0,
      health: HEALTH,
      alive: true,
      state: 'advance',
      path: [],
      pathIndex: 0,
      target: null,
      targetKey: null,
      lastSeen: null,
      lastSeenAt: -99,
      perceiveAt: 0,
      reactionLeft: 0,
      burstLeft: 0,
      burstGap: 0,
      cooldown: 0,
      strafeDir: 1,
      strafeAt: 0,
      holdUntil: 0,
      holdPoint: null,
      assignedSite: null,
      defuseLeft: 0,
      fall: 0,
      hiddenAt: 0,
      speed: 0,
      stuckAt: 0,
      lastX: spawn[0],
      lastZ: spawn[1],
    };
    body.torso.userData.bot = bot;
    body.torso.userData.part = 'torso';
    body.head.userData.bot = bot;
    body.head.userData.part = 'head';
    bots.push(bot);
    return bot;
  }

  function setObjective(bot, waypointId) {
    const from = nearestWaypoint(bot.position.x, bot.position.z);
    bot.path = findPath(from, waypointId);
    bot.pathIndex = 0;
    bot.state = 'advance';
  }

  function assignRound(bot, index) {
    bot.health = HEALTH;
    bot.alive = true;
    bot.fall = 0;
    bot.group.visible = true;
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.group.position.y = 0;
    bot.target = null;
    bot.targetKey = null;
    bot.lastSeen = null;
    bot.defuseLeft = 0;
    bot.reactionLeft = 0;
    bot.burstLeft = 0;
    bot.cooldown = 0;
    if (bot.side === 'attack') {
      bot.assignedSite = pick(random, ['A', 'B']);
      bot.holdPoint = bot.assignedSite === 'A' ? 'siteA' : 'siteB';
      setObjective(bot, bot.holdPoint);
    } else {
      const points = HOLD_POINTS.defend;
      bot.holdPoint = points[index % points.length];
      bot.assignedSite = bot.holdPoint === 'siteA' ? 'A' : bot.holdPoint === 'siteB' ? 'B' : null;
      setObjective(bot, bot.holdPoint);
    }
  }

  function faceToward(bot, x, z, dt) {
    const want = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += diff * Math.min(1, dt * 8);
  }

  function moveToward(bot, x, z, dt, speed) {
    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepLen = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * stepLen;
    const nz = bot.position.z + (dz / dist) * stepLen;
    if (!overlaps(nx, bot.position.z, 0.04)) bot.position.x = nx;
    if (!overlaps(bot.position.x, nz, 0.04)) bot.position.z = nz;
    bot.speed = speed;
    faceToward(bot, x, z, dt);
    return dist - stepLen < 0.6;
  }

  function perceive(bot, time, ctx) {
    // Visible enemies: the player and the other side's bots.
    const enemies = [];
    if (bot.side === 'defend' && ctx.player.alive) enemies.push({ kind: 'player', pos: ctx.player.position, eye: ctx.player.eye });
    for (const other of bots) {
      if (other.side === bot.side || !other.alive) continue;
      enemies.push({ kind: 'bot', bot: other, pos: other.position, eye: 1.45 });
    }
    let best = null;
    let bestDist = Infinity;
    // Line of sight is checked from gun height, the same height the shot leaves
    // from — a head-height check would clear cover the bullets cannot clear.
    const eye = tmp.set(bot.position.x, bot.position.y + 1.15, bot.position.z);
    for (const enemy of enemies) {
      const chest = new THREE.Vector3(enemy.pos.x, enemy.pos.y + enemy.eye * 0.85, enemy.pos.z);
      const dist = eye.distanceTo(chest);
      if (dist > SIGHT_RANGE || dist >= bestDist) continue;
      // Facing: the bot must roughly look toward the enemy (wide cone, it turns fast).
      const fx = -Math.sin(bot.yaw);
      const fz = -Math.cos(bot.yaw);
      const dot = ((chest.x - eye.x) * fx + (chest.z - eye.z) * fz) / dist;
      if (dot < FOV_COS && dist > 4) continue;
      if (!canSee(eye, chest)) continue;
      best = { enemy, chest, dist };
      bestDist = dist;
    }
    if (best) {
      // Identity is the stable thing: 'player', or the enemy bot's id. The enemy
      // records are rebuilt every perceive tick, so comparing the records themselves
      // would reset the reaction delay forever and no bot would ever fire.
      const key = best.enemy.kind === 'player' ? 'player' : best.enemy.bot.id;
      if (bot.targetKey !== key) {
        bot.targetKey = key;
        bot.target = best.enemy.kind === 'player' ? { kind: 'player' } : { kind: 'bot', bot: best.enemy.bot };
        bot.reactionLeft = range(random, REACTION_MIN, REACTION_MAX);
        bot.burstLeft = 0;
      }
      bot.lastSeen = best.chest;
      bot.lastSeenAt = time;
    } else if (bot.target && time - bot.lastSeenAt > 1.5) {
      bot.target = null;
      bot.targetKey = null;
      bot.lastSeen = null;
    }
  }

  function aimError(bot, dist, targetSpeed) {
    return 0.024 + dist * 0.001 + targetSpeed * 0.004 + (bot.speed > 0.5 ? 0.016 : 0);
  }

  function shootAt(bot, time, ctx) {
    const target = bot.target;
    if (!target) return;
    const aim = target.kind === 'player'
      ? new THREE.Vector3(ctx.player.position.x, ctx.player.position.y + ctx.player.eye * (random() < 0.08 ? 0.98 : 0.82), ctx.player.position.z)
      : new THREE.Vector3(target.bot.position.x, target.bot.position.y + (random() < 0.08 ? 1.53 : 1.15), target.bot.position.z);
    const muzzle = new THREE.Vector3();
    bot.gun.getWorldPosition(muzzle);
    const dir = aim.clone().sub(muzzle).normalize();
    const dist = muzzle.distanceTo(aim);
    const targetSpeed = target.kind === 'player' ? Math.hypot(ctxPlayerVel.x, ctxPlayerVel.z) : target.bot.speed;
    const err = aimError(bot, dist, targetSpeed);
    dir.x += (random() * 2 - 1) * err;
    dir.y += (random() * 2 - 1) * err;
    dir.z += (random() * 2 - 1) * err;
    dir.normalize();
    api.shoot(bot, muzzle, dir);
  }

  // Player velocity, refreshed by main.js each frame for bot aim error.
  const ctxPlayerVel = { x: 0, z: 0 };

  function stepBot(bot, dt, time, ctx) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.1;
      }
      return;
    }
    bot.speed = 0;
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    if (time >= bot.perceiveAt) {
      bot.perceiveAt = time + PERCEIVE_EVERY;
      perceive(bot, time, ctx);
    }

    // Bomb planted: defenders run to defuse, attackers guard the site.
    if (ctx.bombPlanted && bot.side === 'defend') {
      const site = ctx.bombSite;
      const dx = bot.position.x - site.x;
      const dz = bot.position.z - site.z;
      if (Math.hypot(dx, dz) > 2.2) {
        if (bot.state !== 'defuse-run') {
          bot.state = 'defuse-run';
          setObjective(bot, site.name === 'A' ? 'siteA' : 'siteB');
        }
      } else {
        bot.state = 'defusing';
        bot.defuseLeft += dt;
        faceToward(bot, site.x, site.z, dt);
        if (bot.defuseLeft >= DEFUSE_TIME) api.defused(bot);
        return;
      }
    } else if (ctx.bombPlanted && bot.side === 'attack') {
      if (bot.state !== 'guard') {
        bot.state = 'guard';
        setObjective(bot, ctx.bombSite.name === 'A' ? 'siteA' : 'siteB');
      }
    }

    if (bot.target) {
      bot.state = 'engage';
      const t = bot.target;
      const tx = t.kind === 'player' ? ctx.player.position.x : t.bot.position.x;
      const tz = t.kind === 'player' ? ctx.player.position.z : t.bot.position.z;
      faceToward(bot, tx, tz, dt);
      // Strafe while fighting, switching direction every second or so.
      if (time >= bot.strafeAt) {
        bot.strafeAt = time + range(random, 0.7, 1.4);
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const sx = Math.cos(bot.yaw) * bot.strafeDir;
      const sz = -Math.sin(bot.yaw) * bot.strafeDir;
      const nx = bot.position.x + sx * ENGAGE_SPEED * dt;
      const nz = bot.position.z + sz * ENGAGE_SPEED * dt;
      if (!overlaps(nx, bot.position.z, 0.04)) bot.position.x = nx;
      if (!overlaps(bot.position.x, nz, 0.04)) bot.position.z = nz;
      bot.speed = ENGAGE_SPEED;
      if (bot.reactionLeft > 0) {
        bot.reactionLeft -= dt;
      } else if (bot.burstLeft > 0) {
        bot.burstGap -= dt;
        if (bot.burstGap <= 0) {
          bot.burstGap = SHOT_GAP;
          bot.burstLeft -= 1;
          shootAt(bot, time, ctx);
          if (bot.burstLeft === 0) bot.cooldown = range(random, 0.7, 1.3);
        }
      } else if (bot.cooldown <= 0) {
        bot.burstLeft = intRange(random, BURST_MIN, BURST_MAX);
        bot.burstGap = 0;
      }
      return;
    }

    // No target: walk the objective path, then hold and scan.
    if (bot.state === 'advance' || bot.state === 'guard' || bot.state === 'defuse-run') {
      const wp = bot.path[bot.pathIndex];
      if (wp) {
        const { x, z } = waypointPos(wp);
        // Stuck recovery: if the bot has barely moved in 2.5 s, re-path to its hold
        // point and sidestep, so a bad corner never freezes the round.
        const moved = Math.hypot(bot.position.x - bot.lastX, bot.position.z - bot.lastZ);
        if (moved > 0.5) {
          bot.lastX = bot.position.x;
          bot.lastZ = bot.position.z;
          bot.stuckAt = time;
        } else if (time - bot.stuckAt > 2.5) {
          bot.stuckAt = time;
          bot.lastX = bot.position.x;
          bot.lastZ = bot.position.z;
          bot.position.x += (random() - 0.5) * 1.2;
          bot.position.z += (random() - 0.5) * 1.2;
          setObjective(bot, bot.holdPoint || 'mid');
        }
        if (moveToward(bot, x, z, dt, WALK_SPEED)) bot.pathIndex += 1;
        if (bot.pathIndex >= bot.path.length) {
          bot.state = 'hold';
          bot.holdUntil = time + range(random, 2.5, 5);
        }
      } else {
        bot.state = 'hold';
        bot.holdUntil = time + range(random, 2.5, 5);
      }
      return;
    }
    // Hold: scan around slowly; attackers at a site keep watching the approaches.
    bot.yaw += dt * 0.25;
    if (bot.state === 'hold' && time >= bot.holdUntil && bot.side === 'attack') {
      // Attackers who reached their site hold it; if the bomb is not planted and the
      // player is elsewhere, drift to the other site once in a while.
      if (!ctx.bombPlanted && random() < 0.3) {
        bot.assignedSite = bot.assignedSite === 'A' ? 'B' : 'A';
        setObjective(bot, bot.assignedSite === 'A' ? 'siteA' : 'siteB');
      } else {
        bot.holdUntil = time + range(random, 3, 6);
      }
    }
  }

  return {
    bots,
    spawn(side, spawnPoints) {
      const list = [];
      const count = side === 'attack' ? ATTACK_NAMES.length : DEFEND_NAMES.length;
      for (let i = 0; i < count; i += 1) {
        const existing = bots.find((b) => b.side === side && b.id.endsWith(`-${i}`));
        const bot = existing || makeBot(side, i, spawnPoints[i % spawnPoints.length]);
        bot.position.set(spawnPoints[i % spawnPoints.length][0], 0, spawnPoints[i % spawnPoints.length][1]);
        bot.yaw = side === 'attack' ? Math.PI : 0;
        bot.group.rotation.set(0, bot.yaw, 0);
        assignRound(bot, i);
        list.push(bot);
      }
      return list;
    },
    step(dt, time, ctx) {
      for (const bot of bots) stepBot(bot, dt, time, ctx);
    },
    setPlayerVelocity(x, z) {
      ctxPlayerVel.x = x;
      ctxPlayerVel.z = z;
    },
    damage(bot, amount, part) {
      if (!bot.alive) return false;
      bot.health -= amount;
      // A hit interrupts a defuse.
      if (bot.state === 'defusing') {
        bot.defuseLeft = 0;
        bot.state = 'engage';
      }
      if (bot.health > 0) return false;
      bot.health = 0;
      bot.alive = false;
      bot.fall = 0;
      bot.target = null;
      return true;
    },
    aliveCount(side) {
      return bots.filter((b) => b.side === side && b.alive).length;
    },
    reset() {
      for (const bot of bots) {
        bot.alive = false;
        bot.group.visible = false;
      }
    },
  };
}
