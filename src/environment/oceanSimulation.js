/**
 * @file oceanSimulation.js
 * @description 海洋动力学与水体光学着色器模块（v4 支持 360° 真航向波浪旋转 + 4x4 视锥分块剔除 + 远景 LOD）：
 *              1. 6 组多方向色散 Gerstner 波（随船体 360° 航向 uOceanHeading 实时旋转波向）+ 24 米前倾卷唇海啸水墙；
 *              2. 随掌舵偏航角同步旋转的船舱排水 SDF、破浪首波、开尔文 V 字尾流、转向弧度及桅帆水面投影倒影；
 *              3. 4x4 分块径向海面网格，支持硬件视锥体剔除，减少 50%+ 背面顶点计算；
 *              4. CPU 侧与 GPU 侧严格同步的 360° 波向旋转、一阶 Gerstner 水平位移修正与五点浮力采样。
 */

import * as THREE from 'three';
import { TSUNAMI_START_Z, TSUNAMI_END_Z, evaluateTsunamiProfile } from '../state/weatherState.js';

export const BASE_SAILING_SPEED = 7.8;

export let currentSailingSpeed = BASE_SAILING_SPEED;
export function setCurrentSailingSpeed(v) {
  currentSailingSpeed = v;
}
export const oceanScroll = new THREE.Vector2(0, 0);

/** 六组 Gerstner 波参数：[dirX, dirZ, 振幅, 波长, 陡度, 相速度倍率] */
export const GERSTNER_WAVES = [
  [-0.38, -0.925, 0.62, 38.0, 0.42, 1.05],
  [0.32, -0.947, 0.44, 25.0, 0.38, 1.15],
  [-0.68, -0.733, 0.27, 15.5, 0.36, 1.25],
  [0.58, -0.815, 0.18, 10.2, 0.32, 1.32],
  [-0.22, -0.975, 0.13, 6.8, 0.28, 1.4],
  [0.82, -0.572, 0.09, 4.7, 0.25, 1.45],
];

const GRAVITY = 9.81;

/**
 * CPU 端精确波高查询（支持 360° 航向旋转对齐、一阶 Gerstner 水平偏移回拉与海啸前卷唇补偿）
 */
export function sampleOceanHeight(x, z, time, state = null) {
  const ampScale = state ? state.waveAmpScale : 1;
  const heading = state ? state.worldHeading || 0 : 0;
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);

  const rad = Math.hypot(x, z);
  const distFade = 1 - THREE.MathUtils.smoothstep(rad, 280, 1300);
  const detailWaveFade = distFade * (1 - THREE.MathUtils.smoothstep(rad, 165, 330));

  // 将船体局部 (x, z) 旋回世界坐标再叠加累计世界航迹 oceanScroll
  const wx = x * ch + z * sh + oceanScroll.x;
  const wz = -x * sh + z * ch + oceanScroll.y;

  let dx = 0;
  let dz = 0;
  const waveLimit = detailWaveFade > 0.002 ? GERSTNER_WAVES.length : 3;

  for (let i = 0; i < waveLimit; i++) {
    const [rx, rz, amp, wl, steep, spd] = GERSTNER_WAVES[i];
    const fade = i < 3 ? distFade : detailWaveFade;
    const invLen = 1 / Math.hypot(rx, rz);
    const nx = rx * invLen;
    const nz = rz * invLen;
    const k = (Math.PI * 2) / wl;
    const omega = Math.sqrt(GRAVITY * k) * spd;
    const a = amp * ampScale * fade;
    const q = THREE.MathUtils.clamp(steep / (k * Math.max(a, 0.001) * 6), 0, 0.14);
    const phase = k * (nx * wx + nz * wz) - omega * time;
    const cs = Math.cos(phase);
    dx += q * a * nx * cs;
    dz += q * a * nz * cs;
  }

  const baseWX = wx - dx;
  const baseWZ = wz - dz;
  let height = 0;
  for (let i = 0; i < waveLimit; i++) {
    const [rx, rz, amp, wl, , spd] = GERSTNER_WAVES[i];
    const fade = i < 3 ? distFade : detailWaveFade;
    const invLen = 1 / Math.hypot(rx, rz);
    const nx = rx * invLen;
    const nz = rz * invLen;
    const k = (Math.PI * 2) / wl;
    const omega = Math.sqrt(GRAVITY * k) * spd;
    const phase = k * (nx * baseWX + nz * baseWZ) - omega * time;
    height += amp * ampScale * fade * Math.sin(phase);
  }

  if (state && state.tsunamiMode > 0.001) {
    let tsu = evaluateTsunamiProfile(x, z, state.tsunamiCrestZ, state.tsunamiMode);
    if (tsu.crestFactor > 0.62) {
      const clear = THREE.MathUtils.smoothstep(Math.abs(x), 5.5, 14);
      const curl = THREE.MathUtils.smoothstep(tsu.crestFactor, 0.62, 0.98) * 5.2 * (0.28 + 0.72 * clear) * state.tsunamiMode;
      tsu = evaluateTsunamiProfile(x, z + curl * 0.65, state.tsunamiCrestZ, state.tsunamiMode);
    }
    height += tsu.y;
  }
  return height;
}

