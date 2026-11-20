/**
 * @file navalAndEcology.js
 * @description 海洋环境粒子、生物生态与舷炮海战交互模块（v4 完整海战玩法 + 精细生态版）：
 *              1. createAtmosphericParticlesAndBirds：船首浪花/船尾水雾/海啸飞沫粒子、GPU 暴雨雨丝、暖光浮尘与暴风自动避风海鸟群；
 *              2. createNavalAndEcology：
 *                 - 支持 Q（左舷）/ E（右舷）独立冷却齐射与 Space 双舷齐射，第一人称视角实时投影海面弹着点预测圈；
 *                 - 2 艘带双桅黑红帆与尾灯的巡逻海盗双桅战舰，支持实时炮弹命中判定、爆炸火球、木屑飞溅、起火冒烟与 3 发击沉重生；
 *                 - 6 个带铁箍与航标旗的漂浮补给木桶（靠近 <14m 自动打捞触发疾行增益）+ 真实世界坐标可驶近绕行灯塔岛礁；
 *                 - 5 只伴航跃水海豚 + 14m 座头鲸破浪跃水奇观 + 14 只带内核与飘动触手的星夜荧光水母。
 */

import * as THREE from 'three';
import { zToHullParam, sampleHullSurface } from '../ship/hullCurve.js';
import { currentSailingSpeed, sampleOceanHeight } from './oceanSimulation.js';
import { createDeckBrazier, createIceFloeSystem } from './ambientProps.js';

const _tmpLocalCam = new THREE.Vector3();
const _tmpOutDir = new THREE.Vector3();

function mergePartGeos(geos) {
  let vTotal = 0;
  let iTotal = 0;
  for (const g of geos) {
    vTotal += g.attributes.position.count;
    iTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const norm = new Float32Array(vTotal * 3);
  const col = new Float32Array(vTotal * 3);
  const idx = new Uint16Array(iTotal);
  let vOff = 0;
  let iOff = 0;

  for (const g of geos) {
    const vc = g.attributes.position.count;
    pos.set(g.attributes.position.array, vOff * 3);
    if (g.attributes.normal) norm.set(g.attributes.normal.array, vOff * 3);
    if (g.attributes.color) {
      col.set(g.attributes.color.array, vOff * 3);
    } else {
      for (let k = 0; k < vc * 3; k++) col[vOff * 3 + k] = 1;
    }
    if (g.index) {
      const ga = g.index.array;
      for (let k = 0; k < ga.length; k++) idx[iOff + k] = ga[k] + vOff;
      iOff += ga.length;
    } else {
      for (let k = 0; k < vc; k++) idx[iOff++] = vOff + k;
    }
    vOff += vc;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function tintGeo(geo, r, g, b) {
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function buildDolphinGeometry() {
  const rings = 24;
  const seg = 12;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];

  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const z = (u - 0.52) * 2.65;
    let r = 0;
    let yOff = 0;
    if (u > 0.89) {
      const t = (u - 0.89) / 0.11;
      r = 0.085 * (1 - t * 0.72);
      yOff = -0.045;
    } else if (u > 0.74) {
      const t = (u - 0.74) / 0.15;
      r = 0.23 * (1 - t) + 0.085 * t;
      yOff = 0.035 * (1 - t) - 0.045 * t;
    } else {
      const t = u / 0.74;
      r = 0.028 + 0.215 * Math.pow(Math.sin(t * Math.PI * 0.84), 0.72);
      yOff = Math.sin(t * Math.PI) * 0.055;
    }

    for (let j = 0; j <= seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      const nx = Math.sin(ang);
      const ny = Math.cos(ang);
      pos.push(nx * r * 0.92, ny * r * 1.06 + yOff, z);
      uv.push(u, j / seg);
      const belly = THREE.MathUtils.smoothstep(-ny, 0.05, 0.65);
      col.push(
        THREE.MathUtils.lerp(0.11, 0.74, belly),
        THREE.MathUtils.lerp(0.18, 0.78, belly),
        THREE.MathUtils.lerp(0.29, 0.83, belly)
      );
    }
  }

  const stride = seg + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  function addFin(pts3, cR, cG, cB) {
    const base = pos.length / 3;
    for (const p of pts3) {
      pos.push(p[0], p[1], p[2]);
      uv.push(p[2] / 2.65 + 0.52, 0.5);
      col.push(cR, cG, cB);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 1);
  }

  addFin([[0, 0.18, 0.12], [0, 0.48, -0.16], [0, 0.15, -0.32]], 0.09, 0.15, 0.25);
  addFin([[0.14, -0.04, 0.38], [0.46, -0.22, 0.16], [0.12, -0.08, 0.12]], 0.11, 0.17, 0.27);
  addFin([[-0.14, -0.04, 0.38], [-0.46, -0.22, 0.16], [-0.12, -0.08, 0.12]], 0.11, 0.17, 0.27);
  addFin([[0, 0, -1.18], [0.38, 0.02, -1.44], [0, 0, -1.36]], 0.09, 0.15, 0.25);
  addFin([[0, 0, -1.18], [-0.38, 0.02, -1.44], [0, 0, -1.36]], 0.09, 0.15, 0.25);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildWhaleGeometry() {
  const rings = 32;
  const seg = 16;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];

  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const z = (u - 0.5) * 14.0;
    const bodyTaper = Math.sin(Math.pow(u, 0.72) * Math.PI);
    const rx = 0.14 + 1.48 * bodyTaper;
    const ry = 0.11 + 1.24 * bodyTaper;
    const yOff = Math.sin(u * Math.PI) * 0.24;

    for (let j = 0; j <= seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      const nx = Math.sin(ang);
      const ny = Math.cos(ang);
      const pleat = ny < -0.15 && u > 0.35 && u < 0.88 ? Math.sin(ang * 14) * 0.035 : 0;
      pos.push(nx * rx, ny * (ry + pleat) + yOff, z);
      uv.push(u, j / seg);
      const belly = THREE.MathUtils.smoothstep(-ny, -0.05, 0.65);
      col.push(
        THREE.MathUtils.lerp(0.08, 0.58, belly),
        THREE.MathUtils.lerp(0.12, 0.62, belly),
        THREE.MathUtils.lerp(0.18, 0.68, belly)
      );
    }
  }

  const stride = seg + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const parts = [];
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bodyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bodyGeo.setIndex(idx);
  bodyGeo.computeVertexNormals();
  parts.push(bodyGeo);

  for (const side of [-1, 1]) {
    const finCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 1.15, -0.25, 1.8),
      new THREE.Vector3(side * 2.55, -0.45, 0.9),
      new THREE.Vector3(side * 4.25, -0.75, -0.35),
    ]);
    const fg = new THREE.TubeGeometry(finCurve, 8, 0.24, 6, false);
    const fPos = fg.attributes.position;
    for (let k = 0; k < fPos.count; k++) {
      const t = Math.floor(k / 7) / 8;
      fPos.setY(k, fPos.getY(k) * 0.28 + (1 - t) * -0.1);
    }
    fg.computeVertexNormals();
    parts.push(tintGeo(fg, 0.14, 0.18, 0.25));
  }

  for (const side of [-1, 1]) {
    const fluke = new THREE.ConeGeometry(0.95, 2.55, 6);
    fluke.scale(0.18, 1, 0.72);
    fluke.rotateZ(side * -Math.PI * 0.48);
    fluke.rotateY(side * 0.28);
    fluke.translate(side * 1.35, 0.05, -6.95);
    parts.push(tintGeo(fluke, 0.09, 0.13, 0.19));
  }

  const merged = mergePartGeos(parts);
  const mPos = merged.attributes.position;
  const mUv = new Float32Array(mPos.count * 2);
  for (let i = 0; i < mPos.count; i++) {
    mUv[i * 2] = THREE.MathUtils.clamp(mPos.getZ(i) / 14.0 + 0.5, 0, 1);
    mUv[i * 2 + 1] = 0.5;
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(mUv, 2));
  return merged;
}

