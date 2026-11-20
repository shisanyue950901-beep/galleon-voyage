/**
 * @file proceduralTextures.js
 * @description 纯程序化材质生成器（Canvas 2D + GPU 离屏烘焙加速）：
 *              1. 船壳与甲板无缝拼接木板贴图（含颜色、凹凸法线高度与粗糙度三通道贴图）
 *              2. 复古做旧帆布与红白条纹战船横帆贴图（含补丁缝线、四角加固布与凹凸贴图）
 *              3. 股捻麻绳贴图
 *              4. 三通道无缝平铺海沫贴图（支持 GPU WebGLRenderTarget 亚毫秒级烘焙，R: Worley 细胞网状泡沫, G/B: 多频 FBM 湍流噪波）
 *              5. 风灯光晕贴图与飞沫水滴粒子贴图
 */

import * as THREE from 'three';

/** 线性同余确定性伪随机数生成器 */
export function createSeededRNG(seed = 1337) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hashGrid2D(ix, iy, seed = 0) {
  let n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function tileableValueNoise(u, v, freqX, freqY, seed = 0) {
  const rx = u * freqX;
  const ry = v * freqY;
  const x0 = Math.floor(rx);
  const y0 = Math.floor(ry);
  const fx = rx - x0;
  const fy = ry - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const ix0 = ((x0 % freqX) + freqX) % freqX;
  const ix1 = (ix0 + 1) % freqX;
  const iy0 = ((y0 % freqY) + freqY) % freqY;
  const iy1 = (iy0 + 1) % freqY;

  const a = hashGrid2D(ix0, iy0, seed);
  const b = hashGrid2D(ix1, iy0, seed);
  const c = hashGrid2D(ix0, iy1, seed);
  const d = hashGrid2D(ix1, iy1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function tileableFBM(u, v, freqX, freqY, octaves = 4, seed = 1) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = freqX;
  let fy = freqY;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileableValueNoise(u, v, fx, fy, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

/**
 * 生成无缝平铺古木板纹理组（漫反射 map + 凹凸 bumpMap + 粗糙度 roughnessMap）
 */
export function createPlankTextures({
  width = 1024,
  height = 1024,
  rows = 12,
  baseColors = ['#4a2d1b', '#563520', '#3f2515', '#613c24', '#4d301d'],
  seamColor = '#170d07',
  nailColor = '#24170e',
  grainContrast = 0.22,
  seed = 101,
} = {}) {
  const rng = createSeededRNG(seed);

  const colCanvas = document.createElement('canvas');
  colCanvas.width = width;
  colCanvas.height = height;
  const colCtx = colCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bumpCtx = bumpCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const roughCtx = roughCanvas.getContext('2d');

  colCtx.fillStyle = seamColor;
  colCtx.fillRect(0, 0, width, height);
  bumpCtx.fillStyle = '#181818';
  bumpCtx.fillRect(0, 0, width, height);
  roughCtx.fillStyle = '#e8e8e8';
  roughCtx.fillRect(0, 0, width, height);

  const rowHeight = height / rows;
  const gap = Math.max(2, Math.round(rowHeight * 0.045));

  for (let row = 0; row < rows; row++) {
    const py = Math.round(row * rowHeight);
    const ph = Math.round(rowHeight) - gap;
    const numPlanks = 2 + Math.floor(rng() * 2);
    const rowOffset = rng() * width;
    const splits = [0];
    for (let s = 1; s < numPlanks; s++) {
      splits.push((s / numPlanks + (rng() - 0.5) * 0.14) * width);
    }
    splits.push(width);

    for (let s = 0; s < numPlanks; s++) {
      const startX = splits[s];
      const pw = splits[s + 1] - splits[s] - gap;
      const hex = baseColors[Math.floor(rng() * baseColors.length)];
      const plankColor = new THREE.Color(hex);
      plankColor.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.12);

      const drawPlankAt = (px) => {
        colCtx.save();
        colCtx.beginPath();
        colCtx.rect(px, py, pw, ph);
        colCtx.clip();
        colCtx.fillStyle = `#${plankColor.getHexString()}`;
        colCtx.fillRect(px, py, pw, ph);

        const edgeGrad = colCtx.createLinearGradient(0, py, 0, py + ph);
        edgeGrad.addColorStop(0, 'rgba(255, 225, 185, 0.10)');
        edgeGrad.addColorStop(0.18, 'rgba(255, 255, 255, 0.0)');
        edgeGrad.addColorStop(0.82, 'rgba(0, 0, 0, 0.0)');
        edgeGrad.addColorStop(1, 'rgba(10, 5, 2, 0.28)');
        colCtx.fillStyle = edgeGrad;
        colCtx.fillRect(px, py, pw, ph);

        const grainLines = 26;
        for (let g = 0; g < grainLines; g++) {
          const gy = py + (g / grainLines) * ph + (rng() - 0.5) * 3;
          const isDark = rng() > 0.42;
          const alpha = (0.04 + rng() * 0.12) * (grainContrast / 0.22);
          colCtx.strokeStyle = isDark
            ? `rgba(22, 10, 4, ${alpha.toFixed(3)})`
            : `rgba(235, 190, 135, ${(alpha * 0.65).toFixed(3)})`;
          colCtx.lineWidth = 0.8 + rng() * 2.2;
          colCtx.beginPath();
          const waveAmp = 1.2 + rng() * 3;
          const waveFreq = (1 + Math.floor(rng() * 3)) * ((Math.PI * 2) / Math.max(pw, 80));
          const wavePhase = rng() * Math.PI * 2;
          for (let lx = 0; lx <= pw; lx += 14) {
            const wy = gy + Math.sin(lx * waveFreq + wavePhase) * waveAmp;
            if (lx === 0) colCtx.moveTo(px + lx, wy);
            else colCtx.lineTo(px + lx, wy);
          }
          colCtx.stroke();
        }

        if (rng() < 0.45 && pw > 90) {
          const kx = px + 35 + rng() * (pw - 70);
          const ky = py + ph * (0.28 + rng() * 0.44);
          const kr = 5 + rng() * 7;
          const knotGrad = colCtx.createRadialGradient(kx, ky, 1, kx, ky, kr * 2.1);
          knotGrad.addColorStop(0, 'rgba(24, 11, 4, 0.55)');
          knotGrad.addColorStop(0.45, 'rgba(42, 20, 8, 0.26)');
          knotGrad.addColorStop(1, 'rgba(42, 20, 8, 0)');
          colCtx.fillStyle = knotGrad;
          colCtx.beginPath();
          colCtx.ellipse(kx, ky, kr * 2.4, kr * 1.15, 0, 0, Math.PI * 2);
          colCtx.fill();
        }

        const nailMargin = 9;
        const ny1 = py + ph * 0.28;
        const ny2 = py + ph * 0.72;
        colCtx.fillStyle = nailColor;
        for (const nx of [px + nailMargin, px + pw - nailMargin]) {
          for (const ny of [ny1, ny2]) {
            colCtx.beginPath();
            colCtx.arc(nx, ny, 2.3, 0, Math.PI * 2);
            colCtx.fill();
          }
        }
        colCtx.restore();

        bumpCtx.save();
        bumpCtx.beginPath();
        bumpCtx.rect(px, py, pw, ph);
        bumpCtx.clip();
        const bVal = Math.round(165 + (rng() - 0.5) * 36);
        const bGrad = bumpCtx.createLinearGradient(0, py, 0, py + ph);
        bGrad.addColorStop(0, `rgb(${bVal - 22},${bVal - 22},${bVal - 22})`);
        bGrad.addColorStop(0.12, `rgb(${bVal + 15},${bVal + 15},${bVal + 15})`);
        bGrad.addColorStop(0.88, `rgb(${bVal},${bVal},${bVal})`);
        bGrad.addColorStop(1, `rgb(${bVal - 35},${bVal - 35},${bVal - 35})`);
        bumpCtx.fillStyle = bGrad;
        bumpCtx.fillRect(px, py, pw, ph);
        for (let g = 0; g < 18; g++) {
          const gy = py + (g / 18) * ph;
          bumpCtx.strokeStyle = g % 2 === 0 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.12)';
          bumpCtx.lineWidth = 1.3;
          bumpCtx.beginPath();
          bumpCtx.moveTo(px, gy);
          bumpCtx.lineTo(px + pw, gy + (rng() - 0.5) * 3);
          bumpCtx.stroke();
        }
        bumpCtx.restore();

        const rVal = Math.round(150 + (rng() - 0.5) * 44);
        roughCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
        roughCtx.fillRect(px, py, pw, ph);
      };

      const wrappedX = (startX + rowOffset) % width;
      drawPlankAt(wrappedX);
      if (wrappedX + pw > width) drawPlankAt(wrappedX - width);
      if (wrappedX < gap) drawPlankAt(wrappedX + width);
    }
  }

  const map = new THREE.CanvasTexture(colCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 4;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  return { map, bumpMap, roughnessMap };
}

/**
 * 生成古帆船亚麻帆布与绛红条纹主帆纹理
 */
export function createSailTextures({ striped = false, weathered = 1, seed = 202 } = {}) {
  const rng = createSeededRNG(seed);
  const colCanvas = document.createElement('canvas');
  colCanvas.width = 1024;
  colCanvas.height = 1024;
  const colCtx = colCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 1024;
  bumpCanvas.height = 1024;
  const bumpCtx = bumpCanvas.getContext('2d');

  colCtx.fillStyle = '#eadbc2';
  colCtx.fillRect(0, 0, 1024, 1024);
  bumpCtx.fillStyle = '#909090';
  bumpCtx.fillRect(0, 0, 1024, 1024);

  const panels = 12;
  const panelW = 1024 / panels;
  for (let i = 0; i < panels; i++) {
    const px = i * panelW;
    if (striped && (i === 2 || i === 3 || i === 8 || i === 9)) {
      const c = new THREE.Color('#7d261e').offsetHSL(0, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.04);
      colCtx.fillStyle = `#${c.getHexString()}`;
    } else {
      const c = new THREE.Color('#e8d7ba').offsetHSL((rng() - 0.5) * 0.015, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.045);
      colCtx.fillStyle = `#${c.getHexString()}`;
    }
    colCtx.fillRect(px, 0, panelW, 1024);

    const seamGrad = colCtx.createLinearGradient(px, 0, px + panelW, 0);
    seamGrad.addColorStop(0, 'rgba(45, 28, 14, 0.24)');
    seamGrad.addColorStop(0.07, 'rgba(45, 28, 14, 0.0)');
    seamGrad.addColorStop(0.93, 'rgba(45, 28, 14, 0.0)');
    seamGrad.addColorStop(1, 'rgba(45, 28, 14, 0.20)');
    colCtx.fillStyle = seamGrad;
    colCtx.fillRect(px, 0, panelW, 1024);

    bumpCtx.fillStyle = 'rgba(40,40,40,0.65)';
    bumpCtx.fillRect(px, 0, 3, 1024);
    bumpCtx.fillStyle = 'rgba(220,220,220,0.45)';
    bumpCtx.fillRect(px + 3, 0, 3, 1024);
  }

  const drawReefBand = (y, h, alpha = 0.13) => {
    colCtx.fillStyle = `rgba(110, 82, 52, ${alpha})`;
    colCtx.fillRect(0, y, 1024, h);
    colCtx.strokeStyle = 'rgba(62, 42, 24, 0.35)';
    colCtx.lineWidth = 2;
    colCtx.strokeRect(0, y, 1024, h);
    bumpCtx.fillStyle = 'rgba(215, 215, 215, 0.35)';
    bumpCtx.fillRect(0, y, 1024, h);
  };
  drawReefBand(0, 34, 0.18);
  drawReefBand(988, 36, 0.18);
  drawReefBand(Math.round(1024 * 0.32), 24, 0.12);
  drawReefBand(Math.round(1024 * 0.64), 22, 0.11);

  for (let i = 0; i < 3; i++) {
    const pw = 85 + rng() * 95;
    const ph = 70 + rng() * 90;
    const px = 80 + rng() * (864 - pw);
    const py = 90 + rng() * (844 - ph);
    colCtx.save();
    colCtx.translate(px + pw * 0.5, py + ph * 0.5);
    colCtx.rotate((rng() - 0.5) * 0.08);
    colCtx.fillStyle = rng() > 0.35 ? 'rgba(216, 194, 158, 0.72)' : 'rgba(192, 168, 132, 0.68)';
    colCtx.fillRect(-pw * 0.5, -ph * 0.5, pw, ph);
    colCtx.strokeStyle = 'rgba(68, 46, 26, 0.5)';
    colCtx.lineWidth = 2;
    colCtx.setLineDash([6, 5]);
    colCtx.strokeRect(-pw * 0.5 + 3, -ph * 0.5 + 3, pw - 6, ph - 6);
    colCtx.restore();
  }

  colCtx.fillStyle = 'rgba(65, 45, 22, 0.03)';
  for (let y = 0; y < 1024; y += 4) colCtx.fillRect(0, y, 1024, 1);
  for (let x = 0; x < 1024; x += 4) colCtx.fillRect(x, 0, 1, 1024);

  if (weathered > 0) {
    const vig = colCtx.createRadialGradient(512, 491.52, 225.28, 512, 512, 737.28);
    vig.addColorStop(0, 'rgba(255, 248, 232, 0.04)');
    vig.addColorStop(0.7, 'rgba(92, 65, 38, 0.10)');
    vig.addColorStop(1, `rgba(58, 38, 20, ${(0.34 * weathered).toFixed(2)})`);
    colCtx.fillStyle = vig;
    colCtx.fillRect(0, 0, 1024, 1024);
  }

  colCtx.fillStyle = '#5c3a20';
  const cSize = 58;
  const corners = [
    [[0, 0], [cSize, 0], [0, cSize]],
    [[1024, 0], [1024 - cSize, 0], [1024, cSize]],
    [[0, 1024], [cSize, 1024], [0, 1024 - cSize]],
    [[1024, 1024], [1024 - cSize, 1024], [1024, 1024 - cSize]],
  ];
  for (const tri of corners) {
    colCtx.beginPath();
    colCtx.moveTo(tri[0][0], tri[0][1]);
    colCtx.lineTo(tri[1][0], tri[1][1]);
    colCtx.lineTo(tri[2][0], tri[2][1]);
    colCtx.closePath();
    colCtx.fill();
  }

  const map = new THREE.CanvasTexture(colCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 4;

  return { map, bumpMap };
}

/**
 * 生成螺旋股捻麻绳贴图
 */
export function createRopeTextures() {
  const colCanvas = document.createElement('canvas');
  colCanvas.width = 128;
  colCanvas.height = 256;
  const colCtx = colCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 128;
  bumpCanvas.height = 256;
  const bumpCtx = bumpCanvas.getContext('2d');

  const colImg = colCtx.createImageData(128, 256);
  const bumpImg = bumpCtx.createImageData(128, 256);

  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 128; x++) {
      const u = x / 128;
      const v = y / 256;
      const twistPhase = (u * 3 + v * 6) * Math.PI * 2;
      const strand = Math.abs(Math.sin(twistPhase * 0.5));
      const fiber = 0.85 + 0.15 * Math.sin((u * 28 + v * 12) * Math.PI * 2);
      const shade = (0.52 + 0.48 * strand) * fiber;
      const idx = (y * 128 + x) * 4;

      colImg.data[idx] = Math.min(255, Math.round(188 * shade));
      colImg.data[idx + 1] = Math.min(255, Math.round(152 * shade));
      colImg.data[idx + 2] = Math.min(255, Math.round(102 * shade));
      colImg.data[idx + 3] = 255;

      const hVal = Math.min(255, Math.round(255 * strand * fiber));
      bumpImg.data[idx] = hVal;
      bumpImg.data[idx + 1] = hVal;
      bumpImg.data[idx + 2] = hVal;
      bumpImg.data[idx + 3] = 255;
    }
  }
  colCtx.putImageData(colImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);

  const map = new THREE.CanvasTexture(colCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;

  return { map, bumpMap };
}

/**
 * 生成三通道无缝海沫与微波法线贴图（R: Worley 蜂窝海沫脊线, G/B: 多尺度平铺 FBM 噪波）
 * 当传入 renderer 时，采用 GPU 离屏着色器在 < 0.5ms 内直接烘焙，彻底消除首屏 CPU 420 万次哈希循环阻塞
 */
export function createFoamNoiseTexture(size = 512, renderer = null) {
  if (renderer) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.anisotropy = 8;

    const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bakeGeo = new THREE.BufferGeometry();
    bakeGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    bakeGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));

    const bakeMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;

        float hashGrid(vec2 cell, float seed) {
          vec2 p = mod(cell, 256.0) + vec2(seed * 17.3, seed * 31.7);
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float tileNoise(vec2 uv, float freq, float seed) {
          vec2 r = uv * freq;
          vec2 i0 = floor(r);
          vec2 f = fract(r);
          vec2 u = f * f * (3.0 - 2.0 * f);
          vec2 c0 = mod(i0, freq);
          vec2 c1 = mod(i0 + 1.0, freq);
          float a = hashGrid(vec2(c0.x, c0.y), seed);
          float b = hashGrid(vec2(c1.x, c0.y), seed);
          float c = hashGrid(vec2(c0.x, c1.y), seed);
          float d = hashGrid(vec2(c1.x, c1.y), seed);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float worleyRidge(vec2 uv, float cells) {
          vec2 g = uv * cells;
          vec2 baseCell = floor(g);
          float d1 = 999.0;
          float d2 = 999.0;
          for (int oy = -1; oy <= 1; oy++) {
            for (int ox = -1; ox <= 1; ox++) {
              vec2 offset = vec2(float(ox), float(oy));
              vec2 neighbor = baseCell + offset;
              vec2 wrapped = mod(neighbor + cells, cells);
              vec2 feat = neighbor + vec2(
                0.15 + 0.70 * hashGrid(wrapped, 71.0),
                0.15 + 0.70 * hashGrid(wrapped, 193.0)
              );
              float dist = length(g - feat);
              if (dist < d1) {
                d2 = d1;
                d1 = dist;
              } else if (dist < d2) {
                d2 = dist;
              }
            }
          }
          float ridge = 1.0 - min(1.0, (d2 - d1) * 2.4);
          return pow(max(0.0, ridge), 1.65);
        }

        void main() {
          vec2 uv = fract(vUv);
          float lacyFoam = worleyRidge(uv, 12.0);

          float midFbm = (
            0.5000 * tileNoise(uv, 6.0, 17.0) +
            0.2500 * tileNoise(uv, 12.0, 48.0) +
            0.1250 * tileNoise(uv, 24.0, 79.0) +
            0.0625 * tileNoise(uv, 48.0, 110.0)
          ) / 0.9375;

          float fineFbm = (
            0.500 * tileNoise(uv, 14.0, 89.0) +
            0.250 * tileNoise(uv, 28.0, 120.0) +
            0.125 * tileNoise(uv, 56.0, 151.0)
          ) / 0.875;

          gl_FragColor = vec4(lacyFoam, midFbm, fineFbm, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const bakeMesh = new THREE.Mesh(bakeGeo, bakeMat);
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt);
    renderer.render(bakeMesh, bakeCam);
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;

    bakeGeo.dispose();
    bakeMat.dispose();
    return rt.texture;
  }

  // CPU 降级兼容路径
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  const cells = 12;
  const featX = new Float32Array(cells * cells);
  const featY = new Float32Array(cells * cells);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const idx = cy * cells + cx;
      featX[idx] = cx + 0.15 + 0.7 * hashGrid2D(cx, cy, 71);
      featY[idx] = cy + 0.15 + 0.7 * hashGrid2D(cx, cy, 193);
    }
  }

  for (let py = 0; py < size; py++) {
    const v = py / size;
    const gy = v * cells;
    const cy0 = Math.floor(gy);
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const gx = u * cells;
      const cx0 = Math.floor(gx);
      let d1 = 999;
      let d2 = 999;
      for (let oy = -1; oy <= 1; oy++) {
        const wy = ((cy0 + oy) % cells + cells) % cells;
        for (let ox = -1; ox <= 1; ox++) {
          const wx = ((cx0 + ox) % cells + cells) % cells;
          const cellIdx = wy * cells + wx;
          const fx = featX[cellIdx] + Math.floor((cx0 + ox) / cells) * cells;
          const fy = featY[cellIdx] + Math.floor((cy0 + oy) / cells) * cells;
          const dist = Math.hypot(gx - fx, gy - fy);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }
      const ridge = 1 - Math.min(1, (d2 - d1) * 2.4);
      const lacyFoam = Math.pow(Math.max(0, ridge), 1.65);
      const midFbm = tileableFBM(u, v, 6, 6, 4, 17);
      const fineFbm = tileableFBM(u, v, 14, 14, 3, 89);

      const idx = (py * size + px) * 4;
      img.data[idx] = Math.min(255, Math.round(lacyFoam * 255));
      img.data[idx + 1] = Math.min(255, Math.round(midFbm * 255));
      img.data[idx + 2] = Math.min(255, Math.round(fineFbm * 255));
      img.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 生成柔和暖金径向光晕贴图（用于风灯光晕、炮口闪光与空气微尘）
 */
export function createSoftGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255, 250, 225, 1.0)');
  grad.addColorStop(0.18, 'rgba(255, 200, 105, 0.78)');
  grad.addColorStop(0.48, 'rgba(255, 130, 35, 0.24)');
  grad.addColorStop(1, 'rgba(255, 95, 15, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 生成复合水珠团簇飞沫贴图（用于船首浪花、海啸水雾、炮弹浓烟与落水柱）
 */
export function createSprayDropTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = createSeededRNG(909);
  const half = size * 0.5;

  const baseGrad = ctx.createRadialGradient(half, half, 0, half, half, half * 0.92);
  baseGrad.addColorStop(0, 'rgba(255, 248, 236, 0.34)');
  baseGrad.addColorStop(0.45, 'rgba(235, 244, 250, 0.16)');
  baseGrad.addColorStop(1, 'rgba(200, 225, 240, 0.0)');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 28; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.pow(rng(), 0.75) * (half * 0.72);
    const dx = half + Math.cos(ang) * rad;
    const dy = half + Math.sin(ang) * rad;
    const dropR = 1.6 + rng() * 4.8 * (1 - rad / half);
    const dropGrad = ctx.createRadialGradient(dx, dy, 0, dx, dy, dropR);
    const alpha = 0.35 + rng() * 0.5;
    dropGrad.addColorStop(0, `rgba(255, 252, 244, ${alpha.toFixed(2)})`);
    dropGrad.addColorStop(0.55, `rgba(238, 246, 252, ${(alpha * 0.45).toFixed(2)})`);
    dropGrad.addColorStop(1, 'rgba(220, 238, 248, 0.0)');
    ctx.fillStyle = dropGrad;
    ctx.beginPath();
    ctx.arc(dx, dy, dropR, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
