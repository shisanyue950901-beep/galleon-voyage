/**
 * @file weatherState.js
 * @description 六大海洋天气预设（正午晴空、日落余晖、星夜荧光、雷暴骤雨、极地暴雪、滔天海啸）、
 *              24 小时连续昼夜天光插值、平滑过渡状态机、光声延迟闪电触发与 360° 世界航向角同步。
 */

import * as THREE from 'three';

/** 天气模式顺序列表（对应数字键 1–6） */
export const WEATHER_MODES = ['noon', 'sunset', 'night', 'storm', 'blizzard', 'tsunami'];

/** 海啸巨浪循环周期与推进起止 Z 坐标（米） */
export const TSUNAMI_PERIOD = 15.5;
export const TSUNAMI_START_Z = 148;
export const TSUNAMI_END_Z = -152;

/** 默认日落太阳方向向量（用于初始化着色器 Uniform） */
export const DEFAULT_SUN_DIR = new THREE.Vector3(0.12, 0.112, -0.986).normalize();

/**
 * 六大天气海况完整光学、大气、水体与动力学预设表
 * 注意：envIndex 0..5 一一对应 skyAndLighting.js 中烘焙的 6 张专属 PMREM 环境反射贴图
 */
export const WEATHER_PRESETS = {
  noon: {
    sunAzimuth: 0.48,
    sunElevation: 0.78,
    skyZenith: [0.045, 0.245, 0.68],
    skyUpper: [0.11, 0.42, 0.82],
    skyMid: [0.24, 0.6, 0.9],
    skyLow: [0.44, 0.76, 0.95],
    skyHorizon: [0.64, 0.86, 0.96],
    cloudShadow: [0.42, 0.5, 0.64],
    cloudBelly: [0.82, 0.86, 0.92],
    cloudRim: [1.15, 1.14, 1.1],
    cloudCoverage: 0.42,
    sunDiscColor: [3.2, 3.05, 2.75],
    sunLightColor: [1, 0.96, 0.88],
    sunLightIntensity: 4.35,
    fillLightColor: [0.68, 0.85, 1],
    fillLightIntensity: 1.55,
    bounceLightColor: [0.12, 0.78, 0.88],
    bounceLightIntensity: 1.25,
    hemiSkyColor: [0.62, 0.84, 1],
    hemiGroundColor: [0.06, 0.42, 0.58],
    hemiIntensity: 1.15,
    waterDeep: [0.008, 0.095, 0.245],
    waterMid: [0.018, 0.285, 0.485],
    waterShallow: [0.055, 0.56, 0.68],
    waterSSS: [0.1, 0.92, 0.84],
    sunSpecColor: [1.05, 1, 0.9],
    foamLit: [1.02, 1.02, 1],
    foamShadow: [0.58, 0.76, 0.88],
    waveAmpScale: 0.86,
    windSpeedScale: 0.92,
    heelAngle: -0.045,
    lanternFactor: 0.08,
    starVisibility: 0,
    isMoon: 0,
    bioluminescence: 0,
    rainAmount: 0,
    snowAmount: 0,
    storminess: 0,
    tsunamiMode: 0,
    wetness: 0.12,
    godRayStrength: 0.18,
    exposure: 0.98,
    envIndex: 0,
  },
  sunset: {
    sunAzimuth: 0.12,
    sunElevation: 0.112,
    skyZenith: [0.032, 0.048, 0.155],
    skyUpper: [0.185, 0.072, 0.225],
    skyMid: [0.56, 0.135, 0.185],
    skyLow: [0.88, 0.285, 0.115],
    skyHorizon: [0.96, 0.505, 0.195],
    cloudShadow: [0.13, 0.07, 0.17],
    cloudBelly: [0.58, 0.17, 0.14],
    cloudRim: [1.22, 0.78, 0.32],
    cloudCoverage: 0.56,
    sunDiscColor: [3.3, 2.3, 1.15],
    sunLightColor: [1, 0.66, 0.32],
    sunLightIntensity: 3.9,
    fillLightColor: [1, 0.71, 0.5],
    fillLightIntensity: 1.48,
    bounceLightColor: [0.16, 0.72, 0.81],
    bounceLightIntensity: 0.98,
    hemiSkyColor: [1, 0.61, 0.4],
    hemiGroundColor: [0.055, 0.31, 0.41],
    hemiIntensity: 0.96,
    waterDeep: [0.01, 0.052, 0.112],
    waterMid: [0.022, 0.145, 0.245],
    waterShallow: [0.045, 0.295, 0.375],
    waterSSS: [0.16, 0.78, 0.66],
    sunSpecColor: [1.05, 0.6, 0.22],
    foamLit: [1, 0.89, 0.76],
    foamShadow: [0.48, 0.62, 0.75],
    waveAmpScale: 1,
    windSpeedScale: 1,
    heelAngle: -0.058,
    lanternFactor: 1,
    starVisibility: 0.12,
    isMoon: 0,
    bioluminescence: 0,
    rainAmount: 0,
    snowAmount: 0,
    storminess: 0,
    tsunamiMode: 0,
    wetness: 0.28,
    godRayStrength: 0.42,
    exposure: 1.06,
    envIndex: 1,
  },
  night: {
    sunAzimuth: -0.18,
    sunElevation: 0.26,
    skyZenith: [0.006, 0.012, 0.038],
    skyUpper: [0.012, 0.024, 0.068],
    skyMid: [0.02, 0.042, 0.105],
    skyLow: [0.032, 0.068, 0.148],
    skyHorizon: [0.048, 0.102, 0.195],
    cloudShadow: [0.015, 0.025, 0.055],
    cloudBelly: [0.04, 0.068, 0.13],
    cloudRim: [0.38, 0.56, 0.82],
    cloudCoverage: 0.34,
    sunDiscColor: [1.95, 2.25, 2.65],
    sunLightColor: [0.52, 0.7, 0.98],
    sunLightIntensity: 1.95,
    fillLightColor: [0.3, 0.46, 0.75],
    fillLightIntensity: 0.78,
    bounceLightColor: [0.06, 0.58, 0.82],
    bounceLightIntensity: 0.68,
    hemiSkyColor: [0.18, 0.3, 0.56],
    hemiGroundColor: [0.02, 0.12, 0.24],
    hemiIntensity: 0.68,
    waterDeep: [0.004, 0.016, 0.045],
    waterMid: [0.008, 0.042, 0.095],
    waterShallow: [0.016, 0.095, 0.175],
    waterSSS: [0.06, 0.46, 0.68],
    sunSpecColor: [0.62, 0.82, 1.1],
    foamLit: [0.52, 0.74, 0.95],
    foamShadow: [0.16, 0.3, 0.48],
    waveAmpScale: 0.88,
    windSpeedScale: 0.92,
    heelAngle: -0.048,
    lanternFactor: 1.55,
    starVisibility: 1,
    isMoon: 1,
    bioluminescence: 1,
    rainAmount: 0,
    snowAmount: 0,
    storminess: 0,
    tsunamiMode: 0,
    wetness: 0.32,
    godRayStrength: 0.16,
    exposure: 1.14,
    envIndex: 2,
  },
  storm: {
    sunAzimuth: 0.22,
    sunElevation: 0.24,
    skyZenith: [0.018, 0.024, 0.038],
    skyUpper: [0.032, 0.042, 0.062],
    skyMid: [0.052, 0.066, 0.088],
    skyLow: [0.078, 0.096, 0.122],
    skyHorizon: [0.105, 0.128, 0.155],
    cloudShadow: [0.014, 0.018, 0.028],
    cloudBelly: [0.042, 0.052, 0.07],
    cloudRim: [0.22, 0.28, 0.36],
    cloudCoverage: 0.92,
    sunDiscColor: [0.18, 0.22, 0.28],
    sunLightColor: [0.56, 0.68, 0.82],
    sunLightIntensity: 1.45,
    fillLightColor: [0.38, 0.48, 0.62],
    fillLightIntensity: 0.95,
    bounceLightColor: [0.1, 0.34, 0.42],
    bounceLightIntensity: 0.72,
    hemiSkyColor: [0.24, 0.3, 0.38],
    hemiGroundColor: [0.03, 0.08, 0.12],
    hemiIntensity: 0.85,
    waterDeep: [0.008, 0.022, 0.038],
    waterMid: [0.018, 0.058, 0.085],
    waterShallow: [0.038, 0.125, 0.155],
    waterSSS: [0.08, 0.38, 0.38],
    sunSpecColor: [0.45, 0.56, 0.68],
    foamLit: [0.78, 0.84, 0.9],
    foamShadow: [0.32, 0.4, 0.48],
    waveAmpScale: 1.78,
    windSpeedScale: 1.65,
    heelAngle: -0.135,
    lanternFactor: 1.75,
    starVisibility: 0,
    isMoon: 0,
    bioluminescence: 0,
    rainAmount: 1,
    snowAmount: 0,
    storminess: 1,
    tsunamiMode: 0,
    wetness: 0.95,
    godRayStrength: 0,
    exposure: 1.12,
    envIndex: 3,
  },
  blizzard: {
    sunAzimuth: -0.26,
    sunElevation: 0.22,
    skyZenith: [0.014, 0.028, 0.058],
    skyUpper: [0.032, 0.062, 0.108],
    skyMid: [0.068, 0.115, 0.175],
    skyLow: [0.128, 0.185, 0.245],
    skyHorizon: [0.21, 0.275, 0.34],
    cloudShadow: [0.032, 0.052, 0.085],
    cloudBelly: [0.095, 0.135, 0.188],
    cloudRim: [0.42, 0.58, 0.72],
    cloudCoverage: 0.86,
    sunDiscColor: [1.35, 1.75, 2.2],
    sunLightColor: [0.68, 0.84, 1.0],
    sunLightIntensity: 1.75,
    fillLightColor: [0.55, 0.74, 0.95],
    fillLightIntensity: 1.15,
    bounceLightColor: [0.16, 0.52, 0.68],
    bounceLightIntensity: 0.78,
    hemiSkyColor: [0.36, 0.48, 0.64],
    hemiGroundColor: [0.06, 0.16, 0.24],
    hemiIntensity: 0.96,
    waterDeep: [0.006, 0.024, 0.052],
    waterMid: [0.015, 0.062, 0.108],
    waterShallow: [0.042, 0.165, 0.225],
    waterSSS: [0.12, 0.56, 0.68],
    sunSpecColor: [0.72, 0.88, 1.05],
    foamLit: [0.92, 0.96, 1.02],
    foamShadow: [0.42, 0.56, 0.72],
    waveAmpScale: 1.36,
    windSpeedScale: 1.75,
    heelAngle: -0.095,
    lanternFactor: 1.98,
    starVisibility: 0.48,
    isMoon: 1,
    bioluminescence: 0.18,
    rainAmount: 0,
    snowAmount: 1,
    storminess: 0.58,
    tsunamiMode: 0,
    wetness: 0.48,
    godRayStrength: 0.06,
    exposure: 1.14,
    envIndex: 5,
  },
  tsunami: {
    sunAzimuth: 0.16,
    sunElevation: 0.14,
    skyZenith: [0.016, 0.026, 0.058],
    skyUpper: [0.055, 0.042, 0.088],
    skyMid: [0.195, 0.078, 0.105],
    skyLow: [0.46, 0.165, 0.095],
    skyHorizon: [0.68, 0.32, 0.145],
    cloudShadow: [0.028, 0.025, 0.048],
    cloudBelly: [0.18, 0.08, 0.09],
    cloudRim: [0.95, 0.48, 0.18],
    cloudCoverage: 0.82,
    sunDiscColor: [2.1, 1.25, 0.55],
    sunLightColor: [0.98, 0.62, 0.34],
    sunLightIntensity: 2.85,
    fillLightColor: [0.55, 0.64, 0.78],
    fillLightIntensity: 1.18,
    bounceLightColor: [0.08, 0.68, 0.68],
    bounceLightIntensity: 1.15,
    hemiSkyColor: [0.52, 0.38, 0.36],
    hemiGroundColor: [0.03, 0.22, 0.28],
    hemiIntensity: 0.92,
    waterDeep: [0.006, 0.032, 0.062],
    waterMid: [0.015, 0.095, 0.145],
    waterShallow: [0.038, 0.265, 0.305],
    waterSSS: [0.12, 0.88, 0.74],
    sunSpecColor: [0.95, 0.58, 0.28],
    foamLit: [0.96, 0.92, 0.88],
    foamShadow: [0.4, 0.54, 0.64],
    waveAmpScale: 1.42,
    windSpeedScale: 1.5,
    heelAngle: -0.095,
    lanternFactor: 1.5,
    starVisibility: 0,
    isMoon: 0,
    bioluminescence: 0,
    rainAmount: 0.45,
    snowAmount: 0,
    storminess: 0.55,
    tsunamiMode: 1,
    wetness: 0.88,
    godRayStrength: 0.24,
    exposure: 1.08,
    envIndex: 4,
  },
};

