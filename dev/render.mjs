// Renderiza o avatar real (com skinning, morphs e texturas) para PNG, sem GPU.
// Uso: node render.mjs --view bust|face|full --pose app|tpose --expr happy,blink --out /tmp/x.png
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ---------------------------------------------------------------- PNG
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'latin1'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, c]); };
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
function encodePNG(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h), src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1); raw[o] = 4; const rs = y * stride, ps = rs - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? src[rs + i - 4] : 0, b = y > 0 ? src[ps + i] : 0, c = y > 0 && i >= 4 ? src[ps + i - 4] : 0;
      raw[o + 1 + i] = (src[rs + i] - paeth(a, b, c)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(buf) {
  let off = 8, width = 0, height = 0, colorType = 6; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1, stride = width * ch;
  const out = new Uint8Array(width * height * 4), line = new Uint8Array(stride), prev = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    for (let i = 0; i < stride; i++) {
      const x = raw[pos + i], a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      line[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 0xff;
    }
    pos += stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (ch === 4) { out[o] = line[x * 4]; out[o + 1] = line[x * 4 + 1]; out[o + 2] = line[x * 4 + 2]; out[o + 3] = line[x * 4 + 3]; }
      else if (ch === 3) { out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255; }
      else { out[o] = out[o + 1] = out[o + 2] = line[x]; out[o + 3] = 255; }
    }
    prev.set(line);
  }
  return { width, height, rgba: out };
}

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const VIEWS = {
  bust: { eye: [0, 1.47, 0.8], target: [0, 1.43, 0], fov: 30 },
  face: { eye: [0, 1.53, 0.34], target: [0, 1.5, 0.02], fov: 26 },
  full: { eye: [0.05, 1.05, 2.2], target: [0, 0.9, 0], fov: 30 },
  '3q': { eye: [0.5, 1.5, 0.66], target: [0, 1.42, 0], fov: 31 },
  back: { eye: [0, 1.5, -0.8], target: [0, 1.4, 0], fov: 32 },
};
const view = VIEWS[opt('view', 'bust')];
const W = parseInt(opt('w', '560'), 10), H = parseInt(opt('h', '700'), 10), SS = parseInt(opt('ss', '2'), 10);
const out = opt('out', '/tmp/avatar.png');
const poseMode = opt('pose', 'app');
const exprs = opt('expr', '').split(',').filter(Boolean);

// ---------------------------------------------------------------- shims
globalThis.self = globalThis;
globalThis.createImageBitmap = async (blob) => {
  const buf = Buffer.from(await blob.arrayBuffer());
  const img = decodePNG(buf);
  return { width: img.width, height: img.height, __rgba: img.rgba, close() {} };
};

// ---------------------------------------------------------------- carregar
const data = fs.readFileSync(new URL('../assets/avatar.vrm', import.meta.url));
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p, { autoUpdateHumanBones: true }));
const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
const vrm = gltf.userData.vrm;
VRMUtils.removeUnnecessaryVertices(gltf.scene);
VRMUtils.removeUnnecessaryJoints(gltf.scene);
VRMUtils.rotateVRM0(vrm);
const scene = new THREE.Scene();
scene.add(vrm.scene);

// pose do app: braços para baixo
if (poseMode === 'app') {
  const b = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  if (b('leftUpperArm')) b('leftUpperArm').rotation.z = -1.12;
  if (b('rightUpperArm')) b('rightUpperArm').rotation.z = 1.12;
  if (b('leftLowerArm')) b('leftLowerArm').rotation.z = -0.16;
  if (b('rightLowerArm')) b('rightLowerArm').rotation.z = 0.16;
}
for (const e of exprs) {
  const [nome, peso] = e.split('=');
  vrm.expressionManager.setValue(nome, peso ? parseFloat(peso) : 1);
}
const head = vrm.humanoid.getNormalizedBoneNode('head');
if (head && poseMode === 'app') head.rotation.x = -0.02;
vrm.update(0.016);
scene.updateMatrixWorld(true);
// os boneMatrices do skeleton sao atualizados pelo renderer do three; aqui precisamos chamar na mao
scene.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
console.log('skinned meshes:', (() => { let c = 0; scene.traverse((o) => { if (o.isSkinnedMesh) c++; }); return c; })());


// ---------------------------------------------------------------- camera
const eye = new THREE.Vector3(...view.eye), target = new THREE.Vector3(...view.target);
const camM = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
const viewM = new THREE.Matrix4().copy(camM).invert().multiply(new THREE.Matrix4().makeTranslation(-eye.x, -eye.y, -eye.z));
const NEAR = 0.05, aspect = (W * SS) / (H * SS);
const tv = NEAR * Math.tan((view.fov * Math.PI) / 360);
const vp = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().makePerspective(-tv * aspect, tv * aspect, tv, -tv, NEAR, 50), viewM);
const VP = vp.elements;
const project = (x, y, z) => ({ x: VP[0] * x + VP[4] * y + VP[8] * z + VP[12], y: VP[1] * x + VP[5] * y + VP[9] * z + VP[13], z: VP[2] * x + VP[6] * y + VP[10] * z + VP[14], w: VP[3] * x + VP[7] * y + VP[11] * z + VP[15] });

