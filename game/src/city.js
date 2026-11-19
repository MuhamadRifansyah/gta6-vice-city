// Solmar Bay — the procedural city. A road grid with varied buildings, sidewalks,
// streetlights, trees, parks, a beach and the sea to the south, under a warm sun.
// Everything is generated at runtime from a seeded RNG: no textures or models
// are loaded from files. Exports the collision boxes and the road network the
// traffic, police and missions drive on.
import * as THREE from 'three';
import { makeRng, pick, randRange } from './util.js';

export const ROAD_STEP = 50;
export const ROAD_COORDS = [-175, -125, -75, -25, 25, 75, 125, 175];
export const BLOCK_CENTERS = [-150, -100, -50, 0, 50, 100, 150];
export const CITY_BOUND = 210;
export const BEACH_Z = 200; // south of this the sand starts
export const WATER_Z = 232; // south of this is sea

const PALETTES = [
  { base: '#e8b48a', win: '#3a5a78', lit: '#ffd98a' },
  { base: '#c9d4d6', win: '#2f4a5e', lit: '#ffe9a8' },
  { base: '#d97b6c', win: '#33475c', lit: '#ffce7a' },
  { base: '#8fb8a8', win: '#2c4250', lit: '#ffe1a0' },
  { base: '#e0cfa8', win: '#3d5a6b', lit: '#ffd27a' },
  { base: '#7fa3c9', win: '#22384a', lit: '#ffe9a8' },
];

