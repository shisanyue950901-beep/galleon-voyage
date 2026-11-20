/**
 * @file atmosphereParticles.js
 * @description 海洋大气粒子与海鸟群模块：
 *              包含船首劈浪飞沫、船尾水雾、海啸水墙飞沫、GPU 暴雨雨线、GPU 极地暴雪（1800 粒子）、
 *              空气暖光浮尘、大浪拍船首爆发粒子以及暴风自动避风盘旋海鸟群。
 */

import * as THREE from 'three';
import { evaluateTsunamiProfile } from '../state/weatherState.js';
import { zToHullParam, sampleHullSurface } from '../ship/hullCurve.js';
import { currentSailingSpeed, sampleOceanHeight } from './oceanSimulation.js';

const _tmpAtmoHullPt = new THREE.Vector3();

/**
 * 创建船首飞沫、暴雨雨线、空气微尘与盘旋海鸟系统
 */
export function createAtmosphericParticlesAndBirds(scene, textures) {
  const group = new THREE.Group();
  scene.add(group);

  const numParticles = 460;
  const sprayPos = new Float32Array(numParticles * 3);
  const spraySize = new Float32Array(numParticles);
  const sprayAlpha = new Float32Array(numParticles);
  const particles = [];

  for (let i = 0; i < numParticles; i++) {
    const kind = i < 240 ? 'bow' : i < 340 ? 'mist' : 'tsunami';
    particles.push({
      x: 0,
      y: -50,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: Math.random() * 1.6,
      life: 0.7 + Math.random() * 1.1,
      baseSize: 0.8 + Math.random() * 1.2,
      kind,
    });
  }

  function respawnParticle(p, shipPos, shipPitch, bowSlam, time, state) {
    p.age = 0;
    if (p.kind === 'tsunami') {
      if (!state || state.tsunamiMode < 0.08) {
        p.y = -60;
        p.life = 0.4 + Math.random() * 0.5;
        p.baseSize = 0.1;
        return;
      }
      const rx = (Math.random() - 0.5) * 190;
      const curveZ = Math.cos(rx * 0.018) * 3.5;
      const rz = state.tsunamiCrestZ + curveZ + (Math.random() - 0.5) * 8.5;
      const tsu = evaluateTsunamiProfile(rx, rz, state.tsunamiCrestZ, state.tsunamiMode);
      if (tsu.crestFactor < 0.25) {
        p.y = -60;
        p.life = 0.35;
        return;
      }
      p.x = rx;
      p.y = tsu.y - 1.2 + Math.random() * 2.8;
      p.z = rz;
      p.vx = (Math.random() - 0.5) * 4.5 - 1.8;
      p.vy = 2.5 + Math.random() * 6.5;
      p.vz = -18.5 - Math.random() * 7.5;
      p.life = 0.9 + Math.random() * 1.25;
      p.baseSize = (5.2 + Math.random() * 7.5) * tsu.crestFactor;
      return;
    }

    if (p.kind === 'mist') {
      if (Math.random() < 0.55) {
        const zOff = -14.2 - Math.random() * 2.5;
        const wy = sampleOceanHeight(shipPos.x, shipPos.z + zOff, time, state);
        p.x = shipPos.x + (Math.random() - 0.5) * 4.2;
        p.y = wy + 0.25 + Math.random() * 0.65;
        p.z = shipPos.z + zOff;
        p.vx = (Math.random() - 0.5) * 1.2 - 0.45 * (state ? state.windSpeedScale : 1);
        p.vy = 0.45 + Math.random() * 0.85;
        p.vz = -currentSailingSpeed * (0.72 + Math.random() * 0.25);
        p.life = 1.2 + Math.random() * 1.4;
        p.baseSize = 1.8 + Math.random() * 2.4;
      } else {
        const side = Math.random() < 0.5 ? -1 : 1;
        const zLocal = -8 + Math.random() * 20;
        sampleHullSurface(zToHullParam(zLocal), 0.48, _tmpAtmoHullPt);
        const wy = sampleOceanHeight(shipPos.x + _tmpAtmoHullPt.x * side, shipPos.z + zLocal, time, state);
        p.x = shipPos.x + (_tmpAtmoHullPt.x + 0.35) * side;
        p.y = wy + 0.15 + Math.random() * 0.45;
        p.z = shipPos.z + zLocal;
        p.vx = side * (0.8 + Math.random() * 1.4) - 0.35;
        p.vy = 0.6 + Math.random() * 1.1;
        p.vz = -currentSailingSpeed * (0.78 + Math.random() * 0.22);
        p.life = 0.85 + Math.random() * 0.95;
        p.baseSize = 1.35 + Math.random() * 1.85;
      }
      return;
    }

    const side = Math.random() < 0.5 ? -1 : 1;
    const zBow = 11.2 + Math.pow(Math.random(), 0.58) * 4.1;
    sampleHullSurface(zToHullParam(zBow), 0.44, _tmpAtmoHullPt);
    const waveScale = state ? state.waveAmpScale : 1;
    const energy = (0.82 + bowSlam * 0.65) * (0.85 + 0.25 * waveScale);
    const wx = shipPos.x + (_tmpAtmoHullPt.x + 0.38) * side;
    const wz = shipPos.z + zBow;
    const bowKeelY = shipPos.y - Math.sin(shipPitch) * zBow;
    const surfY = sampleOceanHeight(wx, wz, time, state);

    p.x = wx;
    p.y = Math.max(surfY, bowKeelY - 0.8) + 0.08 + Math.random() * 0.35;
    p.z = wz;
    p.vx = side * (1.8 + Math.random() * 2.9) * energy - 0.55;
    p.vy = (1.8 + Math.random() * 3.5) * energy;
    p.vz = -currentSailingSpeed * (0.64 + Math.random() * 0.34);
    p.life = 0.55 + Math.random() * 0.72;
    p.baseSize = (0.75 + Math.random() * 1.35) * (0.85 + bowSlam * 0.35);
  }

  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  sprayGeo.setAttribute('aSize', new THREE.BufferAttribute(spraySize, 1));
  sprayGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sprayAlpha, 1));

  const sprayMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: textures.sprayDrop },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uSprayTint: { value: new THREE.Color(1.04, 0.95, 0.86) },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPixelRatio * (310.0 / max(-mvPos.z, 1.0)), 1.5, 130.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform vec3 uSprayTint;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uTex, gl_PointCoord);
        if (tex.a * vAlpha < 0.01) discard;
        gl_FragColor = vec4(tex.rgb * uSprayTint, tex.a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const sprayPoints = new THREE.Points(sprayGeo, sprayMat);
  sprayPoints.frustumCulled = false;
  group.add(sprayPoints);

  const rainCount = 1500;
  const rainPos = new Float32Array(rainCount * 2 * 3);
  const rainEnd = new Float32Array(rainCount * 2);
  for (let i = 0; i < rainCount; i++) {
    const rx = (Math.random() - 0.5) * 76;
    const ry = Math.random() * 46;
    const rz = (Math.random() - 0.5) * 76;
    const base = i * 6;
    rainPos[base] = rx;
    rainPos[base + 1] = ry;
    rainPos[base + 2] = rz;
    rainPos[base + 3] = rx;
    rainPos[base + 4] = ry;
    rainPos[base + 5] = rz;
    rainEnd[i * 2] = 0;
    rainEnd[i * 2 + 1] = 1;
  }

  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(rainEnd, 1));
  const rainMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRainAmount: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uLightningFlash: { value: 0 },
    },
    vertexShader: `
      attribute float aEnd;
      uniform float uTime;
      uniform vec3 uCenter;
      varying float vEnd;
      void main() {
        vEnd = aEnd;
        vec3 windVel = vec3(-7.5, -34.0, -9.5);
        vec3 p = position + windVel * uTime;
        p.x = mod(p.x + 38.0, 76.0) - 38.0 + uCenter.x;
        p.y = mod(p.y, 46.0) - 4.0 + uCenter.y * 0.45;
        p.z = mod(p.z + 38.0, 76.0) - 38.0 + uCenter.z;
        p += normalize(windVel) * (aEnd * 1.55);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uRainAmount;
      uniform float uLightningFlash;
      varying float vEnd;
      void main() {
        vec3 col = mix(vec3(0.62, 0.74, 0.88), vec3(0.92, 0.96, 1.0), uLightningFlash * 0.7);
        float alpha = uRainAmount * (0.08 + 0.28 * vEnd) * (1.0 + uLightningFlash * 0.85);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.frustumCulled = false;
  rainLines.visible = false;
  group.add(rainLines);

  // 极地暴雪 GPU 飘雪系统（1800 片斜吹旋涡雪花，随风速与月光/极光柔亮）
  const snowCount = 1800;
  const snowPos = new Float32Array(snowCount * 3);
  const snowSeed = new Float32Array(snowCount);
  for (let i = 0; i < snowCount; i++) {
    snowPos[i * 3] = (Math.random() - 0.5) * 84;
    snowPos[i * 3 + 1] = Math.random() * 48;
    snowPos[i * 3 + 2] = (Math.random() - 0.5) * 84;
    snowSeed[i] = Math.random() * 100;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  snowGeo.setAttribute('aSeed', new THREE.BufferAttribute(snowSeed, 1));
  const snowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSnowAmount: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        float driftX = -10.5 - mod(aSeed, 4.5);
        float fallY = -6.2 - mod(aSeed * 1.7, 3.8);
        float driftZ = -8.5 - mod(aSeed * 2.3, 4.0);
        vec3 p = position + vec3(driftX, fallY, driftZ) * uTime;
        p.x += sin(uTime * 1.65 + aSeed) * 1.85;
        p.z += cos(uTime * 1.35 + aSeed * 1.3) * 1.65;
        p.x = mod(p.x + 42.0, 84.0) - 42.0 + uCenter.x;
        p.y = mod(p.y, 48.0) - 4.0 + uCenter.y * 0.45;
        p.z = mod(p.z + 42.0, 84.0) - 42.0 + uCenter.z;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float sz = 0.24 + fract(aSeed * 0.73) * 0.28;
        gl_PointSize = clamp(sz * uPixelRatio * (270.0 / max(-mv.z, 1.0)), 1.5, 13.0);
        vAlpha = 0.45 + 0.55 * fract(aSeed * 0.37);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uSnowAmount;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float soft = smoothstep(0.5, 0.08, d);
        gl_FragColor = vec4(vec3(0.86, 0.93, 1.0), soft * vAlpha * uSnowAmount * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const snowPoints = new THREE.Points(snowGeo, snowMat);
  snowPoints.frustumCulled = false;
  snowPoints.visible = false;
  group.add(snowPoints);

  const moteCount = 85;
  const motePos = new Float32Array(moteCount * 3);
  const moteSeed = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 24;
    motePos[i * 3 + 1] = 2 + Math.random() * 19;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * 38;
    moteSeed[i] = Math.random() * 100;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(moteSeed, 1));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTex: { value: textures.softGlow },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uShipY: { value: 0 },
      uMoteColor: { value: new THREE.Color(1, 0.8, 0.45) },
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uShipY;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        p.x = mod(p.x - uTime * 0.55 + 12.0, 24.0) - 12.0;
        p.z = mod(p.z - uTime * 2.45 + 19.0, 38.0) - 19.0;
        p.y += uShipY + sin(uTime * 1.4 + aSeed) * 0.45;
        vTwinkle = 0.25 + 0.45 * (0.5 + 0.5 * sin(uTime * 2.8 + aSeed * 3.1));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(0.42 * uPixelRatio * (260.0 / max(-mv.z, 1.0)), 1.5, 16.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform vec3 uMoteColor;
      varying float vTwinkle;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(uMoteColor * t.rgb, t.a * vTwinkle);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const motePoints = new THREE.Points(moteGeo, moteMat);
  motePoints.frustumCulled = false;
  group.add(motePoints);

  const birdWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf0e6d4,
    roughness: 0.7,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const birdTipMat = new THREE.MeshStandardMaterial({
    color: 0x2a2428,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });

  const birds = [];
  for (let i = 0; i < 9; i++) {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.58, 6), birdWhiteMat);
    body.rotation.x = Math.PI * 0.5;
    root.add(body);

    const wingPivots = [];
    for (const side of [-1, 1]) {
      const innerPivot = new THREE.Group();
      const innerWing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.022, 0.19), birdWhiteMat);
      innerWing.position.set(side * 0.23, 0, -0.02);
      innerWing.rotation.y = side * -0.12;
      innerPivot.add(innerWing);

      const outerPivot = new THREE.Group();
      outerPivot.position.set(side * 0.45, 0, -0.04);
      const outerWing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.018, 0.13), birdTipMat);
      outerWing.position.set(side * 0.2, 0, -0.04);
      outerWing.rotation.y = side * -0.26;
      outerPivot.add(outerWing);

      innerPivot.add(outerPivot);
      root.add(innerPivot);
      wingPivots.push({ side, innerPivot, outerPivot });
    }

    root.scale.setScalar(0.85 + Math.random() * 0.45);
    group.add(root);
    birds.push({
      root,
      wingPivots,
      centerX: (i < 5 ? 10 : -16) + (Math.random() - 0.5) * 14,
      centerZ: (i < 5 ? -24 : 8) + (Math.random() - 0.5) * 18,
      radiusX: 16 + Math.random() * 18,
      radiusZ: 14 + Math.random() * 16,
      baseY: 16 + Math.random() * 15,
      orbitSpeed: (0.14 + Math.random() * 0.09) * (i % 2 === 0 ? 1 : -1),
      phase: Math.random() * Math.PI * 2,
      flapSpeed: 5.2 + Math.random() * 1.8,
      flapPhase: Math.random() * Math.PI * 2,
      flee: 0,
    });
  }

  return {
    update(dt, time, shipPos, shipPitch, bowSlam, state, camPos) {
      const flash = state ? state.lightningFlash * 0.5 : 0;
      if (state) {
        const bio = state.bioluminescence;
        sprayMat.uniforms.uSprayTint.value.setRGB(
          THREE.MathUtils.lerp(state.foamLit[0], 0.55, bio * 0.55) + flash,
          THREE.MathUtils.lerp(state.foamLit[1], 0.92, bio * 0.55) + flash,
          THREE.MathUtils.lerp(state.foamLit[2], 1.15, bio * 0.65) + flash
        );
        moteMat.uniforms.uMoteColor.value.setRGB(
          THREE.MathUtils.lerp(1, 0.25, bio),
          THREE.MathUtils.lerp(0.8, 0.95, bio),
          THREE.MathUtils.lerp(0.45, 1.15, bio)
        );
      }

      for (let i = 0; i < numParticles; i++) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life || p.y < -30) {
          respawnParticle(p, shipPos, shipPitch, bowSlam, time, state);
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.kind === 'mist' || p.kind === 'tsunami') {
            p.vy -= 1.45 * dt;
            p.vx *= 0.988;
          } else {
            p.vy -= 9.4 * dt;
          }
        }
        const u = Math.min(1, p.age / p.life);
        const fadeIn = Math.min(1, u * 5);
        const fadeOut = 1 - Math.pow(u, p.kind === 'bow' ? 1.8 : 1.35);
        sprayPos[i * 3] = p.x;
        sprayPos[i * 3 + 1] = p.y;
        sprayPos[i * 3 + 2] = p.z;
        spraySize[i] = p.baseSize * (p.kind === 'bow' ? 0.85 + u * 0.95 : 1 + u * 1.45);
        const maxAlpha = p.kind === 'bow' ? 0.5 : p.kind === 'tsunami' ? 0.36 : 0.24;
        sprayAlpha[i] = p.y < -25 ? 0 : fadeIn * fadeOut * maxAlpha;
      }
      sprayGeo.attributes.position.needsUpdate = true;
      sprayGeo.attributes.aSize.needsUpdate = true;
      sprayGeo.attributes.aAlpha.needsUpdate = true;

      const rainAmt = state ? state.rainAmount : 0;
      if (rainAmt > 0.01) {
        rainLines.visible = true;
        rainMat.uniforms.uTime.value = time;
        rainMat.uniforms.uRainAmount.value = rainAmt;
        rainMat.uniforms.uCenter.value.set((shipPos.x + camPos.x) * 0.5, shipPos.y, (shipPos.z + camPos.z) * 0.5);
        rainMat.uniforms.uLightningFlash.value = state.lightningFlash;
      } else {
        rainLines.visible = false;
      }

      const snowAmt = state ? state.snowAmount || 0 : 0;
      if (snowAmt > 0.01) {
        snowPoints.visible = true;
        snowMat.uniforms.uTime.value = time;
        snowMat.uniforms.uSnowAmount.value = snowAmt;
        snowMat.uniforms.uCenter.value.set((shipPos.x + camPos.x) * 0.5, shipPos.y, (shipPos.z + camPos.z) * 0.5);
      } else {
        snowPoints.visible = false;
      }

      moteMat.uniforms.uTime.value = time;
      moteMat.uniforms.uShipY.value = shipPos.y;

      const liftY = Math.max(0, shipPos.y * 0.65);
      const stormFlee = state
        ? Math.min(1, Math.max(0, (Math.max(state.storminess, state.tsunamiMode) - 0.28) * 1.5))
        : 0;

      for (const b of birds) {
        b.flee += (stormFlee - b.flee) * Math.min(1, dt * 1.2);
        if (b.flee > 0.96) {
          b.root.visible = false;
          continue;
        }
        b.root.visible = true;
        const spdMul = 1 + b.flee * 1.35;
        const ang = time * b.orbitSpeed * spdMul + b.phase;
        const nextAng = ang + b.orbitSpeed * 0.05;
        const rx = b.radiusX + b.flee * 58;
        const rz = b.radiusZ + b.flee * 58;
        const bx = b.centerX + Math.cos(ang) * rx;
        const bz = b.centerZ + Math.sin(ang) * rz;
        const by = b.baseY + liftY + b.flee * 34 + Math.sin(ang * 2 + b.phase) * 2.1;
        const nx = b.centerX + Math.cos(nextAng) * rx;
        const nz = b.centerZ + Math.sin(nextAng) * rz;

        b.root.position.set(bx, by, bz);
        b.root.rotation.y = Math.atan2(nx - bx, nz - bz);
        b.root.rotation.z = -b.orbitSpeed * 1.65;

        const flapAmp = Math.sin(time * 0.75 + b.flapPhase) > 0.25 && b.flee < 0.3 ? 0.08 : 0.52;
        const innerAng = Math.sin(time * b.flapSpeed * spdMul + b.flapPhase) * flapAmp;
        const outerAng = Math.sin(time * b.flapSpeed * spdMul + b.flapPhase - 0.55) * flapAmp * 0.85;
        for (const wp of b.wingPivots) {
          wp.innerPivot.rotation.z = wp.side * (innerAng + 0.08);
          wp.outerPivot.rotation.z = wp.side * (outerAng - 0.12);
        }
      }
    },
    triggerBowSlamBurst(shipPos, shipPitch, intensity, time, state) {
      let spawned = 0;
      for (let i = 0; i < numParticles && spawned < 34; i++) {
        const p = particles[i];
        if (p.kind !== 'bow') continue;
        if (p.age > p.life * 0.35 || spawned < 16) {
          respawnParticle(p, shipPos, shipPitch, Math.min(2.2, 1.1 + intensity * 0.9), time, state);
          p.vy *= 1.35 + intensity * 0.45;
          p.vx *= 1.25 + intensity * 0.35;
          p.baseSize *= 1.25;
          spawned++;
        }
      }
    },
    onResize(dpr) {
      const p = dpr || Math.min(window.devicePixelRatio || 1, 2);
      sprayMat.uniforms.uPixelRatio.value = p;
      moteMat.uniforms.uPixelRatio.value = p;
      snowMat.uniforms.uPixelRatio.value = p;
    },
  };
}
