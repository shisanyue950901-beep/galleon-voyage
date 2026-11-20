/**
 * @file deckFittings.js
 * @description 甲板舾装与活动道具建模模块：
 *              包含 6 门可独立触发后坐力回退动画的露天甲板加农炮、金字塔炮弹托盘、露天舱口木格栅、
 *              救生小艇、掌舵轮与发光罗经柜、掌舵船长人偶、起锚绞盘、可敲击摆动的船首黄铜船钟、
 *              船首两侧大铁锚、木桶货箱盘绳栓架，以及 9 盏随风浪物理摆动的暖光风灯。
 */

import * as THREE from 'three';
import { zToHullParam, sampleHullSurface, getDeckHeightAtZ } from './hullCurve.js';

/** 创建海军四轮滑架加农炮（几何体缓存复用） */
function createDeckCannon(mats, ropeMat) {
  if (!createDeckCannon._cache) {
    const cheekShape = new THREE.Shape();
    cheekShape.moveTo(-0.58, 0);
    cheekShape.lineTo(0.56, 0);
    cheekShape.lineTo(0.56, 0.48);
    cheekShape.lineTo(0.16, 0.48);
    cheekShape.lineTo(0.16, 0.39);
    cheekShape.lineTo(-0.18, 0.39);
    cheekShape.lineTo(-0.18, 0.3);
    cheekShape.lineTo(-0.58, 0.3);
    cheekShape.closePath();

    const cheek = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.09, bevelEnabled: false });
    const bed = new THREE.BoxGeometry(0.96, 0.09, 0.42);
    const wheel = new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12);
    wheel.rotateX(Math.PI * 0.5);

    const barrelProfile = [
      new THREE.Vector2(0, -0.78),
      new THREE.Vector2(0.065, -0.75),
      new THREE.Vector2(0.045, -0.68),
      new THREE.Vector2(0.175, -0.62),
      new THREE.Vector2(0.185, -0.56),
      new THREE.Vector2(0.168, -0.15),
      new THREE.Vector2(0.178, -0.11),
      new THREE.Vector2(0.152, 0.28),
      new THREE.Vector2(0.162, 0.31),
      new THREE.Vector2(0.128, 0.82),
      new THREE.Vector2(0.162, 0.9),
      new THREE.Vector2(0.135, 0.96),
      new THREE.Vector2(0.082, 0.96),
      new THREE.Vector2(0.082, 0.65),
    ];
    const barrel = new THREE.LatheGeometry(barrelProfile, 14);
    barrel.rotateZ(-Math.PI * 0.5);

    const trunnion = new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8);
    const breechCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.52, 0.32, -0.45),
      new THREE.Vector3(-0.62, 0.48, -0.16),
      new THREE.Vector3(-0.66, 0.52, 0),
      new THREE.Vector3(-0.62, 0.48, 0.16),
      new THREE.Vector3(0.52, 0.32, 0.45),
    ]);
    const breech = new THREE.TubeGeometry(breechCurve, 18, 0.028, 6, false);
    createDeckCannon._cache = { cheek, bed, wheel, barrel, trunnion, breech };
  }

  const g = createDeckCannon._cache;
  const group = new THREE.Group();

  for (const zOff of [-0.24, 0.15]) {
    const m = new THREE.Mesh(g.cheek, mats.crimsonWoodMat);
    m.position.set(0, 0.14, zOff);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  const bedMesh = new THREE.Mesh(g.bed, mats.darkWoodMat);
  bedMesh.position.set(-0.02, 0.2, 0);
  group.add(bedMesh);

  for (const xOff of [-0.38, 0.38]) {
    for (const zOff of [-0.28, 0.28]) {
      const w = new THREE.Mesh(g.wheel, mats.darkWoodMat);
      w.position.set(xOff, 0.14, zOff);
      w.castShadow = true;
      group.add(w);
    }
  }

  const barrelMesh = new THREE.Mesh(g.barrel, mats.ironMat);
  barrelMesh.position.set(0.16, 0.54, 0);
  barrelMesh.rotation.z = 0.04;
  barrelMesh.castShadow = true;
  group.add(barrelMesh);

  const trunnionMesh = new THREE.Mesh(g.trunnion, mats.goldMat);
  trunnionMesh.rotation.x = Math.PI * 0.5;
  trunnionMesh.position.set(0.22, 0.52, 0);
  group.add(trunnionMesh);

  group.add(new THREE.Mesh(g.breech, ropeMat));
  return group;
}