function facadeTexture(palette, rng) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = palette.base;
  g.fillRect(0, 0, 128, 256);
  // subtle vertical shading
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, 0, 8, 256);
  g.fillRect(120, 0, 8, 256);
  const cols = 4, rows = 10;
  const ww = 128 / cols, hh = 256 / rows;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      g.fillStyle = rng() < 0.22 ? palette.lit : palette.win;
      g.fillRect(x * ww + 5, y * hh + 6, ww - 10, hh - 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCity(scene) {
  const rng = makeRng(20261120);
  const colliders = [];
  const parkingSpots = [];
  const parkBlocks = [];

  // --- lights and sky ---
  const sun = new THREE.DirectionalLight(0xffe3b3, 2.4);
  sun.position.set(160, 220, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 1.1));
  scene.background = new THREE.Color(0x8ec3e8);
  scene.fog = new THREE.Fog(0x9fc8e8, 320, 760);
  // sun disc
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(22, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false })
  );
  sunDisc.position.set(320, 260, -420);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
  // clouds: flattened white blobs drifting slowly
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const cl = new THREE.Group();
    const n = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < n; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(randRange(rng, 6, 12), 8, 6), cloudMat);
      s.position.set(j * 9 - n * 4, randRange(rng, -1, 1), randRange(rng, -3, 3));
      s.scale.y = 0.45;
      cl.add(s);
    }
    cl.position.set(randRange(rng, -320, 320), randRange(rng, 90, 150), randRange(rng, -320, 160));
    scene.add(cl);
    clouds.push(cl);
  }

  // --- ground, beach, sea ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 460),
    new THREE.MeshLambertMaterial({ color: 0x9aa08a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -30);
  ground.receiveShadow = true;
  scene.add(ground);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 40),
    new THREE.MeshLambertMaterial({ color: 0xe8d29a })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.03, 220);
  sand.receiveShadow = true;
  scene.add(sand);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 320),
    new THREE.MeshLambertMaterial({ color: 0x1e7fa8 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.4, 400);
  scene.add(sea);
  // gentle sea shimmer strip
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 3),
    new THREE.MeshBasicMaterial({ color: 0xdff4ff })
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.06, 234);
  scene.add(foam);

  // --- roads ---
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x33383e });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5e9c8 });
  const walkMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a4 });
  for (const c of ROAD_COORDS) {
    for (const [w, l, x, z] of [[10, 480, c, -20], [480, 10, -20, c]]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(w, l), roadMat);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.02, z);
      r.receiveShadow = true;
      scene.add(r);
    }
    // centre dashes along both directions
    for (let t = -230; t < 230; t += 10) {
      const d1 = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3), dashMat);
      d1.rotation.x = -Math.PI / 2; d1.position.set(c, 0.04, t); scene.add(d1);
      const d2 = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.6), dashMat);
      d2.rotation.x = -Math.PI / 2; d2.position.set(t, 0.04, c); scene.add(d2);
    }
  }
  // sidewalks around each block
  const walkGeo = new THREE.PlaneGeometry(44, 44);
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (bz >= 190) continue;
      const w = new THREE.Mesh(walkGeo, walkMat);
      w.rotation.x = -Math.PI / 2;
      w.position.set(bx, 0.05, bz);
      w.receiveShadow = true;
      scene.add(w);
    }
  }

  // --- buildings ---
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a4a52 });
  const facadeMats = PALETTES.map((p) => {
    const tex = facadeTexture(p, rng);
    return new THREE.MeshLambertMaterial({ map: tex });
  });
  const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const treeTopMat = new THREE.MeshLambertMaterial({ color: 0x3f8f4f });
  const lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x2e3438 });
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });

  function addTree(x, z, s) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2.4 * s, 6), treeTrunkMat);
    trunk.position.y = 1.2 * s; trunk.castShadow = true;
    const top = new THREE.Mesh(new THREE.SphereGeometry(1.7 * s, 8, 6), treeTopMat);
    top.position.y = 3.4 * s; top.castShadow = true;
    g.add(trunk, top);
    g.position.set(x, 0, z);
    scene.add(g);
  }
  function addLamp(x, z) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), lampPoleMat);
    pole.position.y = 3; pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), lampPoleMat);
    arm.position.set(0.7, 5.9, 0);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lampGlowMat);
    bulb.position.set(1.4, 5.8, 0);
    g.add(pole, arm, bulb);
    g.position.set(x, 0, z);
    scene.add(g);
  }

  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (bz >= 190) continue; // beach blocks stay open
      const roll = rng();
      if (roll < 0.12) {
        // park block: grass + trees + benches of green
        const grass = new THREE.Mesh(new THREE.PlaneGeometry(38, 38),
          new THREE.MeshLambertMaterial({ color: 0x4d9e57 }));
        grass.rotation.x = -Math.PI / 2;
        grass.position.set(bx, 0.07, bz);
        grass.receiveShadow = true;
        scene.add(grass);
        for (let i = 0; i < 6; i++) addTree(bx + randRange(rng, -15, 15), bz + randRange(rng, -15, 15), randRange(rng, 0.9, 1.4));
        parkBlocks.push({ x: bx, z: bz });
        continue;
      }
      if (roll < 0.2) {
        // parking lot block: flat lot with marked bays
        const lot = new THREE.Mesh(new THREE.PlaneGeometry(38, 38),
          new THREE.MeshLambertMaterial({ color: 0x55595e }));
        lot.rotation.x = -Math.PI / 2;
        lot.position.set(bx, 0.07, bz);
        lot.receiveShadow = true;
        scene.add(lot);
        for (let i = 0; i < 3; i++) {
          parkingSpots.push({ x: bx + randRange(rng, -14, 14), z: bz + randRange(rng, -14, 14), angle: rng() < 0.5 ? 0 : Math.PI / 2 });
        }
        continue;
      }
      // built block: 1 tall tower or 2-4 smaller buildings
      const n = rng() < 0.4 ? 1 : 2 + Math.floor(rng() * 3);
      const spots = n === 1
        ? [{ dx: 0, dz: 0, w: 30, d: 30, h: randRange(rng, 26, 48) }]
        : Array.from({ length: n }, (_, i) => ({
            dx: (i % 2 === 0 ? -9 : 9), dz: (i < 2 ? -9 : 9),
            w: randRange(rng, 13, 17), d: randRange(rng, 13, 17), h: randRange(rng, 8, 24),
          }));
      for (const s of spots) {
        const mat = pick(rng, facadeMats);
        const b = new THREE.Mesh(unitBox, [mat, mat, roofMat, roofMat, mat, mat]);
        b.scale.set(s.w, s.h, s.d);
        b.position.set(bx + s.dx, s.h / 2, bz + s.dz);
        b.castShadow = true;
        b.receiveShadow = true;
        scene.add(b);
        colliders.push({
          minX: bx + s.dx - s.w / 2 - 0.4, maxX: bx + s.dx + s.w / 2 + 0.4,
          minZ: bz + s.dz - s.d / 2 - 0.4, maxZ: bz + s.dz + s.d / 2 + 0.4,
        });
        // rooftop AC box for silhouette variety
        if (s.h > 18) {
          const ac = new THREE.Mesh(unitBox, roofMat);
          ac.scale.set(3, 1.6, 3);
          ac.position.set(bx + s.dx + 4, s.h + 0.8, bz + s.dz - 4);
          scene.add(ac);
        }
      }
      // trees on the block corners
      addTree(bx - 19, bz - 19, 1);
      addTree(bx + 19, bz + 19, 0.9);
    }
  }

  // streetlights at every second intersection
  ROAD_COORDS.forEach((c, i) => {
    if (i % 2) return;
    ROAD_COORDS.forEach((d, j) => {
      if (j % 2) return;
      addLamp(c + 6, d + 6);
    });
  });
  // palm trees along the beach
  for (let x = -200; x <= 200; x += 26) {
    if (rng() < 0.3) continue;
    addTree(x + randRange(rng, -4, 4), 212 + randRange(rng, -2, 6), randRange(rng, 1.1, 1.5));
  }

  return {
    colliders,
    parkingSpots,
    parkBlocks,
    clouds,
    update(dt, t) {
      for (const c of clouds) {
        c.position.x += dt * 1.2;
        if (c.position.x > 360) c.position.x = -360;
      }
      // sea shimmer: gentle scale pulse on the foam line is skipped; water colour breathes
      sea.material.color.setHSL(0.54, 0.72, 0.42 + Math.sin(t * 0.4) * 0.03);
    },
  };
}
