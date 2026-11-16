// The arsenal: three hitscan guns and a frag grenade. Each weapon owns its numbers, its
// view model and its reload; main.js owns the ray and the damage. Spread grows with
// movement speed and with sustained fire, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, auto: false,
    damage: 26, headMult: 3.2, mag: 12, reserve: 48,
    fireGap: 0.16, reloadTime: 1.35, spreadStill: 0.0028, spreadMove: 0.02,
    kick: 0.007, range: 60,
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', price: 1500, auto: true,
    damage: 22, headMult: 3, mag: 32, reserve: 96,
    fireGap: 0.075, reloadTime: 1.7, spreadStill: 0.005, spreadMove: 0.034,
    kick: 0.005, range: 55,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', price: 2700, auto: true,
    damage: 34, headMult: 3, mag: 30, reserve: 90,
    fireGap: 0.096, reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028,
    kick: 0.009, range: 80,
  },
};

export const GRENADE = { id: 'grenade', name: 'Frag Grenade', price: 300, maxCarry: 2 };

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  if (def.id === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.26), body);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.2), grip);
    frame.position.set(0, -0.03, 0.02);
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), grip);
    gripMesh.position.set(0, -0.1, 0.09);
    gripMesh.rotation.x = 0.25;
    model.add(slide, frame, gripMesh);
    model.position.set(0.2, -0.2, -0.35);
  } else if (def.id === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), grip);
    barrel.position.set(0, 0.02, -0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), accent);
    mag.position.set(0, -0.12, -0.02);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), grip);
    stock.position.set(0, -0.01, 0.24);
    model.add(receiver, barrel, mag, stock);
    model.position.set(0.22, -0.2, -0.4);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accent);
    sight.position.set(0, 0.07, -0.05);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.24, -0.2, -0.42);
  }
  return model;
}

export function createWeaponSet(camera, onEmpty) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const owned = { pistol: true, smg: false, rifle: false };
  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  let current = 'pistol';
  let grenades = 0;
  const state = { cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, heat: 0, switchLeft: 0 };
  models[current].visible = true;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.heat = Math.max(0, state.heat - dt * 1.4);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[current];
    model.position.z = (current === 'pistol' ? -0.35 : -0.4) + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[current];
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - ammo[current].mag;
        const take = Math.min(need, ammo[current].reserve);
        ammo[current].mag += take;
        ammo[current].reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    owned,
    get current() {
      return current;
    },
    get grenades() {
      return grenades;
    },
    def() {
      return WEAPONS[current];
    },
    step,
    ready() {
      return ammo[current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    pullTrigger() {
      const def = WEAPONS[current];
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.heat = Math.min(1, state.heat + 0.14);
    },
    takeRound() {
      if (ammo[current].mag <= 0) {
        if (onEmpty) onEmpty();
        return false;
      }
      ammo[current].mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[current];
      if (state.reloadLeft > 0 || ammo[current].mag === def.mag || ammo[current].reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      const def = WEAPONS[current];
      const move = Math.min(1, speed / 5.4);
      return def.spreadStill + move * def.spreadMove + state.heat * 0.012;
    },
    switchTo(id) {
      if (!owned[id] || id === current || state.switchLeft > 0) return false;
      models[current].visible = false;
      current = id;
      models[current].visible = true;
      state.switchLeft = 0.28;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.1);
      return true;
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = true;
      ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    buyGrenade() {
      if (grenades >= GRENADE.maxCarry) return false;
      grenades += 1;
      return true;
    },
    throwGrenade() {
      if (grenades <= 0) return false;
      grenades -= 1;
      return true;
    },
    refillAmmo() {
      for (const def of Object.values(WEAPONS)) {
        if (owned[def.id]) ammo[def.id] = { mag: def.mag, reserve: def.reserve };
      }
    },
    resetLoadout() {
      owned.smg = false;
      owned.rifle = false;
      grenades = 0;
      current = 'pistol';
      for (const id of Object.keys(models)) models[id].visible = id === 'pistol';
      this.refillAmmo();
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.heat = 0;
    },
  };
}