function createShotGarland(mats) {
  if (!createShotGarland._cache) {
    createShotGarland._cache = {
      tray: new THREE.BoxGeometry(0.46, 0.08, 0.46),
      ball: new THREE.SphereGeometry(0.085, 10, 8),
    };
  }
  const group = new THREE.Group();
  const tray = new THREE.Mesh(createShotGarland._cache.tray, mats.darkWoodMat);
  tray.position.y = 0.04;
  group.add(tray);

  const stack = [
    [-0.09, 0.14, -0.09],
    [0.09, 0.14, -0.09],
    [-0.09, 0.14, 0.09],
    [0.09, 0.14, 0.09],
    [0, 0.26, 0],
  ];
  for (const [bx, by, bz] of stack) {
    const ball = new THREE.Mesh(createShotGarland._cache.ball, mats.ironMat);
    ball.position.set(bx, by, bz);
    ball.castShadow = true;
    group.add(ball);
  }
  return group;
}

function createWoodenBarrel(mats, scale = 1) {
  if (!createWoodenBarrel._cache) {
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.24, 0),
      new THREE.Vector2(0.3, 0.22),
      new THREE.Vector2(0.32, 0.4),
      new THREE.Vector2(0.3, 0.58),
      new THREE.Vector2(0.24, 0.8),
      new THREE.Vector2(0, 0.8),
    ];
    createWoodenBarrel._cache = {
      body: new THREE.LatheGeometry(profile, 12),
      hoopSm: new THREE.TorusGeometry(0.268, 0.016, 6, 14),
      hoopLg: new THREE.TorusGeometry(0.312, 0.016, 6, 14),
    };
  }
  const group = new THREE.Group();
  const body = new THREE.Mesh(createWoodenBarrel._cache.body, mats.mahoganyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  for (const [hy, isLarge] of [
    [0.09, false],
    [0.27, true],
    [0.53, true],
    [0.71, false],
  ]) {
    const hoop = new THREE.Mesh(
      isLarge ? createWoodenBarrel._cache.hoopLg : createWoodenBarrel._cache.hoopSm,
      mats.ironMat
    );
    hoop.rotation.x = Math.PI * 0.5;
    hoop.position.y = hy;
    group.add(hoop);
  }
  group.scale.setScalar(scale);
  return group;
}

function createCargoCrate(w, h, d, mats) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.deckMat);
  box.position.y = h * 0.5;
  box.castShadow = true;
  box.receiveShadow = true;
  group.add(box);

  const trim = 0.045;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(trim, h + 0.02, trim), mats.darkWoodMat);
      post.position.set(sx * (w * 0.5), h * 0.5, sz * (d * 0.5));
      group.add(post);
    }
  }
  for (const ry of [0.03, h - 0.03]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, trim, d + 0.03), mats.darkWoodMat);
    rim.position.y = ry;
    group.add(rim);
  }
  return group;
}

function createCoiledRope(ropeMat, outerR = 0.42) {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const r = 0.08 + t * (outerR - 0.08);
    const ang = t * 4.5 * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * r, 0.028 + (1 - t) * 0.04, Math.sin(ang) * r));
  }
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, 0.028, 6, false), ropeMat);
  mesh.castShadow = true;
  return mesh;
}

