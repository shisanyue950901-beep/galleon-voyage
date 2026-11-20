/**
 * @file riggingAndSails.js
 * @description 三桅帆船桅杆、全套鼓风帆具、静索动索及桅顶分叉长旒旗模块：
 *              1. 风帆顶点着色器同时求取多频阵风位移、迎风转角偏置与偏导法线扰动，并共享 customDepthMaterial 实现动态甲板帆影；
 *              2. 顶层三面上桅帆（Topgallant / Mizzen Topsail）在雷暴与海啸模式下自动向上收卷；
 *              3. 三面桅顶燕尾长旒旗合并为单次绘制 BufferGeometry，完全在 GPU 顶点着色器与阴影材质中完成风舞动画。
 */

import * as THREE from 'three';
import { DEFAULT_SUN_DIR } from '../state/weatherState.js';
import { zToHullParam, sampleHullSurface } from './hullCurve.js';

/** 风帆多频阵风位移、迎风转桁偏移与解析法线偏导 GLSL 函数 */
const SAIL_WAVE_GLSL = `
  attribute float aFlutterWeight;
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uSailTrimAngle;
  void evalSailWave(vec3 pos, float fw, out vec3 disp, out vec3 dNorm) {
    float wSpd = 0.8 + uWindStrength * 0.45;
    float p1 = uTime * 2.35 * wSpd + pos.y * 0.45 + pos.x * 0.35;
    float p2 = uTime * 4.90 * wSpd - pos.y * 1.15 + pos.x * 0.85;
    float p3 = uTime * 7.40 * wSpd + pos.y * 2.10;
    float pB = uTime * 1.55 * wSpd + pos.y * 0.18;
    float gust = sin(p1) * 0.55 + sin(p2) * 0.30 + cos(p3) * 0.15;
    float dgdx = cos(p1) * 0.1925 + cos(p2) * 0.255;
    float dgdy = cos(p1) * 0.2475 - cos(p2) * 0.345 - sin(p3) * 0.315;
    float breathe = 0.94 + 0.12 * uWindStrength * sin(pB);
    float dbdy = 0.0216 * uWindStrength * cos(pB);
    float ampG = 0.16 * uWindStrength;
    float leechFlutter = pow(fw, 2.2) * sin(uTime * 11.5 * wSpd + pos.y * 2.8 + pos.x * 1.4) * 0.045 * uWindStrength;
    float trimTwistZ = pos.x * uSailTrimAngle * (0.35 + 0.65 * fw);
    disp = vec3(fw * gust * (-0.06 * uWindStrength), 0.0, fw * (gust * ampG + (breathe - 1.0) * 0.55) + leechFlutter + trimTwistZ);
    float dzdx = fw * dgdx * ampG + uSailTrimAngle * 0.5;
    float dzdy = fw * (dgdy * ampG + dbdy * 0.55);
    dNorm = vec3(-dzdx, -dzdy, 0.0);
  }
`;