// ---------------------------------------------------------------- buffers
const RW = W * SS, RH = H * SS;
const color = new Uint8Array(RW * RH * 4), depth = new Float32Array(RW * RH).fill(Infinity);
for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) { const o = (y * RW + x) * 4; const t = y / RH; color[o] = 226 - 46 * t; color[o + 1] = 231 - 40 * t; color[o + 2] = 246 - 28 * t; color[o + 3] = 255; }

const L1 = new THREE.Vector3(-0.5, 0.75, 0.75).normalize(), L2 = new THREE.Vector3(0.6, 0.15, 0.5).normalize();

// ---------------------------------------------------------------- skinning
const acc = [];
const mats = [];
let triTotal = 0;
scene.traverse((obj) => {
  if (!obj.isMesh) return;
  const geo = obj.geometry;
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  const n = pos.count;
  const skinned = !!obj.isSkinnedMesh;
  const skinIdx = skinned ? geo.attributes.skinIndex : null;
  const skinW = skinned ? geo.attributes.skinWeight : null;
  const boneMatrices = skinned && obj.skeleton ? obj.skeleton.boneMatrices : null;
  const morphs = geo.morphAttributes.position || [];
  const inf = obj.morphTargetInfluences || [];

  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  const v = new THREE.Vector3(), nrm = new THREE.Vector3(), bm = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    for (let mi = 0; mi < morphs.length; mi++) {
      const w = inf[mi] || 0;
      if (w) { x += morphs[mi].getX(i) * w; y += morphs[mi].getY(i) * w; z += morphs[mi].getZ(i) * w; }
    }
    v.set(x, y, z);
    let nx = nor ? nor.getX(i) : 0, ny = nor ? nor.getY(i) : 1, nz = nor ? nor.getZ(i) : 0;
    if (skinned && boneMatrices) {
      const o = new THREE.Vector3(), on = new THREE.Vector3();
      for (let k = 0; k < 4; k++) {
        const bi = skinIdx.getComponent(i, k), w = skinW.getComponent(i, k);
        if (!w) continue;
        bm.fromArray(boneMatrices, bi * 16);
        o.addScaledVector(v.clone().applyMatrix4(bm), w);
        const n3 = new THREE.Matrix3().setFromMatrix4(bm);
        on.addScaledVector(new THREE.Vector3(nx, ny, nz).applyMatrix3(n3).normalize(), w);
      }
      v.copy(o);
      nrm.copy(on).normalize();
    } else {
      v.applyMatrix4(obj.matrixWorld);
      nrm.set(nx, ny, nz).transformDirection(obj.matrixWorld);
    }
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    N[i * 3] = nrm.x || 0; N[i * 3 + 1] = nrm.y || 0; N[i * 3 + 2] = nrm.z || 0;
    U[i * 2] = uv ? uv.getX(i) : 0; U[i * 2 + 1] = uv ? uv.getY(i) : 0;
  }
  let tex = null;
  const mat = obj.material;
  const map = mat.map || (mat.uniforms && mat.uniforms.map && mat.uniforms.map.value) || null;
  if (map && map.image) {
    if (map.image.__rgba) tex = { width: map.image.width, height: map.image.height, rgba: map.image.__rgba };
    else if (map.image.data) tex = { width: map.image.width, height: map.image.height, rgba: map.image.data };
    else if (!globalThis.__warnedImg) { globalThis.__warnedImg = true; console.log('imagem sem dados:', map.image.constructor && map.image.constructor.name, typeof map.image, map.image.width, map.image.height); }
  }
  const u = mat.uniforms || {};
  const base = (u.diffuse && u.diffuse.value) || (u.litFactor && u.litFactor.value) || mat.color || null;
  const cor = base ? [base.r === undefined ? base.x : base.r, base.g === undefined ? base.y : base.g, base.b === undefined ? base.z : base.b] : [1, 1, 1];
  const opac = u.opacity ? u.opacity.value : 1;
  const idx = geo.index ? geo.index.array : null;
  const count = idx ? idx.length : n;
  const idxArr = idx || Uint32Array.from({ length: n }, (_, i) => i);
  triTotal += count / 3;
  mats.push({ color: cor, opac, tex, alphaTest: (u.alphaTest && u.alphaTest.value) || mat.alphaTest || 0, transparent: !!mat.transparent, doubleSided: mat.side === THREE.DoubleSide, name: obj.name, matName: mat.name });
  acc.push({ P, N, U, idx: idxArr, matIndex: mats.length - 1 });
});

// ---------------------------------------------------------------- rasterizar
function sampleTex(tex, u, v) {
  const x = Math.min(tex.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.width)));
  const y = Math.min(tex.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.height)));
  const o = (y * tex.width + x) * 4;
  return [tex.rgba[o] / 255, tex.rgba[o + 1] / 255, tex.rgba[o + 2] / 255, tex.rgba[o + 3] / 255];
}

