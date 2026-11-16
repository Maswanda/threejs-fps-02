// The charge: planted by the player at a site, a 35-second fuse, a blinking light, and a
// beep that quickens as the end nears. Defenders end the round by defusing it; attackers
// win when it goes off.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_TIME = 3;
const BOMB_TIME = 35;

export function createBomb(scene, audio) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.28, 0.36),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.4 }),
  );
  body.position.y = 0.14;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  light.position.set(0.18, 0.3, 0);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.6 }),
  );
  antenna.position.set(-0.18, 0.42, 0);
  group.add(body, light, antenna);
  group.visible = false;
  scene.add(group);

  const state = {
    status: 'carried', // carried | planted | defused | exploded
    site: null,
    timeLeft: BOMB_TIME,
    beepAt: 0,
    blink: 0,
  };

  return {
    state,
    plantTime: PLANT_TIME,
    bombTime: BOMB_TIME,
    plant(site) {
      state.status = 'planted';
      state.site = site;
      state.timeLeft = BOMB_TIME;
      state.beepAt = 0;
      group.position.set(site.x, 0, site.z);
      group.visible = true;
      audio.plant();
    },
    update(dt, onExplode) {
      if (state.status !== 'planted') return;
      state.timeLeft -= dt;
      state.blink += dt;
      const interval = state.timeLeft > 15 ? 1 : state.timeLeft > 7 ? 0.5 : 0.25;
      if (state.timeLeft <= state.beepAt) {
        state.beepAt = state.timeLeft - interval;
        audio.beep(state.timeLeft <= 3);
      }
      light.material.color.setHex(Math.sin(state.blink * 10) > 0 ? 0xf2a33c : 0x661111);
      if (state.timeLeft <= 0) {
        state.status = 'exploded';
        group.visible = false;
        onExplode();
      }
    },
    defused() {
      state.status = 'defused';
      group.visible = false;
    },
    reset() {
      state.status = 'carried';
      state.site = null;
      state.timeLeft = BOMB_TIME;
      state.beepAt = 0;
      group.visible = false;
    },
  };
}
