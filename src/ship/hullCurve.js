/**
 * @file hullCurve.js
 * @description 17 世纪三桅战舰（Galleon）参数化船体几何型线方程：
 *              定义船尾（z = -14.5m）至船首（z = +15.2m）的龙骨高度、舷顶阶梯舷弧、最大水线半宽与各层甲板高度，
 *              供船壳放样、甲板铺设、舷炮定位、桅杆生根与静索链板共享查询。
 *              支持传入复用 target 向量实现热路径零 GC 内存分配。
 */

import * as THREE from 'three';

export const STERN_Z = -14.5;
export const BOW_Z = 15.2;
export const HULL_LENGTH = BOW_Z - STERN_Z;

const _tmpDeckPt = new THREE.Vector3();

export function clampVal(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function smoothBand(edge0, edge1, x) {
  const t = clampVal((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 根据纵向归一化坐标 s ∈ [0, 1]（0=船尾, 1=船首）计算船体横剖面控制参数
 */
export function evaluateHullSection(s) {
  s = clampVal(s, 0, 1);
  const z = STERN_Z + s * HULL_LENGTH;
  const bowRise = Math.pow(smoothBand(0.76, 1.0, s), 2.15);
  const yKeel = -2.85 + (1 - smoothBand(0.0, 0.16, s)) * 0.45 + bowRise * 7.45;

  const fwdTaper = Math.pow(clampVal(1 - Math.max(s - 0.54, 0) / 0.46, 0, 1), 0.76);
  const aftTaper = 0.58 + 0.42 * smoothBand(0.0, 0.36, s);
  const maxHalfBeam = 4.32 * fwdTaper * aftTaper;

  const baseSheer =
    2.82 +
    Math.pow(clampVal((0.46 - s) / 0.46, 0, 1), 1.65) * 1.35 +
    Math.pow(clampVal((s - 0.52) / 0.48, 0, 1), 1.55) * 1.45;
  const poopStep = (1 - smoothBand(0.14, 0.185, s)) * 1.42;
  const quarterStep = (1 - smoothBand(0.36, 0.405, s)) * 0.72;
  const forecastleStep = smoothBand(0.725, 0.77, s) * 0.56;
  const ySheer = baseSheer + poopStep + quarterStep + forecastleStep;

  return { z, s, yKeel, ySheer, maxHalfBeam };
}

/** 将船体局部 Z 坐标归一化至纵向参数 s ∈ [0, 1] */
export function zToHullParam(z) {
  return clampVal((z - STERN_Z) / HULL_LENGTH, 0, 1);
}

/**
 * 计算参数化船壳外表面三维点 (s ∈ [0,1] 纵向, v ∈ [0,1] 龙骨至舷顶垂向)
 * 包含水线下圆舭过渡、水线上内倾（Tumblehome）、船首外飘（Flare）与船尾斜倾（Transom Rake）
 * @param {number} s 纵向归一化参数 [0, 1]
 * @param {number} v 垂向归一化参数 [0, 1]
 * @param {THREE.Vector3} [target] 可选复用输出向量（避免主循环 GC 分配）
 */
export function sampleHullSurface(s, v, target = null) {
  const sec = evaluateHullSection(s);
  const y = sec.yKeel + (sec.ySheer - sec.yKeel) * v;
  let beamShape;

  if (v < 0.52) {
    const u = v / 0.52;
    const endSharpness = 1 - Math.sin(Math.PI * clampVal(s, 0.05, 0.95)) * 0.55;
    const midRound = Math.pow(Math.sin(u * Math.PI * 0.5), 0.62);
    const veeHull = Math.pow(u, 0.95);
    beamShape = midRound * (1 - endSharpness * 0.45) + veeHull * (endSharpness * 0.45);
  } else {
    const u = (v - 0.52) / 0.48;
    const bowFlare = smoothBand(0.72, 0.98, s);
    beamShape = 1 - 0.13 * Math.pow(u, 1.35) * (1 - bowFlare) + 0.09 * Math.pow(u, 1.2) * bowFlare;
  }

  const stemPinch = s > 0.985 ? 1 - (s - 0.985) / 0.015 : 1;
  const x = sec.maxHalfBeam * beamShape * stemPinch;
  const transomRakeZ = (1 - smoothBand(0.0, 0.055, s)) * (v - 0.35) * -0.85;
  if (target) {
    return target.set(x, y, sec.z + transomRakeZ);
  }
  return new THREE.Vector3(x, y, sec.z + transomRakeZ);
}

/**
 * 查询任意纵向坐标 z 处所对应的阶梯甲板基准高度（艉楼甲板 / 后甲板 / 主露天甲板 / 艏楼甲板）
 */
export function getDeckHeightAtZ(z) {
  if (z < -9.6) return 4.72 + clampVal((-9.6 - z) / (-9.6 - STERN_Z), 0, 1) * 0.58;
  if (z < -3.2) return 3.22 + clampVal((-3.2 - z) / 6.4, 0, 1) * 0.34;
  if (z <= 7.6) {
    const mid = Math.abs(z - 2.2) / 5.4;
    return 1.56 + Math.pow(mid, 2) * 0.12;
  }
  return 3.04 + clampVal((z - 7.6) / (14.8 - 7.6), 0, 1) * 0.58;
}

/**
 * 查询任意纵向坐标 z 在指定垂向比例 v 处的甲板净半宽（零分配）
 */
export function getDeckHalfWidthAtZ(z, v = 0.86) {
  const s = zToHullParam(z);
  sampleHullSurface(s, v, _tmpDeckPt);
  return Math.max(0.15, _tmpDeckPt.x - 0.24);
}