for (const mesh of acc) {
  const { P, N, U, idx, matIndex } = mesh;
  const M = mats[matIndex];
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i], ib = idx[i + 1], ic = idx[i + 2];
    const clip = [ia, ib, ic].map((k) => project(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]));
    if (clip.some((c) => c.w <= 0.02)) continue;
    const scr = clip.map((c) => [((c.x / c.w + 1) / 2) * RW, ((1 - c.y / c.w) / 2) * RH, c.z / c.w, c.w]);
    const area = (scr[1][0] - scr[0][0]) * (scr[2][1] - scr[0][1]) - (scr[2][0] - scr[0][0]) * (scr[1][1] - scr[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const frente = area < 0;
    if (!frente && !M.doubleSided) continue;
    const minX = Math.max(0, Math.floor(Math.min(scr[0][0], scr[1][0], scr[2][0])));
    const maxX = Math.min(RW - 1, Math.ceil(Math.max(scr[0][0], scr[1][0], scr[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(scr[0][1], scr[1][1], scr[2][1])));
    const maxY = Math.min(RH - 1, Math.ceil(Math.max(scr[0][1], scr[1][1], scr[2][1])));
    if (maxX < minX || maxY < minY) continue;
    const iw = scr.map((s) => 1 / s[3]);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const x = px + 0.5, y = py + 0.5;
        const w0 = ((scr[1][0] - x) * (scr[2][1] - y) - (scr[2][0] - x) * (scr[1][1] - y)) / area;
        const w1 = ((scr[2][0] - x) * (scr[0][1] - y) - (scr[0][0] - x) * (scr[2][1] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;
        const z = scr[0][2] * w0 + scr[1][2] * w1 + scr[2][2] * w2;
        const pi = py * RW + px;
        if (z >= depth[pi]) continue;
        const iwt = iw[0] * w0 + iw[1] * w1 + iw[2] * w2;
        const bw = [w0 * iw[0] / iwt, w1 * iw[1] / iwt, w2 * iw[2] / iwt];
        const ks = [ia, ib, ic];
        let r = 0, g = 0, b = 0, al = 1, uu = 0, vv = 0;
        for (let k = 0; k < 3; k++) {
          const vi = ks[k];
          let tr = 1, tg = 1, tb = 1, ta = 1;
          if (M.tex) { const s = sampleTex(M.tex, U[vi * 2], U[vi * 2 + 1]); tr = s[0]; tg = s[1]; tb = s[2]; ta = s[3]; }
          r += bw[k] * tr * M.color[0]; g += bw[k] * tg * M.color[1]; b += bw[k] * tb * M.color[2]; al = Math.min(al, ta);
          uu += bw[k] * U[vi * 2]; vv += bw[k] * U[vi * 2 + 1];
        }
        void uu; void vv;
        al *= M.opac === undefined ? 1 : M.opac;
        if (M.alphaTest > 0 && al < M.alphaTest) continue;
        if (al < 0.3) continue;
        const nx = bw[0] * N[ia * 3] + bw[1] * N[ib * 3] + bw[2] * N[ic * 3];
        const ny = bw[0] * N[ia * 3 + 1] + bw[1] * N[ib * 3 + 1] + bw[2] * N[ic * 3 + 1];
        const nz = bw[0] * N[ia * 3 + 2] + bw[1] * N[ib * 3 + 2] + bw[2] * N[ic * 3 + 2];
        const len = Math.hypot(nx, ny, nz) || 1;
        const normal = new THREE.Vector3(nx / len, ny / len, nz / len);
        const dif = Math.max(0, normal.dot(L1)) * 0.72 + Math.max(0, normal.dot(L2)) * 0.26;
        const amb = 0.42 + 0.16 * Math.max(0, normal.y);
        const s = Math.min(1.15, amb + dif);
        const o = pi * 4;
        color[o] = Math.min(255, r * s * 255);
        color[o + 1] = Math.min(255, g * s * 255);
        color[o + 2] = Math.min(255, b * s * 255);
        color[o + 3] = 255;
        depth[pi] = z;
      }
    }
  }
}

// downsample + salvar
const final = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const o = ((y * SS + sy) * RW + (x * SS + sx)) * 4; r += color[o]; g += color[o + 1]; b += color[o + 2]; }
    const k = SS * SS, o = (y * W + x) * 4;
    final[o] = r / k; final[o + 1] = g / k; final[o + 2] = b / k; final[o + 3] = 255;
  }
}
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, encodePNG(W, H, final));
console.log('texturas aplicadas:', mats.filter((m) => m.tex).length, 'de', mats.length);
console.log(`${out}  ${W}x${H}  view=${opt('view', 'bust')} pose=${poseMode}${exprs.length ? ' expr=' + exprs.join(',') : ''}  tris=${Math.round(triTotal)} malhas=${mats.length}`);