function createHelmAndBinnacle(mats, ropeMat) {
  const group = new THREE.Group();
  for (const zOff of [-0.28, 0.28]) {
    const stanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 1.08, 8), mats.mahoganyMat);
    stanchion.position.set(0, 0.54, zOff);
    stanchion.castShadow = true;
    group.add(stanchion);
  }

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.48, 12), ropeMat);
  drum.rotation.x = Math.PI * 0.5;
  drum.position.set(0, 1.02, 0);
  drum.castShadow = true;
  group.add(drum);

  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0, 1.02, -0.34);
  const outerRim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 8, 24), mats.mahoganyMat);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 6, 20), mats.goldMat);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 12), mats.goldMat);
  hub.rotation.x = Math.PI * 0.5;
  outerRim.castShadow = true;
  wheelPivot.add(outerRim, innerRing, hub);

  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.84, 8), mats.mahoganyMat);
    spoke.position.set(Math.cos(ang) * 0.42, Math.sin(ang) * 0.42, 0);
    spoke.rotation.z = ang - Math.PI * 0.5;
    spoke.castShadow = true;
    wheelPivot.add(spoke);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), mats.goldMat);
    knob.position.set(Math.cos(ang) * 0.83, Math.sin(ang) * 0.83, 0);
    wheelPivot.add(knob);
  }
  group.add(wheelPivot);

  const binnacleBox = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.88, 0.4), mats.mahoganyMat);
  binnacleBox.position.set(0, 0.44, 0.86);
  binnacleBox.castShadow = true;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), mats.goldMat);
  hood.position.set(0, 0.98, 0.86);
  const dialGlow = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), mats.glowingWindowMat);
  dialGlow.position.set(0, 0.97, 0.65);
  dialGlow.rotation.y = Math.PI;
  group.add(binnacleBox, hood, dialGlow);

  return { group, wheelPivot };
}

function createIronAnchor(mats, ropeMat) {
  const group = new THREE.Group();
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 2.05, 8), mats.ironMat);
  shank.castShadow = true;
  group.add(shank);

  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.78, -0.58, 0),
    new THREE.Vector3(-0.42, -0.96, 0),
    new THREE.Vector3(0, -1.04, 0),
    new THREE.Vector3(0.42, -0.96, 0),
    new THREE.Vector3(0.78, -0.58, 0),
  ]);
  const arms = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 16, 0.065, 8, false), mats.ironMat);
  arms.castShadow = true;
  group.add(arms);

  for (const side of [-1, 1]) {
    const fluke = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 4), mats.ironMat);
    fluke.position.set(side * 0.78, -0.54, 0);
    fluke.rotation.z = side * -0.52;
    fluke.scale.set(1, 1, 0.28);
    group.add(fluke);
  }

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 1.75), mats.darkWoodMat);
  stock.position.set(0, 0.78, 0);
  stock.castShadow = true;
  group.add(stock);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 14), mats.ironMat);
  ring.position.set(0, 1.12, 0);
  group.add(ring);

  const puddening = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.032, 6, 12), ropeMat);
  puddening.position.set(0, 0.78, 0);
  group.add(puddening);
  return group;
}

function createShipsBoat(mats, ropeMat) {
  const group = new THREE.Group();
  const len = 3.55;
  const segsZ = 18;
  const segsV = 8;
  const positions = [];
  const indices = [];
  const stride = segsV + 1;

  for (const side of [1, -1]) {
    const base = positions.length / 3;
    for (let iz = 0; iz <= segsZ; iz++) {
      const t = iz / segsZ;
      const z = (t - 0.5) * len;
      const halfW = 0.78 * Math.sin(Math.PI * Math.pow(t, 0.82));
      const sheerY = 0.48 + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.2;
      for (let iv = 0; iv <= segsV; iv++) {
        const v = iv / segsV;
        positions.push(halfW * Math.sin(v * Math.PI * 0.5) * side, v * sheerY, z);
      }
    }
    for (let iz = 0; iz < segsZ; iz++) {
      for (let iv = 0; iv < segsV; iv++) {
        const a = base + iz * stride + iv;
        const b = base + (iz + 1) * stride + iv;
        const c = base + iz * stride + (iv + 1);
        const d = base + (iz + 1) * stride + (iv + 1);
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  hullGeo.setIndex(indices);
  hullGeo.computeVertexNormals();

  const boatMat = mats.mahoganyMat.clone();
  boatMat.side = THREE.DoubleSide;
  const hullMesh = new THREE.Mesh(hullGeo, boatMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  group.add(hullMesh);

  for (const zBench of [-0.85, 0, 0.85]) {
    const bw = 1.32 * (1 - Math.abs(zBench) * 0.32);
    const thwart = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.05, 0.24), mats.deckMat);
    thwart.position.set(0, 0.38, zBench);
    group.add(thwart);
  }
  for (const xOar of [-0.18, 0.18]) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 2.75, 6), mats.deckMat);
    shaft.rotation.x = Math.PI * 0.5;
    shaft.position.set(xOar, 0.44, -0.1);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.65), mats.deckMat);
    blade.position.set(xOar, 0.44, -1.25);
    group.add(shaft, blade);
  }
  for (const zLash of [-0.95, 0.95]) {
    const lashCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.82, 0, zLash),
      new THREE.Vector3(-0.68, 0.54, zLash),
      new THREE.Vector3(0, 0.58, zLash),
      new THREE.Vector3(0.68, 0.54, zLash),
      new THREE.Vector3(0.82, 0, zLash),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(lashCurve, 14, 0.024, 6, false), ropeMat));
  }
  return group;
}