/**
 * 船体五点旋转浮力采样（计算垂荡 heave、纵摇 pitchTarget、横摇 rollTarget 与船首破浪高度）
 */
export function sampleShipBuoyancy(time, state, yaw = 0) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const hBow = sampleOceanHeight(11.2 * sy, 11.2 * cy, time, state);
  const hStern = sampleOceanHeight(-11.2 * sy, -11.2 * cy, time, state);
  const hStbd = sampleOceanHeight(3.6 * cy, -3.6 * sy, time, state);
  const hPort = sampleOceanHeight(-3.6 * cy, 3.6 * sy, time, state);
  const hMid = sampleOceanHeight(0, 0, time, state);

  const heave = (hBow + hStern + hStbd + hPort + hMid * 1.6) / 5.6;
  const pitchGain = state && state.tsunamiMode > 0.1 ? 0.88 : 0.74;
  const pitchTarget = THREE.MathUtils.clamp(-Math.atan2(hBow - hStern, 22.4) * pitchGain, -0.48, 0.48);
  const rollTarget = THREE.MathUtils.clamp(Math.atan2(hStbd - hPort, 7.2) * 0.65, -0.34, 0.34);

  let tsunamiCrestFactor = 0;
  if (state && state.tsunamiMode > 0.001) {
    tsunamiCrestFactor = evaluateTsunamiProfile(8 * sy, 8 * cy, state.tsunamiCrestZ, state.tsunamiMode).crestFactor;
  }
  return { heave, pitchTarget, rollTarget, bowWaveHeight: hBow, tsunamiCrestFactor };
}

