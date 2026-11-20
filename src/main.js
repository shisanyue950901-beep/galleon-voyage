/**
 * @file main.js
 * @description 远洋古帆船 3D 海景模拟主入口（v4 360°真转向 + 海战靶船 + 精细画面版）：
 *              1. 分帧渐进式初始化程序化纹理（含 GPU 亚毫秒海沫烘焙）、战舰几何合并与 5 预设 PMREM 烘焙；
 *              2. 驱动二阶弹簧阻尼浮力物理、齐射后坐力受迫横倾、360° 世界航迹与真实波向同步旋转、灯塔浅滩避让；
 *              3. 管理 5 大摄像机机位、Q/E 独立舷炮、海盗双桅靶船、补给木桶打捞、座头鲸跃水与星夜极光水母；
 *              4. 支持高/中/低三档画质实时切换（DPR + MSAA + 泛光）。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function showFatalError(msg) {
  const loadEl = document.getElementById('agy-loader');
  const loadSub = document.getElementById('agy-load-sub');
  const loadBar = document.getElementById('agy-load-bar');
  if (loadEl) loadEl.classList.remove('agy-loaded');
  if (loadBar) {
    loadBar.style.width = '100%';
    loadBar.style.background = '#e05252';
  }
  if (loadSub) {
    loadSub.style.color = '#ffb4b4';
    loadSub.textContent = `初始化失败：${msg}`;
  }
}

import { createWeatherController } from './state/weatherState.js';
import {
  createPlankTextures,
  createSailTextures,
  createRopeTextures,
  createFoamNoiseTexture,
  createSoftGlowTexture,
  createSprayDropTexture,
} from './textures/proceduralTextures.js';
import { createSkyAndLighting } from './environment/skyAndLighting.js';
import {
  BASE_SAILING_SPEED,
  setCurrentSailingSpeed,
  oceanScroll,
  sampleOceanHeight,
  sampleShipBuoyancy,
  createOceanSurface,
} from './environment/oceanSimulation.js';
import { detectDeviceCapabilities, loadUserPrefs, saveUserPrefs } from './utils/deviceCompat.js';
import { createAtmosphericParticlesAndBirds } from './environment/atmosphereParticles.js';
import { createNavalAndEcology } from './environment/navalAndEcology.js';
import { buildShipHull } from './ship/hullBuilder.js';
import { buildDeckFittings } from './ship/deckFittings.js';
import { buildRiggingAndSails } from './ship/riggingAndSails.js';
import { optimizeRigidPivot, optimizeStaticShip } from './ship/staticBatchOptimizer.js';
import { FullScreenQuad, createBloomPipeline, FINAL_COMPOSITE_SHADER } from './postprocessing/bloomAndComposite.js';
import { createMaritimeAudio } from './audio/maritimeAudio.js';
import { createHudAndControls } from './ui/hudAndControls.js';

function startApplication() {
  const loadEl = document.getElementById('agy-loader');
  const loadBar = document.getElementById('agy-load-bar');
  const loadSub = document.getElementById('agy-load-sub');
  const setLoadProgress = (pct, msg) => {
    if (loadBar) loadBar.style.width = `${pct}%`;
    if (loadSub && msg) loadSub.textContent = msg;
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
  } catch (err) {
    showFatalError('当前浏览器或环境不支持 WebGL 渲染 (' + (err && err.message ? err.message : err) + ')');
    return;
  }

  const compat = detectDeviceCapabilities(renderer);
  const savedPrefs = loadUserPrefs();
  const getBaseDPR = () => Math.min(window.devicePixelRatio || 1, compat.maxDPR);
  const qualityPresets = [
    { label: '高', dpr: 1.0, bloom: true },
    { label: '中', dpr: 0.78, bloom: true },
    { label: '低 (流畅)', dpr: 0.62, bloom: false },
  ];
  let qualityIdx =
    typeof savedPrefs.qualityIdx === 'number' && savedPrefs.qualityIdx >= 0 && savedPrefs.qualityIdx < qualityPresets.length
      ? savedPrefs.qualityIdx
      : compat.defaultQualityIdx;
  let dprScale = qualityPresets[qualityIdx].dpr;

  renderer.setPixelRatio(getBaseDPR() * dprScale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.35, 2400);
  camera.position.set(23.5, 9.2, 47);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.4, 9.8, -1.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.65;
  controls.minDistance = 11.5;
  controls.maxDistance = 145;
  controls.maxPolarAngle = Math.PI * 0.488;
  controls.minPolarAngle = 0.08;
  controls.update();

  const camModes = ['orbit', 'helm', 'bow', 'crow', 'cinema', 'cabin'];
  let ambientAutoCam = false;
  let ambientCamTimer = 0;
  let camModeIdx = 0;
  const savedOrbitPos = camera.position.clone();
  const savedOrbitTarget = controls.target.clone();
  let povYaw = 0;
  let povPitch = 0;
  let povDragging = false;
  let povLastX = 0;
  let povLastY = 0;
  let bellSwing = 0;
  let pendingScreenshot = false;
  let navalRef = null;
  let resizeHook = null;

  const weather = createWeatherController('sunset');
  const audio = createMaritimeAudio();

  const tmpCamRight = new THREE.Vector3();
  weather.onThunder((strength, boltPos, delaySec = 0.28) => {
    let pan = 0;
    if (boltPos) {
      const wx = boltPos.x - camera.position.x;
      const wz = boltPos.y - camera.position.z;
      const len = Math.hypot(wx, wz) || 1;
      tmpCamRight.setFromMatrixColumn(camera.matrixWorld, 0);
      pan = THREE.MathUtils.clamp((wx / len) * tmpCamRight.x + (wz / len) * tmpCamRight.z, -0.9, 0.9);
    }
    audio.triggerThunder(strength, pan, delaySec);
  });

  const ui = createHudAndControls(weather, audio, {
    setCameraMode(targetMode) {
      const idx = camModes.indexOf(targetMode);
      if (idx < 0) return camModes[camModeIdx];
      if (camModes[camModeIdx] === 'orbit' && targetMode !== 'orbit') {
        savedOrbitPos.copy(camera.position);
        savedOrbitTarget.copy(controls.target);
      }
      camModeIdx = idx;
      const nextMode = camModes[camModeIdx];
      povYaw = 0;
      povPitch = nextMode === 'crow' ? -0.24 : nextMode === 'bow' ? -0.04 : nextMode === 'cabin' ? 0.02 : 0.04;
      if (nextMode === 'orbit') {
        camera.fov = 50;
        camera.updateProjectionMatrix();
        camera.position.copy(savedOrbitPos);
        controls.target.copy(savedOrbitTarget);
        controls.enabled = true;
        controls.update();
      } else {
        controls.enabled = false;
        camera.fov = nextMode === 'helm' ? 58 : nextMode === 'crow' ? 56 : nextMode === 'cabin' ? 54 : 52;
        camera.updateProjectionMatrix();
      }
      return nextMode;
    },
    setAmbientAutoCam(flag) {
      ambientAutoCam = !!flag;
      ambientCamTimer = 0;
    },
    cycleCamera() {
      const nextMode = camModes[(camModeIdx + 1) % camModes.length];
      return this.setCameraMode(nextMode);
    },
    fireSalvo(sideFilter = 0) {
      const activeMode = camModes[camModeIdx];
      const aimPitch = activeMode !== 'orbit' && activeMode !== 'cinema' ? povPitch : 0;
      return navalRef ? navalRef.fireSalvo(camera, aimPitch, sideFilter) : false;
    },
    cycleQuality() {
      qualityIdx = (qualityIdx + 1) % qualityPresets.length;
      dprScale = qualityPresets[qualityIdx].dpr;
      saveUserPrefs({ qualityIdx });
      if (resizeHook) resizeHook();
      return qualityPresets[qualityIdx].label;
    },
    ringBell() {
      bellSwing = 1.0;
      audio.triggerBell(0);
    },
    takeScreenshot() {
      pendingScreenshot = true;
    },
  });

  let isPointerDown = false;
  let lastInteractTime = -10;
  let elapsed = 0;
  const markInteraction = () => {
    lastInteractTime = elapsed;
  };

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    isPointerDown = true;
    markInteraction();
    if (camModes[camModeIdx] !== 'orbit' && camModes[camModeIdx] !== 'cinema') {
      povDragging = true;
      povLastX = ev.clientX;
      povLastY = ev.clientY;
    }
  });
  window.addEventListener(
    'pointermove',
    (ev) => {
      if (!povDragging) return;
      const dx = ev.clientX - povLastX;
      const dy = ev.clientY - povLastY;
      povLastX = ev.clientX;
      povLastY = ev.clientY;
      povYaw = THREE.MathUtils.clamp(povYaw - dx * 0.0042, -2.15, 2.15);
      povPitch = THREE.MathUtils.clamp(povPitch - dy * 0.0036, -0.55, 0.88);
    },
    { passive: true }
  );
  window.addEventListener('pointerup', () => {
    isPointerDown = false;
    povDragging = false;
    markInteraction();
  });
  window.addEventListener('pointercancel', () => {
    isPointerDown = false;
    povDragging = false;
    markInteraction();
  });
  window.addEventListener('blur', () => {
    isPointerDown = false;
    povDragging = false;
  });
  renderer.domElement.addEventListener('dblclick', () => {
    povYaw = 0;
    povPitch = camModes[camModeIdx] === 'crow' ? -0.24 : 0;
  });
  renderer.domElement.addEventListener('wheel', markInteraction, { passive: true });
  renderer.domElement.addEventListener('touchstart', markInteraction, { passive: true });

  setLoadProgress(22, '正在绘制木纹与 GPU 烘焙海沫材质…');
  requestAnimationFrame(() => {
    let textures;
    try {
      textures = {
        hullPlanks: createPlankTextures({
          rows: 14,
          baseColors: ['#4a2b18', '#593620', '#3d2213', '#633c24', '#4e2f1c'],
          seamColor: '#160b05',
          seed: 109,
        }),
        deckPlanks: createPlankTextures({
          rows: 16,
          baseColors: ['#8c633b', '#996e43', '#7d5733', '#a3774a', '#875f38'],
          seamColor: '#2a1a0e',
          grainContrast: 0.18,
          seed: 317,
        }),
        sailPlain: createSailTextures({ striped: false, weathered: 0.95, seed: 401 }),
        sailStriped: createSailTextures({ striped: true, weathered: 1.05, seed: 509 }),
        rope: createRopeTextures(),
        foamNoise: createFoamNoiseTexture(512, renderer),
        softGlow: createSoftGlowTexture(128),
        sprayDrop: createSprayDropTexture(128),
      };
      textures.rope.map.repeat.set(1, 16);
      textures.rope.bumpMap.repeat.set(1, 16);
    } catch (err) {
      showFatalError(err && err.message ? err.message : String(err));
      return;
    }

    setLoadProgress(68, '正在组装战舰索具与烘焙天光…');
    requestAnimationFrame(() => {
      try {
        const skyAndLights = createSkyAndLighting(scene, renderer, weather.state, compat);
        const ocean = createOceanSurface(scene, textures.foamNoise, weather.state);

        const shipRoot = new THREE.Group();
        scene.add(shipRoot);

        const { hullGroup, materials: shipMats, rudderPivot, gunportMuzzles } = buildShipHull(textures);
        shipRoot.add(hullGroup);

        const {
          deckGroup,
          ropeMat,
          wheelPivot,
          captainPivot,
          swingingLanterns,
          deckCannons,
          bellPivot,
        } = buildDeckFittings(shipMats, textures);
        shipRoot.add(deckGroup);

        const rigging = buildRiggingAndSails(shipMats, textures, ropeMat);
        shipRoot.add(rigging.rigGroup);

        const dynamicRoots = new Set([wheelPivot, captainPivot, rudderPivot, bellPivot]);
        for (const ln of swingingLanterns) dynamicRoots.add(ln.pendulumPivot);
        for (const dc of deckCannons) dynamicRoots.add(dc.pivot);
        for (const gp of gunportMuzzles) {
          if (gp.pivot) dynamicRoots.add(gp.pivot);
          if (gp.lidHinge) dynamicRoots.add(gp.lidHinge);
        }
        for (const pivot of dynamicRoots) optimizeRigidPivot(pivot);
        optimizeStaticShip(shipRoot, dynamicRoots);

        const atmosphere = createAtmosphericParticlesAndBirds(scene, textures);
        const naval = createNavalAndEcology(scene, shipRoot, textures, deckCannons, gunportMuzzles, audio);
        navalRef = naval;
        naval.onEvent((msg) => ui.showToast(msg));

        const rtType = compat.rtType;
        const maxSamples = compat.maxSamples;

        const initDPR = renderer.getPixelRatio();
        const initPW = Math.max(1, Math.floor(window.innerWidth * initDPR));
        const initPH = Math.max(1, Math.floor(window.innerHeight * initDPR));
        const sceneRT = new THREE.WebGLRenderTarget(initPW, initPH, {
          type: rtType,
          samples: maxSamples,
          depthBuffer: true,
          stencilBuffer: false,
        });
        const bloom = createBloomPipeline(initPW, initPH, 0.34, 0.58, 1.05, rtType);
        const finalUniforms = THREE.UniformsUtils.clone(FINAL_COMPOSITE_SHADER.uniforms);
        const finalMat = new THREE.ShaderMaterial({
          uniforms: finalUniforms,
          vertexShader: FINAL_COMPOSITE_SHADER.vertexShader,
          fragmentShader: FINAL_COMPOSITE_SHADER.fragmentShader,
          depthTest: false,
          depthWrite: false,
        });
        const finalQuad = new FullScreenQuad(finalMat);

        function applyViewportSize() {
          const w = window.innerWidth;
          const h = window.innerHeight;
          const effDPR = getBaseDPR() * dprScale;
          const pw = Math.max(1, Math.floor(w * effDPR));
          const ph = Math.max(1, Math.floor(h * effDPR));
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setPixelRatio(effDPR);
          renderer.setSize(w, h);
          sceneRT.setSize(pw, ph);
          bloom.setSize(pw, ph);
          atmosphere.onResize(effDPR);
          naval.onResize(effDPR);
        }
        resizeHook = applyViewportSize;
        window.addEventListener('resize', applyViewportSize);
        window.addEventListener('orientationchange', () => setTimeout(applyViewportSize, 120));
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', applyViewportSize);
        }

        let contextLost = false;
        renderer.domElement.addEventListener('webglcontextlost', (ev) => {
          ev.preventDefault();
          contextLost = true;
          ui.showToast('图形上下文暂时中断，正在尝试自动恢复…');
        });
        renderer.domElement.addEventListener('webglcontextrestored', () => {
          contextLost = false;
          applyViewportSize();
          ui.showToast('3D 渲染已自动恢复');
        });

        const motion = {
          heave: 0,
          heaveVel: 0,
          pitch: 0,
          pitchVel: 0,
          roll: -0.058,
          rollVel: 0,
          yaw: 0,
        };
        let trackedCamHeave = 0;
        let waveLift = 0;
        let rudderAngle = 0;
        let steerYaw = 0;
        let compassHeading = 0;
        let shipWorldX = 0;
        let shipWorldZ = 0;
        let lastEcoInfo = null;
        let bowSlamCooldown = 0;

        let emaDt = 0.0167;
        let slowFramesSec = 0;
        let fastFramesSec = 0;

        const camViewDir = new THREE.Vector3();
        const sunProjVec = new THREE.Vector3();
        const camOffset = new THREE.Vector3();
        const camSpherical = new THREE.Spherical();
        const povEye = new THREE.Vector3();
        const povLook = new THREE.Vector3();
        let prevTimeSec = performance.now() * 0.001;

        setLoadProgress(100, '启航就绪');
        if (loadEl) {
          setTimeout(() => loadEl.classList.add('agy-loaded'), 120);
        }

        function animateFrame() {
          try {
          requestAnimationFrame(animateFrame);
          if (contextLost) return;
          const nowSec = performance.now() * 0.001;
          const rawDt = nowSec - prevTimeSec;
          const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
          prevTimeSec = nowSec;
          elapsed += dt;

          if (qualityIdx === 0 && rawDt > 0.002 && rawDt < 0.2) {
            emaDt += (rawDt - emaDt) * 0.06;
            if (emaDt > 0.028 && dprScale > 0.72) {
              slowFramesSec += dt;
              fastFramesSec = 0;
              if (slowFramesSec > 3.2) {
                dprScale = Math.max(0.7, dprScale - 0.15);
                slowFramesSec = 0;
                applyViewportSize();
              }
            } else if (emaDt < 0.0172 && dprScale < 1.0) {
              fastFramesSec += dt;
              slowFramesSec = 0;
              if (fastFramesSec > 6.5) {
                dprScale = Math.min(1.0, dprScale + 0.15);
                fastFramesSec = 0;
                applyViewportSize();
              }
            } else {
              slowFramesSec = Math.max(0, slowFramesSec - dt * 0.5);
            }
          }

          // 1. 掌舵输入、灯塔浅滩自动避让、动态风场与 360° 真实世界航迹积分
          let steerInput = ui.getSteerInput();
          if (lastEcoInfo && lastEcoInfo.lighthouseDist < 48 && lastEcoInfo.lighthouseLocalZ > -8) {
            // 靠近礁石浅滩时自动向远离岛心的一侧辅助转舵，防止穿模触礁
            steerInput = lastEcoInfo.lighthouseLocalX >= 0 ? 1 : -1;
          }

          const steerRate = steerInput !== 0 ? 2.45 : 1.55;
          rudderAngle += (steerInput * 0.52 - rudderAngle) * (1 - Math.exp(-steerRate * dt));
          if (Math.abs(rudderAngle) < 1e-4 && steerInput === 0) rudderAngle = 0;

          const windWorldRad = 1.08 + Math.sin(elapsed * 0.042) * 0.42 + Math.cos(elapsed * 0.021) * 0.24;
          const relWind = compassHeading - windWorldRad;
          const windAbsSin = Math.abs(Math.sin(relWind));
          const pointOfSail = 0.78 + 0.28 * windAbsSin;
          const sailEffPct = Math.round((0.55 + 0.45 * windAbsSin) * 100);

          const curSpeed =
            BASE_SAILING_SPEED *
            pointOfSail *
            ui.getThrottle() *
            naval.getSpeedMultiplier() *
            (0.88 + 0.16 * weather.state.windSpeedScale);
          setCurrentSailingSpeed(curSpeed);

          const turnRate = rudderAngle * 0.42 * (curSpeed / BASE_SAILING_SPEED);
          compassHeading = (compassHeading - turnRate * dt) % (Math.PI * 2);
          shipWorldX += Math.sin(compassHeading) * curSpeed * dt;
          shipWorldZ += Math.cos(compassHeading) * curSpeed * dt;

          // 按当前 360° 航向角推进海面世界坐标，使波浪迎面方向随船体转向真实改变
          oceanScroll.x += Math.sin(compassHeading) * curSpeed * dt;
          oceanScroll.y += Math.cos(compassHeading) * curSpeed * dt;

          weather.setWorldHeading(compassHeading);
          weather.update(dt);
          const wState = weather.state;

          steerYaw += (rudderAngle * 0.38 - steerYaw) * (1 - Math.exp(-1.9 * dt));

          // 2. 二阶弹簧阻尼船体六自由度姿态解算
          const surgeScale = 0.75 + 0.35 * wState.waveAmpScale;
          const waveYaw = (Math.sin(elapsed * 0.58) * 0.024 + Math.cos(elapsed * 0.93) * 0.012) * surgeScale;
          motion.yaw = steerYaw + waveYaw;

          const buoy = sampleShipBuoyancy(elapsed, wState, motion.yaw);
          const heaveTarget = buoy.heave - 0.12;
          const pitchTarget = buoy.pitchTarget;
          const rollTarget = wState.heelAngle + buoy.rollTarget - rudderAngle * 0.095;

          motion.rollVel += naval.consumeRollImpulse();
          motion.heaveVel += ((heaveTarget - motion.heave) * 15.5 - motion.heaveVel * 5.6) * dt;
          motion.heave += motion.heaveVel * dt;
          motion.pitchVel += ((pitchTarget - motion.pitch) * 12.5 - motion.pitchVel * 4.6) * dt;
          motion.pitch += motion.pitchVel * dt;
          motion.rollVel += ((rollTarget - motion.roll) * 9.5 - motion.rollVel * 3.8) * dt;
          motion.roll += motion.rollVel * dt;

          const surgeZ = Math.sin(elapsed * 0.82) * 0.32 * surgeScale;
          const swayX = Math.cos(elapsed * 0.64) * 0.22 * surgeScale;
          shipRoot.position.set(swayX, motion.heave, surgeZ);
          shipRoot.rotation.order = 'YXZ';
          shipRoot.rotation.set(motion.pitch, motion.yaw, motion.roll);
          shipRoot.updateMatrixWorld();

          // 3. 船舵、船钟、船壳动态水线浸湿带、甲板湿润度、舵轮与摇摆风灯更新
          rudderPivot.rotation.y = -rudderAngle * 0.88;
          if (bellSwing > 1e-3) {
            bellSwing *= Math.exp(-dt * 1.65);
            bellPivot.rotation.z = Math.sin(elapsed * 14.2) * bellSwing * 0.46;
          } else {
            bellPivot.rotation.z = -motion.roll * 0.35;
          }

          const bowDeckHeight = motion.heave - Math.sin(motion.pitch) * 12.5;
          const bowSlam = Math.max(0, Math.min(1.8, (buoy.bowWaveHeight - bowDeckHeight + 0.35) * 1.45));
          if (bowSlamCooldown > 0) bowSlamCooldown -= dt;
          if (bowSlam > 0.78 && bowSlamCooldown <= 0) {
            bowSlamCooldown = 1.35 + Math.random() * 0.55;
            atmosphere.triggerBowSlamBurst(shipRoot.position, motion.pitch, bowSlam, elapsed, wState);
            naval.addShake(0.22 * Math.min(1.4, bowSlam));
            audio.triggerBowSlam(bowSlam * 0.68, 0);
          }

          const wet = wState.wetness;
          shipMats.hullMat.roughness = 0.74 - wet * 0.34;
          shipMats.hullWeatherUni.uWetness.value = wet;
          shipMats.hullWeatherUni.uWaveWetHeight.value =
            0.75 + Math.max(0, buoy.heave) * 0.85 + bowSlam * 0.65 + wState.waveAmpScale * 0.35;

          shipMats.deckMat.roughness = 0.78 - wet * 0.4;
          shipMats.mahoganyMat.roughness = 0.62 - wet * 0.26;
          shipMats.glowingWindowMat.emissiveIntensity = 2.65 * wState.lanternFactor;

          wheelPivot.rotation.z =
            -rudderAngle * 4.8 - motion.roll * 3.6 + Math.sin(elapsed * 1.15 * wState.windSpeedScale) * 0.22;
          captainPivot.rotation.z = -motion.roll * 0.45;

          const swingGain = 1.15 + wState.storminess * 0.85;
          for (let idx = 0; idx < swingingLanterns.length; idx++) {
            const ln = swingingLanterns[idx];
            const phase = idx * 1.37;
            ln.pendulumPivot.rotation.z = -motion.roll * 1.35 * swingGain + Math.sin(elapsed * 2.9 + phase) * 0.075 * swingGain;
            ln.pendulumPivot.rotation.x = -motion.pitch * 1.25 * swingGain + Math.cos(elapsed * 2.4 + phase) * 0.065 * swingGain;
            const flicker = 0.9 + 0.1 * Math.sin(elapsed * 9.5 + phase) * Math.cos(elapsed * 15.3 + phase * 2.1);
            const lf = wState.lanternFactor;
            if (ln.pointLight) ln.pointLight.intensity = ln.baseIntensity * flicker * lf;
            if (ln.lanternGlassMat) ln.lanternGlassMat.emissiveIntensity = 0.25 + 3.45 * lf * flicker;
            ln.halo.material.opacity = Math.min(0.95, 0.58 * lf * flicker);
          }

          rigging.update(elapsed, wState, dt, relWind);
          ocean.update(
            elapsed,
            shipRoot.position,
            motion.pitch,
            wState,
            motion.yaw,
            rudderAngle,
            oceanScroll,
            motion.roll
          );
          skyAndLights.update(elapsed, shipRoot.position, wState, dt);

          // 4. 五机位摄像机更新与非破坏性海啸浪高避让
          if (ui.isAmbientActive() && ambientAutoCam && !isPointerDown) {
            ambientCamTimer += dt;
            if (ambientCamTimer > 18.0) {
              ambientCamTimer = 0;
              const seq = ['cinema', 'cabin', 'helm'];
              const cur = camModes[camModeIdx];
              const nxt = seq[(seq.indexOf(cur) + 1) % seq.length];
              camModeIdx = camModes.indexOf(nxt);
              controls.enabled = false;
              povYaw = 0;
              povPitch = nxt === 'cabin' ? 0.02 : 0.04;
              camera.fov = nxt === 'helm' ? 58 : nxt === 'cabin' ? 54 : 52;
              camera.updateProjectionMatrix();
              ui.setCamModeLabel(nxt);
            }
          }
          const activeCamMode = camModes[camModeIdx];
          const shakeAmp = naval.consumeShake(dt);
          const sxShake = shakeAmp > 0 ? (Math.random() - 0.5) * 0.24 * shakeAmp : 0;
          const syShake = shakeAmp > 0 ? (Math.random() - 0.5) * 0.22 * shakeAmp : 0;
          let baseCamY = 0;
          let tempLift = 0;

          if (activeCamMode === 'orbit') {
            const prevHeave = trackedCamHeave;
            trackedCamHeave += (motion.heave * 0.86 - trackedCamHeave) * Math.min(1, dt * 4.2);
            const deltaHeave = trackedCamHeave - prevHeave;
            controls.target.y += deltaHeave;
            camera.position.y += deltaHeave;

            const idleSec = elapsed - lastInteractTime;
            const idleWeight = !isPointerDown && idleSec > 2.2 ? Math.min(1, (idleSec - 2.2) * 0.35) : 0;
            if (idleWeight > 0) {
              const dTheta = Math.sin(elapsed * 0.16) * 0.055 * dt * idleWeight;
              camOffset.copy(camera.position).sub(controls.target);
              camSpherical.setFromVector3(camOffset);
              camSpherical.theta += dTheta;
              camOffset.setFromSpherical(camSpherical);
              camera.position.copy(controls.target).add(camOffset);
            }

            controls.update();
            baseCamY = camera.position.y;

            const idleBob = Math.sin(elapsed * 1.25) * 0.22 * idleWeight;
            const minSurfY = sampleOceanHeight(camera.position.x, camera.position.z, elapsed, wState) + 1.55;
            const reqLift = Math.max(0, minSurfY - (baseCamY + idleBob));
            const liftRate = reqLift > waveLift ? 16 : 3.4;
            waveLift += (reqLift - waveLift) * (1 - Math.exp(-liftRate * dt));
            if (waveLift < 1e-4 && reqLift === 0) waveLift = 0;

            tempLift = idleBob + waveLift + syShake;
            if (Math.abs(tempLift) > 1e-5 || Math.abs(sxShake) > 1e-5) {
              camera.position.y = baseCamY + tempLift;
              camera.position.x += sxShake;
              camera.lookAt(controls.target);
              camera.updateMatrixWorld();
            }
          } else if (activeCamMode === 'cinema') {
            const ang = elapsed * 0.14 + 0.65;
            const rad = 38 + Math.sin(elapsed * 0.09) * 11;
            const cx = shipRoot.position.x + Math.sin(ang) * rad;
            const cz = shipRoot.position.z + Math.cos(ang) * rad;
            const surf = sampleOceanHeight(cx, cz, elapsed, wState);
            const cy = Math.max(surf + 2.6, 6.2 + Math.sin(elapsed * 0.21) * 4.2 + motion.heave * 0.55);
            camera.position.set(cx + sxShake, cy + syShake, cz);
            povLook.set(shipRoot.position.x, shipRoot.position.y + 9.2 + Math.sin(elapsed * 0.17) * 1.8, shipRoot.position.z + 2.2);
            camera.lookAt(povLook);
            camera.updateMatrixWorld();
          } else {
            if (activeCamMode === 'helm') povEye.set(0, 6.55, -6.65);
            else if (activeCamMode === 'bow') povEye.set(1.55, 5.75, 13.45);
            else if (activeCamMode === 'cabin') povEye.set(0, 6.35, -8.35);
            else povEye.set(0, 17.85, 0.35);

            povEye.applyMatrix4(shipRoot.matrixWorld);
            const surf = sampleOceanHeight(povEye.x, povEye.z, elapsed, wState) + 1.25;
            if (povEye.y < surf) povEye.y = surf;
            camera.position.set(povEye.x + sxShake, povEye.y + syShake, povEye.z);

            const totalYaw = motion.yaw + povYaw;
            const totalPitch = motion.pitch * 0.65 + povPitch;
            const cp = Math.cos(totalPitch);
            povLook.set(
              camera.position.x + Math.sin(totalYaw) * cp * 40,
              camera.position.y + Math.sin(totalPitch) * 40,
              camera.position.z + Math.cos(totalYaw) * cp * 40
            );
            camera.up.set(Math.sin(-motion.roll * 0.55), Math.cos(-motion.roll * 0.55), 0);
            camera.lookAt(povLook);
            camera.up.set(0, 1, 0);
            camera.updateMatrixWorld();
          }

          // 5. 粒子、海战生态、空间音效与航海罗盘 HUD 刷新
          const showAim = !ui.isAmbientActive() && activeCamMode !== 'orbit' && activeCamMode !== 'cinema' && activeCamMode !== 'cabin';
          atmosphere.update(dt, elapsed, shipRoot.position, motion.pitch, bowSlam, wState, camera.position);
          lastEcoInfo = naval.update(
            dt,
            elapsed,
            shipRoot.position,
            motion.yaw,
            wState,
            camera,
            shipWorldX,
            shipWorldZ,
            showAim,
            povPitch,
            ui.isAmbientActive()
          );
          audio.setCabinMuffle(activeCamMode === 'cabin' ? 1 : 0);
          audio.update(dt, elapsed, wState, bowSlam, motion.rollVel, buoy.tsunamiCrestFactor);

          const waveReadout = wState.tsunamiMode > 0.15 ? Math.max(2.2, 23.5 * wState.tsunamiMode) : 1.65 * wState.waveAmpScale;
          const knots = curSpeed * 1.94384;
          ui.updateHUD(
            compassHeading,
            windWorldRad,
            knots,
            waveReadout,
            naval.getCooldown(),
            sailEffPct,
            lastEcoInfo ? lastEcoInfo.lighthouseDist : 290,
            rudderAngle,
            lastEcoInfo
          );

          // 6. 屏幕空间丁达尔光束投影、离屏渲染与单通后处理合成
          camera.getWorldDirection(camViewDir);
          const sunFacing = camViewDir.dot(wState.sunDir);
          if (sunFacing > 0.05 && wState.godRayStrength > 0.005) {
            sunProjVec.copy(camera.position).addScaledVector(wState.sunDir, 1000).project(camera);
            const screenFade = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sunProjVec.x), Math.abs(sunProjVec.y)), 0.72, 1.45);
            const angleFade = THREE.MathUtils.smoothstep(sunFacing, 0.06, 0.42);
            finalUniforms.uSunScreenUV.value.set(sunProjVec.x * 0.5 + 0.5, sunProjVec.y * 0.5 + 0.5);
            finalUniforms.uGodRayWeight.value = wState.godRayStrength * screenFade * angleFade;
            finalUniforms.uGodRayTint.value.set(...wState.sunLightColor);
          } else {
            finalUniforms.uGodRayWeight.value = 0;
          }

          shipMats.deckWeatherUni.uTime.value = elapsed;
          shipMats.deckWeatherUni.uRainAmount.value = wState.rainAmount;
          shipMats.deckWeatherUni.uWetness.value = wState.wetness;
          finalUniforms.uTime.value = elapsed;
          const isCabin = activeCamMode === 'cabin';
          finalUniforms.uCabinGlass.value = isCabin ? 1.0 : 0.0;
          finalUniforms.uLensWetness.value = isCabin
            ? Math.max(wState.rainAmount * 1.15, wState.tsunamiMode * 0.8)
            : Math.max(wState.rainAmount * 0.85, wState.tsunamiMode * 0.65);
          finalUniforms.uFrostAmount.value = (wState.snowAmount || 0) * (isCabin ? 1.15 : 0.68);
          finalUniforms.uWarmGlow.value = (ui.isAmbientActive() || isCabin)
            ? (0.55 + 0.14 * Math.sin(elapsed * 8.4) * Math.cos(elapsed * 5.2)) * Math.max(0.65, wState.lanternFactor * 0.6)
            : 0.0;
          finalUniforms.uExposure.value = wState.exposure;
          const useBloom = qualityPresets[qualityIdx].bloom;
          bloom.strength = useBloom ? 0.32 + wState.bioluminescence * 0.12 + wState.lightningFlash * 0.16 : 0;

          renderer.setRenderTarget(sceneRT);
          renderer.render(scene, camera);

          if (activeCamMode === 'orbit' && (Math.abs(tempLift) > 1e-5 || Math.abs(sxShake) > 1e-5)) {
            camera.position.y = baseCamY;
            camera.position.x -= sxShake;
            camera.lookAt(controls.target);
          }

          if (useBloom) {
            bloom.render(
              renderer,
              sceneRT.texture,
              finalUniforms.uSunScreenUV.value,
              finalUniforms.uGodRayWeight.value
            );
          }
          finalUniforms.tDiffuse.value = sceneRT.texture;
          finalUniforms.uBloomTex.value = bloom.bloomTexture;
          renderer.setRenderTarget(null);
          finalQuad.render(renderer);

          if (pendingScreenshot) {
            pendingScreenshot = false;
            try {
              const dataUrl = renderer.domElement.toDataURL('image/png');
              const dl = document.createElement('a');
              dl.href = dataUrl;
              dl.download = `galleon-${weather.getMode()}-${Date.now()}.png`;
              document.body.appendChild(dl);
              dl.click();
              dl.remove();
            } catch (_err) {
              // 忽略受限环境导出异常
            }
          }
          } catch (frameErr) {
            showFatalError(frameErr && frameErr.message ? frameErr.message : String(frameErr));
          }
        }

        animateFrame();
      } catch (err) {
        showFatalError(err && err.message ? err.message : String(err));
      }
    });
  });
}

startApplication();
