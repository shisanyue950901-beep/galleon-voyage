/**
 * @file maritimeAudio.js
 * @description 纯 Web Audio API 程序化多轨海洋白噪音与空间声景合成器（v5 沉浸伴航混音台版）：
 *              1. 5 轨独立白噪音混音（雨雪 precip / 狂风 wind / 涌浪 ocean / 船体与碰撞 hull / 暖炉噼啪 fire）；
 *              2. 舱内/舷窗低通隔音总线（cabinLPF）：在船长室舷窗视角下室外风暴自然闷响，屋内炉火与木壳吱呀保持通透；
 *              3. 物理碰撞音效联动：大浪拍船首闷响、暴雪浮冰擦碰碎裂、光声延迟 3D 滚雷、黄铜灯链摇晃轻响；
 *              4. 支持 15/30/60 分钟定时助眠渐弱淡出与后台自动挂起省电。
 */

import * as THREE from 'three';

export function createMaritimeAudio() {
  let ctx = null;
  let enabled = false;
  let masterGain = null;
  let exteriorBus = null;
  let interiorBus = null;
  let cabinLPF = null;

  let swellFilter = null;
  let swellGain = null;
  let washFilter = null;
  let washGain = null;
  let windFilter1 = null;
  let windFilter2 = null;
  let windGain = null;
  let rainCurtainGain = null;
  let rainPatterFilter = null;
  let rainPatterGain = null;
  let snowFilter = null;
  let snowGain = null;
  let fireRumbleGain = null;
  let fireHissGain = null;

  let pinkBuffer = null;
  let creakTimer = 0;
  let gullTimer = 6.5;
  let crackleTimer = 0.25;
  let rainDropTimer = 0.08;
  let lanternChimeTimer = 1.8;
  let sailSnapTimer = 3.2;
  let suspendTimer = null;

  let cabinMuffleTarget = 0;
  let ambientModeActive = false;
  let masterVolume = 0.58;
  let sleepTotalSec = 0;
  let sleepRemainingSec = 0;

  // 5 轨独立混音增益（0..1.5）
  const trackGains = {
    precip: 1.0,
    wind: 1.0,
    ocean: 1.0,
    hull: 1.0,
    fire: 0.42,
  };

  function createPanner(panVal) {
    if (!ctx || typeof ctx.createStereoPanner !== 'function') return null;
    const sp = ctx.createStereoPanner();
    sp.pan.value = THREE.MathUtils.clamp(panVal || 0, -0.95, 0.95);
    return sp;
  }

  function routeToBus(sourceNode, panVal, isInterior = false) {
    const dest = isInterior ? interiorBus : exteriorBus;
    const sp = createPanner(panVal);
    if (sp) {
      sourceNode.connect(sp);
      sp.connect(dest);
      return sp;
    }
    sourceNode.connect(dest);
    return null;
  }

  function ensureAudioGraph() {
    if (ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    // 舱外声音经过可调隔音低通滤波器（船长室舷窗视角下自动压低高频，营造温暖庇护感）
    cabinLPF = ctx.createBiquadFilter();
    cabinLPF.type = 'lowpass';
    cabinLPF.frequency.value = 18000;
    cabinLPF.Q.value = 0.65;
    cabinLPF.connect(masterGain);

    exteriorBus = ctx.createGain();
    exteriorBus.gain.value = 1.0;
    exteriorBus.connect(cabinLPF);

    // 舱内/船体近场声音（炉火噼啪、木壳受力吱呀、铜灯链条）直通主总线
    interiorBus = ctx.createGain();
    interiorBus.gain.value = 1.0;
    interiorBus.connect(masterGain);

    // 生成首尾等功率无缝交叉淡化的 4 秒双声道粉红噪音缓冲
    const sr = ctx.sampleRate;
    const bufLen = sr * 4;
    const fadeLen = Math.min(8192, bufLen >> 2);
    const totalLen = bufLen + fadeLen;
    const raw = new Float32Array(totalLen);
    pinkBuffer = ctx.createBuffer(2, bufLen, sr);

    for (let ch = 0; ch < 2; ch++) {
      const out = pinkBuffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < totalLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      const bodyEnd = bufLen - fadeLen;
      for (let i = 0; i < bodyEnd; i++) out[i] = raw[i + fadeLen];
      for (let k = 0; k < fadeLen; k++) {
        const ang = ((k + 1) / (fadeLen + 1)) * (Math.PI * 0.5);
        out[bodyEnd + k] = raw[bufLen + k] * Math.cos(ang) + raw[k] * Math.sin(ang);
      }
    }

    const startLoopSource = (offsetSec = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = pinkBuffer;
      src.loop = true;
      src.start(0, offsetSec);
      return src;
    };

    // 1. 深海涌浪低频层
    const swellSrc = startLoopSource(0);
    swellFilter = ctx.createBiquadFilter();
    swellFilter.type = 'lowpass';
    swellFilter.frequency.value = 310;
    swellFilter.Q.value = 0.85;
    swellGain = ctx.createGain();
    swellGain.gain.value = 0.34;
    swellSrc.connect(swellFilter);
    swellFilter.connect(swellGain);
    swellGain.connect(exteriorBus);

    // 2. 船首劈浪白沫层
    const washSrc = startLoopSource(1.1);
    washFilter = ctx.createBiquadFilter();
    washFilter.type = 'bandpass';
    washFilter.frequency.value = 1150;
    washFilter.Q.value = 0.7;
    washGain = ctx.createGain();
    washGain.gain.value = 0.1;
    washSrc.connect(washFilter);
    washFilter.connect(washGain);
    washGain.connect(exteriorBus);

    // 3. 索具呼啸风声双共振峰层
    const windSrc = startLoopSource(2.3);
    windFilter1 = ctx.createBiquadFilter();
    windFilter1.type = 'bandpass';
    windFilter1.frequency.value = 430;
    windFilter1.Q.value = 4.2;
    windFilter2 = ctx.createBiquadFilter();
    windFilter2.type = 'bandpass';
    windFilter2.frequency.value = 760;
    windFilter2.Q.value = 5.5;
    windGain = ctx.createGain();
    windGain.gain.value = 0.08;
    windSrc.connect(windFilter1);
    windSrc.connect(windFilter2);
    windFilter1.connect(windGain);
    windFilter2.connect(windGain);
    windGain.connect(exteriorBus);

    // 4a. 远海雨幕中频白噪音层
    const rainSrc = startLoopSource(0.6);
    const rainCurtainFilter = ctx.createBiquadFilter();
    rainCurtainFilter.type = 'bandpass';
    rainCurtainFilter.frequency.value = 1650;
    rainCurtainFilter.Q.value = 0.55;
    rainCurtainGain = ctx.createGain();
    rainCurtainGain.gain.value = 0;
    rainSrc.connect(rainCurtainFilter);
    rainCurtainFilter.connect(rainCurtainGain);
    rainCurtainGain.connect(exteriorBus);

    // 4b. 雨滴敲击硬木甲板高频层
    const rainPatSrc = startLoopSource(1.85);
    rainPatterFilter = ctx.createBiquadFilter();
    rainPatterFilter.type = 'highpass';
    rainPatterFilter.frequency.value = 3100;
    rainPatterGain = ctx.createGain();
    rainPatterGain.gain.value = 0;
    rainPatSrc.connect(rainPatterFilter);
    rainPatterFilter.connect(rainPatterGain);
    rainPatterGain.connect(exteriorBus);

    // 4c. 极地暴雪干燥冰晶风雪摩擦层
    const snowSrc = startLoopSource(2.9);
    snowFilter = ctx.createBiquadFilter();
    snowFilter.type = 'bandpass';
    snowFilter.frequency.value = 2650;
    snowFilter.Q.value = 1.65;
    snowGain = ctx.createGain();
    snowGain.gain.value = 0;
    snowSrc.connect(snowFilter);
    snowFilter.connect(snowGain);
    snowGain.connect(exteriorBus);

    // 5. 船尾防风炭火盆 / 舱内暖炉底噪（温暖低频火苗 + 细微气流嘶鸣）
    const fireLowSrc = startLoopSource(0.35);
    const fireLowLP = ctx.createBiquadFilter();
    fireLowLP.type = 'lowpass';
    fireLowLP.frequency.value = 215;
    fireLowLP.Q.value = 1.1;
    fireRumbleGain = ctx.createGain();
    fireRumbleGain.gain.value = 0;
    fireLowSrc.connect(fireLowLP);
    fireLowLP.connect(fireRumbleGain);
    fireRumbleGain.connect(interiorBus);

    const fireMidSrc = startLoopSource(1.7);
    const fireMidBP = ctx.createBiquadFilter();
    fireMidBP.type = 'bandpass';
    fireMidBP.frequency.value = 880;
    fireMidBP.Q.value = 0.9;
    fireHissGain = ctx.createGain();
    fireHissGain.gain.value = 0;
    fireMidSrc.connect(fireMidBP);
    fireMidBP.connect(fireHissGain);
    fireHissGain.connect(interiorBus);

    document.addEventListener('visibilitychange', () => {
      if (!ctx || !enabled) return;
      if (document.hidden) {
        if (ctx.state === 'running') ctx.suspend();
      } else if (ctx.state === 'suspended') {
        ctx.resume();
      }
    });
  }

  /** 温暖木柴爆裂噼啪声（炉火/篝火核心白噪音脉冲） */
  function triggerFireCrackle(level = 1) {
    if (!ctx || !enabled || !pinkBuffer || ctx.state !== 'running') return;
    if (trackGains.fire <= 0.02) return;
    const t0 = ctx.currentTime;
    const burstCount = Math.random() > 0.65 ? 2 : 1;
    for (let b = 0; b < burstCount; b++) {
      const startT = t0 + b * (0.028 + Math.random() * 0.045);
      const dur = 0.016 + Math.random() * 0.028;
      const src = ctx.createBufferSource();
      src.buffer = pinkBuffer;
      src.playbackRate.value = 1.35 + Math.random() * 1.1;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2200 + Math.random() * 3400;
      bp.Q.value = 2.4 + Math.random() * 2.5;

      const gn = ctx.createGain();
      const peak = (0.055 + Math.random() * 0.075) * level * trackGains.fire;
      gn.gain.setValueAtTime(0.0005, startT);
      gn.gain.linearRampToValueAtTime(peak, startT + 0.003);
      gn.gain.exponentialRampToValueAtTime(0.0004, startT + dur);

      const sp = routeToBus(gn, (Math.random() - 0.5) * 0.55, true);
      src.connect(bp);
      bp.connect(gn);
      src.onended = () => {
        src.disconnect();
        bp.disconnect();
        gn.disconnect();
        if (sp) sp.disconnect();
      };
      src.start(startT, Math.random() * 3.2);
      src.stop(startT + dur + 0.01);
    }
  }

  /** 窗玻璃/木篷雨滴轻敲脉冲 */
  function triggerRainTap(rainAmt = 1) {
    if (!ctx || !enabled || ctx.state !== 'running') return;
    if (trackGains.precip <= 0.02) return;
    const t0 = ctx.currentTime;
    const dur = 0.022 + Math.random() * 0.018;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 980 + Math.random() * 1350;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.52, t0 + dur);

    const gn = ctx.createGain();
    const peak = (0.008 + Math.random() * 0.012) * rainAmt * trackGains.precip * (0.65 + cabinMuffleTarget * 0.75);
    gn.gain.setValueAtTime(0.0002, t0);
    gn.gain.linearRampToValueAtTime(peak, t0 + 0.0025);
    gn.gain.exponentialRampToValueAtTime(0.0002, t0 + dur);

    const sp = routeToBus(gn, (Math.random() - 0.5) * 1.4, cabinMuffleTarget > 0.45);
    osc.connect(gn);
    osc.onended = () => {
      osc.disconnect();
      gn.disconnect();
      if (sp) sp.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  /** 暴雪浮冰擦碰与碎裂声（真实物理碰撞同步触发） */
  function triggerIceCrunch(intensity = 0.8, pan = 0) {
    if (!ctx || !enabled || !pinkBuffer || ctx.state !== 'running') return;
    const gainScale = Math.min(1.4, Math.max(0.2, intensity)) * trackGains.hull;
    if (gainScale <= 0.02) return;
    const t0 = ctx.currentTime;

    // 1. 冰块碎裂高频脆响
    const dur = 0.28 + Math.random() * 0.24;
    const src = ctx.createBufferSource();
    src.buffer = pinkBuffer;
    src.playbackRate.value = 1.4 + Math.random() * 0.55;

    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(3400 + Math.random() * 1200, t0);
    hp.frequency.exponentialRampToValueAtTime(1150, t0 + dur);
    hp.Q.value = 2.2;

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0008, t0);
    ng.gain.linearRampToValueAtTime(0.22 * gainScale, t0 + 0.012);
    ng.gain.exponentialRampToValueAtTime(0.04 * gainScale, t0 + 0.08);
    ng.gain.linearRampToValueAtTime(0.11 * gainScale, t0 + 0.14);
    ng.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);

    // 2. 船体撞击冰体的沉闷木壳共振
    const thud = ctx.createOscillator();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(118 + Math.random() * 25, t0);
    thud.frequency.exponentialRampToValueAtTime(42, t0 + 0.22);

    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.001, t0);
    tg.gain.linearRampToValueAtTime(0.18 * gainScale, t0 + 0.009);
    tg.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.24);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    const sp = routeToBus(bus, pan, true);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(bus);
    thud.connect(tg);
    tg.connect(bus);

    src.onended = () => {
      src.disconnect();
      hp.disconnect();
      ng.disconnect();
      bus.disconnect();
      if (sp) sp.disconnect();
    };
    thud.onended = () => {
      thud.disconnect();
      tg.disconnect();
    };
    src.start(t0, Math.random() * 2.5);
    src.stop(t0 + dur + 0.02);
    thud.start(t0);
    thud.stop(t0 + 0.26);
  }

  /** 大浪狠砸船首（Bow Slam）低频撞击 + 泼水声 */
  function triggerBowSlam(intensity = 0.85, pan = 0) {
    if (!ctx || !enabled || !pinkBuffer || ctx.state !== 'running') return;
    const s = Math.min(1.35, Math.max(0.2, intensity)) * Math.max(trackGains.ocean, trackGains.hull * 0.7);
    if (s <= 0.02) return;
    const t0 = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(92, t0);
    thud.frequency.exponentialRampToValueAtTime(34, t0 + 0.32);

    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.001, t0);
    tg.gain.linearRampToValueAtTime(0.26 * s, t0 + 0.015);
    tg.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.35);

    const splashSrc = ctx.createBufferSource();
    splashSrc.buffer = pinkBuffer;
    splashSrc.playbackRate.value = 0.88 + Math.random() * 0.22;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1180, t0);
    bp.frequency.exponentialRampToValueAtTime(380, t0 + 0.95);
    bp.Q.value = 0.9;

    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.001, t0);
    sg.gain.linearRampToValueAtTime(0.22 * s, t0 + 0.045);
    sg.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.05);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    const sp = routeToBus(bus, pan, false);
    thud.connect(tg);
    tg.connect(bus);
    splashSrc.connect(bp);
    bp.connect(sg);
    sg.connect(bus);

    splashSrc.onended = () => {
      splashSrc.disconnect();
      bp.disconnect();
      sg.disconnect();
      bus.disconnect();
      if (sp) sp.disconnect();
    };
    thud.onended = () => {
      thud.disconnect();
      tg.disconnect();
    };
    thud.start(t0);
    thud.stop(t0 + 0.38);
    splashSrc.start(t0, Math.random() * 2.2);
    splashSrc.stop(t0 + 1.08);
  }

  /** 黄铜风灯铁链摇晃轻响 */
  function triggerLanternChime(strength = 0.5) {
    if (!ctx || !enabled || ctx.state !== 'running') return;
    if (trackGains.hull <= 0.02) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const f = 2650 + Math.random() * 680;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 0.92, t0 + 0.16);
    const gn = ctx.createGain();
    const peak = 0.008 * Math.min(1, strength) * trackGains.hull;
    gn.gain.setValueAtTime(0.0002, t0);
    gn.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0002, t0 + 0.18);
    const sp = routeToBus(gn, (Math.random() - 0.5) * 0.6, true);
    osc.connect(gn);
    osc.onended = () => {
      osc.disconnect();
      gn.disconnect();
      if (sp) sp.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  /** 强风帆布闷响拍打 */
  function triggerSailSnap(strength = 0.6) {
    if (!ctx || !enabled || !pinkBuffer || ctx.state !== 'running') return;
    if (trackGains.wind <= 0.02) return;
    const t0 = ctx.currentTime;
    const dur = 0.22;
    const src = ctx.createBufferSource();
    src.buffer = pinkBuffer;
    src.playbackRate.value = 0.55 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(340, t0);
    lp.frequency.exponentialRampToValueAtTime(110, t0 + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.001, t0);
    gn.gain.linearRampToValueAtTime(0.11 * strength * trackGains.wind, t0 + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    const sp = routeToBus(gn, (Math.random() - 0.5) * 0.7, false);
    src.connect(lp);
    lp.connect(gn);
    src.onended = () => {
      src.disconnect();
      lp.disconnect();
      gn.disconnect();
      if (sp) sp.disconnect();
    };
    src.start(t0, Math.random() * 2.5);
    src.stop(t0 + dur + 0.02);
  }

  function triggerHullCreak(strength = 0.5) {
    if (!ctx || !enabled || ctx.state !== 'running') return;
    if (trackGains.hull <= 0.02) return;
    const t0 = ctx.currentTime;
    const dur = 0.35 + Math.random() * 0.35;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f0 = 72 + Math.random() * 42;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f0 * (0.78 + Math.random() * 0.4), t0 + dur);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 340 + Math.random() * 220;
    bp.Q.value = 6.5;

    const gn = ctx.createGain();
    const peak = 0.024 * Math.min(1, strength) * trackGains.hull;
    gn.gain.setValueAtTime(1e-4, t0);
    gn.gain.linearRampToValueAtTime(peak, t0 + dur * 0.25);
    gn.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);

    osc.connect(bp);
    bp.connect(gn);
    const sp = routeToBus(gn, (Math.random() - 0.5) * 0.7, true);
    osc.onended = () => {
      osc.disconnect();
      bp.disconnect();
      gn.disconnect();
      if (sp) sp.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 支持真实光声延迟与近/远雷声学形态差异的 3D 滚雷 */
  function triggerThunder(strength = 1, pan = 0, delaySec = 0.22) {
    if (!ctx || !enabled || !pinkBuffer || ctx.state !== 'running') return;
    if (trackGains.precip <= 0.02) return;
    const t0 = ctx.currentTime + Math.max(0.06, delaySec);
    const isClose = delaySec < 0.95;
    const dur = (isClose ? 3.2 : 4.2) + Math.random() * 1.6;
    const src = ctx.createBufferSource();
    src.buffer = pinkBuffer;
    src.playbackRate.value = (isClose ? 0.58 : 0.42) + Math.random() * 0.14;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(isClose ? 1480 : 620, t0);
    lp.frequency.exponentialRampToValueAtTime(135, t0 + 0.48);
    lp.frequency.exponentialRampToValueAtTime(52, t0 + dur);

    const subOsc = ctx.createOscillator();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(isClose ? 62 : 48, t0);
    subOsc.frequency.exponentialRampToValueAtTime(26, t0 + 2.0);

    const nGain = ctx.createGain();
    const peak = 0.62 * strength * Math.min(1.25, trackGains.precip);
    nGain.gain.setValueAtTime(0.001, t0);
    nGain.gain.linearRampToValueAtTime(peak, t0 + (isClose ? 0.03 : 0.12));
    nGain.gain.exponentialRampToValueAtTime(peak * 0.46, t0 + 0.34);
    nGain.gain.linearRampToValueAtTime(peak * 0.72, t0 + 0.62);
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.001, t0);
    sGain.gain.linearRampToValueAtTime(0.24 * strength * Math.min(1.25, trackGains.precip), t0 + 0.08);
    sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 2.25);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    const sp = routeToBus(bus, pan, false);

    src.connect(lp);
    lp.connect(nGain);
    nGain.connect(bus);
    subOsc.connect(sGain);
    sGain.connect(bus);

    src.onended = () => {
      src.disconnect();
      lp.disconnect();
      nGain.disconnect();
      bus.disconnect();
      if (sp) sp.disconnect();
    };
    subOsc.onended = () => {
      subOsc.disconnect();
      sGain.disconnect();
    };
    src.start(t0, Math.random() * 1.2);
    src.stop(t0 + dur + 0.05);
    subOsc.start(t0);
    subOsc.stop(t0 + 2.3);
  }

  function triggerCannon(pan = 0, delay = 0, scale = 1) {
    if (!ctx || !enabled || !pinkBuffer || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + Math.max(0, delay);
    const dur = 1.25 + Math.random() * 0.35;

    const ns = ctx.createBufferSource();
    ns.buffer = pinkBuffer;
    ns.playbackRate.value = 0.68 + Math.random() * 0.22;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1950, t0);
    lp.frequency.exponentialRampToValueAtTime(240, t0 + 0.18);
    lp.frequency.exponentialRampToValueAtTime(95, t0 + dur);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.001, t0);
    ng.gain.linearRampToValueAtTime(0.48 * scale, t0 + 0.012);
    ng.gain.exponentialRampToValueAtTime(0.14 * scale, t0 + 0.16);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(132 + Math.random() * 18, t0);
    osc.frequency.exponentialRampToValueAtTime(31, t0 + 0.36);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0.001, t0);
    og.gain.linearRampToValueAtTime(0.44 * scale, t0 + 0.008);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    const sp = routeToBus(bus, pan, false);

    ns.connect(lp);
    lp.connect(ng);
    ng.connect(bus);
    osc.connect(og);
    og.connect(bus);

    ns.onended = () => {
      ns.disconnect();
      lp.disconnect();
      ng.disconnect();
      bus.disconnect();
      if (sp) sp.disconnect();
    };
    osc.onended = () => {
      osc.disconnect();
      og.disconnect();
    };
    ns.start(t0, Math.random() * 2.2);
    ns.stop(t0 + dur + 0.04);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  }

  function triggerSplash(pan = 0, scale = 1) {
    if (!ctx || !enabled || !pinkBuffer || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    const dur = (0.58 + Math.random() * 0.25) * Math.max(1, scale * 0.72);
    const ns = ctx.createBufferSource();
    ns.buffer = pinkBuffer;
    ns.playbackRate.value = (0.92 + Math.random() * 0.25) / Math.max(1, scale * 0.55);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.25;
    bp.frequency.setValueAtTime(scale > 1.3 ? 620 : 980, t0);
    bp.frequency.exponentialRampToValueAtTime(scale > 1.3 ? 160 : 340, t0 + dur);

    const gNode = ctx.createGain();
    gNode.gain.setValueAtTime(0.001, t0);
    gNode.gain.linearRampToValueAtTime(Math.min(0.45, 0.18 * scale), t0 + 0.03);
    gNode.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    const sp = routeToBus(gNode, pan, false);
    ns.connect(bp);
    bp.connect(gNode);
    ns.onended = () => {
      ns.disconnect();
      bp.disconnect();
      gNode.disconnect();
      if (sp) sp.disconnect();
    };
    ns.start(t0, Math.random() * 2.5);
    ns.stop(t0 + dur + 0.03);
  }

  /** 座头鲸空灵深海鸣叫 */
  function triggerWhaleCall(pan = 0) {
    if (!ctx || !enabled || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    const dur = 2.4;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(148, t0);
    osc.frequency.linearRampToValueAtTime(218, t0 + 0.55);
    osc.frequency.exponentialRampToValueAtTime(92, t0 + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;

    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0005, t0);
    gn.gain.linearRampToValueAtTime(0.045, t0 + 0.35);
    gn.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);

    const sp = routeToBus(gn, pan, false);
    osc.connect(lp);
    lp.connect(gn);
    osc.onended = () => {
      osc.disconnect();
      lp.disconnect();
      gn.disconnect();
      if (sp) sp.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  function triggerBell(pan = 0) {
    if (!ctx || !enabled || ctx.state !== 'running') return;
    const baseT = ctx.currentTime;
    const freqs = [587.33, 1174.66, 1618.4, 2392.0];
    const amps = [0.12, 0.065, 0.045, 0.024];
    const decays = [2.35, 1.65, 1.15, 0.62];

    for (let hit = 0; hit < 2; hit++) {
      const t0 = baseT + hit * 0.44;
      const bus = ctx.createGain();
      bus.gain.value = 1;
      const sp = routeToBus(bus, pan, false);

      for (let k = 0; k < freqs.length; k++) {
        const osc = ctx.createOscillator();
        const gn = ctx.createGain();
        const dur = decays[k];
        osc.type = k === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freqs[k] * (1 + hit * 0.0015), t0);
        gn.gain.setValueAtTime(0.0005, t0);
        gn.gain.linearRampToValueAtTime(amps[k] * (hit === 0 ? 1 : 0.82), t0 + 0.005);
        gn.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
        osc.connect(gn);
        gn.connect(bus);
        osc.onended = () => {
          osc.disconnect();
          gn.disconnect();
          if (k === 0) {
            bus.disconnect();
            if (sp) sp.disconnect();
          }
        };
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
      }
    }
  }

  function triggerGull(pan = 0) {
    if (!ctx || !enabled || ctx.state !== 'running') return;
    const baseT = ctx.currentTime;
    const calls = 1 + (Math.random() > 0.45 ? 1 : 0);
    for (let k = 0; k < calls; k++) {
      const t0 = baseT + k * 0.34;
      const dur = 0.26 + Math.random() * 0.08;
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const gn = ctx.createGain();
      osc.type = 'sawtooth';
      const f0 = 1520 + Math.random() * 260;
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.linearRampToValueAtTime(f0 * 1.28, t0 + dur * 0.28);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.76, t0 + dur);
      bp.type = 'bandpass';
      bp.frequency.value = 1850;
      bp.Q.value = 4.2;
      gn.gain.setValueAtTime(0.0004, t0);
      gn.gain.linearRampToValueAtTime(0.018, t0 + 0.04);
      gn.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
      const sp = routeToBus(gn, pan, false);
      osc.connect(bp);
      bp.connect(gn);
      osc.onended = () => {
        osc.disconnect();
        bp.disconnect();
        gn.disconnect();
        if (sp) sp.disconnect();
      };
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  function setEnabled(nextState) {
    ensureAudioGraph();
    if (!ctx) return false;
    if (suspendTimer) {
      clearTimeout(suspendTimer);
      suspendTimer = null;
    }
    enabled = !!nextState;
    if (enabled && ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(enabled ? masterVolume : 0, now + 0.35);
    if (!enabled) {
      suspendTimer = setTimeout(() => {
        if (!enabled && ctx && ctx.state === 'running') ctx.suspend();
      }, 380);
    }
    return enabled;
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  function setTrackGain(name, value) {
    if (Object.prototype.hasOwnProperty.call(trackGains, name)) {
      trackGains[name] = THREE.MathUtils.clamp(Number(value) || 0, 0, 1.5);
    }
  }

  function setSleepTimer(minutes) {
    const mins = Math.max(0, Number(minutes) || 0);
    sleepTotalSec = mins * 60;
    sleepRemainingSec = sleepTotalSec;
    if (mins > 0 && !enabled) setEnabled(true);
  }

  return {
    isEnabled: () => enabled,
    toggle,
    setEnabled,
    setAmbientMode(active) {
      ambientModeActive = !!active;
    },
    setCabinMuffle(val) {
      cabinMuffleTarget = THREE.MathUtils.clamp(val, 0, 1);
    },
    setTrackGain,
    getTrackGains: () => ({ ...trackGains }),
    setSleepTimer,
    getSleepRemainingSec: () => sleepRemainingSec,
    triggerThunder,
    triggerCannon,
    triggerSplash,
    triggerWhaleCall,
    triggerBell,
    triggerIceCrunch,
    triggerBowSlam,
    update(dt, time, state, bowSlam, rollVel, tsunamiCrestFactor = 0) {
      if (!ctx || !enabled) return;
      const now = ctx.currentTime;

      // 定时助眠倒计时与最后 60 秒平滑淡出
      let sleepFade = 1.0;
      if (sleepTotalSec > 0 && sleepRemainingSec > 0) {
        sleepRemainingSec = Math.max(0, sleepRemainingSec - dt);
        if (sleepRemainingSec <= 60) {
          sleepFade = sleepRemainingSec / 60;
        }
        if (sleepRemainingSec <= 0.05) {
          sleepTotalSec = 0;
          sleepRemainingSec = 0;
          setEnabled(false);
          return;
        }
      }
      masterGain.gain.setTargetAtTime(masterVolume * sleepFade, now, 0.15);

      // 船长室舷窗视角隔音低通滤波（0 -> 18kHz 全通；1 -> 880Hz 温暖闷响）
      const targetCutoff = THREE.MathUtils.lerp(18000, 880, cabinMuffleTarget);
      cabinLPF.frequency.setTargetAtTime(targetCutoff, now, 0.18);

      const waveAmp = state.waveAmpScale;
      const windSpd = state.windSpeedScale;
      const snowAmt = state.snowAmount || 0;
      const lfo = 0.5 + 0.5 * Math.sin(time * 1.15);
      const wallProx =
        state.tsunamiMode > 0.05 ? Math.max(0, 1 - Math.abs(state.tsunamiCrestZ) / 115) * state.tsunamiMode : 0;
      const tsuBoost = tsunamiCrestFactor * 1.45 + wallProx * 0.65;

      // 1. 涌浪与劈浪轨
      swellFilter.frequency.setTargetAtTime(240 + lfo * 180 * waveAmp + tsuBoost * 480, now, 0.08);
      swellGain.gain.setTargetAtTime(
        Math.min(0.92, (0.28 + 0.14 * waveAmp + tsuBoost * 0.44) * trackGains.ocean),
        now,
        0.08
      );

      const washLevel = Math.min(0.45, (0.07 + bowSlam * 0.16 + tsuBoost * 0.22) * trackGains.ocean);
      washFilter.frequency.setTargetAtTime(950 + bowSlam * 650, now, 0.06);
      washGain.gain.setTargetAtTime(washLevel, now, 0.06);

      // 2. 狂风与索具轨（暴雪时风鸣更偏冷峻高频）
      const gustMod = 0.5 + 0.5 * Math.sin(time * 0.62 + Math.cos(time * 0.37));
      windFilter1.frequency.setTargetAtTime(340 + windSpd * 155 + gustMod * 125 + snowAmt * 95, now, 0.1);
      windFilter2.frequency.setTargetAtTime(660 + windSpd * 230 + gustMod * 175 + snowAmt * 180, now, 0.1);
      windGain.gain.setTargetAtTime(
        0.038 * Math.pow(windSpd, 1.82) * (0.75 + 0.5 * gustMod) * trackGains.wind,
        now,
        0.1
      );

      // 3. 雨雪双层白噪音轨
      rainCurtainGain.gain.setTargetAtTime(state.rainAmount * 0.145 * trackGains.precip, now, 0.12);
      rainPatterGain.gain.setTargetAtTime(state.rainAmount * 0.095 * trackGains.precip, now, 0.12);
      snowFilter.frequency.setTargetAtTime(2350 + gustMod * 780, now, 0.15);
      snowGain.gain.setTargetAtTime(snowAmt * (0.115 + 0.045 * gustMod) * trackGains.precip, now, 0.12);

      if (state.rainAmount > 0.15) {
        rainDropTimer -= dt * (0.5 + state.rainAmount * 1.8);
        if (rainDropTimer <= 0) {
          triggerRainTap(state.rainAmount);
          rainDropTimer = 0.045 + Math.random() * 0.095;
        }
      }

      // 4. 船尾暖炉 / 防风炭火盆轨
      const firePresence = Math.max(ambientModeActive ? 0.85 : 0, cabinMuffleTarget * 1.1, state.lanternFactor * 0.45);
      const firePulse = 0.84 + 0.16 * Math.sin(time * 5.7) * Math.cos(time * 3.1);
      const fireEff = Math.min(1.25, firePresence) * trackGains.fire;
      fireRumbleGain.gain.setTargetAtTime(0.14 * fireEff * firePulse, now, 0.12);
      fireHissGain.gain.setTargetAtTime(0.022 * fireEff * firePulse, now, 0.12);

      if (fireEff > 0.05) {
        crackleTimer -= dt * (0.65 + fireEff * 0.85);
        if (crackleTimer <= 0) {
          triggerFireCrackle(Math.min(1.2, firePresence));
          crackleTimer = 0.14 + Math.random() * 0.58;
        }
      }

      // 5. 船体受力吱呀、铜灯链条与强风帆布拍打
      creakTimer -= dt;
      if (creakTimer <= 0 && Math.abs(rollVel) > 0.04) {
        triggerHullCreak(Math.abs(rollVel) * 9);
        creakTimer = 2.0 + Math.random() * 2.6;
      }

      lanternChimeTimer -= dt;
      if (lanternChimeTimer <= 0 && Math.abs(rollVel) > 0.075) {
        triggerLanternChime(Math.abs(rollVel) * 8);
        lanternChimeTimer = 2.6 + Math.random() * 3.4;
      }

      if (windSpd > 1.35) {
        sailSnapTimer -= dt;
        if (sailSnapTimer <= 0 && gustMod > 0.72) {
          triggerSailSnap((windSpd - 1.0) * gustMod);
          sailSnapTimer = 3.2 + Math.random() * 4.5;
        }
      }

      if (state.storminess < 0.22 && state.tsunamiMode < 0.1 && state.isMoon < 0.5 && snowAmt < 0.1) {
        gullTimer -= dt;
        if (gullTimer <= 0) {
          triggerGull((Math.random() - 0.5) * 1.4);
          gullTimer = 11 + Math.random() * 11;
        }
      }
    },
  };
}
