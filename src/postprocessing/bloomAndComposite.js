/**
 * @file bloomAndComposite.js
 * @description 轻量化 HDR 后处理管线（含半分辨率丁达尔光束降采样优化）：
 *              1. FullScreenQuad：单大三角形全屏绘制辅助类；
 *              2. createBloomPipeline：全部关闭冗余深度缓冲（depthBuffer: false）的半分辨率 5 级可分离高斯泛光，
 *                 并在半分辨率合成阶段顺带完成 16 步径向丁达尔体积光采样（存入 alpha 通道，节省 75% 全屏纹理带宽）；
 *              3. FINAL_COMPOSITE_SHADER：将半分辨率 HDR 泛光 + 丁达尔光束、镜头边缘雨水折射、
 *                 电影级冷暖分离调色、ACES Filmic 色调映射、光学暗角与防色带抖动融合在单次片元输出中。
 */

import * as THREE from 'three';

const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsTriangleGeo = new THREE.BufferGeometry();
fsTriangleGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
fsTriangleGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));

export class FullScreenQuad {
  constructor(material) {
    this._mesh = new THREE.Mesh(fsTriangleGeo, material);
  }
  get material() {
    return this._mesh.material;
  }
  set material(m) {
    this._mesh.material = m;
  }
  render(renderer) {
    renderer.render(this._mesh, orthoCam);
  }
  dispose() {
    this._mesh.geometry.dispose();
  }
}

