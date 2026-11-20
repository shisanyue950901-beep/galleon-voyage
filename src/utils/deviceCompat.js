/**
 * @file deviceCompat.js
 * @description 设备形态探测、WebGL/HalfFloat 能力回退、自适应画质档位与安全本地偏好存储。
 *              统一适配桌面端、iOS/Android 移动端、窄屏分栏与车机宽屏环境。
 */

import * as THREE from 'three';

const PREFS_KEY = 'galleon_voyage_prefs_v5';

/** 探测当前运行环境的设备类型、触控特征与渲染管线能力 */
export function detectDeviceCapabilities(renderer) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isTouch =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0));
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (ua.includes('Macintosh') && isTouch);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || (typeof window !== 'undefined' && window.innerWidth <= 768 && isTouch);
  const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 768;

  const gl = renderer.getContext();
  const isWebGL2 = !!renderer.capabilities.isWebGL2;
  const canHalfFloatRT = isWebGL2
    ? !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'))
    : !!gl.getExtension('EXT_color_buffer_half_float');

  const rtType = canHalfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const rawMaxSamples = isWebGL2 ? renderer.capabilities.maxSamples || 0 : 0;
  // 移动端限制 MSAA 至 2x，避免高分屏带宽瓶颈
  const maxSamples = isMobile ? Math.min(2, rawMaxSamples) : Math.min(4, rawMaxSamples);
  const shadowMapSize = isMobile ? 1024 : 2048;
  const maxDPR = isMobile ? 1.5 : 2.0;

  return {
    isTouch,
    isIOS,
    isMobile,
    isNarrow,
    isWebGL2,
    canHalfFloatRT,
    rtType,
    maxSamples,
    shadowMapSize,
    maxDPR,
    defaultQualityIdx: isMobile ? 1 : 0,
  };
}

/** 安全读取本地持久化偏好（在受限 iframe/隐私模式下静默回退） */
export function loadUserPrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

/** 安全写入本地持久化偏好 */
export function saveUserPrefs(partial) {
  try {
    const prev = loadUserPrefs();
    const merged = { ...prev, ...partial };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  } catch (_err) {
    // 忽略沙盒或隐私模式下的存储限制
  }
}