function createSailMaterial(sailTex, sailUniforms) {
  const mat = new THREE.MeshStandardMaterial({
    map: sailTex.map,
    bumpMap: sailTex.bumpMap,
    bumpScale: 0.035,
    roughness: 0.84,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sailUniforms.uTime;
    shader.uniforms.uSunDir = sailUniforms.uSunDir;
    shader.uniforms.uWindStrength = sailUniforms.uWindStrength;
    shader.uniforms.uSailTrimAngle = sailUniforms.uSailTrimAngle;
    shader.uniforms.uTranslucencyTint = sailUniforms.uTranslucencyTint;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${SAIL_WAVE_GLSL}\nvarying vec3 vSailWorldPos;\nvarying vec3 vSailWorldNormal;`
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvec3 _sDisp, _sDNorm;\nevalSailWave(position, aFlutterWeight, _sDisp, _sDNorm);\nobjectNormal = normalize(objectNormal + _sDNorm * 1.2);'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += _sDisp;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvSailWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSailWorldNormal = normalize(mat3(modelMatrix) * objectNormal);'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uTranslucencyTint;\nvarying vec3 vSailWorldPos;\nvarying vec3 vSailWorldNormal;'
      )
      .replace(
        '#include <dithering_fragment>',
        `
        vec3 sViewDir = normalize(cameraPosition - vSailWorldPos);
        vec3 sFaceNormal = gl_FrontFacing ? normalize(vSailWorldNormal) : -normalize(vSailWorldNormal);
        float backSun = max(dot(-sFaceNormal, normalize(uSunDir)), 0.0);
        float forwardScatter = pow(max(dot(-sViewDir, normalize(uSunDir)), 0.0), 2.8);
        float sss = (backSun * 0.62 + forwardScatter * 0.52) * (0.45 + 0.55 * diffuseColor.r);
        gl_FragColor.rgb += diffuseColor.rgb * uTranslucencyTint * sss * 0.68;
        #include <dithering_fragment>
        `
      );
  };

  if (!sailUniforms._sailDepthMat) {
    const dm = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    dm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = sailUniforms.uTime;
      sh.uniforms.uWindStrength = sailUniforms.uWindStrength;
      sh.uniforms.uSailTrimAngle = sailUniforms.uSailTrimAngle;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${SAIL_WAVE_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvec3 _sDisp, _sDNorm;\nevalSailWave(position, aFlutterWeight, _sDisp, _sDNorm);\ntransformed += _sDisp;'
        );
    };
    sailUniforms._sailDepthMat = dm;
  }

  mat.userData.depthMat = sailUniforms._sailDepthMat;
  return mat;
}

function createSquareSailGeometry({ topWidth, bottomWidth, height, bellyDepth, footArch = 0.65, segsX = 28, segsY = 22 }) {
  const positions = [];
  const uvs = [];
  const weights = [];
  const indices = [];
  const stride = segsX + 1;

  for (let iy = 0; iy <= segsY; iy++) {
    const v = iy / segsY;
    for (let ix = 0; ix <= segsX; ix++) {
      const u = ix / segsX;
      const nx = u * 2 - 1;
      const leechPinch = Math.sin(v * Math.PI) * -0.045 * topWidth;
      const halfW = topWidth * 0.5 * (1 - v) + bottomWidth * 0.5 * v + leechPinch;
      const px = nx * halfW;
      const arch = (1 - nx * nx) * footArch * Math.pow(v, 1.5);
      const py = -v * height + arch;
      const bellyV = Math.sin(Math.pow(v, 0.78) * Math.PI);
      const bellyX = 1 - 0.52 * nx * nx;
      const lowerBillow = (1 - nx * nx) * Math.pow(v, 1.35) * 0.42 * bellyDepth;
      const pz = bellyDepth * bellyV * bellyX + lowerBillow;

      positions.push(px, py, pz);
      uvs.push(u, 1 - v);
      weights.push(Math.sin(v * Math.PI * 0.88) * (0.55 + 0.45 * Math.abs(nx)));
    }
  }

  for (let iy = 0; iy < segsY; iy++) {
    for (let ix = 0; ix < segsX; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aFlutterWeight', new THREE.Float32BufferAttribute(weights, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createTriangularJibGeometry(head, tack, clew, bellyVec, segsU = 20, segsV = 18) {
  const positions = [];
  const uvs = [];
  const weights = [];
  const indices = [];
  const stride = segsU + 1;

  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV;
    const pStay = new THREE.Vector3().lerpVectors(head, tack, v);
    const pLeech = new THREE.Vector3().lerpVectors(head, clew, v);
    for (let iu = 0; iu <= segsU; iu++) {
      const u = iu / segsU;
      const pt = new THREE.Vector3().lerpVectors(pStay, pLeech, u);
      const billow = Math.sin(u * Math.PI * 0.82) * Math.sin(v * Math.PI * 0.92);
      pt.addScaledVector(bellyVec, billow);
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(u, 1 - v);
      weights.push(u * Math.sin(v * Math.PI * 0.92));
    }
  }

  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aFlutterWeight', new THREE.Float32BufferAttribute(weights, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createSpankerGeometry(throat, peak, tack, clew, bellySide, segsU = 22, segsV = 20) {
  const positions = [];
  const uvs = [];
  const weights = [];
  const indices = [];
  const stride = segsU + 1;

  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV;
    const pLuff = new THREE.Vector3().lerpVectors(throat, tack, v);
    const pLeech = new THREE.Vector3().lerpVectors(peak, clew, v);
    for (let iu = 0; iu <= segsU; iu++) {
      const u = iu / segsU;
      const pt = new THREE.Vector3().lerpVectors(pLuff, pLeech, u);
      const billow = Math.sin(u * Math.PI * 0.78) * Math.sin(v * Math.PI);
      pt.x -= bellySide * billow;
      pt.z += bellySide * 0.25 * billow;
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(u, 1 - v);
      weights.push(Math.pow(u, 1.2) * Math.sin(v * Math.PI));
    }
  }

  for (let iv = 0; iv < segsV; iv++) {
    for (let iu = 0; iu < segsU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aFlutterWeight', new THREE.Float32BufferAttribute(weights, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createTaperedYardMesh(width, maxR, mats) {
  const profile = [];
  const half = width * 0.5;
  const steps = 12;
  for (let i = -steps; i <= steps; i++) {
    const t = i / steps;
    profile.push(new THREE.Vector2(maxR * (1 - 0.56 * t * t), t * half));
  }
  const geo = new THREE.LatheGeometry(profile, 10);
  geo.rotateZ(Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, mats.darkWoodMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addCatenaryRope(parent, pStart, pEnd, sag, radius, mat, segs = 12) {
  const mid = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(pStart, mid, pEnd);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 5, false), mat);
  mesh.castShadow = radius > 0.024;
  parent.add(mesh);
  return mesh;
}

function createFightingTopPlatform(width, depth, mats) {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, depth), mats.darkWoodMat);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  for (const tx of [-0.36, 0.36]) {
    const trestle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, depth * 1.12), mats.darkWoodMat);
    trestle.position.set(tx, -0.16, 0);
    group.add(trestle);
  }

  const railH = 0.46;
  const corners = [
    new THREE.Vector3(-width * 0.46, 0.08, depth * 0.35),
    new THREE.Vector3(-width * 0.46, 0.08, -depth * 0.46),
    new THREE.Vector3(width * 0.46, 0.08, -depth * 0.46),
    new THREE.Vector3(width * 0.46, 0.08, depth * 0.35),
  ];
  for (const c of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, railH, 6), mats.mahoganyMat);
    post.position.set(c.x, c.y + railH * 0.5, c.z);
    group.add(post);
  }

  const railCurve = new THREE.CatmullRomCurve3(
    corners.map((c) => new THREE.Vector3(c.x, c.y + railH, c.z)),
    false,
    'catmullrom',
    0.05
  );
  group.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve, 12, 0.035, 6, false), mats.mahoganyMat));
  return group;
}

function addShroudsAndRatlines(parent, baseZ, topAnchor, numShrouds, numRatlines, mats, stayMat, ratlineMat) {
  if (!addShroudsAndRatlines._cache) {
    addShroudsAndRatlines._cache = {
      deadeye: new THREE.CylinderGeometry(0.11, 0.11, 0.07, 10),
      chain: new THREE.BoxGeometry(0.04, 0.72, 0.06),
    };
  }
  const s = zToHullParam(baseZ);
  const hullPt = sampleHullSurface(s, 0.92);

  for (const side of [1, -1]) {
    const channelLen = (numShrouds - 1) * 0.62 + 0.65;
    const channelBoard = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, channelLen), mats.darkWoodMat);
    channelBoard.position.set((hullPt.x + 0.22) * side, hullPt.y, baseZ - 0.35);
    channelBoard.castShadow = true;
    parent.add(channelBoard);

    const lowerPts = [];
    const upperPts = [];
    for (let i = 0; i < numShrouds; i++) {
      const zOff = (i - (numShrouds - 1) * 0.5) * 0.6 - 0.35;
      const p = sampleHullSurface(zToHullParam(baseZ + zOff), 0.92);
      const gx = (p.x + 0.42) * side;
      const gy = p.y + 0.32;
      const gz = baseZ + zOff;

      const deLow = new THREE.Mesh(addShroudsAndRatlines._cache.deadeye, mats.darkWoodMat);
      deLow.rotation.z = Math.PI * 0.5;
      deLow.position.set(gx, p.y + 0.1, gz);

      const deHigh = new THREE.Mesh(addShroudsAndRatlines._cache.deadeye, mats.darkWoodMat);
      deHigh.rotation.z = Math.PI * 0.5;
      deHigh.position.set(gx - 0.03 * side, gy, gz);

      const chainPlate = new THREE.Mesh(addShroudsAndRatlines._cache.chain, mats.ironMat);
      chainPlate.position.set((p.x + 0.1) * side, p.y - 0.32, gz);
      chainPlate.rotation.z = side * -0.22;
      parent.add(deLow, deHigh, chainPlate);

      const p0 = new THREE.Vector3(gx - 0.03 * side, gy, gz);
      const p1 = new THREE.Vector3(topAnchor.x + side * 0.42, topAnchor.y, topAnchor.z + (i - (numShrouds - 1) * 0.5) * 0.14);
      lowerPts.push(p0);
      upperPts.push(p1);
      addCatenaryRope(parent, p0, p1, 0, 0.024, stayMat, 4);
    }

    for (let r = 1; r <= numRatlines; r++) {
      const frac = r / (numRatlines + 1);
      const pA = new THREE.Vector3().lerpVectors(lowerPts[0], upperPts[0], frac);
      const pB = new THREE.Vector3().lerpVectors(lowerPts[numShrouds - 1], upperPts[numShrouds - 1], frac);
      addCatenaryRope(parent, pA, pB, 0.015, 0.011, ratlineMat, 4);
    }
  }
}

/**
 * 构建完整三桅索具、风帆与 GPU 长旒旗系统
 */
export function buildRiggingAndSails(mats, textures, runningRopeMat) {
  const rigGroup = new THREE.Group();
  const sailUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: DEFAULT_SUN_DIR.clone() },
    uWindStrength: { value: 1 },
    uSailTrimAngle: { value: 0 },
    uTranslucencyTint: { value: new THREE.Vector3(1.18, 0.66, 0.24) },
  };

  const plainSailMat = createSailMaterial(textures.sailPlain, sailUniforms);
  const stripedSailMat = createSailMaterial(textures.sailStriped, sailUniforms);
  const tarredStayMat = new THREE.MeshStandardMaterial({
    color: 0x261c15,
    bumpMap: textures.rope.bumpMap,
    bumpScale: 0.04,
    roughness: 0.9,
    metalness: 0.04,
  });
  const thinCordMat = new THREE.MeshStandardMaterial({ color: 0x8f724d, roughness: 0.88, metalness: 0.02 });
  const sparWoodMat = new THREE.MeshStandardMaterial({
    color: 0x4f301b,
    bumpMap: textures.hullPlanks.bumpMap,
    bumpScale: 0.05,
    roughness: 0.72,
    metalness: 0.05,
  });

  const yardBraceAngle = -0.21;
  const reefSails = [];
  let reefFactor = 0;

  function buildSteppedMast({ baseZ, baseY, rakeRad, lowerH, lowerR, topH, topR, tgallantH, tgallantR, topPlatformW }) {
    const mastContainer = new THREE.Group();
    mastContainer.position.set(0, baseY, baseZ);
    mastContainer.rotation.x = -rakeRad;

    const lowerMast = new THREE.Mesh(new THREE.CylinderGeometry(lowerR * 0.8, lowerR, lowerH, 14), sparWoodMat);
    lowerMast.position.y = lowerH * 0.5;
    lowerMast.castShadow = true;
    lowerMast.receiveShadow = true;
    mastContainer.add(lowerMast);

    for (let yHoop = 2; yHoop < lowerH - 1.5; yHoop += 2.2) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(lowerR * 0.96, lowerR * 0.96, 0.14, 14), mats.ironMat);
      hoop.position.y = yHoop;
      mastContainer.add(hoop);
    }

    const fightingTop = createFightingTopPlatform(topPlatformW, topPlatformW * 0.74, mats);
    fightingTop.position.set(0, lowerH - 0.65, 0.12);
    mastContainer.add(fightingTop);

    const topMastBaseY = lowerH - 1.15;
    const topMast = new THREE.Mesh(new THREE.CylinderGeometry(topR * 0.76, topR, topH, 12), sparWoodMat);
    topMast.position.set(0, topMastBaseY + topH * 0.5, lowerR * 0.95);
    topMast.castShadow = true;
    mastContainer.add(topMast);

    const crossTreeY = topMastBaseY + topH - 0.55;
    const crossTree = new THREE.Mesh(new THREE.BoxGeometry(topPlatformW * 0.64, 0.12, 0.14), mats.darkWoodMat);
    crossTree.position.set(0, crossTreeY, lowerR * 0.95);
    mastContainer.add(crossTree);

    let truckY = crossTreeY + 0.55;
    let truckZ = lowerR * 0.95;
    if (tgallantH > 0) {
      const tgBaseY = crossTreeY - 0.45;
      const tgMast = new THREE.Mesh(new THREE.CylinderGeometry(tgallantR * 0.55, tgallantR, tgallantH, 10), sparWoodMat);
      tgMast.position.set(0, tgBaseY + tgallantH * 0.5, lowerR * 1.48);
      tgMast.castShadow = true;
      mastContainer.add(tgMast);
      truckY = tgBaseY + tgallantH;
      truckZ = lowerR * 1.48;
    }

    const truckCap = new THREE.Mesh(new THREE.SphereGeometry(lowerR * 0.42, 10, 8), mats.goldMat);
    truckCap.position.set(0, truckY + 0.08, truckZ);
    mastContainer.add(truckCap);

    rigGroup.add(mastContainer);
    mastContainer.updateMatrixWorld(true);

    const toShipSpace = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(mastContainer.matrix);
    return {
      mastContainer,
      toShipSpace,
      fightingTopPos: toShipSpace(0, lowerH - 0.65, 0.12),
      crossTreePos: toShipSpace(0, crossTreeY, lowerR * 0.95),
      truckPos: toShipSpace(0, truckY + 0.08, truckZ),
      lowerForwardZ: lowerR + 0.2,
      topForwardZ: lowerR * 0.95 + topR + 0.16,
      tgForwardZ: lowerR * 1.48 + tgallantR + 0.14,
    };
  }

  const foreMast = buildSteppedMast({
    baseZ: 9.0,
    baseY: 2.85,
    rakeRad: 0.022,
    lowerH: 10.6,
    lowerR: 0.33,
    topH: 7.8,
    topR: 0.22,
    tgallantH: 5.4,
    tgallantR: 0.13,
    topPlatformW: 2.55,
  });
  const mainMast = buildSteppedMast({
    baseZ: 0.4,
    baseY: 1.45,
    rakeRad: 0.032,
    lowerH: 13.8,
    lowerR: 0.39,
    topH: 9.2,
    topR: 0.26,
    tgallantH: 6.4,
    tgallantR: 0.15,
    topPlatformW: 2.95,
  });
  const mizzenMast = buildSteppedMast({
    baseZ: -5.3,
    baseY: 3.15,
    rakeRad: 0.046,
    lowerH: 9.8,
    lowerR: 0.29,
    topH: 6.8,
    topR: 0.19,
    tgallantH: 4.4,
    tgallantR: 0.11,
    topPlatformW: 2.15,
  });

  function mountYardAndSquareSail({
    mastObj,
    localY,
    localZ,
    yardWidth,
    yardRadius,
    sailBottomWidth,
    sailHeight,
    bellyDepth,
    footArch,
    striped,
    braceAnchorZ,
    braceAnchorY,
    lowerYardTips,
    canReef = false,
  }) {
    const yardGroup = new THREE.Group();
    yardGroup.position.set(0, localY, localZ);
    yardGroup.rotation.y = yardBraceAngle;
    yardGroup.add(createTaperedYardMesh(yardWidth, yardRadius, mats));

    for (const side of [-1, 1]) {
      addCatenaryRope(
        yardGroup,
        new THREE.Vector3(side * 0.35, -0.05, 0),
        new THREE.Vector3(side * yardWidth * 0.46, -0.04, 0),
        0.38,
        0.012,
        thinCordMat,
        8
      );
    }

    const sailGeo = createSquareSailGeometry({
      topWidth: yardWidth * 0.92,
      bottomWidth: sailBottomWidth,
      height: sailHeight,
      bellyDepth,
      footArch,
    });
    const activeMat = striped ? stripedSailMat : plainSailMat;
    const sailMesh = new THREE.Mesh(sailGeo, activeMat);
    sailMesh.customDepthMaterial = activeMat.userData.depthMat;
    sailMesh.position.set(0, -0.06, 0.05);
    sailMesh.castShadow = true;
    sailMesh.receiveShadow = true;
    yardGroup.add(sailMesh);

    if (canReef) reefSails.push(sailMesh);

    if (sailHeight >= 5.2 && !canReef) {
      const ry = -0.34 * sailHeight;
      const halfSpan = (yardWidth * 0.92 * 0.5 * (1 - 0.34) + sailBottomWidth * 0.5 * 0.34) * 0.88;
      const count = Math.floor((halfSpan * 2) / 0.95);
      const reefPointGeo =
        mountYardAndSquareSail._reefGeo ||
        (mountYardAndSquareSail._reefGeo = new THREE.CylinderGeometry(0.008, 0.006, 0.44, 4));
      for (let i = 0; i <= count; i++) {
        const nx = (i / count) * 2 - 1;
        const px = nx * halfSpan;
        const belly = Math.sin(Math.pow(0.34, 0.78) * Math.PI) * (1 - 0.52 * nx * nx);
        const pz = bellyDepth * belly + 0.07;
        const cord = new THREE.Mesh(reefPointGeo, thinCordMat);
        cord.position.set(px, ry - 0.2, pz + 0.04);
        cord.rotation.x = 0.16;
        yardGroup.add(cord);
      }
    }

    mastObj.mastContainer.add(yardGroup);
    mastObj.mastContainer.updateMatrixWorld(true);
    yardGroup.updateMatrixWorld(true);

    const yardToRig = (lx, ly, lz) => {
      const v = new THREE.Vector3(lx, ly, lz);
      yardGroup.localToWorld(v);
      rigGroup.worldToLocal(v);
      return v;
    };

    const tipPort = yardToRig(-yardWidth * 0.49, 0, 0);
    const tipStbd = yardToRig(yardWidth * 0.49, 0, 0);
    const clewPort = yardToRig(-sailBottomWidth * 0.5, -sailHeight, 0.08);
    const clewStbd = yardToRig(sailBottomWidth * 0.5, -sailHeight, 0.08);

    const anchorHull = sampleHullSurface(zToHullParam(braceAnchorZ), 0.96);
    addCatenaryRope(
      rigGroup,
      tipPort,
      new THREE.Vector3(-(anchorHull.x - 0.15), Math.max(braceAnchorY, anchorHull.y), braceAnchorZ),
      0.32,
      0.016,
      runningRopeMat,
      10
    );
    addCatenaryRope(
      rigGroup,
      tipStbd,
      new THREE.Vector3(anchorHull.x - 0.15, Math.max(braceAnchorY, anchorHull.y), braceAnchorZ),
      0.32,
      0.016,
      runningRopeMat,
      10
    );

    if (lowerYardTips) {
      addCatenaryRope(rigGroup, clewPort, lowerYardTips[0], 0.12, 0.016, runningRopeMat, 6);
      addCatenaryRope(rigGroup, clewStbd, lowerYardTips[1], 0.12, 0.016, runningRopeMat, 6);
    } else {
      const sheetZ = clewPort.z - 2.4;
      const sheetHull = sampleHullSurface(zToHullParam(sheetZ), 0.98);
      addCatenaryRope(rigGroup, clewPort, new THREE.Vector3(-(sheetHull.x - 0.15), sheetHull.y, sheetZ), 0.24, 0.018, runningRopeMat, 8);
      addCatenaryRope(rigGroup, clewStbd, new THREE.Vector3(sheetHull.x - 0.15, sheetHull.y, sheetZ), 0.24, 0.018, runningRopeMat, 8);
    }
    return [tipPort, tipStbd];
  }

  // 前桅三层横帆
  const foreCourseTips = mountYardAndSquareSail({
    mastObj: foreMast,
    localY: 9.0,
    localZ: foreMast.lowerForwardZ,
    yardWidth: 10.6,
    yardRadius: 0.19,
    sailBottomWidth: 9.8,
    sailHeight: 5.4,
    bellyDepth: 1.65,
    footArch: 0.78,
    striped: false,
    braceAnchorZ: 1.5,
    braceAnchorY: 2.95,
    lowerYardTips: null,
  });
  const foreTopTips = mountYardAndSquareSail({
    mastObj: foreMast,
    localY: 16.2,
    localZ: foreMast.topForwardZ,
    yardWidth: 8.8,
    yardRadius: 0.15,
    sailBottomWidth: 10.0,
    sailHeight: 6.9,
    bellyDepth: 1.85,
    footArch: 0.35,
    striped: true,
    braceAnchorZ: 0.8,
    braceAnchorY: 6.5,
    lowerYardTips: foreCourseTips,
  });
  mountYardAndSquareSail({
    mastObj: foreMast,
    localY: 21.3,
    localZ: foreMast.tgForwardZ,
    yardWidth: 6.2,
    yardRadius: 0.11,
    sailBottomWidth: 8.2,
    sailHeight: 4.9,
    bellyDepth: 1.25,
    footArch: 0.22,
    striped: false,
    braceAnchorZ: 0.6,
    braceAnchorY: 13.5,
    lowerYardTips: foreTopTips,
    canReef: true,
  });

  // 主桅三层横帆
  const mainCourseTips = mountYardAndSquareSail({
    mastObj: mainMast,
    localY: 11.9,
    localZ: mainMast.lowerForwardZ,
    yardWidth: 12.8,
    yardRadius: 0.22,
    sailBottomWidth: 11.8,
    sailHeight: 6.8,
    bellyDepth: 2.15,
    footArch: 0.95,
    striped: false,
    braceAnchorZ: -6.8,
    braceAnchorY: 3.8,
    lowerYardTips: null,
  });
  const mainTopTips = mountYardAndSquareSail({
    mastObj: mainMast,
    localY: 20.6,
    localZ: mainMast.topForwardZ,
    yardWidth: 10.5,
    yardRadius: 0.17,
    sailBottomWidth: 12.0,
    sailHeight: 8.3,
    bellyDepth: 2.35,
    footArch: 0.42,
    striped: true,
    braceAnchorZ: -6.2,
    braceAnchorY: 7.5,
    lowerYardTips: mainCourseTips,
  });
  mountYardAndSquareSail({
    mastObj: mainMast,
    localY: 26.8,
    localZ: mainMast.tgForwardZ,
    yardWidth: 7.4,
    yardRadius: 0.12,
    sailBottomWidth: 9.8,
    sailHeight: 5.9,
    bellyDepth: 1.55,
    footArch: 0.26,
    striped: false,
    braceAnchorZ: -5.6,
    braceAnchorY: 12.2,
    lowerYardTips: mainTopTips,
    canReef: true,
  });

  // 后桅下横桁、中桅横帆与船尾纵帆（Spanker）
  const crossjackYard = new THREE.Group();
  crossjackYard.position.set(0, 8.6, mizzenMast.lowerForwardZ);
  crossjackYard.rotation.y = yardBraceAngle;
  crossjackYard.add(createTaperedYardMesh(8.4, 0.15, mats));
  mizzenMast.mastContainer.add(crossjackYard);
  mizzenMast.mastContainer.updateMatrixWorld(true);
  crossjackYard.updateMatrixWorld(true);

  const cjTipPort = new THREE.Vector3(-4.1, 0, 0).applyMatrix4(crossjackYard.matrixWorld);
  const cjTipStbd = new THREE.Vector3(4.1, 0, 0).applyMatrix4(crossjackYard.matrixWorld);

  mountYardAndSquareSail({
    mastObj: mizzenMast,
    localY: 14.8,
    localZ: mizzenMast.topForwardZ,
    yardWidth: 6.8,
    yardRadius: 0.13,
    sailBottomWidth: 7.9,
    sailHeight: 5.9,
    bellyDepth: 1.45,
    footArch: 0.28,
    striped: true,
    braceAnchorZ: -13.2,
    braceAnchorY: 5.4,
    lowerYardTips: [cjTipPort, cjTipStbd],
    canReef: true,
  });

  const spankerThroat = mizzenMast.toShipSpace(0, 7.8, -0.28);
  const spankerTack = mizzenMast.toShipSpace(0, 3.35, -0.26);
  const spankerClew = new THREE.Vector3(-1.45, spankerTack.y + 0.35, -15.35);
  const spankerPeak = new THREE.Vector3(-1.18, spankerThroat.y + 3.45, -14.45);

  const boomCurve = new THREE.LineCurve3(spankerTack, new THREE.Vector3(-1.55, spankerTack.y + 0.38, -15.75));
  const boomMesh = new THREE.Mesh(new THREE.TubeGeometry(boomCurve, 8, 0.11, 8, false), sparWoodMat);
  boomMesh.castShadow = true;
  const gaffCurve = new THREE.LineCurve3(spankerThroat, new THREE.Vector3(-1.25, spankerThroat.y + 3.65, -14.85));
  const gaffMesh = new THREE.Mesh(new THREE.TubeGeometry(gaffCurve, 8, 0.09, 8, false), sparWoodMat);
  gaffMesh.castShadow = true;
  rigGroup.add(boomMesh, gaffMesh);

  const spankerMesh = new THREE.Mesh(
    createSpankerGeometry(spankerThroat, spankerPeak, spankerTack, spankerClew, 1.15),
    plainSailMat
  );
  spankerMesh.customDepthMaterial = plainSailMat.userData.depthMat;
  spankerMesh.castShadow = true;
  spankerMesh.receiveShadow = true;
  rigGroup.add(spankerMesh);

  addCatenaryRope(rigGroup, mizzenMast.fightingTopPos, spankerPeak, 0.08, 0.018, runningRopeMat, 8);
  addCatenaryRope(rigGroup, mizzenMast.crossTreePos, spankerPeak, 0.05, 0.016, runningRopeMat, 8);
  addCatenaryRope(rigGroup, mizzenMast.fightingTopPos, spankerClew, 0.14, 0.016, runningRopeMat, 8);
  addCatenaryRope(rigGroup, spankerClew, new THREE.Vector3(-2.1, 5.45, -14.2), 0.22, 0.018, runningRopeMat, 8);

  // 船首斜桅（Bowsprit + Jibboom）与三道船首三角帆（Jibs）
  const bowspritRoot = new THREE.Vector3(0, 3.48, 12.6);
  const bowspritCap = new THREE.Vector3(0, 6.45, 19.6);
  const jibboomTip = new THREE.Vector3(0, 8.35, 24.8);

  const bowspritMesh = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.LineCurve3(bowspritRoot, bowspritCap), 10, 0.26, 10, false),
    sparWoodMat
  );
  bowspritMesh.castShadow = true;

  const jibboomMesh = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 6.22, 18.8), jibboomTip), 10, 0.14, 8, false),
    sparWoodMat
  );
  jibboomMesh.castShadow = true;

  const capBlock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 0.34), mats.ironMat);
  capBlock.position.copy(bowspritCap);
  capBlock.rotation.x = -0.39;

  const dolphinStrikerTip = new THREE.Vector3(0, 4.35, 20.15);
  const dolphinStriker = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.LineCurve3(bowspritCap, dolphinStrikerTip), 4, 0.065, 6, false),
    sparWoodMat
  );
  rigGroup.add(bowspritMesh, jibboomMesh, capBlock, dolphinStriker);

  addCatenaryRope(rigGroup, new THREE.Vector3(0, 3.25, 14.9), bowspritCap, 0.05, 0.028, tarredStayMat, 6);
  addCatenaryRope(rigGroup, new THREE.Vector3(0, 3.85, 15.6), dolphinStrikerTip, 0.04, 0.022, tarredStayMat, 6);
  addCatenaryRope(rigGroup, dolphinStrikerTip, jibboomTip, 0.04, 0.02, tarredStayMat, 6);

  const stayTop1 = foreMast.fightingTopPos.clone().add(new THREE.Vector3(0, 0.3, 0.35));
  const stayTop2 = foreMast.crossTreePos.clone().add(new THREE.Vector3(0, -0.2, 0.25));
  const stayTop3 = foreMast.truckPos.clone().add(new THREE.Vector3(0, -0.5, 0.15));
  const stayTack1 = new THREE.Vector3(0, 5.42, 17.15);
  const stayTack2 = new THREE.Vector3(0, 6.82, 20.65);
  const stayTack3 = new THREE.Vector3(0, 8.18, 24.35);

  addCatenaryRope(rigGroup, stayTop1, stayTack1, 0, 0.032, tarredStayMat, 6);
  addCatenaryRope(rigGroup, stayTop2, stayTack2, 0, 0.026, tarredStayMat, 6);
  addCatenaryRope(rigGroup, stayTop3, stayTack3, 0, 0.02, tarredStayMat, 6);

  const jibs = [
    { head: stayTop1.clone().lerp(stayTack1, 0.06), tack: stayTack1, clew: new THREE.Vector3(-1.35, 4.45, 11.4), belly: new THREE.Vector3(-0.78, 0.08, 0.42), mat: plainSailMat },
    { head: stayTop2.clone().lerp(stayTack2, 0.08), tack: stayTack2, clew: new THREE.Vector3(-1.55, 5.25, 14.2), belly: new THREE.Vector3(-0.92, 0.1, 0.48), mat: stripedSailMat },
    { head: stayTop3.clone().lerp(stayTack3, 0.1), tack: stayTack3, clew: new THREE.Vector3(-1.45, 6.15, 17.6), belly: new THREE.Vector3(-0.85, 0.1, 0.45), mat: plainSailMat },
  ];
  for (const jb of jibs) {
    const jibMesh = new THREE.Mesh(createTriangularJibGeometry(jb.head, jb.tack, jb.clew, jb.belly), jb.mat);
    jibMesh.customDepthMaterial = jb.mat.userData.depthMat;
    jibMesh.castShadow = true;
    jibMesh.receiveShadow = true;
    rigGroup.add(jibMesh);
    addCatenaryRope(rigGroup, jb.clew, new THREE.Vector3(-2.35, 4.15, 11.2), 0.18, 0.016, runningRopeMat, 6);
  }

  // 三桅侧支索绳梯（Shrouds & Ratlines）与前后支索（Stays & Backstays）
  addShroudsAndRatlines(rigGroup, 9.0, foreMast.fightingTopPos, 4, 15, mats, tarredStayMat, thinCordMat);
  addShroudsAndRatlines(rigGroup, 0.4, mainMast.fightingTopPos, 5, 19, mats, tarredStayMat, thinCordMat);
  addShroudsAndRatlines(rigGroup, -5.3, mizzenMast.fightingTopPos, 4, 14, mats, tarredStayMat, thinCordMat);

  for (const mItem of [
    { obj: foreMast, w: 1.15 },
    { obj: mainMast, w: 1.35 },
    { obj: mizzenMast, w: 0.98 },
  ]) {
    for (const side of [-1, 1]) {
      for (const zOff of [-0.22, 0.22]) {
        addCatenaryRope(
          rigGroup,
          mItem.obj.fightingTopPos.clone().add(new THREE.Vector3(side * mItem.w, 0.05, zOff)),
          mItem.obj.crossTreePos.clone().add(new THREE.Vector3(side * 0.22, 0, zOff * 0.3)),
          0,
          0.016,
          tarredStayMat,
          4
        );
      }
    }
  }

  addCatenaryRope(rigGroup, mainMast.fightingTopPos, new THREE.Vector3(0, 3.25, 8.6), 0, 0.036, tarredStayMat, 6);
  addCatenaryRope(rigGroup, mainMast.crossTreePos, foreMast.fightingTopPos, 0, 0.024, tarredStayMat, 6);
  addCatenaryRope(rigGroup, mainMast.truckPos, foreMast.crossTreePos, 0, 0.018, tarredStayMat, 6);
  addCatenaryRope(rigGroup, mizzenMast.fightingTopPos, new THREE.Vector3(0, 3.2, 0.1), 0, 0.028, tarredStayMat, 6);
  addCatenaryRope(rigGroup, mizzenMast.crossTreePos, mainMast.fightingTopPos, 0, 0.02, tarredStayMat, 6);
  addCatenaryRope(rigGroup, mizzenMast.truckPos, mainMast.crossTreePos, 0, 0.016, tarredStayMat, 6);

  for (const side of [-1, 1]) {
    const pFore = sampleHullSurface(zToHullParam(6.2), 0.94);
    addCatenaryRope(rigGroup, foreMast.truckPos, new THREE.Vector3(pFore.x * side, pFore.y, 6.2), 0, 0.016, tarredStayMat, 6);
    const pMain = sampleHullSurface(zToHullParam(-2.8), 0.94);
    addCatenaryRope(rigGroup, mainMast.truckPos, new THREE.Vector3(pMain.x * side, pMain.y, -2.8), 0, 0.018, tarredStayMat, 6);
    const pMiz = sampleHullSurface(zToHullParam(-8.6), 0.94);
    addCatenaryRope(rigGroup, mizzenMast.truckPos, new THREE.Vector3(pMiz.x * side, pMiz.y, -8.6), 0, 0.015, tarredStayMat, 6);
  }

  // 三桅合并单网格 GPU 长旒旗（零 CPU 顶点循环）
  const pennantSpecs = [
    { pos: mainMast.truckPos, len: 6.4, h: 0.66, phase: 0 },
    { pos: foreMast.truckPos, len: 4.6, h: 0.5, phase: 1.7 },
    { pos: mizzenMast.truckPos, len: 4.2, h: 0.46, phase: 3.3 },
  ];
  const pPos = [];
  const pNorm = [];
  const pCol = [];
  const pUv = [];
  const pMeta = [];
  const pIdx = [];
  let pVOff = 0;
  const cosPR = Math.cos(-0.46);
  const sinPR = Math.sin(-0.46);

  for (const spec of pennantSpecs) {
    for (let row = 0; row <= 6; row++) {
      const f = row / 6;
      for (let col = 0; col <= 28; col++) {
        const uFrac = col / 28;
        const halfH = spec.h * 0.5 * (1 - 0.62 * uFrac);
        let zLoc = uFrac * spec.len;
        if (uFrac > 0.72) {
          const notch = (1 - Math.abs(f * 2 - 1)) * 0.85;
          zLoc -= ((uFrac - 0.72) / 0.28) * notch;
        }
        const yLoc = (f - 0.5) * 2 * halfH;
        pPos.push(spec.pos.x + zLoc * sinPR, spec.pos.y + 0.05 + yLoc, spec.pos.z + zLoc * cosPR);
        pNorm.push(cosPR, 0, -sinPR);
        pUv.push(uFrac, f);
        if (f > 0.22 && f < 0.78) pCol.push(0.68, 0.14, 0.12);
        else pCol.push(0.14, 0.11, 0.1);
        pMeta.push(zLoc / spec.len, spec.phase, 1 / spec.len);
      }
    }
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 28; col++) {
        const i0 = pVOff + row * 29 + col;
        const i1 = i0 + 1;
        const i2 = i0 + 29;
        const i3 = i2 + 1;
        pIdx.push(i0, i2, i1, i1, i2, i3);
      }
    }
    pVOff += 7 * 29;
  }

  const pennantGeo = new THREE.BufferGeometry();
  pennantGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
  pennantGeo.setAttribute('normal', new THREE.Float32BufferAttribute(pNorm, 3));
  pennantGeo.setAttribute('color', new THREE.Float32BufferAttribute(pCol, 3));
  pennantGeo.setAttribute('uv', new THREE.Float32BufferAttribute(pUv, 2));
  pennantGeo.setAttribute('aPennantMeta', new THREE.Float32BufferAttribute(pMeta, 3));
  pennantGeo.setIndex(pIdx);
  pennantGeo.computeBoundingBox();
  pennantGeo.computeBoundingSphere();
  pennantGeo.boundingSphere.radius += 2.2;

  const PENNANT_WAVE_GLSL = `
    attribute vec3 aPennantMeta;
    uniform float uTime;
    uniform float uWindStrength;
    void evalPennantWave(vec3 meta, out vec3 disp, out vec3 rigNorm) {
      float ft = max(meta.x, 0.0);
      float ph = meta.y;
      float invLen = meta.z;
      float ampScale = 0.46 * (0.8 + 0.35 * uWindStrength);
      float gt = pow(ft, 1.25) * ampScale;
      float xt = 7.8 * (0.85 + 0.35 * uWindStrength);
      float w1 = ft * 8.5 - uTime * xt + ph;
      float w2 = ft * 15.0 - uTime * xt * 1.55;
      float w3 = ft * 6.2 - uTime * xt * 0.82 + ph;
      float Ot = sin(w1) * gt + sin(w2) * gt * 0.28;
      float pt = cos(w3) * gt * 0.36;
      const float cosR = 0.8960524;
      const float sinR = -0.4439481;
      disp = vec3(Ot * cosR, pt, -Ot * sinR);
      float dgt = 1.25 * pow(max(ft, 0.001), 0.25) * ampScale;
      float sTerm = sin(w1) + 0.28 * sin(w2);
      float dsTerm = 8.5 * cos(w1) + 4.2 * cos(w2);
      float dOtDz = (dgt * sTerm + gt * dsTerm) * invLen;
      vec3 nLoc = normalize(vec3(1.0, 0.0, -dOtDz));
      rigNorm = normalize(vec3(nLoc.x * cosR + nLoc.z * sinR, 0.0, -nLoc.x * sinR + nLoc.z * cosR));
    }
  `;

  const pennantMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  pennantMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sailUniforms.uTime;
    sh.uniforms.uWindStrength = sailUniforms.uWindStrength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${PENNANT_WAVE_GLSL}`)
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvec3 _pDisp, _pNorm;\nevalPennantWave(aPennantMeta, _pDisp, _pNorm);\nobjectNormal = _pNorm;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += _pDisp;');
  };

  const pennantDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  pennantDepthMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sailUniforms.uTime;
    sh.uniforms.uWindStrength = sailUniforms.uWindStrength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${PENNANT_WAVE_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvec3 _pDisp, _pNorm;\nevalPennantWave(aPennantMeta, _pDisp, _pNorm);\ntransformed += _pDisp;'
      );
  };

  const pennantMesh = new THREE.Mesh(pennantGeo, pennantMat);
  pennantMesh.customDepthMaterial = pennantDepthMat;
  pennantMesh.castShadow = true;
  rigGroup.add(pennantMesh);

  return {
    rigGroup,
    sailUniforms,
    update(time, state, dt = 0.016, relWind = 0) {
      const windStrength = state ? state.windSpeedScale : 1;
      sailUniforms.uTime.value = time;
      sailUniforms.uWindStrength.value = windStrength;

      // 随船首航向与风向相对角动态扭转帆面迎角（GPU 顶点着色器与阴影贴图同步生效）
      const targetTrim = Math.sin(relWind) * 0.14;
      sailUniforms.uSailTrimAngle.value +=
        (targetTrim - sailUniforms.uSailTrimAngle.value) * (1 - Math.exp(-dt * 2.5));

      if (state) {
        sailUniforms.uSunDir.value.copy(state.sunDir);
        const clearFactor = 1 - state.storminess * 0.78;
        sailUniforms.uTranslucencyTint.value.set(
          state.sunLightColor[0] * 1.15 * clearFactor,
          state.sunLightColor[1] * 1.02 * clearFactor,
          state.sunLightColor[2] * 0.9 * clearFactor
        );

        // 暴风雨或海啸来袭时自动向上收卷顶层横帆
        const targetReef =
          state.storminess > 0.42 || state.tsunamiMode > 0.32
            ? Math.min(1, Math.max(state.storminess, state.tsunamiMode))
            : 0;
        reefFactor += (targetReef - reefFactor) * (1 - Math.exp(-dt * 1.35));
        const sy = 1 - 0.82 * reefFactor;
        const sz = 1 - 0.55 * reefFactor;
        for (const rs of reefSails) rs.scale.set(1, sy, sz);
      }
    },
  };
}