const RGB_KEYS = [
  'skyZenith', 'skyUpper', 'skyMid', 'skyLow', 'skyHorizon',
  'cloudShadow', 'cloudBelly', 'cloudRim', 'sunDiscColor', 'sunLightColor',
  'fillLightColor', 'bounceLightColor', 'hemiSkyColor', 'hemiGroundColor',
  'waterDeep', 'waterMid', 'waterShallow', 'waterSSS', 'sunSpecColor', 'foamLit', 'foamShadow',
];

const SCALAR_KEYS = [
  'cloudCoverage', 'sunLightIntensity', 'fillLightIntensity', 'bounceLightIntensity', 'hemiIntensity',
  'waveAmpScale', 'windSpeedScale', 'heelAngle', 'lanternFactor', 'starVisibility', 'isMoon',
  'bioluminescence', 'rainAmount', 'snowAmount', 'storminess', 'tsunamiMode', 'wetness', 'godRayStrength', 'exposure',
];

/** 根据 24 小时制时间 hour ∈ [0, 24) 连续混合出对应的天光与海洋预设 */
function buildCustomTimePreset(hour) {
  const h = ((hour % 24) + 24) % 24;
  let pA, pB, t;
  if (h < 5.0) {
    pA = WEATHER_PRESETS.night; pB = WEATHER_PRESETS.night; t = 0;
  } else if (h < 7.5) {
    pA = WEATHER_PRESETS.night; pB = WEATHER_PRESETS.sunset; t = THREE.MathUtils.smoothstep(h, 5.0, 7.5);
  } else if (h < 10.5) {
    pA = WEATHER_PRESETS.sunset; pB = WEATHER_PRESETS.noon; t = THREE.MathUtils.smoothstep(h, 7.5, 10.5);
  } else if (h < 16.0) {
    pA = WEATHER_PRESETS.noon; pB = WEATHER_PRESETS.noon; t = 0;
  } else if (h < 18.5) {
    pA = WEATHER_PRESETS.noon; pB = WEATHER_PRESETS.sunset; t = THREE.MathUtils.smoothstep(h, 16.0, 18.5);
  } else if (h < 20.8) {
    pA = WEATHER_PRESETS.sunset; pB = WEATHER_PRESETS.night; t = THREE.MathUtils.smoothstep(h, 18.5, 20.8);
  } else {
    pA = WEATHER_PRESETS.night; pB = WEATHER_PRESETS.night; t = 0;
  }

  const out = {};
  for (const k of RGB_KEYS) {
    out[k] = [
      pA[k][0] + (pB[k][0] - pA[k][0]) * t,
      pA[k][1] + (pB[k][1] - pA[k][1]) * t,
      pA[k][2] + (pB[k][2] - pA[k][2]) * t,
    ];
  }
  for (const k of SCALAR_KEYS) {
    out[k] = pA[k] + (pB[k] - pA[k]) * t;
  }

  if (h >= 5.5 && h <= 19.5) {
    const dayU = (h - 5.5) / 14.0;
    out.sunElevation = Math.max(0.05, Math.sin(dayU * Math.PI) * 0.88);
    out.sunAzimuth = -0.95 + dayU * 1.9;
  } else {
    out.sunElevation = pA.sunElevation + (pB.sunElevation - pA.sunElevation) * t;
    out.sunAzimuth = pA.sunAzimuth + (pB.sunAzimuth - pA.sunAzimuth) * t;
  }
  out.envIndex = t < 0.5 ? pA.envIndex : pB.envIndex;
  return out;
}