function buildJellyfishGeometry() {
  const parts = [];
  const outerBell = new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58);
  parts.push(tintGeo(outerBell, 0.22, 0.88, 1.0));

  const innerCore = new THREE.SphereGeometry(0.24, 10, 6);
  innerCore.scale(1, 0.75, 1);
  innerCore.translate(0, 0.12, 0);
  parts.push(tintGeo(innerCore, 0.72, 0.98, 1.0));

  for (let t = 0; t < 4; t++) {
    const ang = (t / 4) * Math.PI * 2 + 0.4;
    const rx = Math.cos(ang) * 0.16;
    const rz = Math.sin(ang) * 0.16;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(rx, 0.02, rz),
      new THREE.Vector3(rx * 1.35, -0.32, rz * 1.35),
      new THREE.Vector3(rx * 0.85, -0.68, rz * 0.85),
    ]);
    const tent = new THREE.TubeGeometry(curve, 6, 0.022, 4, false);
    parts.push(tintGeo(tent, 0.38, 0.92, 1.0));
  }
  return mergePartGeos(parts);
}

function buildFloatingBuoyGeometry() {
  const parts = [];
  const profile = [
    new THREE.Vector2(0, -0.42),
    new THREE.Vector2(0.26, -0.42),
    new THREE.Vector2(0.34, -0.18),
    new THREE.Vector2(0.36, 0.0),
    new THREE.Vector2(0.34, 0.18),
    new THREE.Vector2(0.26, 0.42),
    new THREE.Vector2(0, 0.42),
  ];
  const barrel = new THREE.LatheGeometry(profile, 12);
  parts.push(tintGeo(barrel, 0.48, 0.28, 0.15));

  for (const [hy, rad] of [
    [-0.28, 0.305],
    [-0.08, 0.352],
    [0.08, 0.352],
    [0.28, 0.305],
  ]) {
    const hoop = new THREE.TorusGeometry(rad, 0.018, 6, 14);
    hoop.rotateX(Math.PI * 0.5);
    hoop.translate(0, hy, 0);
    parts.push(tintGeo(hoop, 0.16, 0.17, 0.19));
  }

  const pole = new THREE.CylinderGeometry(0.02, 0.025, 0.85, 6);
  pole.translate(0, 0.72, 0);
  parts.push(tintGeo(pole, 0.38, 0.24, 0.14));

  const flag = new THREE.BoxGeometry(0.36, 0.2, 0.02);
  flag.translate(0.18, 1.02, 0);
  parts.push(tintGeo(flag, 0.75, 0.18, 0.15));

  return mergePartGeos(parts);
}

/** 构建海盗双桅战舰靶船（暗橡木船壳 + 双桅黑红横帆 + 发光尾灯） */
function createPirateTargetShip() {
  const root = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2b1912, roughness: 0.76, metalness: 0.06 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x7d231b, roughness: 0.68, metalness: 0.08 });
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0x261d1c,
    roughness: 0.88,
    side: THREE.DoubleSide,
  });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffb864,
    emissive: new THREE.Color(0xff6a18),
    emissiveIntensity: 3.2,
  });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.5, 16.5), hullMat);
  hull.position.y = 0.65;
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(2.3, 4.6, 4), hullMat);
  bow.rotation.x = Math.PI * 0.5;
  bow.rotation.y = Math.PI * 0.25;
  bow.position.set(0, 0.78, 10.5);
  bow.castShadow = true;
  root.add(bow);

  const sternCastle = new THREE.Mesh(new THREE.BoxGeometry(3.9, 1.4, 4.2), trimMat);
  sternCastle.position.set(0, 2.35, -6.1);
  sternCastle.castShadow = true;
  root.add(sternCastle);

  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lanternMat);
  lantern.position.set(0, 3.35, -8.35);
  root.add(lantern);

  for (const [mz, mh, sw] of [
    [3.8, 11.5, 6.2],
    [-3.2, 13.5, 7.4],
  ]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, mh, 8), hullMat);
    mast.position.set(0, 1.5 + mh * 0.5, mz);
    mast.castShadow = true;
    root.add(mast);

    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, sw, 6), hullMat);
    yard.rotation.z = Math.PI * 0.5;
    yard.position.set(0, 1.5 + mh * 0.72, mz + 0.25);
    root.add(yard);

    const sail = new THREE.Mesh(new THREE.PlaneGeometry(sw * 0.88, mh * 0.52, 6, 4), sailMat);
    sail.position.set(0, 1.5 + mh * 0.45, mz + 0.42);
    sail.castShadow = true;
    root.add(sail);

    const emblem = new THREE.Mesh(new THREE.BoxGeometry(sw * 0.84, 0.42, 0.06), trimMat);
    emblem.position.set(0, 1.5 + mh * 0.45, mz + 0.45);
    root.add(emblem);
  }

  return root;
}

