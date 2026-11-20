/**
 * @file staticBatchOptimizer.js
 * @description 船体静态几何体性能优化器：
 *              1. 自动识别重复 ≥ 6 次且正行列式的构件（如火炮车轮、炮弹、木桶箍圈、系缆桩、三眼滑车），转为 GPU InstancedMesh；
 *              2. 其余静态网格按 (material, castShadow, receiveShadow) 自动烘焙合并为单一 BufferGeometry（含镜像缩放负行列式三角形绕序修正）；
 *              3. 对舵轮、船长、摇摆风灯、火炮后坐力枢轴、船舵与船钟等刚体活动节点内部子网格做局部合并，将整船 ~1700 次绘制压缩至 ~250 次以内。
 */

import * as THREE from 'three';

/**
 * 将同一材质与阴影属性的静态网格数组烘焙合并为单个世界/局部空间 BufferGeometry
 */
export function mergeStaticBucket(items, wantVertexColor) {
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const item of items) {
    const count = item.geo.attributes.position.count;
    vertexTotal += count;
    indexTotal += item.geo.index !== null ? item.geo.index.count : count;
  }

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const colors = wantVertexColor ? new Float32Array(vertexTotal * 3) : null;
  const indices = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);

  let vOffset = 0;
  let iOffset = 0;
  const tmpPos = new THREE.Vector3();
  const tmpNorm = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();

  for (const item of items) {
    const g = item.geo;
    const posAttr = g.attributes.position;
    const normAttr = g.attributes.normal;
    const uvAttr = g.attributes.uv;
    const colAttr = g.attributes.color;
    const vCount = posAttr.count;

    normalMat.getNormalMatrix(item.mat4);

    for (let k = 0; k < vCount; k++) {
      const b3 = (vOffset + k) * 3;
      const b2 = (vOffset + k) * 2;
      tmpPos.fromBufferAttribute(posAttr, k).applyMatrix4(item.mat4);
      positions[b3] = tmpPos.x;
      positions[b3 + 1] = tmpPos.y;
      positions[b3 + 2] = tmpPos.z;

      if (normAttr) {
        tmpNorm.fromBufferAttribute(normAttr, k).applyNormalMatrix(normalMat);
        normals[b3] = tmpNorm.x;
        normals[b3 + 1] = tmpNorm.y;
        normals[b3 + 2] = tmpNorm.z;
      } else {
        normals[b3] = 0;
        normals[b3 + 1] = 1;
        normals[b3 + 2] = 0;
      }

      if (uvAttr) {
        uvs[b2] = uvAttr.getX(k);
        uvs[b2 + 1] = uvAttr.getY(k);
      }

      if (colors) {
        if (colAttr) {
          colors[b3] = colAttr.getX(k);
          colors[b3 + 1] = colAttr.getY(k);
          colors[b3 + 2] = colAttr.getZ(k);
        } else {
          colors[b3] = 1;
          colors[b3 + 1] = 1;
          colors[b3 + 2] = 1;
        }
      }
    }

    // 若变换矩阵行列式为负（如左右舷镜像 scale.x = -1），翻转三角形顶点绕序以保持法线朝外
    const flipWinding = item.det < 0;
    if (g.index !== null) {
      const idxAttr = g.index;
      const idxCount = idxAttr.count;
      for (let k = 0; k < idxCount; k += 3) {
        const a0 = vOffset + idxAttr.getX(k);
        const a1 = vOffset + idxAttr.getX(k + 1);
        const a2 = vOffset + idxAttr.getX(k + 2);
        indices[iOffset++] = a0;
        indices[iOffset++] = flipWinding ? a2 : a1;
        indices[iOffset++] = flipWinding ? a1 : a2;
      }
    } else {
      for (let k = 0; k < vCount; k += 3) {
        const a0 = vOffset + k;
        const a1 = vOffset + k + 1;
        const a2 = vOffset + k + 2;
        indices[iOffset++] = a0;
        indices[iOffset++] = flipWinding ? a2 : a1;
        indices[iOffset++] = flipWinding ? a1 : a2;
      }
    }

    vOffset += vCount;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * 合并动态刚体枢轴（如舵轮、船长、火炮车架、风灯）内部的同材质子网格，保留枢轴自身的旋转/位移自由度
 */
export function optimizeRigidPivot(pivot) {
  pivot.updateMatrixWorld(true);
  const invRoot = pivot.matrixWorld.clone().invert();
  const items = [];

  function scan(node) {
    if (node.isMesh && !node.isInstancedMesh && !Array.isArray(node.material) && node.visible !== false) {
      const relMat = invRoot.clone().multiply(node.matrixWorld);
      items.push({
        mesh: node,
        geo: node.geometry,
        mat: node.material,
        cast: !!node.castShadow,
        recv: !!node.receiveShadow,
        mat4: relMat,
        det: relMat.determinant(),
      });
    }
    for (const child of node.children) scan(child);
  }
  scan(pivot);

  const buckets = new Map();
  for (const it of items) {
    const key = `${it.mat.id}_${it.cast ? 1 : 0}_${it.recv ? 1 : 0}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(it);
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const ref = bucket[0];
    const mergedGeo = mergeStaticBucket(bucket, !!ref.mat.vertexColors);
    const mergedMesh = new THREE.Mesh(mergedGeo, ref.mat);
    mergedMesh.castShadow = ref.cast;
    mergedMesh.receiveShadow = ref.recv;
    for (const it of bucket) {
      if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
    }
    pivot.add(mergedMesh);
  }
}

/**
 * 对整艘船体执行静态网格合并与重复构件实例化，自动跳过风帆、长旒旗及动态刚体枢轴
 */
export function optimizeStaticShip(shipRoot, dynamicRoots) {
  shipRoot.updateMatrixWorld(true);
  const candidates = [];
  const protectedGeos = new Set();

  function collectProtected(node) {
    if (node.isMesh && node.geometry) protectedGeos.add(node.geometry);
    for (const child of node.children) collectProtected(child);
  }

  function walk(node) {
    if (dynamicRoots.has(node)) {
      collectProtected(node);
      return;
    }
    if (node.isMesh && !node.isInstancedMesh && node.visible !== false) {
      const g = node.geometry;
      if (g.attributes.aFlutterWeight || g.attributes.aPennantMeta) {
        protectedGeos.add(g);
      } else if (!Array.isArray(node.material)) {
        candidates.push({
          mesh: node,
          geo: g,
          mat: node.material,
          cast: !!node.castShadow,
          recv: !!node.receiveShadow,
          mat4: node.matrixWorld.clone(),
          det: node.matrixWorld.determinant(),
        });
      }
    }
    for (const child of node.children) walk(child);
  }
  walk(shipRoot);

  const instMap = new Map();
  const mergeList = [];
  for (const it of candidates) {
    if (it.det > 0) {
      const key = `${it.geo.id}_${it.mat.id}_${it.cast ? 1 : 0}_${it.recv ? 1 : 0}`;
      let arr = instMap.get(key);
      if (!arr) {
        arr = [];
        instMap.set(key, arr);
      }
      arr.push(it);
    } else {
      mergeList.push(it);
    }
  }

  const optimizedRoot = new THREE.Group();
  optimizedRoot.name = 'OptimizedStaticShip';

  for (const arr of instMap.values()) {
    if (arr.length >= 6) {
      const ref = arr[0];
      const instMesh = new THREE.InstancedMesh(ref.geo, ref.mat, arr.length);
      instMesh.castShadow = ref.cast;
      instMesh.receiveShadow = ref.recv;
      for (let k = 0; k < arr.length; k++) {
        instMesh.setMatrixAt(k, arr[k].mat4);
      }
      instMesh.instanceMatrix.needsUpdate = true;
      instMesh.computeBoundingBox();
      instMesh.computeBoundingSphere();
      optimizedRoot.add(instMesh);
      protectedGeos.add(ref.geo);
    } else {
      for (const it of arr) mergeList.push(it);
    }
  }

  const matBuckets = new Map();
  for (const it of mergeList) {
    const key = `${it.mat.id}_${it.cast ? 1 : 0}_${it.recv ? 1 : 0}`;
    let bucket = matBuckets.get(key);
    if (!bucket) {
      bucket = [];
      matBuckets.set(key, bucket);
    }
    bucket.push(it);
  }

  for (const bucket of matBuckets.values()) {
    const ref = bucket[0];
    const mergedGeo = mergeStaticBucket(bucket, !!ref.mat.vertexColors);
    const mergedMesh = new THREE.Mesh(mergedGeo, ref.mat);
    mergedMesh.castShadow = ref.cast;
    mergedMesh.receiveShadow = ref.recv;
    optimizedRoot.add(mergedMesh);
  }

  const disposedGeos = new Set();
  for (const it of candidates) {
    if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
    if (!protectedGeos.has(it.geo) && !disposedGeos.has(it.geo)) {
      disposedGeos.add(it.geo);
      it.geo.dispose();
    }
  }

  function pruneEmptyGroups(node) {
    for (let k = node.children.length - 1; k >= 0; k--) {
      const child = node.children[k];
      if (!dynamicRoots.has(child)) {
        pruneEmptyGroups(child);
        if (child.isGroup && child.children.length === 0) node.remove(child);
      }
    }
  }
  pruneEmptyGroups(shipRoot);
  shipRoot.add(optimizedRoot);
}
