/**
 * @file skyAndLighting.js
 * @description 大气天穹、星野银河、星夜极光幕（Aurora Borealis）、双层体积感程序云、
 *              5 预设 PMREM 环境贴图平滑混合及分叉闪电池模块。
 *              天球采用远平面 Early-Z 深度测试（renderOrder = 1, depthFunc = LessEqualDepth）。
 */

import * as THREE from 'three';
import { WEATHER_PRESETS } from '../state/weatherState.js';
import { FullScreenQuad } from '../postprocessing/bloomAndComposite.js';

const SKY_VERTEX_SHADER = `
uniform float uWorldHeading;
uniform float uIsEnvPass;
varying vec3 vWorldDir;
varying vec3 vCelestialDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 d = normalize(position);
  vWorldDir = d;
  float ch = cos(uWorldHeading), sh = sin(uWorldHeading);
  vCelestialDir = vec3(d.x * ch + d.z * sh, d.y, -d.x * sh + d.z * ch);
  vec4 clipPos = projectionMatrix * viewMatrix * wp;
  gl_Position = uIsEnvPass > 0.5 ? clipPos : clipPos.xyww;
}
`;

const SKY_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vWorldDir;
varying vec3 vCelestialDir;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uIsEnvPass;

uniform vec3 uSkyZenith;
uniform vec3 uSkyUpper;
uniform vec3 uSkyMid;
uniform vec3 uSkyLow;
uniform vec3 uSkyHorizon;
uniform vec3 uCloudShadow;
uniform vec3 uCloudBelly;
uniform vec3 uCloudRim;
uniform float uCloudCoverage;
uniform vec3 uSunDiscColor;
uniform float uStarVisibility;
uniform float uIsMoon;
uniform float uStorminess;
uniform float uLightningFlash;
uniform vec3 uLightningDir;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    v += a * valueNoise(p);
    p = rot * p * 2.04 + vec2(13.7, 7.3);
    a *= 0.5;
  }
  return v;
}

vec3 computeStarsAndMilkyWay(vec3 dir) {
  vec3 col = vec3(0.0);
  float horizonFade = smoothstep(0.03, 0.22, dir.y);
  if (horizonFade <= 0.001) return col;

  vec3 galNormal = normalize(vec3(0.56, 0.42, 0.71));
  float galDist = abs(dot(dir, galNormal));
  float galBand = exp(-pow(galDist * 4.2, 2.0));
  vec2 galUV = vec2(atan(dir.x, dir.z) * 2.4, dir.y * 3.5);
  float dust = fbm(galUV * 2.2);
  float fineDust = fbm(galUV * 5.8 + 4.1);
  vec3 nebulaCol = mix(vec3(0.06, 0.14, 0.32), vec3(0.22, 0.16, 0.42), fineDust);
  col += nebulaCol * galBand * smoothstep(0.28, 0.78, dust) * 0.65;

  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 115.0 : 210.0;
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 fracP = fract(p) - 0.5;
    float rnd = hash31(cell + float(layer) * 71.7);
    float threshold = layer == 0 ? 0.968 : 0.980 - galBand * 0.018;
    if (rnd > threshold) {
      vec3 jitter = vec3(
        hash31(cell + 11.1) - 0.5,
        hash31(cell + 27.3) - 0.5,
        hash31(cell + 53.9) - 0.5
      ) * 0.55;
      float d = length(fracP - jitter);
      float mag = pow(hash31(cell + 43.7), 3.2);
      float size = (layer == 0 ? 0.145 : 0.098) * (0.72 + 0.55 * mag);
      float star = smoothstep(size, 0.0, d);
      float twinkle = 0.74 + 0.26 * sin(uTime * (2.4 + rnd * 4.5) + rnd * 62.8);
      vec3 starTint = mix(vec3(0.74, 0.88, 1.0), vec3(1.0, 0.86, 0.70), hash31(cell + 91.2));
      col += starTint * star * star * twinkle * (layer == 0 ? (1.15 + 1.95 * mag) : (0.72 + 0.95 * mag));
    }
  }
  return col * horizonFade;
}