function createChunkedRadialOceanGrid(segments = 328, halfExtent = 1440, chunksPerAxis = 4) {
  const chunkSegs = Math.floor(segments / chunksPerAxis);
  const totalSegs = chunkSegs * chunksPerAxis;
  const geoms = [];

  const evalWX = (ix) => {
    const nx = (ix / totalSegs) * 2 - 1;
    const ax = Math.abs(nx);
    return Math.sign(nx) * (ax * 68 + Math.pow(ax, 3.8) * (halfExtent - 68));
  };
  const evalWZ = (iz) => {
    const nz = (iz / totalSegs) * 2 - 1;
    const az = Math.abs(nz);
    return Math.sign(nz) * (az * 82 + Math.pow(az, 3.8) * (halfExtent - 82));
  };

  for (let cz = 0; cz < chunksPerAxis; cz++) {
    const izStart = cz * chunkSegs;
    for (let cx = 0; cx < chunksPerAxis; cx++) {
      const ixStart = cx * chunkSegs;
      const stride = chunkSegs + 1;
      const vCount = stride * stride;
      const positions = new Float32Array(vCount * 3);
      const uvs = new Float32Array(vCount * 2);
      let pIdx = 0;
      let uIdx = 0;

      for (let dz = 0; dz <= chunkSegs; dz++) {
        const iz = izStart + dz;
        const wz = evalWZ(iz);
        const vCoord = iz / totalSegs;
        for (let dx = 0; dx <= chunkSegs; dx++) {
          const ix = ixStart + dx;
          positions[pIdx++] = evalWX(ix);
          positions[pIdx++] = 0;
          positions[pIdx++] = wz;
          uvs[uIdx++] = ix / totalSegs;
          uvs[uIdx++] = vCoord;
        }
      }

      const indices = new Uint16Array(chunkSegs * chunkSegs * 6);
      let iIdx = 0;
      for (let dz = 0; dz < chunkSegs; dz++) {
        for (let dx = 0; dx < chunkSegs; dx++) {
          const a = dz * stride + dx;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          indices[iIdx++] = a;
          indices[iIdx++] = c;
          indices[iIdx++] = b;
          indices[iIdx++] = b;
          indices[iIdx++] = c;
          indices[iIdx++] = d;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeBoundingBox();
      geo.boundingBox.min.y = -8.0;
      geo.boundingBox.max.y = 28.0;
      geo.computeBoundingSphere();
      geo.boundingSphere.radius += 28.0;
      geoms.push(geo);
    }
  }
  return geoms;
}

const OCEAN_VERTEX_SHADER = `
precision highp float;

uniform float uTime;
uniform vec2 uOceanScroll;
uniform float uOceanHeading;
uniform float uWaveAmpScale;
uniform vec2 uShipXZ;
uniform float uShipHeave;
uniform float uShipPitch;
uniform float uShipYaw;
uniform float uWakeCurve;

uniform float uTsunamiMode;
uniform float uTsunamiCrestZ;

varying vec3 vWorldPos;
varying vec3 vBaseNormal;
varying vec2 vOceanCoord;
varying float vWaveCrest;
varying float vWakeFoam;
varying float vSubFoam;
varying float vTsunamiCrest;
varying float vHullSDF;

float hullWaterlineSDF(vec2 p) {
  float zNorm = clamp((p.y + 14.2) / 28.8, 0.0, 1.0);
  float bowTaper = pow(clamp(1.0 - max(zNorm - 0.52, 0.0) / 0.48, 0.0, 1.0), 0.72);
  float sternTaper = 0.52 + 0.48 * smoothstep(0.0, 0.34, zNorm);
  float halfBeam = 4.22 * bowTaper * sternTaper;
  if (p.y > 14.6) {
    return length(vec2(p.x, p.y - 14.6));
  }
  if (p.y < -14.2) {
    return length(vec2(max(abs(p.x) - 2.15, 0.0), p.y + 14.2));
  }
  return abs(p.x) - halfBeam;
}

void addGerstner(
  vec2 dirRaw,
  float amp,
  float wl,
  float steep,
  float spd,
  vec2 sampleXZ,
  float distFade,
  float ch,
  float sh,
  inout vec3 disp,
  inout vec3 tangentX,
  inout vec3 tangentZ,
  inout float crestAcc
) {
  vec2 dw = normalize(dirRaw);
  float k = 6.2831853 / wl;
  float omega = sqrt(9.81 * k) * spd;
  float phase = k * dot(dw, sampleXZ) - omega * uTime;
  float s = sin(phase);
  float c = cos(phase);

  // 将世界空间波浪方向旋回当前船首局部空间，实现 360° 打舵时海浪真实迎面转向
  vec2 d = vec2(dw.x * ch - dw.y * sh, dw.x * sh + dw.y * ch);

  float a = amp * uWaveAmpScale * distFade;
  float q = steep / (k * max(a, 0.001) * 6.0);
  q = clamp(q, 0.0, 0.14);

  disp.x += q * a * d.x * c;
  disp.y += a * s;
  disp.z += q * a * d.y * c;

  float wa = k * a;
  tangentX += vec3(-q * d.x * d.x * wa * s, d.x * wa * c, -q * d.x * d.y * wa * s);
  tangentZ += vec3(-q * d.x * d.y * wa * s, d.y * wa * c, -q * d.y * d.y * wa * s);

  crestAcc += max(s, 0.0) * (amp * uWaveAmpScale / 1.4);
}

void main() {
  vec3 basePos = position;
  float radialDist = length(basePos.xz);
  float distFade = 1.0 - smoothstep(280.0, 1300.0, radialDist);
  float detailWaveFade = distFade * (1.0 - smoothstep(165.0, 330.0, radialDist));

  float ch = cos(uOceanHeading);
  float sh = sin(uOceanHeading);
  vec2 rotXZ = vec2(basePos.x * ch + basePos.z * sh, -basePos.x * sh + basePos.z * ch);
  vec2 oceanXZ = rotXZ + uOceanScroll;
  vOceanCoord = oceanXZ;

  vec3 disp = vec3(0.0);
  vec3 tangentX = vec3(1.0, 0.0, 0.0);
  vec3 tangentZ = vec3(0.0, 0.0, 1.0);
  float crestAcc = 0.0;

  addGerstner(vec2(-0.38, -0.925), 0.62, 38.0, 0.42, 1.05, oceanXZ, distFade, ch, sh, disp, tangentX, tangentZ, crestAcc);
  addGerstner(vec2( 0.32, -0.947), 0.44, 25.0, 0.38, 1.15, oceanXZ, distFade, ch, sh, disp, tangentX, tangentZ, crestAcc);
  addGerstner(vec2(-0.68, -0.733), 0.27, 15.5, 0.36, 1.25, oceanXZ, distFade, ch, sh, disp, tangentX, tangentZ, crestAcc);

  if (detailWaveFade > 0.002) {
    addGerstner(vec2( 0.58, -0.815), 0.18, 10.2, 0.32, 1.32, oceanXZ, detailWaveFade, ch, sh, disp, tangentX, tangentZ, crestAcc);
    addGerstner(vec2(-0.22, -0.975), 0.13,  6.8, 0.28, 1.40, oceanXZ, detailWaveFade, ch, sh, disp, tangentX, tangentZ, crestAcc);
    addGerstner(vec2( 0.82, -0.572), 0.09,  4.7, 0.25, 1.45, oceanXZ, detailWaveFade, ch, sh, disp, tangentX, tangentZ, crestAcc);
  }

  float tsunamiCrest = 0.0;
  if (uTsunamiMode > 0.001) {
    float envFade = smoothstep(${TSUNAMI_END_Z.toFixed(1)}, ${(TSUNAMI_END_Z + 36).toFixed(1)}, uTsunamiCrestZ)
                  * (1.0 - smoothstep(${(TSUNAMI_START_Z - 30).toFixed(1)}, ${TSUNAMI_START_Z.toFixed(1)}, uTsunamiCrestZ))
                  * (1.0 - smoothstep(220.0, 520.0, abs(basePos.x)));

    float curveZ = cos(basePos.x * 0.018) * 3.5;
    float dz = basePos.z - (uTsunamiCrestZ + curveZ);
    float sigma = dz < 0.0 ? 22.5 : 31.0;
    float profile = exp(-(dz * dz) / (sigma * sigma));
    float trough = -3.4 * exp(-pow((dz + 34.0) / 18.0, 2.0));

    float ridgeNoise = sin(basePos.x * 0.14 + uTime * 2.1) * 0.85 + cos(basePos.x * 0.37 - uTime * 3.4) * 0.45;
    float wAmp = (23.5 + ridgeNoise * profile) * envFade * uTsunamiMode;
    float tsuY = wAmp * profile + trough * envFade * uTsunamiMode;

    float dProfileDz = profile * (-2.0 * dz / (sigma * sigma));
    float dTroughDz = trough * (-2.0 * (dz + 34.0) / 324.0) * envFade * uTsunamiMode;
    tangentZ.y += wAmp * dProfileDz + dTroughDz;

    float clearShipLane = smoothstep(5.5, 14.0, abs(basePos.x));
    float curlBand = smoothstep(0.62, 0.98, profile) * smoothstep(6.0, -8.0, dz);
    disp.z -= curlBand * 5.2 * envFade * uTsunamiMode * (0.28 + 0.72 * clearShipLane);
    disp.y += tsuY;

    tsunamiCrest = clamp(profile * envFade * uTsunamiMode, 0.0, 1.4);
  }

  vec2 displacedXZ = basePos.xz + disp.xz;
  vec2 dShipXZ = displacedXZ - uShipXZ;
  float cYaw = cos(uShipYaw), sYaw = sin(uShipYaw);
  vec2 relShip = vec2(dShipXZ.x * cYaw - dShipXZ.y * sYaw, dShipXZ.x * sYaw + dShipXZ.y * cYaw);
  if (relShip.y < -2.0) {
    float trailD = min(-relShip.y - 2.0, 110.0);
    relShip.x -= uWakeCurve * trailD * trailD * 0.0022;
  }
  float sdf = hullWaterlineSDF(relShip);

  float shipLocalY = uShipHeave - sin(uShipPitch) * relShip.y;
  float insideBilge = 1.0 - smoothstep(-1.15, -0.35, sdf);
  disp.y = mix(disp.y, shipLocalY - 2.05, insideBilge * 0.96);

  float wakeFoam = 0.0;
  float subFoam = 0.0;

  float bowZone = smoothstep(5.5, 12.8, relShip.y) * (1.0 - smoothstep(14.8, 18.0, relShip.y));
  float bowRing = exp(-pow((sdf - 0.50) / 1.25, 2.0)) * bowZone;
  disp.y += bowRing * 0.54;
  wakeFoam += bowRing * 1.08;

  float hullCollar = exp(-pow(max(sdf, -0.15) / 0.82, 2.0)) * smoothstep(-15.2, -13.0, relShip.y) * (1.0 - smoothstep(15.0, 16.6, relShip.y));
  wakeFoam += hullCollar * 0.85;

  float asternFromBow = 13.8 - relShip.y;
  if (asternFromBow > 0.0 && asternFromBow < 135.0) {
    float armSpread = 1.35 + 0.245 * pow(asternFromBow, 0.86);
    float armWidth = 0.85 + 0.042 * asternFromBow;
    float armDist = abs(abs(relShip.x) - armSpread);
    float armProfile = exp(-pow(armDist / armWidth, 2.0));
    float armFade = (1.0 - smoothstep(28.0, 128.0, asternFromBow)) * smoothstep(0.0, 2.2, asternFromBow);

    float kelvinRipple = sin(asternFromBow * 1.65 - abs(relShip.x) * 1.15 - uTime * 7.2);
    disp.y += armProfile * armFade * (0.24 + 0.14 * kelvinRipple);
    wakeFoam += armProfile * armFade * (0.78 + 0.28 * kelvinRipple);
    subFoam += exp(-pow(armDist / (armWidth * 1.9), 2.0)) * armFade * 0.55;
  }

  float asternStern = -13.6 - relShip.y;
  if (asternStern > -2.5 && asternStern < 120.0) {
    float d = max(asternStern, 0.0);
    float sternHalfW = 2.55 + 0.075 * d;
    float centerFactor = exp(-pow(relShip.x / sternHalfW, 2.0));
    float sternFade = smoothstep(-2.5, 1.5, asternStern) * (1.0 - smoothstep(24.0, 112.0, d));
    float sternChurn = sin(d * 1.3 - uTime * 8.5) * cos(relShip.x * 1.8 + uTime * 3.1);
    disp.y += centerFactor * sternFade * (-0.16 + 0.11 * sternChurn);
    wakeFoam += centerFactor * (1.0 - smoothstep(14.0, 78.0, d)) * smoothstep(-2.0, 1.2, asternStern) * 0.95;
    subFoam += exp(-pow(relShip.x / (sternHalfW * 1.45), 2.0)) * sternFade * 0.95;
  }

  if (tsunamiCrest > 0.25) {
    float cascade = smoothstep(0.56, 0.96, tsunamiCrest);
    wakeFoam += cascade * 1.45;
    subFoam += smoothstep(0.32, 0.85, tsunamiCrest) * 0.95;
  }

  vec3 finalPos = basePos + disp;
  vec3 geomNormal = normalize(cross(tangentZ, tangentX));

  vWorldPos = (modelMatrix * vec4(finalPos, 1.0)).xyz;
  vBaseNormal = geomNormal;
  vWaveCrest = clamp(crestAcc, 0.0, 1.8);
  vWakeFoam = clamp(wakeFoam, 0.0, 2.2);
  vSubFoam = clamp(subFoam, 0.0, 1.6);
  vTsunamiCrest = tsunamiCrest;
  vHullSDF = sdf;

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const OCEAN_FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform vec3 uSunDir;
uniform sampler2D uFoamTex;
uniform vec2 uShipXZ;
uniform float uShipHeave;
uniform float uShipYaw;
uniform float uShipRoll;

uniform vec3 uWaterDeep;
uniform vec3 uWaterMid;
uniform vec3 uWaterShallow;
uniform vec3 uWaterSSS;
uniform vec3 uSunSpecColor;
uniform vec3 uFoamLit;
uniform vec3 uFoamShadow;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform float uBioluminescence;
uniform float uLanternFactor;
uniform float uLightningFlash;

varying vec3 vWorldPos;
varying vec3 vBaseNormal;
varying vec2 vOceanCoord;
varying float vWaveCrest;
varying float vWakeFoam;
varying float vSubFoam;
varying float vTsunamiCrest;
varying float vHullSDF;

vec3 computeFineWaterNormal(vec2 oc, vec3 baseN, float distFade) {
  vec2 uv1 = oc * 0.055 + vec2(uTime * 0.022, -uTime * 0.031);
  vec2 uv2 = oc * 0.145 + vec2(-uTime * 0.036, uTime * 0.027);
  vec2 uv3 = oc * 0.380 + vec2(uTime * 0.048, uTime * 0.041);

  float h1 = texture2D(uFoamTex, uv1).g;
  float h2 = texture2D(uFoamTex, uv2).g;
  float h3 = texture2D(uFoamTex, uv3).b;

  float eps = 0.008;
  float hx = texture2D(uFoamTex, uv1 + vec2(eps, 0.0)).g * 0.55 + texture2D(uFoamTex, uv2 + vec2(eps, 0.0)).g * 0.30 + texture2D(uFoamTex, uv3 + vec2(eps, 0.0)).b * 0.15;
  float hz = texture2D(uFoamTex, uv1 + vec2(0.0, eps)).g * 0.55 + texture2D(uFoamTex, uv2 + vec2(0.0, eps)).g * 0.30 + texture2D(uFoamTex, uv3 + vec2(0.0, eps)).b * 0.15;
  float hc = h1 * 0.55 + h2 * 0.30 + h3 * 0.15;

  float rippleStrength = 1.75 * distFade;
  vec3 pert = vec3((hc - hx) * rippleStrength, 0.0, (hc - hz) * rippleStrength);
  return normalize(baseN + pert);
}

void main() {
  vec3 viewVec = cameraPosition - vWorldPos;
  float camDist = length(viewVec);
  vec3 V = viewVec / max(camDist, 1e-4);
  vec3 L = normalize(uSunDir);

  float detailFade = 1.0 - smoothstep(75.0, 540.0, camDist);
  vec3 N = computeFineWaterNormal(vOceanCoord, normalize(vBaseNormal), detailFade);

  float NdotV = max(dot(N, V), 0.001);
  float fresnel = 0.03 + 0.97 * pow(1.0 - NdotV, 4.5);

  float heightFactor = smoothstep(-0.9, 1.35, vWorldPos.y - uShipHeave * 0.25);
  vec3 waterBody = mix(uWaterDeep, uWaterMid, heightFactor);
  waterBody = mix(waterBody, uWaterShallow, smoothstep(0.42, 1.15, vWaveCrest + vTsunamiCrest * 0.65));

  vec3 backLightDir = normalize(L + N * 0.55);
  float sssView = pow(clamp(dot(V, -backLightDir), 0.0, 1.0), 3.0);
  float wallThinness = max(smoothstep(0.26, 1.05, vWaveCrest) * max(0.25, 1.0 - N.y * 0.65), smoothstep(0.30, 0.92, vTsunamiCrest) * 1.15);
  waterBody += uWaterSSS * (0.26 + 0.88 * sssView) * wallThinness * (1.0 - smoothstep(180.0, 680.0, camDist));

  // 近景船舷浅水焦散微光（Sunlit Shallow Caustics）
  if (camDist < 120.0 && vHullSDF < 14.0) {
    float c1 = texture2D(uFoamTex, vOceanCoord * 0.19 + vec2(uTime * 0.035, -uTime * 0.028)).r;
    float c2 = texture2D(uFoamTex, vOceanCoord * 0.27 - vec2(uTime * 0.025, uTime * 0.032)).r;
    float caust = pow(clamp(c1 * c2 * 2.6, 0.0, 1.0), 2.2) * (1.0 - smoothstep(1.5, 14.0, max(vHullSDF, 0.0)));
    waterBody += uWaterSSS * caust * 0.35 * max(L.y, 0.1);
  }

  vec2 warpSample = texture2D(uFoamTex, vOceanCoord * 0.048 + vec2(-uTime * 0.012, uTime * 0.018)).gb - 0.5;
  if (vSubFoam > 0.005) {
    vec2 wakeUV1 = vOceanCoord * 0.09 + warpSample * 0.25 + vec2(0.0, uTime * 0.08);
    vec2 wakeUV2 = vOceanCoord * 0.21 - warpSample * 0.35 - vec2(uTime * 0.03, uTime * 0.05);
    float turbNoise = texture2D(uFoamTex, wakeUV1).g * 0.6 + texture2D(uFoamTex, wakeUV2).r * 0.4;
    float subMask = smoothstep(0.18, 0.82, vSubFoam * (0.55 + 0.75 * turbNoise));
    vec3 aeratedCol = mix(uWaterShallow * 1.45 + vec3(0.06, 0.24, 0.26), vec3(0.06, 0.72, 1.15), uBioluminescence * 0.75);
    waterBody = mix(waterBody, aeratedCol, subMask * 0.62);
  }

  vec3 R = reflect(-V, N);
  float rElev = clamp(R.y, 0.0, 1.0);
  float rSun = max(dot(normalize(vec3(R.x, max(R.y, 0.02), R.z)), L), 0.0);
  vec3 reflHorizon = mix(uSkyHorizon * 0.55, uSkyHorizon * 1.05, pow(rSun, 2.4));
  vec3 skyRefl = mix(reflHorizon, uSkyZenith * 1.15, smoothstep(0.0, 0.52, rElev));
  skyRefl += uSunSpecColor * pow(rSun, 14.0) * 0.52;
  skyRefl += vec3(0.65, 0.84, 1.25) * uLightningFlash * 0.55;

  vec2 dFragXZ = vWorldPos.xz - uShipXZ;
  float fcY = cos(uShipYaw), fsY = sin(uShipYaw);
  vec2 relShip = vec2(dFragXZ.x * fcY - dFragXZ.y * fsY, dFragXZ.x * fsY + dFragXZ.y * fcY);
  float nearHullX = 1.0 - smoothstep(3.8, 10.5, abs(relShip.x));
  float nearHullZ = smoothstep(-17.5, -12.0, relShip.y) * (1.0 - smoothstep(13.0, 18.0, relShip.y));
  float shipReflAO = nearHullX * nearHullZ * 0.44;

  vec2 sailReflCoord = relShip + N.xz * 2.8 + vec2(uShipRoll * 14.0, 0.0);
  float mastBandZ = exp(-pow((sailReflCoord.y - 9.0) / 3.2, 2.0))
                  + exp(-pow((sailReflCoord.y - 0.4) / 4.2, 2.0)) * 1.15
                  + exp(-pow((sailReflCoord.y + 5.3) / 3.0, 2.0)) * 0.85;
  float sailSpanX = smoothstep(4.2, 18.5, abs(sailReflCoord.x)) * (1.0 - smoothstep(19.0, 29.0, abs(sailReflCoord.x)));
  float sailSil = clamp(mastBandZ * sailSpanX, 0.0, 1.0) * (1.0 - smoothstep(32.0, 85.0, camDist));
  skyRefl *= (1.0 - max(shipReflAO, sailSil * 0.32));

  float sternDist = length((relShip - vec2(0.0, -15.2)) * vec2(0.85, 0.55));
  float broadsideDist = length((relShip - vec2(0.0, 0.5)) * vec2(0.65, 0.28));
  float rippleShimmer = 0.55 + 0.45 * sin(N.x * 16.0 + N.z * 14.0 + uTime * 3.0);
  float lanternRefl = (exp(-sternDist * 0.22) * 0.95 + exp(-broadsideDist * 0.26) * 0.48) * uLanternFactor * rippleShimmer;
  float sailBounce = (exp(-broadsideDist * 0.22) + sailSil * 0.65) * (1.0 - uBioluminescence) * 0.22 * rippleShimmer;

  float hullCollarTrans = exp(-max(vHullSDF, 0.0) * 0.68) * smoothstep(-0.45, 0.15, vHullSDF);
  vec3 submergedTint = mix(uWaterDeep * 0.52, uWaterShallow * 0.92, clamp(vWaveCrest * 0.65, 0.0, 1.0));
  waterBody = mix(waterBody, submergedTint, hullCollarTrans * 0.46);

  vec3 oceanColor = mix(waterBody, skyRefl, fresnel * 0.76);
  oceanColor += vec3(1.18, 0.56, 0.14) * lanternRefl * (0.45 + 0.55 * fresnel);
  oceanColor += vec3(0.85, 0.58, 0.42) * sailBounce * fresnel;

  float specAA = smoothstep(38.0, 440.0, camDist);
  vec3 Nspec = normalize(mix(N, normalize(vBaseNormal), specAA * 0.62));
  vec3 H = normalize(L + V);
  float NdotH = max(dot(Nspec, H), 0.0);
  float specBroad = pow(NdotH, mix(48.0, 26.0, specAA)) * 0.70;
  float specMid   = pow(NdotH, mix(240.0, 72.0, specAA)) * mix(1.60, 0.72, specAA);
  float specGlint = pow(NdotH, mix(1050.0, 110.0, specAA)) * mix(4.40, 0.58, specAA);
  oceanColor += uSunSpecColor * (specBroad + specMid + specGlint * 1.25);

  vec2 foamUV1 = vOceanCoord * 0.145 + warpSample * 0.42 + vec2(uTime * 0.015, uTime * 0.02);
  vec2 foamUV2 = vOceanCoord * 0.340 - warpSample * 0.65 - vec2(uTime * 0.025, uTime * 0.03);
  vec3 fTex1 = texture2D(uFoamTex, foamUV1).rgb;
  vec3 fTex2 = texture2D(uFoamTex, foamUV2).rgb;

  float lacyWeb = fTex1.r * 0.62 + fTex2.r * 0.38;
  float foamBreakup = fTex1.g * 0.55 + fTex2.b * 0.45;

  float slopeSteep = 1.0 - clamp(N.y, 0.0, 1.0);
  float crestDriver = smoothstep(0.66, 1.12, vWaveCrest + slopeSteep * 1.15) * (1.0 - smoothstep(105.0, 400.0, camDist));
  float whitecapFoam = smoothstep(0.42, 0.76, crestDriver * (0.48 + 0.85 * lacyWeb * foamBreakup));

  float wakeDriver = vWakeFoam * (0.38 + 0.88 * lacyWeb) * (0.55 + 0.65 * foamBreakup);
  float wakeOuter = smoothstep(0.28, 0.62, wakeDriver);
  float wakeCore  = smoothstep(0.64, 1.08, vWakeFoam * (0.58 + 0.62 * foamBreakup));

  float totalFoam = clamp(max(whitecapFoam * 0.82, wakeOuter * 0.76 + wakeCore * 0.55), 0.0, 1.0);

  if (totalFoam > 0.005) {
    float foamSun = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    vec3 foamCol = mix(uFoamShadow, uFoamLit, 0.36 + 0.64 * foamSun);
    foamCol += vec3(0.45, 0.60, 0.85) * uLightningFlash * 0.45;
    oceanColor = mix(oceanColor, foamCol, totalFoam);
  }

  if (uBioluminescence > 0.01) {
    float bioSparkle = 0.55 + 0.75 * pow(fTex2.b, 2.0) * (0.6 + 0.4 * sin(uTime * 4.5 + vOceanCoord.x * 1.7 + vOceanCoord.y * 1.3));
    float bioMask = clamp(wakeOuter * 0.95 + vSubFoam * 0.48 + whitecapFoam * 0.55, 0.0, 1.25);
    vec3 bioCol = mix(vec3(0.02, 0.58, 1.15), vec3(0.22, 1.35, 1.65), clamp(totalFoam * bioSparkle, 0.0, 1.0));
    oceanColor += bioCol * bioMask * bioSparkle * uBioluminescence * 0.92;
  }

  float sunHoriz = max(dot(normalize(vec2(-V.x, -V.z) + 1e-5), normalize(vec2(L.x, L.z))), 0.0);
  vec3 horizonFogCol = mix(uSkyHorizon * 0.58, uSkyHorizon, pow(sunHoriz, 2.4));
  horizonFogCol += vec3(0.45, 0.62, 0.95) * uLightningFlash * 0.22;
  float baseFog = smoothstep(185.0, 1360.0, camDist);
  float marineMist = smoothstep(95.0, 780.0, camDist) * exp(-max(vWorldPos.y, 0.0) * 0.095) * (0.18 + 0.24 * clamp(uLanternFactor, 0.0, 1.0));
  float fogFactor = clamp(max(baseFog, marineMist), 0.0, 1.0);
  oceanColor = mix(oceanColor, horizonFogCol, fogFactor);

  gl_FragColor = vec4(oceanColor, 1.0);
}
`;

export function createOceanSurface(scene, foamTex, initState) {
  const chunkGeos = createChunkedRadialOceanGrid(328, 1440, 4);
  const uniforms = {
    uTime: { value: 0 },
    uOceanScroll: { value: new THREE.Vector2(0, 0) },
    uOceanHeading: { value: 0 },
    uWaveAmpScale: { value: initState.waveAmpScale },
    uSunDir: { value: initState.sunDir.clone() },
    uFoamTex: { value: foamTex },
    uShipXZ: { value: new THREE.Vector2(0, 0) },
    uShipHeave: { value: 0 },
    uShipPitch: { value: 0 },
    uShipYaw: { value: 0 },
    uShipRoll: { value: 0 },
    uWakeCurve: { value: 0 },
    uTsunamiMode: { value: 0 },
    uTsunamiCrestZ: { value: 120 },
    uWaterDeep: { value: new THREE.Color(...initState.waterDeep) },
    uWaterMid: { value: new THREE.Color(...initState.waterMid) },
    uWaterShallow: { value: new THREE.Color(...initState.waterShallow) },
    uWaterSSS: { value: new THREE.Color(...initState.waterSSS) },
    uSunSpecColor: { value: new THREE.Vector3(...initState.sunSpecColor) },
    uFoamLit: { value: new THREE.Color(...initState.foamLit) },
    uFoamShadow: { value: new THREE.Color(...initState.foamShadow) },
    uSkyHorizon: { value: new THREE.Color(...initState.skyHorizon) },
    uSkyZenith: { value: new THREE.Color(...initState.skyZenith) },
    uBioluminescence: { value: initState.bioluminescence },
    uLanternFactor: { value: initState.lanternFactor },
    uLightningFlash: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: OCEAN_VERTEX_SHADER,
    fragmentShader: OCEAN_FRAGMENT_SHADER,
    uniforms,
  });

  const oceanGroup = new THREE.Group();
  oceanGroup.name = 'ChunkedOceanSurface';
  for (const cGeo of chunkGeos) {
    const chunkMesh = new THREE.Mesh(cGeo, mat);
    chunkMesh.frustumCulled = true;
    oceanGroup.add(chunkMesh);
  }
  scene.add(oceanGroup);

  return {
    oceanMesh: oceanGroup,
    oceanUniforms: uniforms,
    update(time, shipPos, shipPitch, state, shipYaw = 0, wakeCurve = 0, scroll = oceanScroll, shipRoll = 0) {
      uniforms.uTime.value = time;
      uniforms.uOceanScroll.value.copy(scroll);
      uniforms.uOceanHeading.value = state.worldHeading || 0;
      uniforms.uWaveAmpScale.value = state.waveAmpScale;
      uniforms.uSunDir.value.copy(state.sunDir);
      uniforms.uShipXZ.value.set(shipPos.x, shipPos.z);
      uniforms.uShipHeave.value = shipPos.y;
      uniforms.uShipPitch.value = shipPitch;
      uniforms.uShipYaw.value = shipYaw;
      uniforms.uShipRoll.value = shipRoll;
      uniforms.uWakeCurve.value = wakeCurve;
      uniforms.uTsunamiMode.value = state.tsunamiMode;
      uniforms.uTsunamiCrestZ.value = state.tsunamiCrestZ;
      uniforms.uWaterDeep.value.setRGB(...state.waterDeep);
      uniforms.uWaterMid.value.setRGB(...state.waterMid);
      uniforms.uWaterShallow.value.setRGB(...state.waterShallow);
      uniforms.uWaterSSS.value.setRGB(...state.waterSSS);
      uniforms.uSunSpecColor.value.set(...state.sunSpecColor);
      uniforms.uFoamLit.value.setRGB(...state.foamLit);
      uniforms.uFoamShadow.value.setRGB(...state.foamShadow);
      uniforms.uSkyHorizon.value.setRGB(...state.skyHorizon);
      uniforms.uSkyZenith.value.setRGB(...state.skyZenith);
      uniforms.uBioluminescence.value = state.bioluminescence;
      uniforms.uLanternFactor.value = state.lanternFactor;
      uniforms.uLightningFlash.value = state.lightningFlash;
    },
  };
}