function createWorldLighthouse(scene) {
  const root = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x1e2326, roughness: 0.92, metalness: 0.04 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e3da, roughness: 0.72, metalness: 0.04 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0x932926, roughness: 0.68, metalness: 0.05 });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffdcae,
    emissive: new THREE.Color(0xffa642),
    emissiveIntensity: 4.2,
    roughness: 0.15,
  });

  const rocks = [
    [0, 5.5, 0, 22, 13, 7],
    [-14, 3.5, 6, 15, 9, 6],
    [15, 3, -5, 14, 8.5, 6],
    [4, 2.8, 13, 12, 7, 5],
  ];
  for (const [rx, ry, rz, rad, h, seg] of rocks) {
    const rm = new THREE.Mesh(new THREE.ConeGeometry(rad, h, seg), rockMat);
    rm.position.set(rx, ry, rz);
    rm.rotation.y = rx * 0.4;
    root.add(rm);
  }

  const baseY = 10.5;
  for (let tier = 0; tier < 5; tier++) {
    const h = 5.2;
    const rBot = 4.2 - tier * 0.42;
    const rTop = 3.78 - tier * 0.42;
    const segMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, 14),
      tier % 2 === 0 ? whiteMat : redMat
    );
    segMesh.position.set(0, baseY + tier * h + h * 0.5, 0);
    root.add(segMesh);
  }

  const topY = baseY + 26;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.65, 2.35, 0.9, 14), rockMat);
  gallery.position.set(0, topY + 0.45, 0);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 3.2, 12), lanternMat);
  core.position.set(0, topY + 2.3, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 12), redMat);
  roof.position.set(0, topY + 4.9, 0);
  root.add(gallery, core, roof);

  const beamPivot = new THREE.Group();
  beamPivot.position.set(0, topY + 2.3, 0);
  const coneGeo = new THREE.ConeGeometry(16, 135, 20, 1, true);
  coneGeo.translate(0, -67.5, 0);
  coneGeo.rotateX(-Math.PI * 0.5);

  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.78, 0.38) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vAlong = clamp(position.z / 135.0, 0.0, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.65);
        float axial = (1.0 - vAlong) * (1.0 - vAlong) * smoothstep(0.0, 0.08, vAlong);
        float a = edge * axial * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const beam1 = new THREE.Mesh(coneGeo, beamMat);
  const beam2 = new THREE.Mesh(coneGeo, beamMat);
  beam2.rotation.y = Math.PI;
  beamPivot.add(beam1, beam2);
  root.add(beamPivot);
  scene.add(root);

  const worldPos = { x: -120, z: 265 };

  return {
    root,
    getWorldPos: () => worldPos,
    update(time, state, shipWorldX = 0, shipWorldZ = 0) {
      const dx = worldPos.x - shipWorldX;
      const dz = worldPos.z - shipWorldZ;
      const dist = Math.hypot(dx, dz);

      const heading = state.worldHeading || 0;
      if (dist > 880) {
        const sideSign = Math.random() > 0.5 ? 1 : -1;
        const aheadAngle = heading + sideSign * (0.28 + Math.random() * 0.35);
        worldPos.x = shipWorldX + Math.sin(aheadAngle) * 520;
        worldPos.z = shipWorldZ + Math.cos(aheadAngle) * 520;
      }

      const relDx = worldPos.x - shipWorldX;
      const relDz = worldPos.z - shipWorldZ;
      const ch = Math.cos(heading);
      const sh = Math.sin(heading);
      const localX = relDx * ch - relDz * sh;
      const localZ = relDx * sh + relDz * ch;

      root.position.set(localX, -1.6, localZ);
      beamPivot.rotation.y = time * 0.46;
      const lf = THREE.MathUtils.clamp((state.lanternFactor - 0.18) / 0.82, 0, 1.3);
      lanternMat.emissiveIntensity = 0.4 + 4.2 * lf;
      beamMat.uniforms.uOpacity.value = 0.24 * lf * (1 - state.storminess * 0.22);
      return { dist: Math.hypot(localX, localZ), localX, localZ };
    },
  };
}

/**
 * 创建全船 16 门火炮齐射（支持左右舷独立开火）、海盗靶船、补给打捞、落点预测圈与海洋生态管理器
 */
