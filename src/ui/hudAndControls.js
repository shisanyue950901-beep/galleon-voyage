/**
 * @file hudAndControls.js
 * @description 交互界面控制器模块（v5 沉浸伴航 / 风暴炉火白噪音混音台 + 船长室舷窗版）：
 *              1. 左上角黄铜航海罗盘、实时遥测、24 小时昼夜滑块、防脱焦打舵按钮与「伴航解压」快捷入口；
 *              2. 右下角六大天气预设（含极地暴雪）、6 大机位切换（含船长室舷窗）、舷炮齐射、音效、画质与截图栏；
 *              3. 沉浸伴航模式（Z 键）：极简悬浮控制条（极地暴雪/雷暴夜航/星夜暖灯、船长室舷窗/自动慢镜）、
 *                 5 轨独立白噪音混音台与 15/30/60 分钟定时助眠渐弱淡出。
 */

import { WEATHER_MODES } from '../state/weatherState.js';

export const UI_ICONS = {
  noon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="4.2"/>
    <line x1="12" y1="2.2" x2="12" y2="4.6"/>
    <line x1="12" y1="19.4" x2="12" y2="21.8"/>
    <line x1="2.2" y1="12" x2="4.6" y2="12"/>
    <line x1="19.4" y1="12" x2="21.8" y2="12"/>
    <line x1="5.1" y1="5.1" x2="6.8" y2="6.8"/>
    <line x1="17.2" y1="17.2" x2="18.9" y2="18.9"/>
    <line x1="18.9" y1="5.1" x2="17.2" y2="6.8"/>
    <line x1="6.8" y1="17.2" x2="5.1" y2="18.9"/>
  </svg>`,
  sunset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6.8 14.5a5.2 5.2 0 0 1 10.4 0"/>
    <line x1="12" y1="4.2" x2="12" y2="6.4"/>
    <line x1="5.4" y1="7.4" x2="7.0" y2="9.0"/>
    <line x1="18.6" y1="7.4" x2="17.0" y2="9.0"/>
    <line x1="2.5" y1="14.5" x2="21.5" y2="14.5"/>
    <path d="M3.5 18.2c2.2-1.1 4.2 1.1 6.4 0s4.2-1.1 6.4 0 2.8 0.8 4.2 0"/>
  </svg>`,
  night: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19.2 14.6A7.6 7.6 0 0 1 9.4 4.8a7.6 7.6 0 1 0 9.8 9.8z"/>
    <path d="M16.5 4.2l0.6 1.4 1.4 0.6-1.4 0.6-0.6 1.4-0.6-1.4-1.4-0.6 1.4-0.6z"/>
  </svg>`,
  storm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6.5 15.2a4.2 4.2 0 0 1-.4-8.3 5.6 5.6 0 0 1 10.7-1.2 3.8 3.8 0 0 1 .9 7.5"/>
    <polyline points="12.6 12.2 9.6 16.8 13.0 16.8 10.6 21.4"/>
  </svg>`,
  blizzard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="2.5" x2="12" y2="21.5"/>
    <line x1="3.8" y1="7.2" x2="20.2" y2="16.8"/>
    <line x1="20.2" y1="7.2" x2="3.8" y2="16.8"/>
    <polyline points="9.5 4.8 12 7.2 14.5 4.8"/>
    <polyline points="9.5 19.2 12 16.8 14.5 19.2"/>
  </svg>`,
  tsunami: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.5 18.8c3.2 0 5.6-2.4 6.6-5.8 1.1-3.8 4.2-6.8 8.1-6.8 2.4 0 4.0 1.4 3.8 3.3-.2 1.7-1.8 2.7-3.4 2.2-1.2-.4-1.8-1.6-1.2-2.6"/>
    <path d="M11.6 14.6c1.5 2.6 4.4 4.2 8.9 4.2"/>
    <path d="M3.2 21.2c3.8-.9 6.6.9 10.4 0 2.8-.7 4.8.4 7.2 0"/>
  </svg>`,
  ambient: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3.2c2.2 3.2 5.2 5.4 5.2 9.2a5.2 5.2 0 0 1-10.4 0c0-2.1 1-3.8 2.1-5.2.3 1.4 1.2 2.2 2.1 2.4-.5-2.1-.1-4.3 1-6.4z"/>
    <line x1="5" y1="20.2" x2="19" y2="20.2"/>
  </svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.2 12s3.6-6.2 9.8-6.2 9.8 6.2 9.8 6.2-3.6 6.2-9.8 6.2S2.2 12 2.2 12z"/>
    <circle cx="12" cy="12" r="3.1"/>
  </svg>`,
  cannon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3.5 14.2l11.8-4.4 1.6 4.1-11.8 4.4z"/>
    <circle cx="8.2" cy="18.2" r="2.4"/>
    <path d="M5.2 18.2h6.2"/>
    <line x1="18.6" y1="8.8" x2="21.5" y2="7.2"/>
    <line x1="19.2" y1="11.2" x2="22" y2="11.4"/>
    <line x1="17.6" y1="6.8" x2="19.2" y2="4.4"/>
  </svg>`,
  shot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 7.5h3l1.6-2h6.8l1.6 2h3A1.8 1.8 0 0 1 21.8 9.3v8.4a1.8 1.8 0 0 1-1.8 1.8H4a1.8 1.8 0 0 1-1.8-1.8V9.3A1.8 1.8 0 0 1 4 7.5z"/>
    <circle cx="12" cy="13.3" r="3.4"/>
  </svg>`,
  cycle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="17 2.8 20.5 6.3 17 9.8"/>
    <path d="M3.8 11.2V9.5a3.2 3.2 0 0 1 3.2-3.2h13.5"/>
    <polyline points="7 21.2 3.5 17.7 7 14.2"/>
    <path d="M20.2 12.8v1.7a3.2 3.2 0 0 1-3.2 3.2H3.5"/>
  </svg>`,
  audioOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5"/>
    <line x1="21.5" y1="9" x2="15.5" y2="15"/>
    <line x1="15.5" y1="9" x2="21.5" y2="15"/>
  </svg>`,
  audioOn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5"/>
    <path d="M15.2 8.6a4.8 4.8 0 0 1 0 6.8"/>
    <path d="M18.4 5.8a8.8 8.8 0 0 1 0 12.4"/>
  </svg>`,
  quality: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>`,
};

const MODE_LABELS = {
  noon: '正午晴空 (1)',
  sunset: '日落余晖 (2)',
  night: '星夜极光 (3)',
  storm: '雷暴骤雨 (4)',
  blizzard: '极地暴雪 (5)',
  tsunami: '滔天海啸 (6)',
};

const CAMERA_LABELS = {
  orbit: '自由环绕',
  helm: '舵轮船长',
  bow: '船首破浪',
  crow: '桅顶瞭望',
  cinema: '电影巡航',
  cabin: '船长室舷窗',
};

const COMPASS_CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function formatHour(h) {
  const totalMin = Math.round((((h % 24) + 24) % 24) * 60);
  const hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatCountdown(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function createHudAndControls(weather, audio, actions = {}) {
  const toastEl = document.createElement('div');
  toastEl.className = 'agy-toast';
  document.body.appendChild(toastEl);
  let toastTimer = null;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('agy-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('agy-show'), 2300);
  }

  // 船长室复古木框舷窗覆盖层（仅在 cabin 视角显现）
  const cabinFrame = document.createElement('div');
  cabinFrame.id = 'agy-cabin-frame';
  cabinFrame.innerHTML = `
    <div class="agy-cabin-warmth"></div>
    <svg class="agy-cabin-svg" viewBox="0 0 1600 900" preserveAspectRatio="none">
      <defs>
        <linearGradient id="oakWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2b180d"/>
          <stop offset="50%" stop-color="#1b0e07"/>
          <stop offset="100%" stop-color="#120804"/>
        </linearGradient>
        <linearGradient id="warmEdge" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#ff9944" stop-opacity="0.48"/>
          <stop offset="100%" stop-color="#6e3a18" stop-opacity="0.12"/>
        </linearGradient>
      </defs>
      <!-- 外围深橡木窗框 -->
      <path d="M0,0 H1600 V900 H0 Z M95,72 C95,52 125,44 165,44 H1435 C1475,44 1505,52 1505,72 V788 C1505,816 1478,832 1435,832 H165 C122,832 95,816 95,788 Z" fill="url(#oakWood)" fill-rule="evenodd"/>
      <!-- 窗框暖光内斜边 -->
      <rect x="95" y="44" width="1410" height="788" rx="28" fill="none" stroke="url(#warmEdge)" stroke-width="5"/>
      <!-- 竖向与横向复古木窗棂 -->
      <rect x="520" y="44" width="22" height="788" fill="url(#oakWood)"/>
      <rect x="1058" y="44" width="22" height="788" fill="url(#oakWood)"/>
      <rect x="95" y="540" width="1410" height="18" fill="url(#oakWood)"/>
      <!-- 窗棂暖光边缘线 -->
      <line x1="542" y1="44" x2="542" y2="832" stroke="#d8823c" stroke-opacity="0.28" stroke-width="2"/>
      <line x1="1058" y1="44" x2="1058" y2="832" stroke="#d8823c" stroke-opacity="0.28" stroke-width="2"/>
      <line x1="95" y1="540" x2="1505" y2="540" stroke="#e49448" stroke-opacity="0.32" stroke-width="2"/>
      <!-- 黄铜铆钉点缀 -->
      <circle cx="531" cy="549" r="5" fill="#c98e46" opacity="0.72"/>
      <circle cx="1069" cy="549" r="5" fill="#c98e46" opacity="0.72"/>
    </svg>
  `;
  document.body.appendChild(cabinFrame);

  const hud = document.createElement('div');
  hud.className = 'agy-hud';
  hud.setAttribute('role', 'region');
  hud.setAttribute('aria-label', '航海罗盘与航速仪');

  const compWrap = document.createElement('div');
  compWrap.className = 'agy-compass-wrap';
  compWrap.innerHTML = `<svg class="agy-compass-svg" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="18" fill="rgba(6,10,20,0.65)" stroke="rgba(255,210,142,0.45)" stroke-width="1.2"/>
    <circle cx="20" cy="20" r="14.5" fill="none" stroke="rgba(255,210,142,0.18)" stroke-width="0.8" stroke-dasharray="2 2.5"/>
    <text x="20" y="6.8" text-anchor="middle" fill="#ffd07a" font-size="5.2" font-weight="700">N</text>
    <g data-role="wind">
      <polygon points="20,1.2 22.1,5.2 17.9,5.2" fill="#74f2ff" opacity="0.88"/>
    </g>
    <g data-role="needle">
      <polygon points="20,6.5 22.4,20 20,18.2 17.6,20" fill="#ff6b4a"/>
      <polygon points="20,33.5 22.4,20 20,21.8 17.6,20" fill="#e8dcc8" opacity="0.85"/>
      <circle cx="20" cy="20" r="2.1" fill="#ffd07a"/>
    </g>
  </svg>`;
  const needleG = compWrap.querySelector('[data-role="needle"]');
  const windG = compWrap.querySelector('[data-role="wind"]');

  const hudCol = document.createElement('div');
  hudCol.className = 'agy-hud-col';
  const metricsRow = document.createElement('div');
  metricsRow.className = 'agy-hud-metrics';
  const hdgSpan = document.createElement('span');
  const dot1 = document.createElement('span');
  const spdSpan = document.createElement('span');
  const dot2 = document.createElement('span');
  const waveSpan = document.createElement('span');
  const dot3 = document.createElement('span');
  const rudderSpan = document.createElement('span');
  const dot4 = document.createElement('span');
  const effSpan = document.createElement('span');
  const dot5 = document.createElement('span');
  const lhSpan = document.createElement('span');
  const dot6 = document.createElement('span');
  const combatSpan = document.createElement('span');
  dot1.className = dot2.className = dot3.className = dot4.className = dot5.className = dot6.className = 'agy-hud-dot';
  dot1.textContent = dot2.textContent = dot3.textContent = dot4.textContent = dot5.textContent = dot6.textContent = '·';
  hdgSpan.textContent = 'N 000°';
  spdSpan.textContent = '15.2 节';
  waveSpan.textContent = '浪 1.8m';
  rudderSpan.textContent = '正舵 0°';
  effSpan.textContent = '帆效 94%';
  lhSpan.textContent = '灯塔 290m';
  combatSpan.textContent = '击沉 0 · 补给 0';
  metricsRow.append(
    hdgSpan, dot1, spdSpan, dot2, waveSpan, dot3, rudderSpan, dot4, effSpan, dot5, lhSpan, dot6, combatSpan
  );

  const subRow = document.createElement('div');
  subRow.className = 'agy-hud-sub';

  const portBtn = document.createElement('button');
  portBtn.type = 'button';
  portBtn.className = 'agy-mini-btn agy-steer-btn';
  portBtn.textContent = '‹ 左舵';
  portBtn.title = '左转掌舵 (A / ←)';

  const stbdBtn = document.createElement('button');
  stbdBtn.type = 'button';
  stbdBtn.className = 'agy-mini-btn agy-steer-btn';
  stbdBtn.textContent = '右舵 ›';
  stbdBtn.title = '右转掌舵 (D / →)';

  const camPill = document.createElement('button');
  camPill.type = 'button';
  camPill.className = 'agy-mini-btn';
  camPill.textContent = '视角：自由环绕 (V)';

  const bellMini = document.createElement('button');
  bellMini.type = 'button';
  bellMini.className = 'agy-mini-btn';
  bellMini.textContent = '船钟';
  bellMini.title = '敲响船首铜钟 (B)';

  const ambientMini = document.createElement('button');
  ambientMini.type = 'button';
  ambientMini.className = 'agy-mini-btn agy-ambient-trigger';
  ambientMini.textContent = '🔥 伴航解压 (Z)';
  ambientMini.title = '一键进入风暴炉火伴航白噪音模式 (Z)';

  const timeWrap = document.createElement('div');
  timeWrap.className = 'agy-time-wrap';
  const timeSlider = document.createElement('input');
  timeSlider.type = 'range';
  timeSlider.min = '0';
  timeSlider.max = '23.9';
  timeSlider.step = '0.1';
  timeSlider.value = String(weather.getTimeOfDay());
  timeSlider.className = 'agy-time-slider';
  timeSlider.title = '拖动调节 24 小时连续昼夜天光';
  const timeLbl = document.createElement('span');
  timeLbl.className = 'agy-time-lbl';
  timeLbl.textContent = formatHour(weather.getTimeOfDay());
  timeSlider.addEventListener('input', (ev) => {
    ev.stopPropagation();
    const h = parseFloat(timeSlider.value);
    timeLbl.textContent = formatHour(h);
    weather.setTimeOfDay(h);
  });
  timeWrap.append(timeSlider, timeLbl);

  subRow.append(portBtn, stbdBtn, camPill, bellMini, ambientMini, timeWrap);
  hudCol.append(metricsRow, subRow);
  hud.append(compWrap, hudCol);
  document.body.appendChild(hud);

  const dock = document.createElement('div');
  dock.className = 'agy-dock';
  dock.setAttribute('role', 'toolbar');
  dock.setAttribute('aria-label', '天气与交互控制栏');

  // --- 沉浸伴航无打扰控制条 + 5 轨白噪音混音台 ---
  const ambientWrap = document.createElement('div');
  ambientWrap.className = 'agy-ambient-wrap';

  const mixerPanel = document.createElement('div');
  mixerPanel.className = 'agy-mixer-panel';
  const mixerHeader = document.createElement('div');
  mixerHeader.className = 'agy-mixer-title';
  mixerHeader.innerHTML = '<span>白噪音多轨混音台</span><span style="opacity:0.65;font-weight:400;">实时独立调节</span>';
  mixerPanel.appendChild(mixerHeader);

  const mixerDefs = [
    { key: 'precip', label: '雨雪声', def: 1.0 },
    { key: 'wind', label: '狂风索具', def: 1.0 },
    { key: 'ocean', label: '深海涌浪', def: 1.0 },
    { key: 'hull', label: '船体碰撞', def: 1.0 },
    { key: 'fire', label: '炉火噼啪', def: 0.92 },
  ];
  const mixerSliders = new Map();
  for (const md of mixerDefs) {
    const row = document.createElement('div');
    row.className = 'agy-mixer-row';
    const lbl = document.createElement('label');
    lbl.textContent = md.label;
    const rng = document.createElement('input');
    rng.type = 'range';
    rng.min = '0';
    rng.max = '1.5';
    rng.step = '0.05';
    rng.value = String(md.def);
    const valSpan = document.createElement('span');
    valSpan.className = 'agy-mixer-val';
    valSpan.textContent = `${Math.round(md.def * 100)}%`;
    rng.addEventListener('input', (ev) => {
      ev.stopPropagation();
      const v = parseFloat(rng.value);
      valSpan.textContent = `${Math.round(v * 100)}%`;
      audio.setTrackGain(md.key, v);
      if (!audio.isEnabled() && v > 0) {
        audio.setEnabled(true);
        syncUI();
      }
    });
    row.append(lbl, rng, valSpan);
    mixerPanel.appendChild(row);
    mixerSliders.set(md.key, { rng, valSpan });
  }

  const sleepRow = document.createElement('div');
  sleepRow.className = 'agy-sleep-row';
  const sleepLbl = document.createElement('span');
  sleepLbl.textContent = '定时助眠淡出';
  const sleepBtnsWrap = document.createElement('div');
  sleepBtnsWrap.className = 'agy-sleep-btns';
  const sleepBtns = new Map();
  let selectedSleepMin = 0;
  for (const mins of [0, 15, 30, 60]) {
    const sb = document.createElement('button');
    sb.type = 'button';
    sb.className = 'agy-sleep-btn' + (mins === 0 ? ' agy-active' : '');
    sb.textContent = mins === 0 ? '关闭' : `${mins}分`;
    sb.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectedSleepMin = mins;
      audio.setSleepTimer(mins);
      for (const [m, bEl] of sleepBtns.entries()) bEl.classList.toggle('agy-active', m === mins);
      showToast(mins === 0 ? '已关闭助眠定时' : `已设 ${mins} 分钟定时，最后 1 分钟自动淡出`);
      syncUI();
    });
    sleepBtnsWrap.appendChild(sb);
    sleepBtns.set(mins, sb);
  }
  sleepRow.append(sleepLbl, sleepBtnsWrap);
  mixerPanel.appendChild(sleepRow);

  const ambBar = document.createElement('div');
  ambBar.className = 'agy-ambient-bar';

  const ambBlizBtn = document.createElement('button');
  ambBlizBtn.type = 'button';
  ambBlizBtn.className = 'agy-amb-pill';
  ambBlizBtn.textContent = '❄️ 极地暴雪';

  const ambStormBtn = document.createElement('button');
  ambStormBtn.type = 'button';
  ambStormBtn.className = 'agy-amb-pill';
  ambStormBtn.textContent = '⛈️ 雷暴夜航';

  const ambNightBtn = document.createElement('button');
  ambNightBtn.type = 'button';
  ambNightBtn.className = 'agy-amb-pill';
  ambNightBtn.textContent = '🌌 星夜暖灯';

  const ambViewBtn = document.createElement('button');
  ambViewBtn.type = 'button';
  ambViewBtn.className = 'agy-amb-pill';
  ambViewBtn.textContent = '🪟 船长室舷窗';

  const ambMixerBtn = document.createElement('button');
  ambMixerBtn.type = 'button';
  ambMixerBtn.className = 'agy-amb-pill';
  ambMixerBtn.textContent = '🎛️ 调音台';

  const sleepBadge = document.createElement('span');
  sleepBadge.className = 'agy-sleep-badge';

  const ambExitBtn = document.createElement('button');
  ambExitBtn.type = 'button';
  ambExitBtn.className = 'agy-amb-pill agy-amb-exit';
  ambExitBtn.textContent = '✕ 退出伴航';

  ambBar.append(ambBlizBtn, ambStormBtn, ambNightBtn, ambViewBtn, ambMixerBtn, sleepBadge, ambExitBtn);
  ambientWrap.append(mixerPanel, ambBar);
  document.body.appendChild(ambientWrap);

  let idleTimer = null;
  let ambIdleTimer = null;
  const wakeUI = () => {
    dock.classList.remove('agy-idle');
    hud.classList.remove('agy-idle');
    ambientWrap.classList.remove('agy-ambient-idle');
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      dock.classList.add('agy-idle');
      hud.classList.add('agy-idle');
    }, 3800);
    if (ambIdleTimer) clearTimeout(ambIdleTimer);
    ambIdleTimer = setTimeout(() => {
      if (!mixerPanel.classList.contains('agy-open')) {
        ambientWrap.classList.add('agy-ambient-idle');
      }
    }, 5200);
  };

  for (const bar of [dock, hud, ambientWrap]) {
    bar.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      wakeUI();
    });
    bar.addEventListener('pointerenter', wakeUI);
    bar.addEventListener('wheel', (ev) => ev.stopPropagation());
  }

  let keySteerLeft = false;
  let keySteerRight = false;
  let ptrSteer = 0;
  let throttleTrim = 1;

  function bindHoldSteer(btn, dir) {
    const release = (ev) => {
      if (ev && ev.pointerId !== undefined && btn.hasPointerCapture && btn.hasPointerCapture(ev.pointerId)) {
        try {
          btn.releasePointerCapture(ev.pointerId);
        } catch (_e) {}
      }
      if (ptrSteer === dir) ptrSteer = 0;
      btn.classList.remove('agy-held');
    };
    btn.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      wakeUI();
      ptrSteer = dir;
      btn.classList.add('agy-held');
      if (btn.setPointerCapture && ev.pointerId !== undefined) {
        try {
          btn.setPointerCapture(ev.pointerId);
        } catch (_e) {}
      }
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      wakeUI();
    });
  }
  bindHoldSteer(portBtn, 1);
  bindHoldSteer(stbdBtn, -1);

  const modeButtons = new Map();
  for (const mode of WEATHER_MODES) {
    const btn = document.createElement('button');
    const tip = MODE_LABELS[mode] || mode;
    btn.type = 'button';
    btn.className = 'agy-btn';
    btn.innerHTML = UI_ICONS[mode];
    btn.setAttribute('data-tip', tip);
    btn.setAttribute('aria-label', tip);
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      wakeUI();
      weather.setMode(mode, true);
      syncUI();
    });
    dock.appendChild(btn);
    modeButtons.set(mode, btn);
  }

  const sep1 = document.createElement('div');
  sep1.className = 'agy-sep';
  dock.appendChild(sep1);

  const ambientDockBtn = document.createElement('button');
  ambientDockBtn.type = 'button';
  ambientDockBtn.className = 'agy-btn';
  ambientDockBtn.innerHTML = UI_ICONS.ambient;
  ambientDockBtn.setAttribute('data-tip', '沉浸伴航 / 炉火解压模式 (Z)');
  ambientDockBtn.setAttribute('aria-label', '沉浸伴航模式 (Z)');
  dock.appendChild(ambientDockBtn);

  const camBtn = document.createElement('button');
  camBtn.type = 'button';
  camBtn.className = 'agy-btn';
  camBtn.innerHTML = UI_ICONS.camera;
  camBtn.setAttribute('data-tip', '切换视角：自由环绕 (V)');
  dock.appendChild(camBtn);

  const salvoBtn = document.createElement('button');
  salvoBtn.type = 'button';
  salvoBtn.className = 'agy-btn';
  salvoBtn.innerHTML = UI_ICONS.cannon;
  salvoBtn.setAttribute('data-tip', '齐射 (Space) · 左/右舷 (Q/E)');
  dock.appendChild(salvoBtn);

  const sep2 = document.createElement('div');
  sep2.className = 'agy-sep';
  dock.appendChild(sep2);

  const cycleBtn = document.createElement('button');
  cycleBtn.type = 'button';
  cycleBtn.className = 'agy-btn';
  cycleBtn.innerHTML = UI_ICONS.cycle;
  cycleBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    wakeUI();
    weather.toggleAutoCycle();
    syncUI();
  });
  dock.appendChild(cycleBtn);

  const audioBtn = document.createElement('button');
  audioBtn.type = 'button';
  audioBtn.className = 'agy-btn';
  audioBtn.innerHTML = UI_ICONS.audioOff;
  audioBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    wakeUI();
    audio.toggle();
    syncUI();
  });
  dock.appendChild(audioBtn);

  const qualityBtn = document.createElement('button');
  qualityBtn.type = 'button';
  qualityBtn.className = 'agy-btn';
  qualityBtn.innerHTML = UI_ICONS.quality;
  qualityBtn.setAttribute('data-tip', '画质：高 (G 切换)');
  dock.appendChild(qualityBtn);

  const shotBtn = document.createElement('button');
  shotBtn.type = 'button';
  shotBtn.className = 'agy-btn';
  shotBtn.innerHTML = UI_ICONS.shot;
  shotBtn.setAttribute('data-tip', '保存纯净截图 (P)');
  dock.appendChild(shotBtn);

  document.body.appendChild(dock);

  let curCamMode = 'orbit';
  let uiHidden = false;
  let ambientActive = false;
  let ambientAutoCam = false;

  function setAmbientMode(active) {
    ambientActive = !!active;
    document.body.classList.toggle('agy-ambient-active', ambientActive);
    audio.setAmbientMode(ambientActive);
    if (ambientActive) {
      // 自动切入解压天气（若当前为晴天或海啸则默认进入雷暴夜航）
      const m = weather.getMode();
      if (m !== 'blizzard' && m !== 'storm' && m !== 'night') {
        weather.setMode('storm', true);
      }
      // 自动开启白噪音并拉起温暖炉火声轨
      audio.setEnabled(true);
      audio.setTrackGain('fire', 0.92);
      const fireSlider = mixerSliders.get('fire');
      if (fireSlider) {
        fireSlider.rng.value = '0.92';
        fireSlider.valSpan.textContent = '92%';
      }
      ambientAutoCam = false;
      if (actions.setCameraMode) curCamMode = actions.setCameraMode('cabin');
      if (actions.setAmbientAutoCam) actions.setAmbientAutoCam(false);
      showToast('已进入沉浸伴航模式 · 船长室舷窗观风暴');
    } else {
      mixerPanel.classList.remove('agy-open');
      ambientAutoCam = false;
      if (actions.setAmbientAutoCam) actions.setAmbientAutoCam(false);
      if (curCamMode === 'cabin' && actions.setCameraMode) curCamMode = actions.setCameraMode('orbit');
      showToast('已退出伴航模式');
    }
    syncUI();
    wakeUI();
  }

  function doCycleCam() {
    wakeUI();
    if (actions.cycleCamera) {
      curCamMode = actions.cycleCamera();
      syncUI();
      const nm = CAMERA_LABELS[curCamMode] || curCamMode;
      showToast(
        curCamMode === 'cabin'
          ? '视角：船长室舷窗（隔窗听雨雪 · 拖拽环顾）'
          : curCamMode === 'orbit'
          ? `视角：${nm} (拖拽旋转 · 滚轮缩放)`
          : `视角：${nm} (拖拽环顾四周 · Q/E 单舷齐射)`
      );
    }
  }

  function doFireSalvo(sideFilter = 0) {
    wakeUI();
    if (actions.fireSalvo) {
      const ok = actions.fireSalvo(sideFilter);
      const label = sideFilter === 1 ? '左舷火炮齐射！' : sideFilter === -1 ? '右舷火炮齐射！' : '双舷 16 门火炮齐射！';
      showToast(ok ? label : '火炮正在装填弹药…');
    }
  }

  function doCycleQuality() {
    wakeUI();
    if (actions.cycleQuality) {
      const label = actions.cycleQuality();
      qualityBtn.setAttribute('data-tip', `画质：${label} (G 切换)`);
      showToast(`渲染画质已切换为：${label}`);
    }
  }

  function doRingBell() {
    wakeUI();
    if (actions.ringBell) actions.ringBell();
    showToast('当——当—— 船首铜钟鸣响');
  }

  function doScreenshot() {
    wakeUI();
    if (actions.takeScreenshot) actions.takeScreenshot();
    showToast('正在导出高清海景截图…');
  }

  function doToggleUI() {
    uiHidden = !uiHidden;
    document.body.classList.toggle('agy-ui-hidden', uiHidden);
    showToast(uiHidden ? '纯净观赏模式 · 按 H 恢复界面' : '控制界面已恢复');
  }

  ambientMini.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setAmbientMode(!ambientActive);
  });
  ambientDockBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setAmbientMode(!ambientActive);
  });
  ambBlizBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    weather.setMode('blizzard', true);
    showToast('极地暴雪 · 浮冰碰撞与极光风雪');
    syncUI();
  });
  ambStormBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    weather.setMode('storm', true);
    showToast('雷暴夜航 · 暴雨闪电与光声滚雷');
    syncUI();
  });
  ambNightBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    weather.setMode('night', true);
    showToast('星夜暖灯 · 深海涌浪与远海鲸鸣');
    syncUI();
  });
  ambViewBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (curCamMode === 'cabin') {
      ambientAutoCam = true;
      if (actions.setAmbientAutoCam) actions.setAmbientAutoCam(true);
      if (actions.setCameraMode) curCamMode = actions.setCameraMode('cinema');
      showToast('已切换为电影慢镜自动巡航');
    } else {
      ambientAutoCam = false;
      if (actions.setAmbientAutoCam) actions.setAmbientAutoCam(false);
      if (actions.setCameraMode) curCamMode = actions.setCameraMode('cabin');
      showToast('已切回船长室舷窗视角');
    }
    syncUI();
  });
  ambMixerBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    mixerPanel.classList.toggle('agy-open');
    ambMixerBtn.classList.toggle('agy-amb-active', mixerPanel.classList.contains('agy-open'));
    wakeUI();
  });
  ambExitBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setAmbientMode(false);
  });

  camBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doCycleCam();
  });
  camPill.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doCycleCam();
  });
  salvoBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doFireSalvo(0);
  });
  bellMini.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doRingBell();
  });
  qualityBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doCycleQuality();
  });
  shotBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    doScreenshot();
  });

  function syncUI() {
    const activeMode = weather.getMode();
    const isCustom = weather.isCustomTime();
    for (const [mKey, btn] of modeButtons.entries()) {
      const active = !isCustom && mKey === activeMode;
      const isCool = mKey === 'night' || mKey === 'blizzard';
      btn.classList.toggle('agy-active', active && !isCool);
      btn.classList.toggle('agy-active-cyan', active && isCool);
      btn.setAttribute('aria-pressed', String(active));
    }

    if (!isCustom) {
      const h = weather.getTimeOfDay();
      timeSlider.value = String(h);
      timeLbl.textContent = formatHour(h);
    }

    document.body.classList.toggle('agy-cabin-active', curCamMode === 'cabin');

    const cmName = CAMERA_LABELS[curCamMode] || '自由环绕';
    const cmTip = `切换视角：${cmName} (V)`;
    camBtn.classList.toggle('agy-active-cyan', curCamMode !== 'orbit');
    camBtn.setAttribute('data-tip', cmTip);
    camPill.textContent = `视角：${cmName} (V)`;

    ambBlizBtn.classList.toggle('agy-amb-active-ice', activeMode === 'blizzard');
    ambStormBtn.classList.toggle('agy-amb-active', activeMode === 'storm');
    ambNightBtn.classList.toggle('agy-amb-active-ice', activeMode === 'night');
    ambViewBtn.textContent = curCamMode === 'cabin' ? '🎥 切自动慢镜' : '🪟 船长室舷窗';
    ambViewBtn.classList.toggle('agy-amb-active', curCamMode === 'cabin');

    const cyc = weather.isAutoCycle();
    cycleBtn.classList.toggle('agy-active-cyan', cyc);
    cycleBtn.setAttribute('data-tip', cyc ? '自动轮播：开启 (C)' : '自动轮播：关闭 (C)');

    const aud = audio.isEnabled();
    audioBtn.innerHTML = aud ? UI_ICONS.audioOn : UI_ICONS.audioOff;
    audioBtn.classList.toggle('agy-active', aud);
    audioBtn.setAttribute('data-tip', aud ? '海浪音效：开启 (M)' : '海浪音效：关闭 (M)');
  }

  weather.onModeChange(() => syncUI());
  syncUI();
  window.addEventListener('pointermove', wakeUI, { passive: true });
  window.addEventListener('pointerdown', wakeUI, { passive: true });
  wakeUI();

  function isEditableTarget(tg) {
    return !!(tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable));
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || isEditableTarget(ev.target)) return;
    const key = ev.key.toLowerCase();

    if (key === 'a' || ev.key === 'ArrowLeft') {
      keySteerLeft = true;
      portBtn.classList.add('agy-held');
      return;
    }
    if (key === 'd' || ev.key === 'ArrowRight') {
      keySteerRight = true;
      stbdBtn.classList.add('agy-held');
      return;
    }
    if (key === 'w' || ev.key === 'ArrowUp') {
      throttleTrim = Math.min(1.24, throttleTrim + 0.08);
      showToast(`帆力推进：${Math.round(throttleTrim * 100)}%`);
      return;
    }
    if (key === 's' || ev.key === 'ArrowDown') {
      throttleTrim = Math.max(0.72, throttleTrim - 0.08);
      showToast(`帆力推进：${Math.round(throttleTrim * 100)}%`);
      return;
    }
    if (ev.repeat) return;

    if (key === 'escape' && ambientActive) {
      setAmbientMode(false);
    } else if (key === 'z') {
      setAmbientMode(!ambientActive);
    } else if (key >= '1' && key <= '6') {
      wakeUI();
      const idx = parseInt(key, 10) - 1;
      if (WEATHER_MODES[idx]) {
        weather.setMode(WEATHER_MODES[idx], true);
        syncUI();
      }
    } else if (key === 'c' || key === '0') {
      wakeUI();
      weather.toggleAutoCycle();
      syncUI();
    } else if (key === 'm') {
      wakeUI();
      audio.toggle();
      syncUI();
    } else if (key === 'v') {
      doCycleCam();
    } else if (key === 'q') {
      doFireSalvo(1);
    } else if (key === 'e') {
      doFireSalvo(-1);
    } else if (ev.code === 'Space' || key === ' ' || key === 'f') {
      ev.preventDefault();
      doFireSalvo(0);
    } else if (key === 'b') {
      doRingBell();
    } else if (key === 'g') {
      doCycleQuality();
    } else if (key === 'h') {
      doToggleUI();
    } else if (key === 'p') {
      doScreenshot();
    }
  });

  window.addEventListener('keyup', (ev) => {
    const key = ev.key.toLowerCase();
    if (key === 'a' || ev.key === 'ArrowLeft') {
      keySteerLeft = false;
      portBtn.classList.remove('agy-held');
    }
    if (key === 'd' || ev.key === 'ArrowRight') {
      keySteerRight = false;
      stbdBtn.classList.remove('agy-held');
    }
  });

  window.addEventListener('blur', () => {
    keySteerLeft = false;
    keySteerRight = false;
    ptrSteer = 0;
    portBtn.classList.remove('agy-held');
    stbdBtn.classList.remove('agy-held');
  });

  return {
    dock,
    hud,
    syncUI,
    showToast,
    isAmbientActive: () => ambientActive,
    setCamModeLabel(mode) {
      curCamMode = mode;
      syncUI();
    },
    getSteerInput: () => (ptrSteer !== 0 ? ptrSteer : (keySteerLeft ? 1 : 0) - (keySteerRight ? 1 : 0)),
    getThrottle: () => throttleTrim,
    updateHUD(hdgRad, windWorldRad, knots, waveM, salvoCooldown, sailEffPct = 94, lighthouseDist = 290, rudderRad = 0, stats = null) {
      const deg = ((Math.round((hdgRad * 180) / Math.PI) % 360) + 360) % 360;
      const dirStr = COMPASS_CARDINALS[Math.round(deg / 45) % 8];
      hdgSpan.textContent = `${dirStr} ${String(deg).padStart(3, '0')}°`;
      spdSpan.textContent = `${knots.toFixed(1)} 节`;
      waveSpan.textContent = `浪 ${waveM.toFixed(1)}m`;

      const rudDeg = Math.round((rudderRad * 180) / Math.PI);
      rudderSpan.textContent = rudDeg > 1 ? `左舵 ${rudDeg}°` : rudDeg < -1 ? `右舵 ${-rudDeg}°` : '正舵 0°';
      effSpan.textContent = `帆效 ${sailEffPct}%`;
      lhSpan.textContent = lighthouseDist < 55 ? `浅滩 ${Math.round(lighthouseDist)}m!` : `灯塔 ${Math.round(lighthouseDist)}m`;
      if (stats) {
        combatSpan.textContent = `击沉 ${stats.sinks} · 补给 ${stats.salvaged}${stats.speedBoost ? ' ⚡' : ''}`;
      }

      const sleepRem = audio.getSleepRemainingSec ? audio.getSleepRemainingSec() : 0;
      if (sleepRem > 0.5) {
        sleepBadge.textContent = `⏳ ${formatCountdown(sleepRem)}`;
        sleepBadge.classList.add('agy-visible');
      } else {
        sleepBadge.classList.remove('agy-visible');
      }

      needleG.setAttribute('transform', `rotate(${(-deg).toFixed(1)} 20 20)`);
      const relWindDeg = (((((windWorldRad - hdgRad) * 180) / Math.PI) % 360) + 360) % 360;
      windG.setAttribute('transform', `rotate(${relWindDeg.toFixed(1)} 20 20)`);
      salvoBtn.classList.toggle('agy-cooldown', salvoCooldown > 0.05);
    },
  };
}