/** 星夜与极地双层流动极光幕（Aurora Borealis） */
vec3 computeAurora(vec3 dir) {
  if (dir.y < 0.04 || dir.y > 0.84) return vec3(0.0);
  float elevMask = smoothstep(0.04, 0.18, dir.y) * (1.0 - smoothstep(0.44, 0.82, dir.y));
  vec2 p = dir.xz / (dir.y + 0.34);

  // 主翠绿极光幕
  float warp1 = fbm(p * 1.15 + vec2(uTime * 0.045, -uTime * 0.025));
  float wave1 = sin(p.x * 1.85 + p.y * 0.85 + uTime * 0.22 + warp1 * 4.8);
  float curtain1 = smoothstep(0.08, 0.92, 0.5 + 0.5 * wave1);
  float rays1 = 0.52 + 0.48 * sin(p.x * 12.5 + p.y * 4.2 - uTime * 0.72 + valueNoise(p * 4.2) * 3.2);

  // 副青紫极光带
  float warp2 = fbm(p * 1.45 - vec2(uTime * 0.035, uTime * 0.03));
  float wave2 = sin(p.x * 2.4 - p.y * 1.15 - uTime * 0.17 + warp2 * 4.2);
  float curtain2 = smoothstep(0.16, 0.94, 0.5 + 0.5 * wave2);

  float patchMask = 0.38 + 0.62 * smoothstep(0.18, 0.78, fbm(p * 0.72 - vec2(uTime * 0.028, 0.0)));
  vec3 emerald = vec3(0.06, 1.05, 0.62);
  vec3 cyanMid = vec3(0.12, 0.82, 0.96);
  vec3 violetTop = vec3(0.48, 0.26, 1.08);
  vec3 col1 = mix(emerald, cyanMid, smoothstep(0.14, 0.38, dir.y));
  col1 = mix(col1, violetTop, smoothstep(0.32, 0.62, dir.y));
  vec3 col2 = mix(cyanMid, violetTop, smoothstep(0.18, 0.56, dir.y));

  vec3 totalAur = col1 * (curtain1 * rays1 * 0.95) + col2 * (curtain2 * 0.48);
  return totalAur * elevMask * patchMask * 1.18;
}

