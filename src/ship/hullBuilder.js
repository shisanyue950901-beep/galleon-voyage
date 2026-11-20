/**
 * @file hullBuilder.js
 * @description 古帆船主船壳与建筑构件建模模块：
 *              包含内外双层木板船壳（带动态破浪吃水线浸湿高光着色器）、龙骨与防撞护舷木（Wales）、
 *              四段阶梯甲板、舱壁门窗、车木立柱栏杆、甲板木梯、两侧 10 门可开合炮门盖与可回退炮管的底层火炮、
 *              艉楼五联发光雕花尾窗、两侧悬挑官舱灯廊、可随掌舵偏转的船尾舵叶枢轴（rudderPivot）以及船首金色雕刻像。
 */

import * as THREE from 'three';
import {
  clampVal,
  smoothBand,
  evaluateHullSection,
  zToHullParam,
  sampleHullSurface,
  getDeckHeightAtZ,
  getDeckHalfWidthAtZ,
} from './hullCurve.js';

/** 构建双侧内外壁船壳与封尾镜板 BufferGeometry（带水线污渍与绛红彩绘顶点色） */
function createHullShellGeometry(segsZ = 96, segsV = 36) {
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const strideV = segsV + 1;

  for (const side of [1, -1]) {
    const outerBase = positions.length / 3;
    for (let iz = 0; iz <= segsZ; iz++) {
      const s = iz / segsZ;
      for (let iv = 0; iv <= segsV; iv++) {
        const v = iv / segsV;
        const pt = sampleHullSurface(s, v);
        positions.push(pt.x * side, pt.y, pt.z);
        uvs.push(s * 7.5, v * 3.2);

        let r = 1.0;
        let g = 0.95;
        let b = 0.88;
        if (v < 0.35) {
          const w = smoothBand(0.28, 0.36, v);
          r = 0.42 + 0.58 * w;
          g = 0.36 + 0.59 * w;
          b = 0.34 + 0.54 * w;
        } else if (v > 0.72 && v < 0.89) {
          r = 1.12;
          g = 0.36;
          b = 0.3;
        } else if (v >= 0.89) {
          r = 0.68;
          g = 0.52;
          b = 0.42;
        }

        const waterlineDist = Math.abs(pt.y - 0.05);
        if (waterlineDist < 0.45) {
          const darken = 1 - 0.28 * (1 - waterlineDist / 0.45);
          r *= darken;
          g *= darken;
          b *= darken;
        }
        colors.push(r, g, b);
      }
    }

    for (let iz = 0; iz < segsZ; iz++) {
      for (let iv = 0; iv < segsV; iv++) {
        const a = outerBase + iz * strideV + iv;
        const b = outerBase + (iz + 1) * strideV + iv;
        const c = outerBase + iz * strideV + (iv + 1);
        const d = outerBase + (iz + 1) * strideV + (iv + 1);
        if (side === 1) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }

    // 舷墙内壁与顶盖封边
    const innerSegs = 10;
    const innerStride = innerSegs + 1;
    const innerBase = positions.length / 3;
    for (let iz = 0; iz <= segsZ; iz++) {
      const s = iz / segsZ;
      const wallThick = 0.24 * Math.sin(Math.PI * clampVal(s, 0.02, 0.98));
      for (let iv = 0; iv <= innerSegs; iv++) {
        const v = 0.55 + (iv / innerSegs) * 0.45;
        const pt = sampleHullSurface(s, v);
        const innerX = Math.max(0, pt.x - wallThick) * side;
        positions.push(innerX, pt.y, pt.z);
        uvs.push(s * 7.5, v * 3.2);
        colors.push(0.76, 0.62, 0.48);
      }
    }

    for (let iz = 0; iz < segsZ; iz++) {
      for (let iv = 0; iv < innerSegs; iv++) {
        const a = innerBase + iz * innerStride + iv;
        const b = innerBase + (iz + 1) * innerStride + iv;
        const c = innerBase + iz * innerStride + (iv + 1);
        const d = innerBase + (iz + 1) * innerStride + (iv + 1);
        if (side === 1) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
      const oa = outerBase + iz * strideV + segsV;
      const ob = outerBase + (iz + 1) * strideV + segsV;
      const ia = innerBase + iz * innerStride + innerSegs;
      const ib = innerBase + (iz + 1) * innerStride + innerSegs;
      if (side === 1) indices.push(ia, ib, oa, oa, ib, ob);
      else indices.push(ia, oa, ib, oa, ob, ib);
    }
  }

  // 船尾微拱封板（Transom）
  const transomBase = positions.length / 3;
  const transomCols = 16;
  for (let iv = 0; iv <= segsV; iv++) {
    const v = iv / segsV;
    const pt = sampleHullSurface(0, v);
    for (let ic = 0; ic <= transomCols; ic++) {
      const nx = (ic / transomCols) * 2 - 1;
      const camberZ = (1 - nx * nx) * -0.28;
      const archY = (1 - nx * nx) * 0.14 * smoothBand(0.5, 1.0, v);
      positions.push(pt.x * nx, pt.y + archY, pt.z + camberZ);
      uvs.push((nx * 0.5 + 0.5) * 3.8, v * 4.2);
      if (v > 0.68) colors.push(0.88, 0.34, 0.28);
      else colors.push(0.68, 0.54, 0.44);
    }
  }

  const tStride = transomCols + 1;
  for (let iv = 0; iv < segsV; iv++) {
    for (let ic = 0; ic < transomCols; ic++) {
      const a = transomBase + iv * tStride + ic;
      const b = a + 1;
      const c = a + tStride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 构建带横向排水脊弧（Camber）的甲板网格 */
function createCamberedDeckGeometry(zStart, zEnd, segsZ = 28, segsX = 14, vRef = 0.84) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const stride = segsX + 1;

  for (let iz = 0; iz <= segsZ; iz++) {
    const t = iz / segsZ;
    const z = zStart + (zEnd - zStart) * t;
    const yBase = getDeckHeightAtZ(z);
    const halfW = getDeckHalfWidthAtZ(z, vRef) + 0.08;
    for (let ix = 0; ix <= segsX; ix++) {
      const nx = (ix / segsX) * 2 - 1;
      const camber = (1 - nx * nx) * 0.14;
      positions.push(nx * halfW, yBase + camber, z);
      uvs.push(nx * halfW * 0.42, z * 0.22);
    }
  }

  for (let iz = 0; iz < segsZ; iz++) {
    for (let ix = 0; ix < segsX; ix++) {
      const a = iz * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 构建沿船壳纵向延伸的凸出防撞护舷木条（Wales）与金边装饰带 */
function createHullWaleStrips(vLevel, radius, mat, sStart = 0, sEnd = 0.992, segs = 64) {
  const group = new THREE.Group();
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const s = sStart + (sEnd - sStart) * (i / segs);
      const p = sampleHullSurface(s, vLevel);
      pts.push(new THREE.Vector3((p.x + radius * 0.42) * side, p.y, p.z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, segs, radius, 6, false);
    const mesh = new THREE.Mesh(tube, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function createBalusterGeometry() {
  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.055, 0),
    new THREE.Vector2(0.055, 0.08),
    new THREE.Vector2(0.032, 0.14),
    new THREE.Vector2(0.062, 0.3),
    new THREE.Vector2(0.028, 0.48),
    new THREE.Vector2(0.048, 0.62),
    new THREE.Vector2(0.036, 0.72),
    new THREE.Vector2(0.052, 0.78),
    new THREE.Vector2(0, 0.78),
  ];
  return new THREE.LatheGeometry(profile, 8);
}

function createBalustradeRailing(points, height, balusterGeo, woodMat, goldMat, spacing = 0.46) {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points);
  const totalLen = curve.getLength();
  const count = Math.max(2, Math.round(totalLen / spacing));

  for (let i = 0; i <= count; i++) {
    const pt = curve.getPointAt(i / count);
    const post = new THREE.Mesh(balusterGeo, i === 0 || i === count ? goldMat : woodMat);
    post.scale.set(1, height / 0.78, 1);
    post.position.copy(pt);
    post.castShadow = true;
    group.add(post);
  }

  const railPts = points.map((p) => new THREE.Vector3(p.x, p.y + height, p.z));
  const railCurve = new THREE.CatmullRomCurve3(railPts);
  const topRail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, Math.max(12, count * 2), 0.065, 8, false), woodMat);
  topRail.castShadow = true;
  group.add(topRail);
  return group;
}

function createDeckStairway(xCenter, zBottom, yBottom, zTop, yTop, width, stepMat, railMat) {
  const group = new THREE.Group();
  const steps = 8;
  const dz = zTop - zBottom;
  const dy = yTop - yBottom;
  const treadGeo = new THREE.BoxGeometry(width, 0.07, Math.abs(dz) / steps + 0.08);

  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const tread = new THREE.Mesh(treadGeo, stepMat);
    tread.position.set(xCenter, yBottom + dy * t, zBottom + dz * t);
    tread.castShadow = true;
    tread.receiveShadow = true;
    group.add(tread);
  }

  for (const side of [-1, 1]) {
    const rx = xCenter + side * (width * 0.5 + 0.04);
    const stringerCurve = new THREE.LineCurve3(
      new THREE.Vector3(rx, yBottom + 0.05, zBottom),
      new THREE.Vector3(rx, yTop + 0.05, zTop)
    );
    const stringer = new THREE.Mesh(new THREE.TubeGeometry(stringerCurve, 2, 0.06, 6, false), railMat);
    stringer.castShadow = true;
    group.add(stringer);

    const handrailCurve = new THREE.LineCurve3(
      new THREE.Vector3(rx, yBottom + 0.78, zBottom),
      new THREE.Vector3(rx, yTop + 0.78, zTop)
    );
    const handrail = new THREE.Mesh(new THREE.TubeGeometry(handrailCurve, 2, 0.045, 6, false), railMat);
    handrail.castShadow = true;
    group.add(handrail);

    for (const frac of [0, 0.5, 1]) {
      const newel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.044, 0.78, 8), railMat);
      newel.position.set(rx, yBottom + dy * frac + 0.39, zBottom + dz * frac);
      newel.castShadow = true;
      group.add(newel);
    }
  }
  return group;
}

/** 构建船首破浪金色雕刻首像与弧形首斜桁装饰肋（Headrails） */
function createFigureheadAndHeadrails(goldMat, darkWoodMat) {
  const group = new THREE.Group();
  const spineCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 2.75, 14.55),
    new THREE.Vector3(0, 3.32, 15.45),
    new THREE.Vector3(0, 3.92, 16.15),
    new THREE.Vector3(0, 4.28, 16.05),
    new THREE.Vector3(0, 4.42, 16.65),
  ]);

  const torsoGeo = new THREE.TubeGeometry(spineCurve, 24, 0.25, 10, false);
  const posAttr = torsoGeo.attributes.position;
  const center = new THREE.Vector3();
  const offset = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    const t = Math.min(1, Math.floor(i / 11) / 24);
    spineCurve.getPointAt(t, center);
    offset.fromBufferAttribute(posAttr, i).sub(center);
    const taper = 1.16 - t * 0.4 + Math.sin(t * Math.PI) * 0.22;
    offset.multiplyScalar(taper).add(center);
    posAttr.setXYZ(i, offset.x, offset.y, offset.z);
  }
  torsoGeo.computeVertexNormals();

  const torso = new THREE.Mesh(torsoGeo, goldMat);
  torso.castShadow = true;
  group.add(torso);

  const crestTop = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.82, 8), goldMat);
  crestTop.rotation.x = Math.PI * 0.46;
  crestTop.position.set(0, 4.4, 17.02);
  crestTop.castShadow = true;
  group.add(crestTop);

  const crestLower = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.62, 7), goldMat);
  crestLower.rotation.x = Math.PI * 0.58;
  crestLower.position.set(0, 4.18, 16.9);
  group.add(crestLower);

  for (const side of [-1, 1]) {
    const hornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.14, 4.48, 16.62),
      new THREE.Vector3(side * 0.36, 4.68, 16.15),
      new THREE.Vector3(side * 0.52, 4.82, 15.58),
    ]);
    const horn = new THREE.Mesh(new THREE.TubeGeometry(hornCurve, 12, 0.052, 6, false), goldMat);
    horn.castShadow = true;
    group.add(horn);

    for (let g = 0; g < 4; g++) {
      const wingCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.22, 3.72 - g * 0.13, 15.75 - g * 0.12),
        new THREE.Vector3(side * (0.62 + g * 0.1), 3.92 - g * 0.1, 15.0 - g * 0.25),
        new THREE.Vector3(side * (0.95 + g * 0.14), 4.16 - g * 0.08, 14.08 - g * 0.38),
      ]);
      const wing = new THREE.Mesh(new THREE.TubeGeometry(wingCurve, 12, 0.072 - g * 0.01, 6, false), goldMat);
      wing.castShadow = true;
      group.add(wing);
    }

    const cheekCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 1.85, 4.38, 13.3),
      new THREE.Vector3(side * 0.92, 3.98, 14.55),
      new THREE.Vector3(side * 0.26, 4.02, 15.75),
    ]);
    const cheekTimber = new THREE.Mesh(new THREE.TubeGeometry(cheekCurve, 16, 0.08, 8, false), darkWoodMat);
    cheekTimber.castShadow = true;
    group.add(cheekTimber);
  }
  return group;
}