const MODE_DEFAULT_HOURS = { noon: 12.5, sunset: 18.0, night: 22.5, storm: 15.0, blizzard: 23.0, tsunami: 17.0 };

/** 根据海啸时钟计算当前 24 米海啸波峰在世界空间的 Z 坐标 */
export function computeTsunamiCrestZ(clock) {
  const norm = ((clock % TSUNAMI_PERIOD) + TSUNAMI_PERIOD) % TSUNAMI_PERIOD / TSUNAMI_PERIOD;
  return TSUNAMI_START_Z + (TSUNAMI_END_Z - TSUNAMI_START_Z) * norm;
}

/** 计算任意水平点 (x, z) 处的海啸水墙抬升高度与波峰因子 */
export function evaluateTsunamiProfile(x, z, crestZ, tsunamiWeight) {
  if (tsunamiWeight <= 0.001) return { y: 0, crestFactor: 0 };
  const envFade =
    THREE.MathUtils.smoothstep(crestZ, TSUNAMI_END_Z, TSUNAMI_END_Z + 36) *
    (1 - THREE.MathUtils.smoothstep(crestZ, TSUNAMI_START_Z - 30, TSUNAMI_START_Z));
  const curveZ = Math.cos(x * 0.018) * 3.5;
  const dz = z - (crestZ + curveZ);
  const sigma = dz < 0 ? 22.5 : 31.0;
  const profile = Math.exp(-(dz * dz) / (sigma * sigma));
  const trough = -3.4 * Math.exp(-Math.pow((dz + 34) / 18, 2));
  return {
    y: (23.5 * profile + trough) * envFade * tsunamiWeight,
    crestFactor: profile * envFade * tsunamiWeight,
  };
}

