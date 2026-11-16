// Transient combat effects: tracers, impact sparks, explosions. One pooled particle
// system and one pooled tracer set, reused every frame — nothing is allocated in the
// hot loop, so the frame rate stays flat in a firefight.
import * as THREE from 'three';

const MAX_PARTICLES = 512;
const MAX_TRACERS = 32;

export function createEffects(scene) {
  // Particles: a single Points cloud, positions and colours rewritten in place.
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colours = new Float32Array(MAX_PARTICLES * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    particles.push({ alive: false, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1 });
  }
  let particleCursor = 0;

  // Tracers: a pool of Line objects, each shown for a few frames then hidden.
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // Explosion shockwave: one reusable expanding shell + one light.
  const shock = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false }),
  );
  shock.visible = false;
  scene.add(shock);
  const shockLight = new THREE.PointLight(0xff9a3c, 0, 22, 1.5);
  scene.add(shockLight);
  let shockLife = 0;

  function spawnParticle(x, y, z, vx, vy, vz, life, r, g, b) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % MAX_PARTICLES;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.r = r;
    p.g = g;
    p.b = b;
  }

  function writeBuffers() {
    let count = 0;
    for (const p of particles) {
      if (!p.alive) continue;
      positions[count * 3] = p.x;
      positions[count * 3 + 1] = p.y;
      positions[count * 3 + 2] = p.z;
      const fade = p.life / p.maxLife;
      colours[count * 3] = p.r * fade;
      colours[count * 3 + 1] = p.g * fade;
      colours[count * 3 + 2] = p.b * fade;
      count += 1;
    }
    geometry.setDrawRange(0, count);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  return {
    tracer(from, to) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const attr = t.line.geometry.attributes.position;
      attr.setXYZ(0, from.x, from.y, from.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      t.line.material.opacity = 0.85;
      t.life = 0.07;
    },
    impact(point, colour = 0xffc46b) {
      const r = ((colour >> 16) & 255) / 255;
      const g = ((colour >> 8) & 255) / 255;
      const b = (colour & 255) / 255;
      for (let i = 0; i < 8; i += 1) {
        spawnParticle(
          point.x, point.y, point.z,
          (Math.random() - 0.5) * 5, Math.random() * 3.5, (Math.random() - 0.5) * 5,
          0.25 + Math.random() * 0.25, r, g, b,
        );
      }
    },
    blood(point) {
      for (let i = 0; i < 10; i += 1) {
        spawnParticle(
          point.x, point.y, point.z,
          (Math.random() - 0.5) * 3.5, Math.random() * 2.5 + 0.5, (Math.random() - 0.5) * 3.5,
          0.3 + Math.random() * 0.3, 0.55, 0.05, 0.05,
        );
      }
    },
    explosion(point) {
      for (let i = 0; i < 90; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const up = Math.random() * 9 + 2;
        const out = Math.random() * 8 + 2;
        spawnParticle(
          point.x, point.y + 0.2, point.z,
          Math.cos(a) * out, up, Math.sin(a) * out,
          0.5 + Math.random() * 0.7,
          1, 0.55 + Math.random() * 0.25, 0.15,
        );
      }
      shock.position.copy(point);
      shock.visible = true;
      shockLife = 0.55;
      shockLight.position.copy(point).y += 1;
      shockLight.intensity = 260;
    },
    step(dt) {
      for (const p of particles) {
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          p.y = -99;
          continue;
        }
        p.vy -= 12 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.02) {
          p.y = 0.02;
          p.vy *= -0.35;
          p.vx *= 0.7;
          p.vz *= 0.7;
        }
      }
      writeBuffers();
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      }
      if (shockLife > 0) {
        shockLife -= dt;
        const k = 1 - shockLife / 0.55;
        const scale = 0.5 + k * 9;
        shock.scale.setScalar(scale);
        shock.material.opacity = Math.max(0, 0.55 * (1 - k));
        shockLight.intensity = Math.max(0, 260 * (1 - k));
        if (shockLife <= 0) shock.visible = false;
      }
    },
  };
}