function createSwingingLantern(mats, glowTex, scale = 1, withPointLight = false, intensity = 5.5, distance = 14) {
  const mountGroup = new THREE.Group();
  const pendulumPivot = new THREE.Group();
  mountGroup.add(pendulumPivot);

  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22 * scale, 6), mats.ironMat);
  chain.position.y = -0.11 * scale;
  pendulumPivot.add(chain);

  const cy = -0.44 * scale;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24 * scale, 0.24 * scale, 6), mats.ironMat);
  cap.position.y = cy + 0.28 * scale;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * scale, 0.11 * scale, 0.12 * scale, 6), mats.ironMat);
  base.position.y = cy - 0.24 * scale;

  const lanternGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffdfaa,
    emissive: new THREE.Color(0xff9622),
    emissiveIntensity: 3.6,
    roughness: 0.12,
    metalness: 0.05,
  });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * scale, 0.14 * scale, 0.38 * scale, 6), lanternGlassMat);
  glass.position.y = cy;

  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * scale, 0.014 * scale, 0.42 * scale, 5), mats.ironMat);
    rib.position.set(Math.cos(ang) * 0.18 * scale, cy, Math.sin(ang) * 0.18 * scale);
    pendulumPivot.add(rib);
  }

  const haloMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: 0xffaa44,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(1.85 * scale);
  halo.position.y = cy;
  pendulumPivot.add(cap, base, glass, halo);

  let pointLight = null;
  if (withPointLight) {
    pointLight = new THREE.PointLight(0xff982e, intensity, distance, 1.65);
    pointLight.position.set(0, cy, 0);
    pendulumPivot.add(pointLight);
  }

  return { mountGroup, pendulumPivot, pointLight, halo, lanternGlassMat, baseIntensity: intensity };
}

function createCaptainFigure(mats) {
  const group = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color: 0x2b1538, roughness: 0.78, metalness: 0.05 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x171210, roughness: 0.65, metalness: 0.08 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x191416, roughness: 0.72, metalness: 0.06 });

  for (const xLeg of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.78, 8), bootMat);
    leg.position.set(xLeg, 0.39, 0);
    leg.rotation.z = xLeg * -0.08;
    leg.castShadow = true;
    group.add(leg);
  }

  const coatSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.29, 0.62, 10), coatMat);
  coatSkirt.position.set(0, 0.88, 0);
  coatSkirt.castShadow = true;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.52, 10), coatMat);
  torso.position.set(0, 1.28, 0.02);
  torso.castShadow = true;
  const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.07, 10), mats.goldMat);
  sash.position.set(0, 1.06, 0.01);
  group.add(coatSkirt, torso, sash);

  for (const side of [-1, 1]) {
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.21, 1.44, 0.02),
      new THREE.Vector3(side * 0.28, 1.28, 0.22),
      new THREE.Vector3(side * 0.34, 1.16, 0.44),
    ]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 8, 0.052, 6, false), coatMat);
    arm.castShadow = true;
    group.add(arm);
  }

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.115, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xb88462, roughness: 0.75 })
  );
  head.position.set(0, 1.64, 0.03);
  group.add(head);

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.13, 10), hatMat);
  crown.position.set(0, 1.72, 0.03);
  const tricorn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.035, 3), hatMat);
  tricorn.position.set(0, 1.71, 0.04);
  tricorn.rotation.y = Math.PI;
  tricorn.rotation.x = -0.08;
  tricorn.castShadow = true;

  const plumeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.1, 1.74, 0.02),
    new THREE.Vector3(0.18, 1.86, -0.1),
    new THREE.Vector3(0.2, 1.8, -0.26),
  ]);
  const plume = new THREE.Mesh(new THREE.TubeGeometry(plumeCurve, 8, 0.028, 5, false), mats.crimsonWoodMat);
  group.add(crown, tricorn, plume);
  return group;
}