export function createNavalAndEcology(scene, shipRoot, textures, deckCannons, gunportMuzzles, audio) {
  const fxGroup = new THREE.Group();
  scene.add(fxGroup);

  const allGuns = [];
  for (const dc of deckCannons) {
    allGuns.push({
      pivot: dc.pivot,
      baseX: dc.baseX,
      muzzleLocal: dc.muzzleLocal,
      side: dc.side,
      z: dc.z,
      recoil: 0,
      isDeck: true,
      lidHinge: null,
    });
  }
  for (const gp of gunportMuzzles) {
    allGuns.push({
      pivot: gp.pivot || null,
      baseX: gp.baseX !== undefined ? gp.baseX : 0,
      muzzleLocal: gp.muzzleLocal,
      side: gp.side,
      z: gp.z,
      recoil: 0,
      isDeck: false,
      lidHinge: gp.lidHinge || null,
      openAngle: gp.openAngle,
      closedAngle: gp.closedAngle,
    });
  }
  allGuns.sort((a, b) => b.z - a.z);

  const flashLights = [
    new THREE.PointLight(0xff9032, 0, 36, 1.5),
    new THREE.PointLight(0xff9032, 0, 36, 1.5),
  ];
  const flashTimers = [0, 0];
  const flashSprites = [];
  for (let k = 0; k < 2; k++) {
    scene.add(flashLights[k]);
    const sm = new THREE.SpriteMaterial({
      map: textures.softGlow,
      color: 0xffb858,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(4.2);
    scene.add(sp);
    flashSprites.push(sp);
  }

  // 第一人称水面炮弹落点预测圈（左舷 / 右舷各一环）
  const aimRingGeo = new THREE.RingGeometry(2.6, 3.3, 28);
  aimRingGeo.rotateX(-Math.PI * 0.5);
  const aimRingMat = new THREE.MeshBasicMaterial({
    color: 0xffd07a,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const aimRings = [new THREE.Mesh(aimRingGeo, aimRingMat), new THREE.Mesh(aimRingGeo, aimRingMat)];
  for (const ar of aimRings) {
    ar.visible = false;
    fxGroup.add(ar);
  }

  // 2 艘巡逻海盗双桅战舰靶船
  const enemies = [];
  for (let k = 0; k < 2; k++) {
    const mesh = createPirateTargetShip();
    fxGroup.add(mesh);
    enemies.push({
      mesh,
      worldX: k === 0 ? 95 : -105,
      worldZ: k === 0 ? 135 : 195,
      heading: k === 0 ? -0.4 : 0.35,
      speed: 3.4 + k * 0.6,
      hp: 3,
      sinking: false,
      sinkTimer: 0,
      fireSmokeTimer: 0,
    });
  }

  let totalHits = 0;
  let totalSinks = 0;
  let totalSalvaged = 0;
  let speedBoostTimer = 0;

  const maxBalls = 24;
  const ballGeo = new THREE.SphereGeometry(0.14, 8, 6);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0x222425, roughness: 0.45, metalness: 0.82 });
  const ballInst = new THREE.InstancedMesh(ballGeo, ballMat, maxBalls);
  const balls = [];
  const hideMat = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmpMat = new THREE.Matrix4();
  ballInst.frustumCulled = false;
  for (let k = 0; k < maxBalls; k++) {
    balls.push({ active: false, x: 0, y: -90, z: 0, vx: 0, vy: 0, vz: 0 });
    ballInst.setMatrixAt(k, hideMat);
  }
  ballInst.instanceMatrix.needsUpdate = true;
  fxGroup.add(ballInst);

  const nSmoke = 220;
  const smPos = new Float32Array(nSmoke * 3);
  const smSize = new Float32Array(nSmoke);
  const smAlpha = new Float32Array(nSmoke);
  const smPool = [];
  for (let k = 0; k < nSmoke; k++) {
    smPool.push({ active: false, x: 0, y: -90, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, kind: 0 });
  }

  const smGeo = new THREE.BufferGeometry();
  smGeo.setAttribute('position', new THREE.BufferAttribute(smPos, 3));
  smGeo.setAttribute('aSize', new THREE.BufferAttribute(smSize, 1));
  smGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smAlpha, 1));
  const smMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: textures.sprayDrop },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uTint: { value: new THREE.Color(0.92, 0.89, 0.85) },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPixelRatio * (320.0 / max(-mv.z, 1.0)), 1.5, 165.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform vec3 uTint;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        if (t.a * vAlpha < 0.008) discard;
        gl_FragColor = vec4(t.rgb * uTint, t.a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const smPoints = new THREE.Points(smGeo, smMat);
  smPoints.frustumCulled = false;
  fxGroup.add(smPoints);

  let smCursor = 0;
  function spawnPuff(x, y, z, vx, vy, vz, size, life, kind = 0) {
    const p = smPool[smCursor];
    smCursor = (smCursor + 1) % nSmoke;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.age = 0;
    p.life = life;
    p.size = size;
    p.kind = kind;
  }

  const fireQueue = [];
  let portCooldown = 0;
  let stbdCooldown = 0;
  let shakeImpulse = 0;
  let rollImpulse = 0;
  let salvoOpenHold = 0;
  let queuedAimPitch = 0;
  const camRight = new THREE.Vector3(1, 0, 0);
  const tmpWorld = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  function computeStereoPan(worldPt, cam) {
    camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    tmpDir.copy(worldPt).sub(cam.position).normalize();
    return THREE.MathUtils.clamp(tmpDir.dot(camRight), -0.92, 0.92);
  }

  /** sideFilter: 0 = 双舷齐射, 1 = 仅左舷 (Q), -1 = 仅右舷 (E) */
  function fireSalvo(cam, aimPitchOffset = 0, sideFilter = 0) {
    const cdMul = speedBoostTimer > 0 ? 0.65 : 1.0;
    if (sideFilter === 1 && portCooldown > 0.05) return false;
    if (sideFilter === -1 && stbdCooldown > 0.05) return false;
    if (sideFilter === 0 && portCooldown > 0.05 && stbdCooldown > 0.05) return false;

    if (sideFilter === 0 || sideFilter === 1) portCooldown = 1.95 * cdMul;
    if (sideFilter === 0 || sideFilter === -1) stbdCooldown = 1.95 * cdMul;
    salvoOpenHold = 3.2;
    queuedAimPitch = THREE.MathUtils.clamp(aimPitchOffset, -0.1, 0.25);

    _tmpLocalCam.copy(cam.position);
    shipRoot.worldToLocal(_tmpLocalCam);
    const leadSide = _tmpLocalCam.x >= 0 ? 1 : -1;
    let portIdx = 0;
    let stbdIdx = 0;
    for (const g of allGuns) {
      if (sideFilter !== 0 && g.side !== sideFilter) continue;
      const ord = g.side === 1 ? portIdx++ : stbdIdx++;
      const sideBase = sideFilter === 0 && g.side !== leadSide ? 0.22 : 0;
      fireQueue.push({ gun: g, timer: sideBase + ord * 0.065 + Math.random() * 0.03 });
    }
    return true;
  }

  function dischargeGun(g, cam) {
    if (g.pivot) g.recoil = g.isDeck ? 0.44 : 0.32;
    tmpWorld.copy(g.muzzleLocal).applyMatrix4(shipRoot.matrixWorld);
    _tmpOutDir
      .set(g.side, 0.065 + queuedAimPitch * 0.45 + Math.random() * 0.045, (Math.random() - 0.5) * 0.06)
      .transformDirection(shipRoot.matrixWorld);

    const li = g.side === 1 ? 0 : 1;
    flashLights[li].position.copy(tmpWorld).addScaledVector(_tmpOutDir, 0.6);
    flashLights[li].intensity = 26;
    flashTimers[li] = 0.12;
    flashSprites[li].position.copy(flashLights[li].position);
    flashSprites[li].material.opacity = 0.95;

    for (let k = 0; k < 6; k++) {
      const spd = 3.5 + Math.random() * 9.5;
      spawnPuff(
        tmpWorld.x + _tmpOutDir.x * 0.35,
        tmpWorld.y + _tmpOutDir.y * 0.35,
        tmpWorld.z + _tmpOutDir.z * 0.35,
        _tmpOutDir.x * spd + (Math.random() - 0.5) * 2.2,
        _tmpOutDir.y * spd + 0.8 + Math.random() * 2.2,
        _tmpOutDir.z * spd - currentSailingSpeed * 0.35 + (Math.random() - 0.5) * 2.2,
        1.8 + Math.random() * 2.4,
        1.4 + Math.random() * 1.1,
        0
      );
    }

    for (const b of balls) {
      if (!b.active) {
        const v0 = 46 + Math.random() * 14;
        b.active = true;
        b.x = tmpWorld.x;
        b.y = tmpWorld.y;
        b.z = tmpWorld.z;
        b.vx = _tmpOutDir.x * v0;
        b.vy = _tmpOutDir.y * v0 + 2.4;
        b.vz = _tmpOutDir.z * v0 - currentSailingSpeed * 0.25;
        break;
      }
    }

    shakeImpulse = Math.min(1, shakeImpulse + 0.26);
    rollImpulse += g.side * (g.isDeck ? 0.022 : 0.015);
    audio.triggerCannon(computeStereoPan(tmpWorld, cam), 0, 0.75 + Math.random() * 0.28);
  }

  const dolphinGeo = buildDolphinGeometry();
  const dolphinUniforms = { uTime: { value: 0 }, uBio: { value: 0 } };
  const dolphinMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.16,
    metalness: 0.08,
  });
  dolphinMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = dolphinUniforms.uTime;
    sh.uniforms.uBio = dolphinUniforms.uBio;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vDolphinBelly;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvDolphinBelly = clamp(-normal.y, 0.0, 1.0);\nfloat tailW = pow(clamp(0.62 - uv.x, 0.0, 1.0), 1.6);\ntransformed.y += sin(uTime * 10.5 + position.z * 2.4) * 0.14 * tailW;'
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBio;\nvarying float vDolphinBelly;')
      .replace(
        '#include <dithering_fragment>',
        'gl_FragColor.rgb += vec3(0.06, 0.78, 1.25) * uBio * (0.22 + 0.35 * vDolphinBelly);\n#include <dithering_fragment>'
      );
  };

  const dolphins = [
    { side: 1, lat: 9.2, zOff: 10.5, period: 5.8, phase: 0.4, leapH: 2.55, wasAir: false },
    { side: 1, lat: 12.4, zOff: 5.2, period: 6.4, phase: 2.5, leapH: 2.25, wasAir: false },
    { side: -1, lat: 9.6, zOff: 11.6, period: 6.1, phase: 1.5, leapH: 2.65, wasAir: false },
    { side: -1, lat: 13.0, zOff: 6.8, period: 6.9, phase: 4.1, leapH: 2.15, wasAir: false },
    { side: 1, lat: 7.8, zOff: 16.2, period: 5.5, phase: 3.6, leapH: 2.4, wasAir: false },
  ];
  for (const dl of dolphins) {
    const m = new THREE.Mesh(dolphinGeo, dolphinMat);
    m.castShadow = true;
    m.scale.setScalar(0.92 + Math.random() * 0.16);
    fxGroup.add(m);
    dl.mesh = m;
    dl.dive = 0;
  }

  const whaleMesh = new THREE.Mesh(buildWhaleGeometry(), dolphinMat);
  whaleMesh.castShadow = true;
  whaleMesh.visible = false;
  fxGroup.add(whaleMesh);
  const whaleState = {
    cooldown: 9.0,
    active: false,
    age: 0,
    dur: 3.8,
    x: 42,
    z: 65,
    yaw: 0.45,
    splashedIn: false,
  };

  const nJelly = 14;
  const jellyGeo = buildJellyfishGeometry();
  const jellyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const jellyInst = new THREE.InstancedMesh(jellyGeo, jellyMat, nJelly);
  jellyInst.frustumCulled = false;
  fxGroup.add(jellyInst);
  const jellies = [];
  for (let k = 0; k < nJelly; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    jellies.push({
      x: side * (7.5 + Math.random() * 26),
      z: -15 + Math.random() * 65,
      phase: Math.random() * Math.PI * 2,
      scale: 0.68 + Math.random() * 0.72,
    });
  }

  const buoyGeo = buildFloatingBuoyGeometry();
  const buoyMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.12,
  });
  const nBuoys = 6;
  const buoyInst = new THREE.InstancedMesh(buoyGeo, buoyMat, nBuoys);
  buoyInst.castShadow = true;
  buoyInst.frustumCulled = false;
  fxGroup.add(buoyInst);
  const buoys = [];
  for (let k = 0; k < nBuoys; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    buoys.push({
      x: side * (11 + Math.random() * 34),
      z: 20 + k * 24 + Math.random() * 14,
      rotY: Math.random() * Math.PI * 2,
    });
  }
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpPosVec = new THREE.Vector3();
  const tmpScaleVec = new THREE.Vector3(1, 1, 1);

  const iceFloeSystem = createIceFloeSystem(fxGroup, {
    onCollision(fx, fy, fz, sideSign, impact, cam) {
      shakeImpulse = Math.min(1.4, shakeImpulse + 0.24 * impact);
      rollImpulse += -sideSign * 0.095 * impact;
      tmpWorld.set(fx, fy, fz);
      audio.triggerIceCrunch(impact, computeStereoPan(tmpWorld, cam));
      for (let s = 0; s < 10; s++) {
        spawnPuff(
          fx - sideSign * 1.2 + (Math.random() - 0.5) * 1.4,
          fy + 0.35 + Math.random() * 0.4,
          fz + (Math.random() - 0.5) * 1.8,
          sideSign * (2.2 + Math.random() * 3.8),
          3.2 + Math.random() * 4.8,
          -currentSailingSpeed * 0.5 + (Math.random() - 0.5) * 2.6,
          1.4 + Math.random() * 1.8,
          0.65 + Math.random() * 0.45,
          1
        );
      }
    },
  });
  const deckBrazier = createDeckBrazier(shipRoot, textures);
  const lighthouse = createWorldLighthouse(scene);
  let eventBannerCallback = null;

  return {
    fireSalvo,
    onEvent(cb) {
      eventBannerCallback = cb;
    },
    getCooldown: () => Math.min(portCooldown, stbdCooldown),
    getCombatStats: () => ({ hits: totalHits, sinks: totalSinks, salvaged: totalSalvaged, speedBoost: speedBoostTimer > 0 }),
    getSpeedMultiplier: () => (speedBoostTimer > 0 ? 1.2 : 1.0),
    consumeShake(dt) {
      const out = shakeImpulse;
      shakeImpulse *= Math.exp(-dt * 9.5);
      if (shakeImpulse < 0.002) shakeImpulse = 0;
      return out;
    },
    consumeRollImpulse() {
      const out = rollImpulse;
      rollImpulse = 0;
      return out;
    },
    addShake(amount) {
      shakeImpulse = Math.min(1.6, shakeImpulse + amount);
    },
    addRollImpulse(val) {
      rollImpulse += val;
    },
    onResize(dpr) {
      smMat.uniforms.uPixelRatio.value = dpr;
      deckBrazier.onResize(dpr || Math.min(window.devicePixelRatio || 1, 2));
    },
    update(dt, time, shipPos, shipYaw, state, cam, shipWorldX = 0, shipWorldZ = 0, showAim = false, aimPitch = 0, ambientMode = false) {
      portCooldown = Math.max(0, portCooldown - dt);
      stbdCooldown = Math.max(0, stbdCooldown - dt);
      speedBoostTimer = Math.max(0, speedBoostTimer - dt);
      salvoOpenHold = Math.max(0, salvoOpenHold - dt);

      for (let k = fireQueue.length - 1; k >= 0; k--) {
        fireQueue[k].timer -= dt;
        if (fireQueue[k].timer <= 0) {
          dischargeGun(fireQueue[k].gun, cam);
          fireQueue.splice(k, 1);
        }
      }

      const closeForStorm =
        salvoOpenHold <= 0.01 && (state.storminess > 0.55 || state.tsunamiMode > 0.35);

      for (const g of allGuns) {
        if (g.pivot) {
          const maxRec = g.isDeck ? 0.44 : 0.32;
          if (g.recoil > 1e-4) {
            g.recoil = Math.max(0, g.recoil - dt * 0.34);
            const kick = Math.sin(Math.min(1, g.recoil / maxRec) * Math.PI * 0.5);
            g.pivot.position.x = g.baseX - g.side * g.recoil;
            if (g.isDeck) g.pivot.rotation.z = g.side * kick * 0.065;
          } else {
            const stormRetract = !g.isDeck && closeForStorm ? g.side * 0.38 : 0;
            g.pivot.position.x += (g.baseX - stormRetract - g.pivot.position.x) * Math.min(1, dt * 6);
            if (g.isDeck) g.pivot.rotation.z = 0;
          }
        }
        if (g.lidHinge) {
          const targetLidAng = closeForStorm ? g.closedAngle : g.openAngle;
          g.lidHinge.rotation.z += (targetLidAng - g.lidHinge.rotation.z) * (1 - Math.exp(-dt * 6.5));
        }
      }

      for (let k = 0; k < 2; k++) {
        if (flashTimers[k] > 0) {
          flashTimers[k] -= dt;
          const f = Math.max(0, flashTimers[k] / 0.12);
          flashLights[k].intensity = 26 * f * f;
          flashSprites[k].material.opacity = 0.95 * f;
        } else {
          flashLights[k].intensity = 0;
          flashSprites[k].material.opacity = 0;
        }
      }

      // 第一人称水面炮弹预测落点圈
      if (showAim) {
        const clampedPitch = THREE.MathUtils.clamp(aimPitch, -0.1, 0.25);
        const vy0 = (0.065 + clampedPitch * 0.45) * 52 + 2.4;
        const flightT = (vy0 + Math.sqrt(vy0 * vy0 + 2 * 9.81 * 2.2)) / 9.81;
        const range = 52 * flightT;
        for (let idx = 0; idx < 2; idx++) {
          const side = idx === 0 ? 1 : -1;
          const rx = shipPos.x + side * Math.cos(shipYaw) * range;
          const rz = shipPos.z - side * Math.sin(shipYaw) * range - currentSailingSpeed * 0.25 * flightT;
          const ry = sampleOceanHeight(rx, rz, time, state) + 0.18;
          aimRings[idx].position.set(rx, ry, rz);
          aimRings[idx].visible = true;
        }
      } else {
        aimRings[0].visible = false;
        aimRings[1].visible = false;
      }

      // 巡逻海盗双桅战舰更新与位置旋回
      const heading = state.worldHeading || 0;
      const ch = Math.cos(heading);
      const sh = Math.sin(heading);

      for (const en of enemies) {
        if (en.sinking) {
          en.sinkTimer += dt;
          en.mesh.position.y -= 1.65 * dt;
          en.mesh.rotation.z += 0.35 * dt;
          en.mesh.rotation.x += 0.18 * dt;
          if (en.sinkTimer > 3.6) {
            en.sinking = false;
            en.sinkTimer = 0;
            en.hp = 3;
            const sideSign = Math.random() > 0.5 ? 1 : -1;
            const spawnAng = heading + sideSign * (0.45 + Math.random() * 0.55);
            en.worldX = shipWorldX + Math.sin(spawnAng) * 210;
            en.worldZ = shipWorldZ + Math.cos(spawnAng) * 210;
            en.heading = heading + Math.PI * 0.35 * sideSign;
          }
        } else {
          en.heading += Math.sin(time * 0.25 + en.worldX * 0.01) * 0.08 * dt;
          en.worldX += Math.sin(en.heading) * en.speed * dt;
          en.worldZ += Math.cos(en.heading) * en.speed * dt;

          const relDx = en.worldX - shipWorldX;
          const relDz = en.worldZ - shipWorldZ;
          const distToShip = Math.hypot(relDx, relDz);
          if (distToShip > 420) {
            const sideSign = Math.random() > 0.5 ? 1 : -1;
            const spawnAng = heading + sideSign * (0.35 + Math.random() * 0.4);
            en.worldX = shipWorldX + Math.sin(spawnAng) * 185;
            en.worldZ = shipWorldZ + Math.cos(spawnAng) * 185;
          }

          const lx = (en.worldX - shipWorldX) * ch - (en.worldZ - shipWorldZ) * sh;
          const lz = (en.worldX - shipWorldX) * sh + (en.worldZ - shipWorldZ) * ch;
          const wy = sampleOceanHeight(lx, lz, time, state);
          en.mesh.position.set(lx, wy - 0.15, lz);
          en.mesh.rotation.order = 'YXZ';
          en.mesh.rotation.set(
            Math.sin(time * 1.4 + en.worldX * 0.05) * 0.045,
            en.heading - heading,
            Math.cos(time * 1.1 + en.worldZ * 0.05) * 0.07
          );

          if (en.hp < 3) {
            en.fireSmokeTimer -= dt;
            if (en.fireSmokeTimer <= 0) {
              en.fireSmokeTimer = 0.12;
              spawnPuff(
                lx + (Math.random() - 0.5) * 2.5,
                wy + 2.2,
                lz + (Math.random() - 0.5) * 4.5,
                (Math.random() - 0.5) * 1.5,
                3.2 + Math.random() * 2.5,
                -currentSailingSpeed * 0.3,
                2.5 + (3 - en.hp) * 1.2,
                1.4,
                0
              );
            }
          }
        }
      }

      // 炮弹飞行、命中敌舰爆炸与落水判定
      let anyBall = false;
      for (let k = 0; k < maxBalls; k++) {
        const b = balls[k];
        if (!b.active) {
          ballInst.setMatrixAt(k, hideMat);
          continue;
        }
        anyBall = true;
        b.vy -= 9.81 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;

        // 敌舰碰撞检测
        let hitEnemy = false;
        for (const en of enemies) {
          if (en.sinking) continue;
          const ex = en.mesh.position.x;
          const ey = en.mesh.position.y + 1.8;
          const ez = en.mesh.position.z;
          if (Math.hypot(b.x - ex, b.z - ez) < 8.5 && Math.abs(b.y - ey) < 5.5) {
            b.active = false;
            ballInst.setMatrixAt(k, hideMat);
            hitEnemy = true;
            totalHits++;
            en.hp--;
            audio.triggerCannon(computeStereoPan(en.mesh.position, cam), 0, 0.9);
            for (let s = 0; s < 14; s++) {
              spawnPuff(
                b.x + (Math.random() - 0.5) * 1.5,
                b.y + 0.4,
                b.z + (Math.random() - 0.5) * 1.5,
                (Math.random() - 0.5) * 8.5,
                3.5 + Math.random() * 7.0,
                (Math.random() - 0.5) * 8.5,
                2.8 + Math.random() * 2.6,
                1.1 + Math.random() * 0.6,
                0
              );
            }
            if (en.hp <= 0) {
              en.sinking = true;
              totalSinks++;
              if (eventBannerCallback) eventBannerCallback(`命中击沉海盗双桅战舰！累计战果：${totalSinks} 艘`);
            } else if (eventBannerCallback) {
              eventBannerCallback(`炮弹命中敌舰！（剩余耐久 ${en.hp}/3）`);
            }
            break;
          }
        }
        if (hitEnemy) continue;

        const wy = sampleOceanHeight(b.x, b.z, time, state);
        if (b.y <= wy) {
          b.active = false;
          ballInst.setMatrixAt(k, hideMat);
          tmpWorld.set(b.x, wy, b.z);
          audio.triggerSplash(computeStereoPan(tmpWorld, cam), 0.85);
          for (let s = 0; s < 9; s++) {
            spawnPuff(
              b.x + (Math.random() - 0.5) * 1.2,
              wy + 0.2,
              b.z + (Math.random() - 0.5) * 1.2,
              (Math.random() - 0.5) * 3.6,
              5.2 + Math.random() * 7.5,
              -currentSailingSpeed * 0.65 + (Math.random() - 0.5) * 3.2,
              2.2 + Math.random() * 2.8,
              0.85 + Math.random() * 0.65,
              1
            );
          }
        } else {
          tmpMat.makeTranslation(b.x, b.y, b.z);
          ballInst.setMatrixAt(k, tmpMat);
        }
      }
      if (anyBall || portCooldown > 0 || stbdCooldown > 0) ballInst.instanceMatrix.needsUpdate = true;

      const lFlash = state.lightningFlash * 0.45;
      const bio = state.bioluminescence;
      smMat.uniforms.uTint.value.setRGB(
        THREE.MathUtils.lerp(state.foamLit[0] * 0.95, 0.48, bio * 0.4) + lFlash,
        THREE.MathUtils.lerp(state.foamLit[1] * 0.95, 0.92, bio * 0.45) + lFlash,
        THREE.MathUtils.lerp(state.foamLit[2] * 0.96, 1.18, bio * 0.55) + lFlash
      );

      for (let k = 0; k < nSmoke; k++) {
        const p = smPool[k];
        if (!p.active) {
          smPos[k * 3 + 1] = -120;
          smSize[k] = 0;
          smAlpha[k] = 0;
          continue;
        }
        p.age += dt;
        if (p.age >= p.life) {
          p.active = false;
          smPos[k * 3 + 1] = -120;
          smAlpha[k] = 0;
          continue;
        }
        if (p.kind === 1) {
          p.vy -= 12.5 * dt;
        } else {
          p.vx += (-0.8 * state.windSpeedScale - p.vx) * dt * 1.2;
          p.vy += (1.15 - p.vy) * dt * 1.4;
          p.vz += (-currentSailingSpeed * 0.55 - p.vz) * dt * 1.1;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const u = p.age / p.life;
        smPos[k * 3] = p.x;
        smPos[k * 3 + 1] = p.y;
        smPos[k * 3 + 2] = p.z;
        smSize[k] = p.size * (p.kind === 1 ? 0.8 + u * 1.35 : 1 + u * 2.4);
        smAlpha[k] = Math.min(1, u * 6) * (1 - Math.pow(u, p.kind === 1 ? 1.6 : 1.25)) * (p.kind === 1 ? 0.56 : 0.34);
      }
      smGeo.attributes.position.needsUpdate = true;
      smGeo.attributes.aSize.needsUpdate = true;
      smGeo.attributes.aAlpha.needsUpdate = true;

      dolphinUniforms.uTime.value = time;
      dolphinUniforms.uBio.value = state.bioluminescence;
      const hideDolphin = state.storminess > 0.38 || state.tsunamiMode > 0.22 ? 1 : 0;
      const cy = Math.cos(shipYaw);
      const sy = Math.sin(shipYaw);

      for (const dl of dolphins) {
        dl.dive += (hideDolphin - dl.dive) * (1 - Math.exp(-dt * 1.5));
        if (dl.dive > 0.96) {
          dl.mesh.visible = false;
          continue;
        }
        dl.mesh.visible = true;
        const cyc = ((time + dl.phase) % dl.period) / dl.period;
        const lx = dl.side * (dl.lat + Math.sin(time * 0.7 + dl.phase) * 0.85);
        const lz = dl.zOff + Math.cos(time * 0.55 + dl.phase) * 2.2;
        const wx = shipPos.x + lx * cy + lz * sy;
        const wz = shipPos.z - lx * sy + lz * cy;
        const surfY = sampleOceanHeight(wx, wz, time, state);

        let air = false;
        let arcY = -0.62;
        let pitch = 0;
        if (cyc < 0.36 && dl.dive < 0.35) {
          const u = cyc / 0.36;
          const sArc = Math.sin(u * Math.PI);
          arcY = -0.45 + sArc * (dl.leapH * (1 - dl.dive));
          pitch = -Math.cos(u * Math.PI) * 0.62;
          air = arcY > 0;
        } else {
          const u = (cyc - 0.36) / 0.64;
          arcY = -0.55 - Math.sin(u * Math.PI) * 0.42;
          pitch = Math.cos(u * Math.PI) * 0.12;
        }

        if (air !== dl.wasAir) {
          dl.wasAir = air;
          for (let s = 0; s < 4; s++) {
            spawnPuff(
              wx + (Math.random() - 0.5) * 0.45,
              surfY + 0.12,
              wz + (Math.random() - 0.5) * 0.45,
              (Math.random() - 0.5) * 1.8,
              1.8 + Math.random() * 2.6,
              -currentSailingSpeed * 0.7,
              1.1 + Math.random() * 0.9,
              0.55 + Math.random() * 0.35,
              1
            );
          }
        }

        dl.mesh.position.set(wx, surfY + arcY - dl.dive * 5.5, wz);
        dl.mesh.rotation.order = 'YXZ';
        dl.mesh.rotation.set(pitch, shipYaw + Math.sin(time * 0.7 + dl.phase) * 0.08, -dl.side * 0.08);
      }

      if (!whaleState.active) {
        if (state.tsunamiMode < 0.25) {
          whaleState.cooldown -= dt;
          if (whaleState.cooldown <= 0) {
            whaleState.active = true;
            whaleState.age = 0;
            whaleState.splashedIn = false;
            const side = Math.random() > 0.5 ? 1 : -1;
            whaleState.x = side * (32 + Math.random() * 38);
            whaleState.z = 38 + Math.random() * 55;
            whaleState.yaw = side * -0.55 + (Math.random() - 0.5) * 0.35;
            whaleMesh.visible = true;
            tmpWorld.set(whaleState.x, 0, whaleState.z);
            audio.triggerWhaleCall(computeStereoPan(tmpWorld, cam));
          }
        }
      } else {
        whaleState.age += dt;
        const u = whaleState.age / whaleState.dur;
        if (u >= 1) {
          whaleState.active = false;
          whaleMesh.visible = false;
          whaleState.cooldown = 20 + Math.random() * 14;
        } else {
          whaleState.z -= currentSailingSpeed * 0.45 * dt;
          const surfY = sampleOceanHeight(whaleState.x, whaleState.z, time, state);
          const arcY = -3.8 + Math.sin(u * Math.PI) * 11.2;
          const wPitch = -Math.cos(u * Math.PI) * 0.78;
          whaleMesh.position.set(whaleState.x, surfY + arcY, whaleState.z);
          whaleMesh.rotation.order = 'YXZ';
          whaleMesh.rotation.set(wPitch, whaleState.yaw, Math.sin(u * Math.PI) * 0.42);

          if (!whaleState.splashedIn && u > 0.76) {
            whaleState.splashedIn = true;
            tmpWorld.set(whaleState.x, surfY, whaleState.z);
            audio.triggerSplash(computeStereoPan(tmpWorld, cam), 1.85);
            for (let s = 0; s < 20; s++) {
              spawnPuff(
                whaleState.x + (Math.random() - 0.5) * 5.2,
                surfY + 0.4,
                whaleState.z + (Math.random() - 0.5) * 5.2,
                (Math.random() - 0.5) * 7.2,
                7.5 + Math.random() * 10.5,
                -currentSailingSpeed * 0.5 + (Math.random() - 0.5) * 5.0,
                4.2 + Math.random() * 4.5,
                1.2 + Math.random() * 0.85,
                1
              );
            }
          }
        }
      }

      if (bio > 0.08) {
        jellyInst.visible = true;
        jellyMat.opacity = bio * 0.72;
        for (let k = 0; k < nJelly; k++) {
          const jl = jellies[k];
          jl.z -= currentSailingSpeed * 0.65 * dt;
          if (jl.z < -35) {
            jl.z = 55 + Math.random() * 25;
            jl.x = (k % 2 === 0 ? 1 : -1) * (7.5 + Math.random() * 26);
          }
          const wy = sampleOceanHeight(jl.x, jl.z, time, state);
          const pulse = 0.85 + 0.22 * Math.sin(time * 2.8 + jl.phase);
          tmpPosVec.set(jl.x, wy - 0.25 + Math.sin(time * 1.4 + jl.phase) * 0.14, jl.z);
          tmpQuat.setFromEuler(tmpEuler.set(Math.sin(time + jl.phase) * 0.18, 0, Math.cos(time + jl.phase) * 0.18));
          tmpScaleVec.set(jl.scale * pulse, jl.scale * (1.15 - pulse * 0.2), jl.scale * pulse);
          tmpMat.compose(tmpPosVec, tmpQuat, tmpScaleVec);
          jellyInst.setMatrixAt(k, tmpMat);
        }
        jellyInst.instanceMatrix.needsUpdate = true;
      } else {
        jellyInst.visible = false;
      }

      // 随波漂浮航海木桶与航标更新 + 靠近 <14m 自动打捞拾取
      for (let k = 0; k < nBuoys; k++) {
        const by = buoys[k];
        by.z -= currentSailingSpeed * 0.86 * dt;
        const distShip = Math.hypot(by.x - shipPos.x, by.z - shipPos.z);
        if (distShip < 13.5 && by.z > -16 && by.z < 18) {
          totalSalvaged++;
          speedBoostTimer = 6.5;
          audio.triggerBell(0);
          if (eventBannerCallback) eventBannerCallback(`打捞海上补给木桶！获得 6.5 秒疾行与快速装填`);
          by.z = 115 + Math.random() * 55;
          by.x = (k % 2 === 0 ? 1 : -1) * (10 + Math.random() * 38);
        } else if (by.z < -75) {
          by.z = 110 + Math.random() * 55;
          by.x = (k % 2 === 0 ? 1 : -1) * (10 + Math.random() * 38);
        }
        const wy = sampleOceanHeight(by.x, by.z, time, state);
        const hFwd = sampleOceanHeight(by.x, by.z + 1.2, time, state);
        const hSide = sampleOceanHeight(by.x + 1.2, by.z, time, state);
        tmpPosVec.set(by.x, wy - 0.08, by.z);
        tmpQuat.setFromEuler(tmpEuler.set(-(hFwd - wy) * 0.45, by.rotY + time * 0.22, (hSide - wy) * 0.45));
        tmpScaleVec.set(1, 1, 1);
        tmpMat.compose(tmpPosVec, tmpQuat, tmpScaleVec);
        buoyInst.setMatrixAt(k, tmpMat);
      }
      buoyInst.instanceMatrix.needsUpdate = true;

      // 船尾防风炭火盆摇曳暖光更新
      deckBrazier.update(time, state, ambientMode ? 1 : 0);

      iceFloeSystem.update(dt, time, shipPos, state, cam);

      const lhInfo = lighthouse.update(time, state, shipWorldX, shipWorldZ);
      return {
        lighthouseDist: lhInfo.dist,
        lighthouseLocalX: lhInfo.localX,
        lighthouseLocalZ: lhInfo.localZ,
        hits: totalHits,
        sinks: totalSinks,
        salvaged: totalSalvaged,
        speedBoost: speedBoostTimer > 0,
      };
    },
  };
}