void main() {
  vec3 dir = normalize(vWorldDir);
  vec3 sunDir = normalize(uSunDir);

  if (dir.y < -0.02 && uIsEnvPass > 0.5) {
    float nadir = clamp(-dir.y, 0.0, 1.0);
    vec3 col = mix(uSkyHorizon * 0.65, uSkyZenith * 0.55 + vec3(0.02, 0.12, 0.18), pow(nadir, 0.45));
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float elev = max(dir.y, 0.0);
  float sunDot = dot(dir, sunDir);
  float sunHorizDot = dot(normalize(vec2(dir.x, dir.z) + 1e-5), normalize(vec2(sunDir.x, sunDir.z)));

  vec3 sky = mix(uSkyHorizon, uSkyLow, smoothstep(0.0, 0.075, elev));
  sky = mix(sky, uSkyMid, smoothstep(0.065, 0.21, elev));
  sky = mix(sky, uSkyUpper, smoothstep(0.19, 0.46, elev));
  sky = mix(sky, uSkyZenith, smoothstep(0.42, 0.90, elev));

  float antiSun = clamp(-sunHorizDot * 0.5 + 0.5, 0.0, 1.0);
  sky *= 1.0 - antiSun * 0.26 * (1.0 - smoothstep(0.0, 0.48, elev));

  float clearSkyFactor = 1.0 - uStorminess * 0.82;
  float sunGlowBroad = pow(max(sunDot, 0.0), 7.0);
  float sunGlowTight = pow(max(sunDot, 0.0), 52.0);
  vec3 glowTint = mix(vec3(0.88, 0.42, 0.12), vec3(0.35, 0.58, 0.92), uIsMoon);
  sky += glowTint * sunGlowBroad * 0.34 * clearSkyFactor;
  sky += uSunDiscColor * 0.22 * sunGlowTight * clearSkyFactor;

  if (uStarVisibility > 0.005 && uIsEnvPass < 0.5) {
    vec3 celDir = normalize(vCelestialDir);
    sky += computeStarsAndMilkyWay(celDir) * uStarVisibility;
    if (uStarVisibility > 0.25) {
      sky += computeAurora(celDir) * smoothstep(0.22, 0.88, uStarVisibility) * (0.45 + 0.55 * clearSkyFactor);
    }
  }

  if (uIsEnvPass < 0.5) {
    float horizonClip = smoothstep(-0.006, 0.012, dir.y);
    float discRadius = mix(0.99908, 0.99885, uIsMoon);
    float sunDisc = smoothstep(discRadius, discRadius + 0.00038, sunDot) * horizonClip * clearSkyFactor;
    float sunHalo = pow(max(sunDot, 0.0), mix(210.0, 140.0, uIsMoon)) * horizonClip * clearSkyFactor;
    sky += uSunDiscColor * 0.30 * sunHalo;
    if (uIsMoon > 0.2) {
      float mAng = acos(clamp(sunDot, -1.0, 1.0));
      float corona = exp(-mAng * 24.0) * 0.16 + exp(-pow((mAng - 0.095) / 0.022, 2.0)) * 0.055;
      sky += vec3(0.48, 0.68, 0.98) * corona * horizonClip * clearSkyFactor * uIsMoon;
    }

    if (sunDisc > 0.001) {
      vec3 discCol = uSunDiscColor;
      if (uIsMoon > 0.2) {
        vec3 upRef = abs(sunDir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 rightAxis = normalize(cross(upRef, sunDir));
        vec3 upAxis = cross(sunDir, rightAxis);
        vec2 moonUV = vec2(dot(dir, rightAxis), dot(dir, upAxis)) * 42.0;
        float maria = fbm(moonUV * 2.4 + 3.7);
        discCol *= 0.76 + 0.32 * smoothstep(0.32, 0.72, maria);
      }
      sky = mix(sky, discCol, sunDisc * 0.98);
    }
  }

  if (dir.y > 0.003) {
    float projH = dir.y + mix(0.085, 0.16, uStorminess);
    vec3 cDir = normalize(vCelestialDir);
    vec2 cloudUV = cDir.xz / projH;
    float driftSpeed = 1.0 + uStorminess * 2.4;

    vec2 cirrusUV = cloudUV * vec2(0.55, 1.15) + vec2(uTime * 0.0045 * driftSpeed, -uTime * 0.0025 * driftSpeed);
    float c1 = fbm(cirrusUV * 1.6);
    float c2 = fbm(cirrusUV * 3.3 + vec2(c1 * 1.4, -c1 * 0.8));
    float cirrusMask = smoothstep(0.52 - uCloudCoverage * 0.16, 0.82, c2)
                     * smoothstep(0.04, 0.22, elev)
                     * (1.0 - smoothstep(0.55, 0.92, elev));
    vec3 cirrusColor = mix(uCloudBelly, uCloudRim, pow(max(sunDot, 0.0), 2.2) * clearSkyFactor);
    sky = mix(sky, cirrusColor, cirrusMask * (0.42 + uStorminess * 0.35));

    vec2 cumUV = cloudUV * 0.76 + vec2(-uTime * 0.0075 * driftSpeed, uTime * 0.0042 * driftSpeed);
    float warp = fbm(cumUV * 1.25);
    float baseShape = fbm(cumUV * 2.15 + vec2(warp * 0.95, warp * 0.65));
    float detail = fbm(cumUV * 5.2 - vec2(warp * 0.6, uTime * 0.006 * driftSpeed));

    float topCutoff = mix(0.44, 0.98, uStorminess);
    float bandMask = smoothstep(0.008, 0.055, elev) * (1.0 - smoothstep(topCutoff * 0.45, topCutoff, elev) * (1.0 - uStorminess * 0.82));
    float sunClear = 1.0 - 0.55 * clearSkyFactor * pow(max(sunDot, 0.0), 34.0);
    float lowThresh = mix(0.54, 0.24, uCloudCoverage);
    float highThresh = lowThresh + 0.28;
    float density = smoothstep(lowThresh, highThresh, baseShape * 0.76 + detail * 0.34) * bandMask * sunClear;

    if (density > 0.002) {
      vec2 toSunUV = normalize(sunDir.xz / (sunDir.y + 0.085) - cloudUV + 1e-4) * 0.045;
      float sampleTowardSun = fbm((cumUV + toSunUV) * 2.15 + vec2(warp * 0.95, warp * 0.65)) * 0.76 + detail * 0.34;
      float edgeLit = clamp((highThresh - 0.04 - sampleTowardSun) * 3.1, 0.0, 1.0);

      vec3 cloudCol = mix(uCloudShadow, uCloudBelly, smoothstep(0.0, 0.58, detail) * 0.62);
      float rimFactor = edgeLit * (0.30 + 0.70 * pow(max(sunDot * 0.5 + 0.5, 0.0), 2.4));
      cloudCol = mix(cloudCol, uCloudRim, clamp(rimFactor, 0.0, 1.0));
      cloudCol += uCloudRim * 0.65 * pow(max(sunDot, 0.0), 10.0) * (1.0 - density * 0.68) * clearSkyFactor;

      if (uLightningFlash > 0.005) {
        float lDot = max(dot(dir, normalize(uLightningDir)), 0.0);
        float cloudFlash = pow(lDot, 4.5) * (0.45 + 0.55 * (1.0 - density * 0.5));
        cloudCol += vec3(0.68, 0.86, 1.35) * uLightningFlash * (cloudFlash * 1.65 + 0.14);
      }

      sky = mix(sky, cloudCol, density * 0.95);
    }
  }

  float horizonMist = exp(-abs(dir.y) * 30.0);
  vec3 mistCol = mix(uSkyLow * 0.72, uSkyHorizon, pow(max(sunHorizDot * 0.5 + 0.5, 0.0), 2.2));
  mistCol += vec3(0.45, 0.62, 0.95) * uLightningFlash * 0.25;
  sky = mix(sky, mistCol, horizonMist * 0.48);

  gl_FragColor = vec4(sky, 1.0);
}
`;

/** 预构建 4 组已合并的分叉闪电网格池（运行时仅切换可见性与旋转角，零 GC 开销） */
function createLightningPool() {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0 });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x6cb8ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const pool = [];
  const seeds = [1.13, 2.71, 4.37, 7.89];

  function mergeTubes(geos) {
    let vTotal = 0;
    let iTotal = 0;
    for (const g of geos) {
      vTotal += g.attributes.position.count;
      iTotal += g.index.count;
    }
    const pos = new Float32Array(vTotal * 3);
    const norm = new Float32Array(vTotal * 3);
    const uv = new Float32Array(vTotal * 2);
    const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
    let vOff = 0;
    let iOff = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, vOff * 3);
      norm.set(g.attributes.normal.array, vOff * 3);
      uv.set(g.attributes.uv.array, vOff * 2);
      const ga = g.index.array;
      for (let k = 0; k < ga.length; k++) idx[iOff + k] = ga[k] + vOff;
      vOff += g.attributes.position.count;
      iOff += ga.length;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }

  for (const seed of seeds) {
    const variant = new THREE.Group();
    let st = Math.floor(seed * 9973) + 17;
    const rng = () => {
      st = (st * 1664525 + 1013904223) >>> 0;
      return st / 4294967296;
    };

    const mainPts = [];
    const segs = 16;
    let x = 0;
    let z = 0;
    const coreGeos = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = 148 * (1 - t) - 2 * t;
      if (i > 0 && i < segs) {
        x += (rng() - 0.5) * 11.5;
        z += (rng() - 0.5) * 6.5;
      }
      mainPts.push(new THREE.Vector3(x, y, z));
      if (i === 4 || i === 7 || i === 10) {
        const branchPts = [mainPts[i].clone()];
        let bx = x;
        let by = y;
        let bz = z;
        const dir = rng() > 0.5 ? 1 : -1;
        for (let b = 1; b <= 5; b++) {
          bx += dir * (3.5 + rng() * 5.5);
          by -= 7.5 + rng() * 5.5;
          bz += (rng() - 0.5) * 4.5;
          branchPts.push(new THREE.Vector3(bx, by, bz));
        }
        coreGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(branchPts), 10, 0.28, 5, false));
      }
    }

    const trunkCurve = new THREE.CatmullRomCurve3(mainPts);
    coreGeos.push(new THREE.TubeGeometry(trunkCurve, 28, 0.52, 6, false));
    const mergedCore = mergeTubes(coreGeos);
    const haloGeo = new THREE.TubeGeometry(trunkCurve, 28, 1.85, 6, false);

    variant.add(new THREE.Mesh(mergedCore, coreMat), new THREE.Mesh(haloGeo, haloMat));
    variant.visible = false;
    group.add(variant);
    pool.push(variant);
  }

  function selectBolt(seed) {
    const pick = Math.abs(Math.floor(seed * 9973)) % pool.length;
    for (let k = 0; k < pool.length; k++) {
      pool[k].visible = k === pick;
      if (k === pick) pool[k].rotation.y = ((seed * 37.7) % 1) * Math.PI * 2;
    }
  }
  selectBolt(1);

  return { group, coreMat, haloMat, regenerateBolt: selectBolt };
}

/**
 * 构建天空穹顶、主太阳/月光阴影光源、补光灯组与 5 张 PMREM 环境贴图平滑混合器
 */
export function createSkyAndLighting(scene, renderer, initState, compat = {}) {
  const skyUniforms = {
    uWorldHeading: { value: 0 },
    uSunDir: { value: initState.sunDir.clone() },
    uTime: { value: 0 },
    uIsEnvPass: { value: 0 },
    uSkyZenith: { value: new THREE.Color(...initState.skyZenith) },
    uSkyUpper: { value: new THREE.Color(...initState.skyUpper) },
    uSkyMid: { value: new THREE.Color(...initState.skyMid) },
    uSkyLow: { value: new THREE.Color(...initState.skyLow) },
    uSkyHorizon: { value: new THREE.Color(...initState.skyHorizon) },
    uCloudShadow: { value: new THREE.Color(...initState.cloudShadow) },
    uCloudBelly: { value: new THREE.Color(...initState.cloudBelly) },
    uCloudRim: { value: new THREE.Color(...initState.cloudRim) },
    uCloudCoverage: { value: initState.cloudCoverage },
    uSunDiscColor: { value: new THREE.Vector3(...initState.sunDiscColor) },
    uStarVisibility: { value: initState.starVisibility },
    uIsMoon: { value: initState.isMoon },
    uStorminess: { value: initState.storminess },
    uLightningFlash: { value: 0 },
    uLightningDir: { value: new THREE.Vector3(0.1, 0.25, -0.96).normalize() },
  };

  const skyGeo = new THREE.SphereGeometry(1450, 64, 40);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = 1;
  scene.add(skyMesh);

  // 预烘焙全部 5 种天气（含海啸暖铜色天空）的 CubeUV PMREM 环境反射贴图
  const pmremGen = new THREE.PMREMGenerator(renderer);
  pmremGen.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const envSkyMat = skyMat.clone();
  const envSphere = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 20), envSkyMat);
  envScene.add(envSphere);

  const envMaps = ['noon', 'sunset', 'night', 'storm', 'tsunami', 'blizzard'].map((key) => {
    const preset = WEATHER_PRESETS[key];
    const cosEl = Math.cos(preset.sunElevation);
    const sunDir = new THREE.Vector3(
      Math.sin(preset.sunAzimuth) * cosEl,
      Math.sin(preset.sunElevation),
      -Math.cos(preset.sunAzimuth) * cosEl
    ).normalize();

    envSkyMat.uniforms.uSunDir.value.copy(sunDir);
    envSkyMat.uniforms.uIsEnvPass.value = 1;
    envSkyMat.uniforms.uSkyZenith.value.setRGB(...preset.skyZenith);
    envSkyMat.uniforms.uSkyUpper.value.setRGB(...preset.skyUpper);
    envSkyMat.uniforms.uSkyMid.value.setRGB(...preset.skyMid);
    envSkyMat.uniforms.uSkyLow.value.setRGB(...preset.skyLow);
    envSkyMat.uniforms.uSkyHorizon.value.setRGB(...preset.skyHorizon);
    envSkyMat.uniforms.uCloudShadow.value.setRGB(...preset.cloudShadow);
    envSkyMat.uniforms.uCloudBelly.value.setRGB(...preset.cloudBelly);
    envSkyMat.uniforms.uCloudRim.value.setRGB(...preset.cloudRim);
    envSkyMat.uniforms.uCloudCoverage.value = preset.cloudCoverage;
    envSkyMat.uniforms.uStorminess.value = preset.storminess;
    return pmremGen.fromScene(envScene, 0.03).texture;
  });

  // 用于天气过渡期平滑混合两张 CubeUV PMREM 贴图的缓冲目标（稳态时零开销直通）
  const ew = envMaps[0].image.width || 768;
  const eh = envMaps[0].image.height || 1024;
  const envBlendRT = new THREE.WebGLRenderTarget(ew, eh, {
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    generateMipmaps: false,
    type: compat.rtType || THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
  });
  envBlendRT.texture.mapping = THREE.CubeUVReflectionMapping;
  envBlendRT.texture.name = 'PMREM.blendedCubeUv';

  const envBlendMat = new THREE.ShaderMaterial({
    uniforms: {
      tEnvA: { value: envMaps[1] },
      tEnvB: { value: envMaps[1] },
      uMix: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; uniform sampler2D tEnvA; uniform sampler2D tEnvB; uniform float uMix; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tEnvA, vUv), texture2D(tEnvB, vUv), uMix); }`,
    depthTest: false,
    depthWrite: false,
  });
  const envQuad = new FullScreenQuad(envBlendMat);
  const envWeights = [0, 1, 0, 0, 0, 0];

  scene.environment = envMaps[1];
  scene.environmentIntensity = 0.82;
  envSphere.geometry.dispose();
  envSkyMat.dispose();
  pmremGen.dispose();

  // 主方向光（带 2048x2048 柔和阴影）与三点海洋漫射补光
  const sunLight = new THREE.DirectionalLight(0xffaa62, 3.85);
  sunLight.position.copy(initState.sunDir).multiplyScalar(95);
  sunLight.castShadow = true;
  const smSize = compat.shadowMapSize || 2048;
  sunLight.shadow.mapSize.set(smSize, smSize);
  sunLight.shadow.camera.near = 25;
  sunLight.shadow.camera.far = 185;
  const shadowExtent = 26;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.bias = -0.00045;
  sunLight.shadow.normalBias = 0.028;
  sunLight.shadow.radius = 2.2;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const fillLight = new THREE.DirectionalLight(0xffb780, 1.48);
  fillLight.position.set(24, 15, 26);
  scene.add(fillLight);

  const bounceLight = new THREE.DirectionalLight(0x28b8cf, 0.98);
  bounceLight.position.set(-26, -5, 14);
  scene.add(bounceLight);

  const hemiLight = new THREE.HemisphereLight(0xff9c66, 0x0e4e68, 0.95);
  scene.add(hemiLight);

  const lightning = createLightningPool();
  scene.add(lightning.group);
  const lightningDirLight = new THREE.DirectionalLight(0xb8dcff, 0);
  scene.add(lightningDirLight);
  let lastLightningSeed = -1;

  return {
    skyMesh,
    skyUniforms,
    sunLight,
    update(time, shipPos, state, dt = 0.016) {
      skyUniforms.uTime.value = time;
      skyUniforms.uWorldHeading.value = state.worldHeading || 0;
      skyUniforms.uSunDir.value.copy(state.sunDir);
      skyUniforms.uSkyZenith.value.setRGB(...state.skyZenith);
      skyUniforms.uSkyUpper.value.setRGB(...state.skyUpper);
      skyUniforms.uSkyMid.value.setRGB(...state.skyMid);
      skyUniforms.uSkyLow.value.setRGB(...state.skyLow);
      skyUniforms.uSkyHorizon.value.setRGB(...state.skyHorizon);
      skyUniforms.uCloudShadow.value.setRGB(...state.cloudShadow);
      skyUniforms.uCloudBelly.value.setRGB(...state.cloudBelly);
      skyUniforms.uCloudRim.value.setRGB(...state.cloudRim);
      skyUniforms.uCloudCoverage.value = state.cloudCoverage;
      skyUniforms.uSunDiscColor.value.set(...state.sunDiscColor);
      skyUniforms.uStarVisibility.value = state.starVisibility;
      skyUniforms.uIsMoon.value = state.isMoon;
      skyUniforms.uStorminess.value = state.storminess;
      skyUniforms.uLightningFlash.value = state.lightningFlash;

      // PMREM 5 权重指数追踪与主导双贴图平滑混合
      const targetIdx = state.envIndex !== undefined ? state.envIndex : 1;
      const blendRate = 1 - Math.exp(-dt * 1.65);
      let weightSum = 0;
      for (let k = 0; k < envMaps.length; k++) {
        envWeights[k] += ((k === targetIdx ? 1 : 0) - envWeights[k]) * blendRate;
        weightSum += envWeights[k];
      }
      let idxA = targetIdx;
      let wA = -1;
      let idxB = targetIdx;
      let wB = -1;
      for (let k = 0; k < envMaps.length; k++) {
        const nw = weightSum > 0 ? envWeights[k] / weightSum : k === targetIdx ? 1 : 0;
        if (nw > wA) {
          idxB = idxA;
          wB = wA;
          idxA = k;
          wA = nw;
        } else if (nw > wB) {
          idxB = k;
          wB = nw;
        }
      }
      if (wA > 0.995 || wB <= 0.002) {
        const settledTex = envMaps[idxA] || envMaps[1];
        if (scene.environment !== settledTex) scene.environment = settledTex;
      } else {
        envBlendMat.uniforms.tEnvA.value = envMaps[idxA];
        envBlendMat.uniforms.tEnvB.value = envMaps[idxB];
        envBlendMat.uniforms.uMix.value = wB / (wA + wB);
        const prevRT = renderer.getRenderTarget();
        const prevAuto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(envBlendRT);
        envQuad.render(renderer);
        renderer.setRenderTarget(prevRT);
        renderer.autoClear = prevAuto;
        if (scene.environment !== envBlendRT.texture) scene.environment = envBlendRT.texture;
      }

      scene.environmentIntensity = 0.52 + 0.35 * (1 - state.isMoon * 0.45) + state.lightningFlash * 0.45;

      sunLight.color.setRGB(...state.sunLightColor);
      sunLight.intensity = state.sunLightIntensity;
      sunLight.target.position.set(shipPos.x, shipPos.y + 6, shipPos.z);
      sunLight.position.copy(state.sunDir).multiplyScalar(95).add(sunLight.target.position);
      sunLight.target.updateMatrixWorld();

      fillLight.color.setRGB(...state.fillLightColor);
      fillLight.intensity = state.fillLightIntensity;
      bounceLight.color.setRGB(...state.bounceLightColor);
      bounceLight.intensity = state.bounceLightIntensity;
      hemiLight.color.setRGB(...state.hemiSkyColor);
      hemiLight.groundColor.setRGB(...state.hemiGroundColor);
      hemiLight.intensity = state.hemiIntensity;

      if (state.lightningFlash > 0.01) {
        if (state.lightningSeed !== lastLightningSeed) {
          lastLightningSeed = state.lightningSeed;
          lightning.regenerateBolt(lastLightningSeed);
        }
        lightning.group.visible = true;
        lightning.group.position.set(shipPos.x + state.lightningPos.x, 0, shipPos.z + state.lightningPos.y);
        lightning.coreMat.opacity = Math.min(1, state.lightningFlash * 1.15);
        lightning.haloMat.opacity = Math.min(0.85, state.lightningFlash * 0.72);
        skyUniforms.uLightningDir.value.set(state.lightningPos.x, 78, state.lightningPos.y).normalize();
        lightningDirLight.position.set(shipPos.x + state.lightningPos.x * 0.5, 65, shipPos.z + state.lightningPos.y * 0.5);
        lightningDirLight.intensity = state.lightningFlash * 9.5;
      } else {
        lightning.group.visible = false;
        lightningDirLight.intensity = 0;
      }
    },
  };
}
