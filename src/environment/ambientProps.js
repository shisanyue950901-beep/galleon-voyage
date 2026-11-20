/**
 * @file ambientProps.js
 * @description 沉浸伴航专属 3D 物理道具模块：
 *              1. createDeckBrazier：船尾甲板防风锻铁炭火盆（三脚铁架、炭火床、双层摇曳火焰、上升火星与摇曳点光源）；
 *              2. createIceFloeSystem：极地暴雪 18 块多面体浮冰群（实时浮力波浪起伏 + 船体碰撞冲量弹开/旋转/碎冰与冰裂音效联动）。
 */

import * as THREE from 'three';
import { currentSailingSpeed, sampleOceanHeight } from './oceanSimulation.js';

function tintAmbientGeo(geo, r, g, b) {
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

function mergeSimpleGeos(geos) {
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

/** 构建多面体极地浮冰块几何（顶面覆雪白、侧壁冰川浅青蓝） */
function buildIceFloeGeometry() {
  const parts = [];
  const base = new THREE.CylinderGeometry(2.45, 2.95, 1.15, 7, 1);
  const pos = base.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const radialJitter = 0.84 + 0.24 * Math.sin(ang * 3.0 + 0.7) + 0.14 * Math.cos(ang * 5.0 - 0.4);
    pos.setX(i, x * radialJitter);
    pos.setZ(i, z * radialJitter);
    if (y > 0) pos.setY(i, y + 0.12 * Math.sin(ang * 2.0));
  }
  base.computeVertexNormals();
  parts.push(tintAmbientGeo(base, 0.74, 0.89, 0.97));

  const snowCap = new THREE.CylinderGeometry(2.15, 2.38, 0.32, 7, 1);
  snowCap.translate(0, 0.68, 0);
  parts.push(tintAmbientGeo(snowCap, 0.94, 0.97, 1.0));

  const ridge = new THREE.ConeGeometry(0.95, 1.15, 5);
  ridge.translate(0.45, 1.05, -0.25);
  ridge.rotateZ(-0.18);
  parts.push(tintAmbientGeo(ridge, 0.84, 0.94, 1.0));

  return mergeSimpleGeos(parts);
}

/** 构建船尾甲板防风锻铁炭火盆 */
export function createDeckBrazier(shipRoot, textures) {
  const group = new THREE.Group();
  group.position.set(0, 5.18, -4.35);

  const ironMat = new THREE.MeshStandardMaterial({ color: 0x1b1a1e, roughness: 0.58, metalness: 0.72 });
  const coalMat = new THREE.MeshStandardMaterial({
    color: 0x2b0b04,
    emissive: new THREE.Color(0xff4208),
    emissiveIntensity: 2.2,
    roughness: 0.85,
  });

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 0.78, 6), ironMat);
    leg.position.set(Math.cos(a) * 0.28, 0.36, Math.sin(a) * 0.28);
    leg.rotation.z = Math.cos(a) * 0.22;
    leg.rotation.x = -Math.sin(a) * 0.22;
    group.add(leg);
  }
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.26, 0.34, 10), ironMat);
  bowl.position.y = 0.78;
  group.add(bowl);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.032, 6, 14), ironMat);
  rim.rotation.x = Math.PI * 0.5;
  rim.position.y = 0.95;
  group.add(rim);

  const coals = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 1), coalMat);
  coals.scale.set(1.1, 0.48, 1.1);
  coals.position.y = 0.94;
  group.add(coals);

  const outerFlameMat = new THREE.MeshBasicMaterial({
    color: 0xff6b14,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: 0xffdf78,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const outerFlame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.78, 7), outerFlameMat);
  outerFlame.position.y = 1.32;
  const innerFlame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.48, 6), innerFlameMat);
  innerFlame.position.y = 1.18;
  group.add(outerFlame, innerFlame);

  const fireLight = new THREE.PointLight(0xff7d28, 4.5, 16, 1.7);
  fireLight.position.set(0, 1.55, 0);
  group.add(fireLight);

  const nEmbers = 26;
  const embPos = new Float32Array(nEmbers * 3);
  const embSeed = new Float32Array(nEmbers);
  for (let i = 0; i < nEmbers; i++) {
    embPos[i * 3] = (Math.random() - 0.5) * 0.34;
    embPos[i * 3 + 1] = 0.95 + Math.random() * 1.9;
    embPos[i * 3 + 2] = (Math.random() - 0.5) * 0.34;
    embSeed[i] = Math.random() * 10;
  }
  const embGeo = new THREE.BufferGeometry();
  embGeo.setAttribute('position', new THREE.BufferAttribute(embPos, 3));
  embGeo.setAttribute('aSeed', new THREE.BufferAttribute(embSeed, 1));
  const embMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTex: { value: textures.softGlow },
      uStrength: { value: 1 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vLife;
      void main() {
        float cyc = fract(uTime * 0.55 + aSeed * 0.37);
        vLife = cyc;
        vec3 p = position;
        p.y = 0.98 + cyc * 2.45;
        p.x += sin(uTime * 4.2 + aSeed * 3.1) * 0.18 * cyc - cyc * 0.28;
        p.z += cos(uTime * 3.6 + aSeed * 2.7) * 0.16 * cyc - cyc * 0.38;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((0.18 + (1.0 - cyc) * 0.16) * uPixelRatio * (260.0 / max(-mv.z, 1.0)), 1.5, 11.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform float uStrength;
      varying float vLife;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        vec3 col = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.28, 0.04), vLife);
        float a = t.a * (1.0 - vLife) * uStrength;
        gl_FragColor = vec4(col * a * 1.4, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const embers = new THREE.Points(embGeo, embMat);
  group.add(embers);
  shipRoot.add(group);

  return {
    update(time, state, ambientBoost = 0) {
      const basePresence = Math.max(state.lanternFactor * 0.72, ambientBoost ? 1.15 : 0);
      const active = basePresence > 0.12;
      outerFlame.visible = active;
      innerFlame.visible = active;
      embers.visible = active;
      if (!active) {
        fireLight.intensity = 0;
        coalMat.emissiveIntensity = 0.25;
        return;
      }
      const flk = 0.86 + 0.14 * Math.sin(time * 13.7) * Math.cos(time * 8.3);
      const flk2 = 0.9 + 0.1 * Math.sin(time * 19.2 + 1.1);
      const windLean = -0.12 * state.windSpeedScale;
      outerFlame.scale.set(
        0.92 + 0.12 * flk,
        (0.85 + 0.28 * flk) * Math.min(1.35, basePresence),
        0.92 + 0.12 * flk2
      );
      outerFlame.rotation.set(windLean, time * 1.8, Math.sin(time * 9.5) * 0.14);
      innerFlame.scale.set(
        0.9 + 0.1 * flk2,
        (0.82 + 0.25 * flk2) * Math.min(1.25, basePresence),
        0.9 + 0.1 * flk
      );
      innerFlame.rotation.set(windLean * 0.7, -time * 2.2, Math.cos(time * 11.2) * 0.1);
      coalMat.emissiveIntensity = 1.8 + 1.4 * basePresence * flk;
      fireLight.intensity = 5.2 * basePresence * flk;
      embMat.uniforms.uTime.value = time;
      embMat.uniforms.uStrength.value = Math.min(1.25, basePresence);
    },
    onResize(dpr) {
      embMat.uniforms.uPixelRatio.value = dpr;
    },
  };
}

/** 创建极地暴雪可碰撞浮冰群系统 */
export function createIceFloeSystem(parentGroup, callbacks = {}) {
  const iceGeo = buildIceFloeGeometry();
  const iceMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.28,
    metalness: 0.08,
  });
  const nIce = 18;
  const iceInst = new THREE.InstancedMesh(iceGeo, iceMat, nIce);
  iceInst.castShadow = true;
  iceInst.receiveShadow = true;
  iceInst.frustumCulled = false;
  iceInst.visible = false;
  parentGroup.add(iceInst);

  const iceFloes = [];
  for (let k = 0; k < nIce; k++) {
    const lane = (k % 5) - 2;
    const isCenterLane = k % 4 === 0;
    iceFloes.push({
      x: isCenterLane ? (Math.random() - 0.5) * 9.5 : lane * 14 + (Math.random() - 0.5) * 9,
      z: 18 + k * 14 + Math.random() * 10,
      vx: 0,
      vz: 0,
      rotY: Math.random() * Math.PI * 2,
      angVel: (Math.random() - 0.5) * 0.18,
      scaleX: 0.72 + Math.random() * 0.85,
      scaleY: 0.65 + Math.random() * 0.55,
      scaleZ: 0.72 + Math.random() * 0.85,
      hitCooldown: 0,
    });
  }

  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpScale = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  return {
    update(dt, time, shipPos, state, cam) {
      const snowPresence = state.snowAmount || 0;
      if (snowPresence <= 0.03) {
        iceInst.visible = false;
        return;
      }
      iceInst.visible = true;
      const riseOffset = (1 - Math.min(1, snowPresence * 1.4)) * -4.2;

      for (let k = 0; k < nIce; k++) {
        const fl = iceFloes[k];
        if (fl.hitCooldown > 0) fl.hitCooldown -= dt;
        fl.z += (-currentSailingSpeed * 0.92 + fl.vz) * dt;
        fl.x += fl.vx * dt;
        fl.vx *= Math.exp(-dt * 1.85);
        fl.vz *= Math.exp(-dt * 1.85);
        fl.rotY += fl.angVel * dt;
        fl.angVel *= Math.exp(-dt * 0.55);

        const iceRad = 2.2 * Math.max(fl.scaleX, fl.scaleZ);
        const dx = fl.x - shipPos.x;
        const dz = fl.z - shipPos.z;
        if (Math.abs(dx) < 4.6 + iceRad && dz > -15.5 && dz < 16.5) {
          const sideSign = dx >= 0 ? 1 : -1;
          const overlap = 4.6 + iceRad - Math.abs(dx);
          fl.x += sideSign * (overlap + 0.35);
          fl.vx += sideSign * (4.8 + Math.random() * 2.6);
          fl.vz -= 2.4 + Math.random() * 1.6;
          fl.angVel += sideSign * (1.35 + Math.random() * 1.2);

          if (fl.hitCooldown <= 0) {
            fl.hitCooldown = 1.45;
            const impact = THREE.MathUtils.clamp(currentSailingSpeed / 6.5, 0.45, 1.25);
            const wyHit = sampleOceanHeight(fl.x, fl.z, time, state);
            if (callbacks.onCollision) {
              callbacks.onCollision(fl.x, wyHit, fl.z, sideSign, impact, cam);
            }
          }
        }

        if (fl.z < -85) {
          fl.z = 115 + Math.random() * 65;
          fl.x = k % 4 === 0 ? (Math.random() - 0.5) * 10 : ((k % 5) - 2) * 14 + (Math.random() - 0.5) * 10;
          fl.vx = 0;
          fl.vz = 0;
          fl.angVel = (Math.random() - 0.5) * 0.18;
        }

        const wy = sampleOceanHeight(fl.x, fl.z, time, state);
        const hFwd = sampleOceanHeight(fl.x, fl.z + 1.6, time, state);
        const hSide = sampleOceanHeight(fl.x + 1.6, fl.z, time, state);
        tmpPos.set(fl.x, wy - 0.32 + riseOffset, fl.z);
        tmpQuat.setFromEuler(tmpEuler.set(-(hFwd - wy) * 0.28, fl.rotY, (hSide - wy) * 0.28));
        tmpScale.set(fl.scaleX, fl.scaleY, fl.scaleZ);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        iceInst.setMatrixAt(k, tmpMat);
      }
      iceInst.instanceMatrix.needsUpdate = true;
    },
  };
}