function lerpScalar(a, b, t) {
  return a + (b - a) * t;
}

function lerpRGB(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/**
 * 创建天气与光照过渡状态机控制器（支持 6 大预设与 24 小时连续时间轴）
 */
export function createWeatherController(initialMode = 'sunset') {
  let currentMode = initialMode;
  let customHour = null;
  let autoCycle = false;
  let cycleTimer = 0;
  const initPreset = WEATHER_PRESETS[initialMode];

  const state = {
    sunAzimuth: initPreset.sunAzimuth,
    sunElevation: initPreset.sunElevation,
    sunDir: new THREE.Vector3(),
    skyZenith: [...initPreset.skyZenith],
    skyUpper: [...initPreset.skyUpper],
    skyMid: [...initPreset.skyMid],
    skyLow: [...initPreset.skyLow],
    skyHorizon: [...initPreset.skyHorizon],
    cloudShadow: [...initPreset.cloudShadow],
    cloudBelly: [...initPreset.cloudBelly],
    cloudRim: [...initPreset.cloudRim],
    cloudCoverage: initPreset.cloudCoverage,
    sunDiscColor: [...initPreset.sunDiscColor],
    sunLightColor: [...initPreset.sunLightColor],
    sunLightIntensity: initPreset.sunLightIntensity,
    fillLightColor: [...initPreset.fillLightColor],
    fillLightIntensity: initPreset.fillLightIntensity,
    bounceLightColor: [...initPreset.bounceLightColor],
    bounceLightIntensity: initPreset.bounceLightIntensity,
    hemiSkyColor: [...initPreset.hemiSkyColor],
    hemiGroundColor: [...initPreset.hemiGroundColor],
    hemiIntensity: initPreset.hemiIntensity,
    waterDeep: [...initPreset.waterDeep],
    waterMid: [...initPreset.waterMid],
    waterShallow: [...initPreset.waterShallow],
    waterSSS: [...initPreset.waterSSS],
    sunSpecColor: [...initPreset.sunSpecColor],
    foamLit: [...initPreset.foamLit],
    foamShadow: [...initPreset.foamShadow],
    waveAmpScale: initPreset.waveAmpScale,
    windSpeedScale: initPreset.windSpeedScale,
    heelAngle: initPreset.heelAngle,
    lanternFactor: initPreset.lanternFactor,
    starVisibility: initPreset.starVisibility,
    isMoon: initPreset.isMoon,
    bioluminescence: initPreset.bioluminescence,
    rainAmount: initPreset.rainAmount,
    snowAmount: initPreset.snowAmount,
    storminess: initPreset.storminess,
    tsunamiMode: initPreset.tsunamiMode,
    wetness: initPreset.wetness,
    godRayStrength: initPreset.godRayStrength,
    exposure: initPreset.exposure,
    envIndex: initPreset.envIndex,
    tsunamiClock: 2.2,
    tsunamiCrestZ: 100,
    lightningFlash: 0,
    lightningPos: new THREE.Vector2(18, -120),
    lightningSeed: 1,
    worldHeading: 0,
  };

  let nextBoltCountdown = 1.6;
  let boltElapsed = -1;
  let thunderCallback = null;
  let modeChangeCallback = null;

  function refreshSunDirection() {
    const cosEl = Math.cos(state.sunElevation);
    const effAzimuth = state.sunAzimuth + state.worldHeading;
    state.sunDir
      .set(Math.sin(effAzimuth) * cosEl, Math.sin(state.sunElevation), -Math.cos(effAzimuth) * cosEl)
      .normalize();
  }
  refreshSunDirection();

  function setMode(nextMode, manualTrigger = false) {
    if (!WEATHER_PRESETS[nextMode]) return;
    if (manualTrigger) autoCycle = false;
    customHour = null;
    const prevMode = currentMode;
    currentMode = nextMode;
    if (nextMode === 'tsunami' && prevMode !== 'tsunami') state.tsunamiClock = 3.6;
    if (nextMode === 'storm' && prevMode !== 'storm') nextBoltCountdown = 0.85;
    if (modeChangeCallback) modeChangeCallback(currentMode, autoCycle, customHour);
  }

  function setTimeOfDay(hour) {
    autoCycle = false;
    customHour = ((hour % 24) + 24) % 24;
    if (modeChangeCallback) modeChangeCallback(currentMode, autoCycle, customHour);
  }

  function toggleAutoCycle() {
    autoCycle = !autoCycle;
    cycleTimer = 0;
    if (autoCycle) customHour = null;
    if (modeChangeCallback) modeChangeCallback(currentMode, autoCycle, customHour);
    return autoCycle;
  }

  return {
    state,
    getMode: () => currentMode,
    getTimeOfDay: () => (customHour !== null ? customHour : MODE_DEFAULT_HOURS[currentMode] ?? 18.0),
    isCustomTime: () => customHour !== null,
    isAutoCycle: () => autoCycle,
    setMode,
    setTimeOfDay,
    toggleAutoCycle,
    setWorldHeading(headingRad) {
      state.worldHeading = headingRad;
      refreshSunDirection();
    },
    onThunder(cb) {
      thunderCallback = cb;
    },
    onModeChange(cb) {
      modeChangeCallback = cb;
    },
    update(dt) {
      if (autoCycle) {
        cycleTimer += dt;
        const dwellSeconds = currentMode === 'tsunami' ? 16 : 12;
        if (cycleTimer >= dwellSeconds) {
          cycleTimer = 0;
          const nextIdx = (WEATHER_MODES.indexOf(currentMode) + 1) % WEATHER_MODES.length;
          setMode(WEATHER_MODES[nextIdx], false);
        }
      }

      const target = customHour !== null ? buildCustomTimePreset(customHour) : WEATHER_PRESETS[currentMode];
      const alpha = 1 - Math.exp(-dt * (customHour !== null ? 4.2 : 1.65));

      state.sunAzimuth = lerpScalar(state.sunAzimuth, target.sunAzimuth, alpha);
      state.sunElevation = lerpScalar(state.sunElevation, target.sunElevation, alpha);
      refreshSunDirection();

      for (const k of RGB_KEYS) lerpRGB(state[k], state[k], target[k], alpha);
      for (const k of SCALAR_KEYS) state[k] = lerpScalar(state[k], target[k], alpha);
      state.envIndex = target.envIndex;

      if (state.tsunamiMode > 0.002) {
        state.tsunamiClock += dt;
        state.tsunamiCrestZ = computeTsunamiCrestZ(state.tsunamiClock);
      }

      // 雷暴与海啸模式下的随机分叉闪电触发（极地暴雪不触发闪电），并计算真实光声传播延迟
      if (state.storminess > 0.22 && state.snowAmount < 0.45) {
        nextBoltCountdown -= dt * (0.65 + state.storminess * 0.65);
        if (nextBoltCountdown <= 0 && boltElapsed < 0) {
          boltElapsed = 0;
          state.lightningSeed = Math.random() * 100;
          const angle = (Math.random() - 0.5) * 1.85;
          const radius = 150 + Math.random() * 210;
          state.lightningPos.set(Math.sin(angle) * radius, -Math.cos(angle) * radius);
          nextBoltCountdown = 2.8 + Math.random() * 4.8;
          // 按声速约 340m/s 映射 0.35s–2.35s 物理光声延迟（近雷清脆、远雷沉闷）
          const delaySec = THREE.MathUtils.clamp(((radius - 130) / 230) * 1.95 + 0.32, 0.32, 2.35);
          const distStrength = THREE.MathUtils.clamp(1.22 - (radius - 150) / 360, 0.52, 1.15);
          if (thunderCallback) {
            thunderCallback(distStrength * (0.68 + 0.32 * state.storminess), state.lightningPos, delaySec);
          }
        }
      }

      if (boltElapsed >= 0) {
        boltElapsed += dt;
        const pulse1 = Math.exp(-Math.pow((boltElapsed - 0.04) / 0.035, 2));
        const pulse2 = Math.exp(-Math.pow((boltElapsed - 0.15) / 0.055, 2)) * 1.15;
        const afterglow = Math.max(0, 1 - boltElapsed / 0.42) * 0.25;
        state.lightningFlash = Math.min(1.35, pulse1 + pulse2 + afterglow);
        if (boltElapsed > 0.46) {
          boltElapsed = -1;
          state.lightningFlash = 0;
        }
      } else {
        state.lightningFlash = 0;
      }
    },
  };
}