const LUMINOSITY_HIGH_PASS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    luminosityThreshold: { value: 1.0 },
    smoothWidth: { value: 0.01 },
    defaultColor: { value: new THREE.Color(0x000000) },
    defaultOpacity: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 defaultColor;
    uniform float defaultOpacity;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float v = dot(texel.xyz, vec3(0.2125, 0.7154, 0.0721));
      float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
      float skyMask = smoothstep(0.62, 1.95, v);
      gl_FragColor = vec4(mix(defaultColor.rgb, texel.rgb, alpha), skyMask);
    }
  `,
};

function createSeparableBlurMaterial(kernelRadius) {
  const coeffs = [];
  for (let i = 0; i < kernelRadius; i++) {
    coeffs.push((0.39894 * Math.exp((-0.5 * i * i) / (kernelRadius * kernelRadius))) / kernelRadius);
  }
  return new THREE.ShaderMaterial({
    defines: { KERNEL_RADIUS: kernelRadius },
    uniforms: {
      colorTexture: { value: null },
      invSize: { value: new THREE.Vector2(0.5, 0.5) },
      direction: { value: new THREE.Vector2(0.5, 0.5) },
      gaussianCoefficients: { value: coeffs },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D colorTexture;
      uniform vec2 invSize;
      uniform vec2 direction;
      uniform float gaussianCoefficients[KERNEL_RADIUS];
      void main() {
        float weightSum = gaussianCoefficients[0];
        vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * weightSum;
        for (int i = 1; i < KERNEL_RADIUS; i++) {
          float x = float(i);
          float w = gaussianCoefficients[i];
          vec2 uvOffset = direction * invSize * x;
          vec3 sample1 = texture2D(colorTexture, vUv + uvOffset).rgb;
          vec3 sample2 = texture2D(colorTexture, vUv - uvOffset).rgb;
          diffuseSum += (sample1 + sample2) * w;
          weightSum += 2.0 * w;
        }
        gl_FragColor = vec4(diffuseSum / weightSum, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

function createBloomCompositeMaterial(numMips) {
  return new THREE.ShaderMaterial({
    defines: { NUM_MIPS: numMips },
    uniforms: {
      tBrightMask: { value: null },
      blurTexture1: { value: null },
      blurTexture2: { value: null },
      blurTexture3: { value: null },
      blurTexture4: { value: null },
      blurTexture5: { value: null },
      bloomStrength: { value: 1.0 },
      bloomFactors: { value: null },
      bloomTintColors: { value: null },
      bloomRadius: { value: 0.0 },
      uSunScreenUV: { value: new THREE.Vector2(0.75, 0.62) },
      uGodRayWeight: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tBrightMask;
      uniform sampler2D blurTexture1;
      uniform sampler2D blurTexture2;
      uniform sampler2D blurTexture3;
      uniform sampler2D blurTexture4;
      uniform sampler2D blurTexture5;
      uniform float bloomStrength;
      uniform float bloomRadius;
      uniform float bloomFactors[NUM_MIPS];
      uniform vec3 bloomTintColors[NUM_MIPS];
      uniform vec2 uSunScreenUV;
      uniform float uGodRayWeight;

      float lerpBloomFactor(const in float factor) {
        float mirrorFactor = 1.2 - factor;
        return mix(factor, mirrorFactor, bloomRadius);
      }

      void main() {
        vec3 bloomCol = bloomStrength * (
          lerpBloomFactor(bloomFactors[0]) * bloomTintColors[0] * texture2D(blurTexture1, vUv).rgb +
          lerpBloomFactor(bloomFactors[1]) * bloomTintColors[1] * texture2D(blurTexture2, vUv).rgb +
          lerpBloomFactor(bloomFactors[2]) * bloomTintColors[2] * texture2D(blurTexture3, vUv).rgb +
          lerpBloomFactor(bloomFactors[3]) * bloomTintColors[3] * texture2D(blurTexture4, vUv).rgb +
          lerpBloomFactor(bloomFactors[4]) * bloomTintColors[4] * texture2D(blurTexture5, vUv).rgb
        );

        float shaftOut = 0.0;
        if (uGodRayWeight > 0.003) {
          vec2 delta = (uSunScreenUV - vUv) * (0.86 / 16.0);
          float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 sampleUV = vUv + delta * jitter;
          float illuminationDecay = 1.0;
          float shaftAcc = 0.0;
          for (int i = 0; i < 16; i++) {
            sampleUV += delta;
            if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) break;
            float skyMask = texture2D(tBrightMask, sampleUV).a;
            shaftAcc += skyMask * illuminationDecay;
            illuminationDecay *= 0.935;
          }
          shaftOut = shaftAcc / 16.0;
        }

        gl_FragColor = vec4(bloomCol, shaftOut);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

const BLUR_DIR_X = new THREE.Vector2(1, 0);
const BLUR_DIR_Y = new THREE.Vector2(0, 1);

/**
 * 创建无冗余深度缓冲的 5 级 Mipmap HDR 泛光与半分辨率丁达尔光束管线
 */
export function createBloomPipeline(pixelW, pixelH, strength, radius, threshold, rtType = THREE.HalfFloatType) {
  const nMips = 5;
  const rtOpts = { type: rtType, depthBuffer: false, stencilBuffer: false };
  let rx = Math.max(1, Math.round(pixelW / 2));
  let ry = Math.max(1, Math.round(pixelH / 2));

  const rtBright = new THREE.WebGLRenderTarget(rx, ry, rtOpts);
  rtBright.texture.generateMipmaps = false;

  const rtsH = [];
  const rtsV = [];
  const blurMats = [];
  const kernels = [3, 5, 7, 9, 11];

  for (let i = 0; i < nMips; i++) {
    const th = new THREE.WebGLRenderTarget(rx, ry, rtOpts);
    const tv = new THREE.WebGLRenderTarget(rx, ry, rtOpts);
    th.texture.generateMipmaps = false;
    tv.texture.generateMipmaps = false;
    rtsH.push(th);
    rtsV.push(tv);

    const bm = createSeparableBlurMaterial(kernels[i]);
    bm.uniforms.invSize.value.set(1 / rx, 1 / ry);
    blurMats.push(bm);

    rx = Math.max(1, Math.round(rx / 2));
    ry = Math.max(1, Math.round(ry / 2));
  }

  const hpUni = THREE.UniformsUtils.clone(LUMINOSITY_HIGH_PASS_SHADER.uniforms);
  hpUni.luminosityThreshold.value = threshold;
  hpUni.smoothWidth.value = 0.01;
  const hpMat = new THREE.ShaderMaterial({
    uniforms: hpUni,
    vertexShader: LUMINOSITY_HIGH_PASS_SHADER.vertexShader,
    fragmentShader: LUMINOSITY_HIGH_PASS_SHADER.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });

  const compMat = createBloomCompositeMaterial(nMips);
  compMat.uniforms.tBrightMask.value = rtBright.texture;
  compMat.uniforms.blurTexture1.value = rtsV[0].texture;
  compMat.uniforms.blurTexture2.value = rtsV[1].texture;
  compMat.uniforms.blurTexture3.value = rtsV[2].texture;
  compMat.uniforms.blurTexture4.value = rtsV[3].texture;
  compMat.uniforms.blurTexture5.value = rtsV[4].texture;
  compMat.uniforms.bloomFactors.value = [1.0, 0.8, 0.6, 0.4, 0.2];
  compMat.uniforms.bloomTintColors.value = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, 1, 1),
  ];

  const fsQuad = new FullScreenQuad(null);
  const oldClear = new THREE.Color();
  const clearBlack = new THREE.Color(0, 0, 0);

  return {
    strength,
    radius,
    threshold,
    get bloomTexture() {
      return rtsH[0].texture;
    },
    setSize(pw, ph) {
      let sx = Math.max(1, Math.round(pw / 2));
      let sy = Math.max(1, Math.round(ph / 2));
      rtBright.setSize(sx, sy);
      for (let i = 0; i < nMips; i++) {
        rtsH[i].setSize(sx, sy);
        rtsV[i].setSize(sx, sy);
        blurMats[i].uniforms.invSize.value.set(1 / sx, 1 / sy);
        sx = Math.max(1, Math.round(sx / 2));
        sy = Math.max(1, Math.round(sy / 2));
      }
    },
    render(renderer, inputTexture, sunScreenUV = null, godRayWeight = 0) {
      renderer.getClearColor(oldClear);
      const oldAlpha = renderer.getClearAlpha();
      const oldAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setClearColor(clearBlack, 0);

      hpUni.tDiffuse.value = inputTexture;
      hpUni.luminosityThreshold.value = this.threshold;
      fsQuad.material = hpMat;
      renderer.setRenderTarget(rtBright);
      renderer.clear(true, false, false);
      fsQuad.render(renderer);

      let inputRT = rtBright;
      for (let i = 0; i < nMips; i++) {
        fsQuad.material = blurMats[i];
        blurMats[i].uniforms.colorTexture.value = inputRT.texture;
        blurMats[i].uniforms.direction.value = BLUR_DIR_X;
        renderer.setRenderTarget(rtsH[i]);
        renderer.clear(true, false, false);
        fsQuad.render(renderer);

        blurMats[i].uniforms.colorTexture.value = rtsH[i].texture;
        blurMats[i].uniforms.direction.value = BLUR_DIR_Y;
        renderer.setRenderTarget(rtsV[i]);
        renderer.clear(true, false, false);
        fsQuad.render(renderer);
        inputRT = rtsV[i];
      }

      fsQuad.material = compMat;
      compMat.uniforms.bloomStrength.value = this.strength;
      compMat.uniforms.bloomRadius.value = this.radius;
      if (sunScreenUV) compMat.uniforms.uSunScreenUV.value.copy(sunScreenUV);
      compMat.uniforms.uGodRayWeight.value = godRayWeight;
      renderer.setRenderTarget(rtsH[0]);
      renderer.clear(true, false, false);
      fsQuad.render(renderer);

      renderer.setClearColor(oldClear, oldAlpha);
      renderer.autoClear = oldAuto;
    },
  };
}

/** 最终单通合成着色器（半分辨率丁达尔光束与 HDR 泛光单次采样融合 + 冷暖分离调色 + ACES Filmic + 暗角抖动） */
export const FINAL_COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uBloomTex: { value: null },
    uExposure: { value: 1.06 },
    uSunScreenUV: { value: new THREE.Vector2(0.75, 0.62) },
    uGodRayWeight: { value: 0.35 },
    uGodRayTint: { value: new THREE.Vector3(1.0, 0.68, 0.32) },
    uTime: { value: 0 },
    uLensWetness: { value: 0 },
    uFrostAmount: { value: 0 },
    uCabinGlass: { value: 0 },
    uWarmGlow: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D uBloomTex;
    uniform float uExposure;
    uniform vec2 uSunScreenUV;
    uniform float uGodRayWeight;
    uniform vec3 uGodRayTint;
    uniform float uTime;
    uniform float uLensWetness;
    uniform float uFrostAmount;
    uniform float uCabinGlass;
    uniform float uWarmGlow;
    varying vec2 vUv;

    vec2 evalLensDrops(vec2 uv, float wetness, float t, float cabinGlass) {
      if (wetness < 0.02) return vec2(0.0);
      float edgeMask = mix(smoothstep(0.26, 0.72, length(uv - 0.5)), 1.0, cabinGlass);
      if (edgeMask < 0.01) return vec2(0.0);
      vec2 grid = uv * mix(vec2(15.0, 9.0), vec2(22.0, 12.0), cabinGlass);
      grid.y += t * mix(0.42, 0.65, cabinGlass);
      vec2 cell = floor(grid);
      vec2 f = fract(grid) - 0.5;
      float rnd = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
      if (rnd < mix(0.62, 0.44, cabinGlass)) return vec2(0.0);
      vec2 center = vec2(fract(rnd * 17.3) - 0.5, fract(rnd * 31.7) - 0.5) * 0.45;
      vec2 d = f - center;
      float r = 0.16 + 0.11 * fract(rnd * 7.1);
      float drop = smoothstep(r, r * 0.32, length(d));
      return d * drop * edgeMask * wetness * mix(0.055, 0.072, cabinGlass);
    }

    float evalFrostRime(vec2 uv, float frost, float cabinGlass) {
      if (frost < 0.02) return 0.0;
      float dist = length((uv - 0.5) * vec2(1.18, 1.0));
      float border = smoothstep(mix(0.46, 0.32, cabinGlass), mix(0.76, 0.68, cabinGlass), dist);
      float n1 = fract(sin(dot(floor(uv * vec2(85.0, 52.0)), vec2(127.1, 311.7))) * 43758.5453);
      float n2 = fract(sin(dot(floor(uv * vec2(32.0, 20.0)), vec2(269.5, 183.3))) * 43758.5453);
      float crystal = smoothstep(0.28, 0.88, n1 * 0.55 + n2 * 0.45);
      return border * (0.45 + 0.55 * crystal) * frost;
    }

    vec3 acesFilmic(vec3 x) {
      const float a = 2.51;
      const float b = 0.03;
      const float c = 2.43;
      const float d = 0.59;
      const float e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 linearToSRGB(vec3 c) {
      vec3 lo = c * 12.92;
      vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
      return mix(lo, hi, step(vec3(0.0031308), c));
    }

    void main() {
      vec2 dropOffset = evalLensDrops(vUv, uLensWetness, uTime, uCabinGlass);
      vec2 sampleBaseUV = clamp(vUv + dropOffset, vec2(0.001), vec2(0.999));
      vec3 hdr = texture2D(tDiffuse, sampleBaseUV).rgb;
      hdr += uGodRayTint * length(dropOffset) * 2.4;

      vec4 bloomAndShaft = texture2D(uBloomTex, vUv);
      hdr += bloomAndShaft.rgb;

      if (uGodRayWeight > 0.003) {
        float radialFalloff = exp(-length(vUv - uSunScreenUV) * 1.65);
        hdr += uGodRayTint * bloomAndShaft.a * radialFalloff * uGodRayWeight;
      }

      hdr *= uExposure;

      float lum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.94, 0.99, 1.08);
      vec3 highlightTint = vec3(1.05, 0.99, 0.92);
      hdr *= mix(shadowTint, highlightTint, smoothstep(0.06, 0.85, lum));

      float satLum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
      hdr = mix(vec3(satLum), hdr, 1.09);

      vec3 ldr = acesFilmic(max(hdr, vec3(0.0)));

      float frostMask = evalFrostRime(vUv, uFrostAmount, uCabinGlass);
      if (frostMask > 0.005) {
        vec3 frostCol = vec3(0.74, 0.86, 0.96);
        ldr = mix(ldr, frostCol, frostMask * mix(0.32, 0.54, uCabinGlass));
      }
      if (uWarmGlow > 0.005) {
        float warmRim = smoothstep(0.58, 0.0, vUv.y) * smoothstep(0.85, 0.15, abs(vUv.x - 0.5));
        ldr += vec3(0.18, 0.075, 0.015) * warmRim * uWarmGlow;
      }

      vec2 centered = vUv - 0.5;
      float vig = 1.0 - dot(centered, centered) * (0.34 + uCabinGlass * 0.28);
      ldr *= clamp(vig, 0.58, 1.0);

      vec3 srgb = linearToSRGB(ldr);
      float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(srgb + dither, 1.0);
    }
  `,
};