/**
 * 组装全部露天甲板舾装与动态活动枢轴
 */
export function buildDeckFittings(mats, textures) {
  const deckGroup = new THREE.Group();
  const swingingLanterns = [];
  const deckCannons = [];

  const ropeMat = new THREE.MeshStandardMaterial({
    map: textures.rope.map,
    bumpMap: textures.rope.bumpMap,
    bumpScale: 0.04,
    roughness: 0.88,
    metalness: 0.02,
  });

  // 1. 六门可回退露天甲板火炮及炮弹架
  const cannonSlots = [
    { x: 2.95, z: -0.2, side: 1 },
    { x: -2.95, z: -0.2, side: -1 },
    { x: 2.85, z: 3.9, side: 1 },
    { x: -2.85, z: 3.9, side: -1 },
    { x: 2.75, z: -5.4, side: 1 },
    { x: -2.75, z: -5.4, side: -1 },
  ];
  for (const slot of cannonSlots) {
    const y = getDeckHeightAtZ(slot.z) + 0.04;
    const cannon = createDeckCannon(mats, ropeMat);
    cannon.position.set(slot.x, y, slot.z);
    if (slot.side === -1) cannon.rotation.y = Math.PI;
    deckGroup.add(cannon);

    deckCannons.push({
      pivot: cannon,
      baseX: slot.x,
      baseY: y,
      z: slot.z,
      side: slot.side,
      muzzleLocal: new THREE.Vector3(slot.x + 1.16 * slot.side, y + 0.56, slot.z),
    });

    const shotRack = createShotGarland(mats);
    shotRack.position.set(slot.x - slot.side * 0.72, y, slot.z + 0.68);
    deckGroup.add(shotRack);
  }

  // 2. 主舱口木格栅与救生艇
  const hatchZ = 2.0;
  const hatchY = getDeckHeightAtZ(hatchZ) + 0.13;
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.26, 3.15), mats.darkWoodMat);
  coaming.position.set(0, hatchY + 0.11, hatchZ);
  coaming.castShadow = true;
  coaming.receiveShadow = true;
  deckGroup.add(coaming);

  const hatchPit = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.28, 2.85), new THREE.MeshBasicMaterial({ color: 0x0b0705 }));
  hatchPit.position.set(0, hatchY + 0.11, hatchZ);
  deckGroup.add(hatchPit);

  for (let gx = -0.92; gx <= 0.93; gx += 0.23) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 2.88), mats.deckMat);
    bar.position.set(gx, hatchY + 0.25, hatchZ);
    bar.castShadow = true;
    deckGroup.add(bar);
  }
  for (let gz = -1.32; gz <= 1.33; gz += 0.24) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.05, 0.055), mats.deckMat);
    bar.position.set(0, hatchY + 0.24, hatchZ + gz);
    deckGroup.add(bar);
  }

  const boat = createShipsBoat(mats, ropeMat);
  boat.position.set(0, hatchY + 0.3, hatchZ - 0.05);
  deckGroup.add(boat);

  // 3. 后甲板舵轮、罗经柜与掌舵船长
  const helmY = getDeckHeightAtZ(-7.65) + 0.12;
  const { group: helmGroup, wheelPivot } = createHelmAndBinnacle(mats, ropeMat);
  helmGroup.position.set(0, helmY, -7.65);
  deckGroup.add(helmGroup);

  const captainPivot = createCaptainFigure(mats);
  captainPivot.position.set(0, helmY, -8.44);
  deckGroup.add(captainPivot);

  // 4. 艏楼绞盘（Capstan）与可敲击摆动的黄铜船钟（bellPivot）
  const capstanZ = 10.2;
  const capstanY = getDeckHeightAtZ(capstanZ) + 0.12;
  const capstan = new THREE.Group();
  capstan.position.set(0, capstanY, capstanZ);
  const capBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.92, 10), mats.mahoganyMat);
  capBarrel.position.y = 0.46;
  capBarrel.castShadow = true;
  const capHead = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.42, 0.18, 12), mats.darkWoodMat);
  capHead.position.y = 0.95;
  capHead.castShadow = true;
  capstan.add(capBarrel, capHead);

  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 1.55, 6), mats.deckMat);
    bar.rotation.z = Math.PI * 0.5;
    bar.rotation.y = ang;
    bar.position.set(Math.cos(ang) * 0.72, 0.95, -Math.sin(ang) * 0.72);
    bar.castShadow = true;
    capstan.add(bar);
  }
  deckGroup.add(capstan);

  const belfryY = getDeckHeightAtZ(7.55) + 0.14;
  for (const bx of [-0.22, 0.22]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.07), mats.darkWoodMat);
    post.position.set(bx, belfryY + 0.39, 7.55);
    deckGroup.add(post);
  }
  const belfryRoof = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.24, 4), mats.darkWoodMat);
  belfryRoof.rotation.y = Math.PI * 0.25;
  belfryRoof.position.set(0, belfryY + 0.88, 7.55);

  const bellPivot = new THREE.Group();
  bellPivot.position.set(0, belfryY + 0.7, 7.55);
  const bellMesh = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.22, 12), mats.goldMat);
  bellMesh.position.set(0, -0.12, 0);
  bellPivot.add(bellMesh);
  deckGroup.add(belfryRoof, bellPivot);

  // 5. 船首两侧吊锚横木（Catheads）与大铁锚
  const catPt = sampleHullSurface(zToHullParam(12.35), 0.98);
  for (const side of [-1, 1]) {
    const cathead = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.22, 0.24), mats.darkWoodMat);
    cathead.position.set((catPt.x + 0.28) * side, catPt.y + 0.05, catPt.z);
    cathead.rotation.z = side * 0.14;
    cathead.castShadow = true;
    deckGroup.add(cathead);

    const catCap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.28), mats.goldMat);
    catCap.position.set((catPt.x + 0.98) * side, catPt.y + 0.15, catPt.z);
    deckGroup.add(catCap);

    const anchor = createIronAnchor(mats, ropeMat);
    anchor.position.set((catPt.x + 0.78) * side, catPt.y - 1.18, catPt.z - 0.15);
    anchor.rotation.set(-0.22, side * 0.32, side * -0.18);
    deckGroup.add(anchor);

    const cableCurve = new THREE.LineCurve3(
      new THREE.Vector3((catPt.x + 0.88) * side, catPt.y + 0.12, catPt.z),
      new THREE.Vector3((catPt.x + 0.62) * side, catPt.y - 0.18, catPt.z - 0.08)
    );
    deckGroup.add(new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 4, 0.032, 6, false), ropeMat));
  }

  // 6. 甲板补给木桶、货箱、盘绳与系缆栓架（Fife Rails）
  const barrels = [
    [-1.45, -2.55, 1],
    [-1.95, -2.25, 0.92],
    [1.55, 6.85, 1],
    [1.1, 6.95, 0.88],
    [-1.35, 6.85, 0.96],
    [1.65, -8.95, 0.92],
    [-1.55, -11.4, 0.88],
  ];
  for (const [bx, bz, bScale] of barrels) {
    const brl = createWoodenBarrel(mats, bScale);
    brl.position.set(bx, getDeckHeightAtZ(bz) + 0.08, bz);
    brl.rotation.y = bx * 1.7;
    deckGroup.add(brl);
  }

  const crates = [
    [1.55, -2.45, 0.78, 0.62, 0.72, 0.18],
    [1.62, -1.72, 0.62, 0.52, 0.58, -0.24],
    [-1.65, 6.15, 0.74, 0.58, 0.68, 0.12],
    [-1.62, -8.85, 0.66, 0.5, 0.62, -0.15],
  ];
  for (const [cx, cz, cw, ch, cd, rotY] of crates) {
    const cr = createCargoCrate(cw, ch, cd, mats);
    cr.position.set(cx, getDeckHeightAtZ(cz) + 0.08, cz);
    cr.rotation.y = rotY;
    deckGroup.add(cr);
  }

  const coils = [
    [0.85, 8.65, 0.4],
    [-0.95, 0.65, 0.44],
    [0.95, 0.45, 0.38],
    [1.15, -6.45, 0.36],
    [-1.15, -6.65, 0.4],
  ];
  for (const [rx, rz, rOut] of coils) {
    const coil = createCoiledRope(ropeMat, rOut);
    coil.position.set(rx, getDeckHeightAtZ(rz) + 0.11, rz);
    deckGroup.add(coil);
  }

  const pinPostGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.85, 8);
  const pinRailGeo = new THREE.BoxGeometry(1.88, 0.09, 0.16);
  const pinGeo = new THREE.CylinderGeometry(0.016, 0.012, 0.26, 6);
  for (const mastZ of [9.0, 0.4, -5.3]) {
    const ry = getDeckHeightAtZ(mastZ) + 0.12;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(pinPostGeo, mats.darkWoodMat);
      post.position.set(side * 0.88, ry + 0.42, mastZ - 0.52);
      deckGroup.add(post);
    }
    const rail = new THREE.Mesh(pinRailGeo, mats.mahoganyMat);
    rail.position.set(0, ry + 0.82, mastZ - 0.52);
    deckGroup.add(rail);

    for (let px = -0.72; px <= 0.73; px += 0.24) {
      const pin = new THREE.Mesh(pinGeo, mats.goldMat);
      pin.position.set(px, ry + 0.86, mastZ - 0.52);
      deckGroup.add(pin);
    }
  }

  // 7. 船尾三盏大号尾灯与舱壁 6 盏摇摆风灯
  const sternTop = sampleHullSurface(0, 1);
  const sternLanternSpecs = [
    { x: 0, y: sternTop.y + 1.62, z: sternTop.z - 0.85, scale: 1.38, light: true, intensity: 9.5, dist: 19 },
    { x: -1.78, y: sternTop.y + 1.25, z: sternTop.z - 0.58, scale: 1.12, light: false, intensity: 0, dist: 0 },
    { x: 1.78, y: sternTop.y + 1.25, z: sternTop.z - 0.58, scale: 1.12, light: false, intensity: 0, dist: 0 },
  ];
  for (const sp of sternLanternSpecs) {
    const bracketCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sp.x * 0.94, sp.y - 0.72, sternTop.z - 0.12),
      new THREE.Vector3(sp.x * 0.97, sp.y - 0.15, sp.z + 0.28),
      new THREE.Vector3(sp.x, sp.y, sp.z),
    ]);
    deckGroup.add(new THREE.Mesh(new THREE.TubeGeometry(bracketCurve, 12, 0.045, 6, false), mats.ironMat));
    const lantern = createSwingingLantern(mats, textures.softGlow, sp.scale, sp.light, sp.intensity, sp.dist);
    lantern.mountGroup.position.set(sp.x, sp.y, sp.z);
    deckGroup.add(lantern.mountGroup);
    swingingLanterns.push(lantern);
  }

  const deckLanternSpecs = [
    { x: 1.75, y: 4.32, z: -3.08, scale: 0.86, light: true, intensity: 6.5, dist: 14 },
    { x: -1.75, y: 4.32, z: -3.08, scale: 0.86, light: false, intensity: 0, dist: 0 },
    { x: 0, y: 4.78, z: -9.35, scale: 0.82, light: true, intensity: 5.5, dist: 12 },
    { x: 1.48, y: 4.12, z: 7.38, scale: 0.86, light: true, intensity: 6.5, dist: 14 },
    { x: -1.48, y: 4.12, z: 7.38, scale: 0.86, light: false, intensity: 0, dist: 0 },
    { x: 0.85, y: 4.65, z: 13.45, scale: 0.78, light: true, intensity: 5.0, dist: 12 },
  ];
  for (const sp of deckLanternSpecs) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 6), mats.ironMat);
    arm.rotation.x = Math.PI * 0.5;
    arm.position.set(sp.x, sp.y, sp.z - 0.14);
    deckGroup.add(arm);

    const lantern = createSwingingLantern(mats, textures.softGlow, sp.scale, sp.light, sp.intensity, sp.dist);
    lantern.mountGroup.position.set(sp.x, sp.y, sp.z);
    deckGroup.add(lantern.mountGroup);
    swingingLanterns.push(lantern);
  }

  return {
    deckGroup,
    ropeMat,
    wheelPivot,
    captainPivot,
    swingingLanterns,
    deckCannons,
    bellPivot,
  };
}