/**
 * 构建完整船体结构与材质集合，并返回可动态偏转的船舵枢轴与底层 10 门火炮（含可开合炮门盖与可回退炮管）
 */
export function buildShipHull(textures) {
  const hullGroup = new THREE.Group();

  const hullWeatherUni = {
    uWaveWetHeight: { value: 0.85 },
    uWetness: { value: 0.28 },
  };
  const hullMat = new THREE.MeshStandardMaterial({
    map: textures.hullPlanks.map,
    bumpMap: textures.hullPlanks.bumpMap,
    bumpScale: 0.085,
    roughnessMap: textures.hullPlanks.roughnessMap,
    roughness: 0.72,
    metalness: 0.06,
    vertexColors: true,
  });
  hullMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWaveWetHeight = hullWeatherUni.uWaveWetHeight;
    sh.uniforms.uWetness = hullWeatherUni.uWetness;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHullWorldPos;\nvarying vec3 vHullLocalPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvHullLocalPos = transformed;\nvHullWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uWaveWetHeight;\nuniform float uWetness;\nvarying vec3 vHullWorldPos;\nvarying vec3 vHullLocalPos;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bowSplashLift = smoothstep(5.0, 14.5, vHullLocalPos.z) * 0.85;
        float wetBand = 1.0 - smoothstep(-0.25, uWaveWetHeight + bowSplashLift, vHullWorldPos.y);
        diffuseColor.rgb *= mix(1.0, 0.72, wetBand);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float bowSplashLiftR = smoothstep(5.0, 14.5, vHullLocalPos.z) * 0.85;
        float wetBandR = 1.0 - smoothstep(-0.25, uWaveWetHeight + bowSplashLiftR, vHullWorldPos.y);
        roughnessFactor *= mix(1.0, 0.18, max(wetBandR, uWetness * 0.45));
        `
      );
  };

  const deckWeatherUni = {
    uTime: { value: 0 },
    uRainAmount: { value: 0 },
    uWetness: { value: 0.28 },
  };
  const deckMat = new THREE.MeshStandardMaterial({
    map: textures.deckPlanks.map,
    bumpMap: textures.deckPlanks.bumpMap,
    bumpScale: 0.055,
    roughnessMap: textures.deckPlanks.roughnessMap,
    roughness: 0.78,
    metalness: 0.03,
  });
  deckMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = deckWeatherUni.uTime;
    sh.uniforms.uRainAmount = deckWeatherUni.uRainAmount;
    sh.uniforms.uWetness = deckWeatherUni.uWetness;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDeckPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeckPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uRainAmount;
        uniform float uWetness;
        varying vec3 vDeckPos;
        float deckHash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
        float deckNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(deckHash21(i),deckHash21(i+vec2(1,0)),f.x),mix(deckHash21(i+vec2(0,1)),deckHash21(i+vec2(1,1)),f.x),f.y);}
        `
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float edgeDistX = clamp((3.6 - abs(vDeckPos.x)) * 0.85, 0.0, 1.0);
        float bulkAO = smoothstep(0.0, 1.15, abs(vDeckPos.z + 3.25)) * smoothstep(0.0, 1.15, abs(vDeckPos.z - 7.58)) * smoothstep(0.0, 1.0, abs(vDeckPos.z + 9.65));
        float contactAO = mix(0.62, 1.0, mix(0.45, 1.0, edgeDistX) * mix(0.68, 1.0, bulkAO));
        diffuseColor.rgb *= contactAO;
        float puddleMask = smoothstep(0.44, 0.72, deckNoise(vDeckPos.xz * 0.65 + vec2(1.7, 3.1))) * clamp(uRainAmount * 1.15 + max(0.0, uWetness - 0.55), 0.0, 1.0);
        diffuseColor.rgb *= (1.0 - 0.24 * puddleMask);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float pMaskR = smoothstep(0.44, 0.72, deckNoise(vDeckPos.xz * 0.65 + vec2(1.7, 3.1))) * clamp(uRainAmount * 1.15 + max(0.0, uWetness - 0.55), 0.0, 1.0);
        roughnessFactor *= mix(1.0, 0.16, pMaskR);
        `
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (uRainAmount > 0.04) {
          vec2 rGrid = vDeckPos.xz * 2.8;
          vec2 rCell = floor(rGrid);
          vec2 rFrac = fract(rGrid) - 0.5;
          float rSeed = deckHash21(rCell);
          float rT = fract(uTime * 1.65 + rSeed * 6.2831);
          vec2 rOff = vec2(deckHash21(rCell + 3.1), deckHash21(rCell + 7.7)) - 0.5;
          float rDist = length(rFrac - rOff * 0.45);
          float ring = sin((rDist - rT * 0.48) * 38.0) * exp(-abs(rDist - rT * 0.48) * 14.0) * (1.0 - rT);
          vec2 rGrad = normalize(rFrac - rOff * 0.45 + 1e-4) * ring * uRainAmount * 0.22;
          normal = normalize(normal + vec3(rGrad.x, 0.0, rGrad.y));
        }
        `
      );
  };
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x3b2213,
    bumpMap: textures.hullPlanks.bumpMap,
    bumpScale: 0.06,
    roughness: 0.68,
    metalness: 0.08,
  });
  const mahoganyMat = new THREE.MeshStandardMaterial({
    color: 0x7c462b,
    map: textures.hullPlanks.map,
    bumpMap: textures.hullPlanks.bumpMap,
    bumpScale: 0.05,
    roughness: 0.62,
    metalness: 0.08,
  });
  const crimsonWoodMat = new THREE.MeshStandardMaterial({
    color: 0x9e2b24,
    map: textures.hullPlanks.map,
    bumpMap: textures.hullPlanks.bumpMap,
    bumpScale: 0.05,
    roughness: 0.64,
    metalness: 0.08,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xdba358,
    roughness: 0.3,
    metalness: 0.82,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d32,
    roughness: 0.46,
    metalness: 0.78,
  });
  const glowingWindowMat = new THREE.MeshStandardMaterial({
    color: 0xffcf75,
    emissive: new THREE.Color(0xff9424),
    emissiveIntensity: 2.65,
    roughness: 0.18,
    metalness: 0.1,
  });

  // 1. 主船壳
  const shellMesh = new THREE.Mesh(createHullShellGeometry(96, 36), hullMat);
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  hullGroup.add(shellMesh);

  // 2. 龙骨与船首柱
  const keelPts = [];
  for (let i = 0; i <= 28; i++) {
    const s = 0.02 + (i / 28) * 0.98;
    const sec = evaluateHullSection(s);
    keelPts.push(new THREE.Vector3(0, sec.yKeel - 0.12, sec.z + (s > 0.85 ? (s - 0.85) * 2.2 : 0)));
  }
  keelPts.push(new THREE.Vector3(0, 4.95, 15.65));
  const keelMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(keelPts), 64, 0.24, 8, false), darkWoodMat);
  keelMesh.scale.set(0.68, 1, 1);
  keelMesh.castShadow = true;
  hullGroup.add(keelMesh);

  // 3. 纵向护舷木与金饰线
  hullGroup.add(createHullWaleStrips(0.48, 0.11, darkWoodMat, 0, 0.985, 64));
  hullGroup.add(createHullWaleStrips(0.71, 0.12, darkWoodMat, 0, 0.988, 64));
  hullGroup.add(createHullWaleStrips(0.89, 0.095, darkWoodMat, 0, 0.992, 64));
  hullGroup.add(createHullWaleStrips(0.99, 0.065, goldMat, 0, 0.992, 64));
  hullGroup.add(createHullWaleStrips(0.82, 0.055, goldMat, 0, 0.42, 36));
  hullGroup.add(createHullWaleStrips(0.82, 0.05, goldMat, 0.72, 0.99, 28));

  // 4. 四层阶梯甲板
  const waistDeck = new THREE.Mesh(createCamberedDeckGeometry(-3.3, 7.7, 26, 14, 0.66), deckMat);
  const forecastleDeck = new THREE.Mesh(createCamberedDeckGeometry(7.6, 14.9, 18, 12, 0.86), deckMat);
  const quarterDeck = new THREE.Mesh(createCamberedDeckGeometry(-9.7, -3.2, 18, 12, 0.84), deckMat);
  const poopDeck = new THREE.Mesh(createCamberedDeckGeometry(-14.45, -9.6, 14, 12, 0.9), deckMat);
  for (const d of [waistDeck, forecastleDeck, quarterDeck, poopDeck]) {
    d.receiveShadow = true;
    d.castShadow = true;
    hullGroup.add(d);
  }

  // 5. 舷墙内侧肋骨木柱（Timberheads）
  const ribGeo = new THREE.BoxGeometry(0.16, 1.45, 0.16);
  for (let z = -12.8; z <= 12.8; z += 1.45) {
    const s = zToHullParam(z);
    const sheerPt = sampleHullSurface(s, 0.98);
    const deckY = getDeckHeightAtZ(z);
    const ribH = Math.max(0.4, sheerPt.y - deckY);
    for (const side of [-1, 1]) {
      const rib = new THREE.Mesh(ribGeo, darkWoodMat);
      rib.scale.set(1, ribH / 1.45, 1);
      rib.position.set((sheerPt.x - 0.22) * side, deckY + ribH * 0.5, sheerPt.z);
      rib.castShadow = true;
      hullGroup.add(rib);
    }
  }

  // 6. 后甲板、艉楼与艏楼舱壁及发光窗格
  const qBulkW = getDeckHalfWidthAtZ(-3.2, 0.76) * 2;
  const qBulk = new THREE.Mesh(new THREE.BoxGeometry(qBulkW, 1.72, 0.32), mahoganyMat);
  qBulk.position.set(0, 1.56 + 0.86, -3.25);
  qBulk.castShadow = true;
  qBulk.receiveShadow = true;
  hullGroup.add(qBulk);

  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.38, 0.08), darkWoodMat);
    door.position.set(side * 0.38, 1.56 + 0.69, -3.08);
    hullGroup.add(door);

    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12), goldMat);
    handle.position.set(side * 0.14, 2.22, -3.02);
    hullGroup.add(handle);

    const winPane = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.68, 0.08), glowingWindowMat);
    winPane.position.set(side * 1.48, 2.48, -3.08);
    hullGroup.add(winPane);

    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.78, 0.11), darkWoodMat);
    winFrame.position.set(side * 1.48, 2.48, -3.11);
    hullGroup.add(winFrame);

    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.12), darkWoodMat);
    mullionV.position.set(side * 1.48, 2.48, -3.07);
    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.12), darkWoodMat);
    mullionH.position.set(side * 1.48, 2.48, -3.07);
    hullGroup.add(mullionV, mullionH);
  }

  const poopBulkW = getDeckHalfWidthAtZ(-9.6, 0.85) * 2;
  const poopBulk = new THREE.Mesh(new THREE.BoxGeometry(poopBulkW, 1.28, 0.3), mahoganyMat);
  poopBulk.position.set(0, 3.52 + 0.64, -9.65);
  poopBulk.castShadow = true;
  poopBulk.receiveShadow = true;
  hullGroup.add(poopBulk);

  for (const xOff of [-1.25, 0, 1.25]) {
    const portholeRim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 8, 16), goldMat);
    portholeRim.position.set(xOff, 4.18, -9.48);
    const portholeGlass = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), glowingWindowMat);
    portholeGlass.position.set(xOff, 4.18, -9.49);
    hullGroup.add(portholeRim, portholeGlass);
  }

  const foreBulkW = getDeckHalfWidthAtZ(7.6, 0.76) * 2;
  const foreBulk = new THREE.Mesh(new THREE.BoxGeometry(foreBulkW, 1.46, 0.3), mahoganyMat);
  foreBulk.position.set(0, 1.64 + 0.73, 7.58);
  foreBulk.castShadow = true;
  foreBulk.receiveShadow = true;
  hullGroup.add(foreBulk);

  const foreDoor = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.18, 0.08), darkWoodMat);
  foreDoor.position.set(0, 1.64 + 0.59, 7.42);
  hullGroup.add(foreDoor);

  // 7. 六座甲板连接木梯与车木护栏
  for (const side of [-1, 1]) {
    hullGroup.add(createDeckStairway(side * 2.55, -1.75, 1.6, -3.22, 3.24, 0.88, deckMat, darkWoodMat));
    hullGroup.add(createDeckStairway(side * 2.15, 6.25, 1.64, 7.58, 3.06, 0.82, deckMat, darkWoodMat));
    hullGroup.add(createDeckStairway(side * 2.25, -8.35, 3.48, -9.62, 4.74, 0.76, deckMat, darkWoodMat));
  }

  const balusterGeo = createBalusterGeometry();
  hullGroup.add(
    createBalustradeRailing(
      [new THREE.Vector3(-2.05, 3.25, -3.22), new THREE.Vector3(0, 3.38, -3.22), new THREE.Vector3(2.05, 3.25, -3.22)],
      0.82,
      balusterGeo,
      mahoganyMat,
      goldMat
    )
  );
  hullGroup.add(
    createBalustradeRailing(
      [new THREE.Vector3(-1.78, 4.75, -9.62), new THREE.Vector3(0, 4.86, -9.62), new THREE.Vector3(1.78, 4.75, -9.62)],
      0.78,
      balusterGeo,
      mahoganyMat,
      goldMat
    )
  );
  hullGroup.add(
    createBalustradeRailing(
      [new THREE.Vector3(-1.68, 3.06, 7.58), new THREE.Vector3(0, 3.18, 7.58), new THREE.Vector3(1.68, 3.06, 7.58)],
      0.78,
      balusterGeo,
      mahoganyMat,
      goldMat
    )
  );

  for (const side of [-1, 1]) {
    const poopSidePts = [];
    for (let i = 0; i <= 6; i++) {
      const z = -9.65 - (i / 6) * 4.75;
      const pt = sampleHullSurface(zToHullParam(z), 1);
      poopSidePts.push(new THREE.Vector3((pt.x - 0.12) * side, pt.y, pt.z));
    }
    hullGroup.add(createBalustradeRailing(poopSidePts, 0.68, balusterGeo, mahoganyMat, goldMat, 0.52));
  }

  const taffrailEdge = sampleHullSurface(0, 1);
  hullGroup.add(
    createBalustradeRailing(
      [
        new THREE.Vector3(-(taffrailEdge.x - 0.12), taffrailEdge.y, taffrailEdge.z),
        new THREE.Vector3(0, taffrailEdge.y + 0.34, taffrailEdge.z - 0.28),
        new THREE.Vector3(taffrailEdge.x - 0.12, taffrailEdge.y, taffrailEdge.z),
      ],
      0.76,
      balusterGeo,
      mahoganyMat,
      goldMat,
      0.44
    )
  );

  // 8. 底层火炮甲板两侧共 10 门火炮窗、可开合炮门盖与可回退炮管
  const gunportZs = [-5.8, -2.9, 0, 2.9, 5.8];
  const gunportMuzzles = [];
  // 修正原单文件反编译遗留的 591365 (0x0905e5) 为纯正深木炭黑 0x090505
  const darkRecessMat = new THREE.MeshBasicMaterial({ color: 0x090505 });

  const barrelProfile = [
    new THREE.Vector2(0.15, 0),
    new THREE.Vector2(0.135, 0.45),
    new THREE.Vector2(0.115, 0.85),
    new THREE.Vector2(0.145, 0.94),
    new THREE.Vector2(0.12, 1.02),
    new THREE.Vector2(0.075, 1.02),
    new THREE.Vector2(0.075, 0.72),
  ];
  const lowerBarrelGeo = new THREE.LatheGeometry(barrelProfile, 12);
  lowerBarrelGeo.rotateZ(-Math.PI * 0.5);

  for (const zPos of gunportZs) {
    const s = zToHullParam(zPos);
    const pLow = sampleHullSurface(s, 0.63);
    const pUp = sampleHullSurface(s, 0.7);
    const hullTilt = Math.atan2(pUp.x - pLow.x, pUp.y - pLow.y);

    for (const side of [1, -1]) {
      const portGroup = new THREE.Group();
      portGroup.position.set(pLow.x * side, pLow.y, pLow.z);
      portGroup.rotation.z = -hullTilt * side;

      const portFrame = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.66, 0.72), darkWoodMat);
      const portCavity = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.5, 0.56), darkRecessMat);
      portGroup.add(portFrame, portCavity);

      const lidHinge = new THREE.Group();
      lidHinge.position.set(0.06 * side, 0.3, 0);
      lidHinge.rotation.z = side * 1.05;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.62), crimsonWoodMat);
      lid.position.set(0, -0.26, 0);
      lid.castShadow = true;
      lidHinge.add(lid);
      portGroup.add(lidHinge);

      const barrelPivot = new THREE.Group();
      barrelPivot.position.set(0.02 * side, -0.04, 0);
      const barrel = new THREE.Mesh(lowerBarrelGeo, ironMat);
      barrel.scale.set(side, 1, 1);
      barrel.castShadow = true;
      barrelPivot.add(barrel);
      portGroup.add(barrelPivot);
      hullGroup.add(portGroup);

      gunportMuzzles.push({
        muzzleLocal: new THREE.Vector3((pLow.x + 1.04) * side, pLow.y - 0.04, pLow.z),
        side,
        z: pLow.z,
        pivot: barrelPivot,
        baseX: 0.02 * side,
        lidHinge,
        openAngle: side * 1.05,
        closedAngle: side * 0.06,
      });
    }
  }

  // 9. 船尾五联雕花大窗、两侧官舱悬挑灯廊与可偏转船舵（rudderPivot）
  const sternGroup = new THREE.Group();
  for (let idx = -2; idx <= 2; idx++) {
    const frac = idx * 0.38;
    const sternPt = sampleHullSurface(0, 0.78);
    const wx = frac * (sternPt.x * 0.86);
    const wy = sternPt.y + (1 - (frac / 0.8) * (frac / 0.8)) * 0.16;
    const wz = sternPt.z - (1 - frac * frac * 0.5) * 0.26 - 0.06;

    const winUnit = new THREE.Group();
    winUnit.position.set(wx, wy, wz);
    winUnit.rotation.x = 0.24;
    winUnit.rotation.y = -frac * 0.18;

    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.92, 0.08), glowingWindowMat);
    const giltFrame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.06, 0.06), goldMat);
    giltFrame.position.z = 0.01;
    for (const mx of [-0.14, 0.14]) {
      const barV = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.94, 0.1), darkWoodMat);
      barV.position.x = mx;
      winUnit.add(barV);
    }
    for (const my of [-0.22, 0.18]) {
      const barH = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.035, 0.1), darkWoodMat);
      barH.position.y = my;
      winUnit.add(barH);
    }
    const pilaster = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.22, 8), goldMat);
    pilaster.position.set(0.36, 0, -0.03);
    winUnit.add(giltFrame, glass, pilaster);
    sternGroup.add(winUnit);
  }

  for (const [vLvl, yOff, rTube] of [
    [0.86, 0.18, 0.075],
    [0.7, -0.14, 0.075],
  ]) {
    const pt = sampleHullSurface(0, vLvl);
    const archCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-pt.x * 0.98, pt.y + yOff, pt.z - 0.08),
      new THREE.Vector3(0, pt.y + yOff + 0.22, pt.z - 0.36),
      new THREE.Vector3(pt.x * 0.98, pt.y + yOff, pt.z - 0.08),
    ]);
    sternGroup.add(new THREE.Mesh(new THREE.TubeGeometry(archCurve, 20, rTube, 8, false), goldMat));
  }

  for (const side of [-1, 1]) {
    const gallery = new THREE.Group();
    const s = zToHullParam(-12.9);
    const pt = sampleHullSurface(s, 0.79);
    gallery.position.set((pt.x + 0.26) * side, pt.y, pt.z);
    gallery.rotation.y = side * -0.14;

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.25, 2.55), crimsonWoodMat);
    body.castShadow = true;
    gallery.add(body);

    const domeTop = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.72, 6), darkWoodMat);
    domeTop.position.set(0, 0.96, 0);
    const corbelBot = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.95, 6), goldMat);
    corbelBot.rotation.x = Math.PI;
    corbelBot.position.set(0, -1.05, 0);
    gallery.add(domeTop, corbelBot);

    for (const zOff of [-0.68, 0.68]) {
      const gGlass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, 0.62), glowingWindowMat);
      gGlass.position.set(0.34 * side, 0.08, zOff);
      const gRim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 0.72), goldMat);
      gRim.position.set(0.33 * side, 0.08, zOff);
      gallery.add(gRim, gGlass);
    }
    sternGroup.add(gallery);
  }

  // 可绕铰链轴偏转的船尾木舵与铁制舵镟带（rudderPivot）
  const rudderShape = new THREE.Shape();
  rudderShape.moveTo(0, -2.55);
  rudderShape.lineTo(-1.18, -2.35);
  rudderShape.quadraticCurveTo(-1.32, -0.45, -0.76, 1.35);
  rudderShape.lineTo(-0.35, 2.35);
  rudderShape.lineTo(0, 2.45);
  rudderShape.closePath();

  const rudderGeo = new THREE.ExtrudeGeometry(rudderShape, {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  rudderGeo.rotateY(Math.PI * 0.5);
  rudderGeo.rotateY(Math.PI);
  rudderGeo.center();

  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, -0.35, -14.42);
  const rudderBlade = new THREE.Mesh(rudderGeo, darkWoodMat);
  rudderBlade.position.set(0, 0, -0.43);
  rudderBlade.castShadow = true;
  rudderPivot.add(rudderBlade);

  for (const strapY of [-1.8, -0.8, 0.2, 1.1]) {
    const pintleStrap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.95), ironMat);
    pintleStrap.position.set(0, strapY + 0.35, -0.23);
    rudderPivot.add(pintleStrap);
  }
  sternGroup.add(rudderPivot);
  hullGroup.add(sternGroup);

  // 10. 船首金色首像
  hullGroup.add(createFigureheadAndHeadrails(goldMat, darkWoodMat));

  return {
    hullGroup,
    materials: {
      hullMat,
      hullWeatherUni,
      deckMat,
      deckWeatherUni,
      darkWoodMat,
      mahoganyMat,
      crimsonWoodMat,
      goldMat,
      ironMat,
      glowingWindowMat,
    },
    rudderPivot,
    gunportMuzzles,
  };
}
