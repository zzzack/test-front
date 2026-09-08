/**
 * 海盐蓝治愈小屋 · 室内装修 3D 漫游
 * -------------------------------------------------------------
 * 免构建：ESM importmap 直连 CDN；类型以 JSDoc 内嵌。
 * 数据驱动：房间 / 墙体 / 材质 / 灯光预设全部来自 scene.config.json。
 * 资源兜底：无外部贴图与模型时，全部由 Canvas 程序化生成。
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/* =============================================================
 * 0. 类型定义（JSDoc，供 VSCode 智能提示，无需 TS 编译）
 * ============================================================= */
/** @typedef {{name:string,size:string,material:string,price:string}} ItemInfo */
/** @typedef {{type:string,geom?:string,pos?:number[],size:number[],r?:number,rot?:number,rotX?:number,mat:string,solid?:boolean,lamp?:boolean,instances?:number[][],info?:ItemInfo}} ItemDef */
/** @typedef {{id:string,name:string,rect:number[],floor:string,wall:string,neighbors:string[],items:ItemDef[]}} RoomDef */
/** @typedef {{a:number[],b:number[],holes:{at:number,w:number,y0:number,y1:number,type:string}[]}} WallDef */

/* =============================================================
 * 1. 常量、DOM 句柄与运行时状态
 * ============================================================= */
const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const GRAVITY = 30;                                   // 重力加速度 m/s²
const STEP_HEIGHT = 0.28;                             // 台阶自动抬升阈值
const IS_TOUCH = matchMedia('(pointer:coarse)').matches; // 触屏判定

const dom = {
  loader: $('#loader'), hint: $('#hint'), cross: $('#cross'),
  roomName: $('#roomName'), modeTag: $('#modeTag'), fps: $('#fps'),
  minimap: /** @type {HTMLCanvasElement} */ ($('#minimap')), roomBtns: $('#roomBtns'),
  floorSel: /** @type {HTMLSelectElement} */ ($('#floorSel')),
  wallSel: /** @type {HTMLSelectElement} */ ($('#wallSel')),
  lightRow: $('#lightRow'), ppBtn: $('#ppBtn'), shadowBtn: $('#shadowBtn'),
  card: $('#card'), cName: $('#cName'), cPrice: $('#cPrice'), cSize: $('#cSize'), cMat: $('#cMat'),
  ctrlBody: $('#ctrlBody'), ctrlToggle: $('#ctrlToggle'),
  stick: $('#stick'), stickDot: /** @type {HTMLElement} */ ($('#stick i')), runBtn: $('#runBtn')
};

/** 全局运行时状态（集中放置，避免散落的模块级变量） */
const state = {
  /** @type {any} */ cfg: null,
  mode: /** @type {'fpv'|'god'|'orbit'} */ ('fpv'),
  light: 'day',
  floorPreset: '', wallPreset: 'cream',
  usePost: true, useShadow: true, lowEnd: false,
  currentRoom: 'entry',
  /** @type {THREE.Object3D|null} */ selected: null,
  velocity: new THREE.Vector3(),
  onFloor: false,
  keys: /** @type {Record<string,boolean>} */ ({}),
  joy: { x: 0, y: 0, run: false },
  probe: { frames: 0, sum: 0, done: false }
};

/* =============================================================
 * 2. 配置加载（file:// 直开时 fetch 会失败 → 走内置兜底盒子房）
 * ============================================================= */
const FALLBACK_CONFIG = {
  meta: { title: '兜底样板间', wallHeight: 2.8, wallThickness: 0.12, eyeHeight: 1.6, spawn: { pos: [3, 1.6, 3], yaw: 180 } },
  quality: { frameBudgetMs: 26, probeFrames: 45, maxPixelRatio: 1.6, mobileMaxPixelRatio: 1.2 },
  lightPresets: { day: { label: '白天', exposure: 1, envIntensity: 1, sun: { color: '#FFF6E8', intensity: 3, dir: [6, 6, -4] }, hemi: { sky: '#EAF3F8', ground: '#D9D2C8', intensity: .5 }, lampIntensity: .4, pointScale: .2, bloom: .3, bg: '#EAF2F7' } },
  floorPresets: { tileWhite: { label: '白砖', tex: 'tile', color: '#F2F0EC', roughness: .35, repeat: [4, 4] } },
  wallPresets: { cream: { label: '奶油白', color: '#F1ECE4', roughness: .93 } },
  materials: { ceiling: { color: '#F8F6F2', roughness: .95 }, fabricCream: { color: '#EFE9DF', roughness: .98 }, bulb: { color: '#FFF7E6', emissive: '#FFE6B8', emissiveIntensity: 1, roughness: .35, lamp: true } },
  walls: [
    { a: [0, 0], b: [6, 0], holes: [] }, { a: [6, 0], b: [6, 6], holes: [] },
    { a: [6, 6], b: [0, 6], holes: [{ at: 3, w: 1, y0: 0, y1: 2.1, type: 'door' }] }, { a: [0, 6], b: [0, 0], holes: [] }
  ],
  rooms: [{
    id: 'box', name: '兜底房', rect: [0, 0, 6, 6], floor: 'tileWhite', wall: 'cream', neighbors: [],
    items: [{ type: 'round', pos: [3, .3, 4], size: [2, .6, 1], r: .12, mat: 'fabricCream', solid: true, info: { name: '占位沙发', size: '2000×1000×600mm', material: '程序化生成', price: '—' } }]
  }],
  pointLights: [{ pos: [3, 2.4, 3], color: '#FFE9C4', distance: 8, base: 1 }]
};

/** @returns {Promise<any>} 场景配置 */
async function loadConfig() {
  try {
    const res = await fetch('./scene.config.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.warn('[config] 加载 scene.config.json 失败，启用兜底场景：', err);
    return FALLBACK_CONFIG;
  }
}

/* =============================================================
 * 3. 程序化贴图（无外部资源时的兜底；地板带 normal + roughness）
 * ============================================================= */
const TEX_SIZE = 512;                                  // 贴图边长（2 的幂，利于 mipmap）

/** 创建离屏画布 @param {number} s @returns {HTMLCanvasElement} */
function makeCanvas(s = TEX_SIZE) {
  const c = document.createElement('canvas'); c.width = c.height = s; return c;
}

/** 高度图 → 法线图（Sobel 差分） */
function heightToNormal(hCanvas, strength = 2.2) {
  const s = hCanvas.width;
  const src = hCanvas.getContext('2d').getImageData(0, 0, s, s).data;
  const out = makeCanvas(s); const ctx = out.getContext('2d');
  const img = ctx.createImageData(s, s);
  const H = (x, y) => src[((y & (s - 1)) * s + (x & (s - 1))) * 4] / 255; // 环绕采样，保证可平铺
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;   // X 方向坡度
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;   // Y 方向坡度
      const len = Math.hypot(-dx, -dy, 1);                 // 归一化
      const i = (y * s + x) * 4;
      img.data[i] = ((-dx / len) * .5 + .5) * 255;
      img.data[i + 1] = ((-dy / len) * .5 + .5) * 255;
      img.data[i + 2] = ((1 / len) * .5 + .5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); return out;
}

/** 高度图 → 粗糙度图（凹缝更粗糙） */
function heightToRough(hCanvas, base = .35, amp = .3) {
  const s = hCanvas.width;
  const src = hCanvas.getContext('2d').getImageData(0, 0, s, s).data;
  const out = makeCanvas(s); const ctx = out.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < src.length; i += 4) {
    const v = Math.min(1, base + (1 - src[i] / 255) * amp) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return out;
}

/** 各类地面/面料的绘制器：返回 { color, height } 两张画布 */
const TEX_PAINTERS = {
  /** 大板白砖：细密砖缝 */
  tile() {
    const c = makeCanvas(), h = makeCanvas(), cx = c.getContext('2d'), hx = h.getContext('2d');
    cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    hx.fillStyle = '#FFFFFF'; hx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    const n = 2, step = TEX_SIZE / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      cx.fillStyle = `rgba(0,0,0,${0.012 + Math.random() * 0.02})`;      // 每块砖轻微色差
      cx.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
    }
    cx.strokeStyle = 'rgba(120,120,120,.30)'; cx.lineWidth = 3;
    hx.strokeStyle = '#6E6E6E'; hx.lineWidth = 4;
    for (let i = 0; i <= n; i++) {
      [cx, hx].forEach(g => { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, TEX_SIZE); g.moveTo(0, i * step); g.lineTo(TEX_SIZE, i * step); g.stroke(); });
    }
    return { color: c, height: h };
  },
  /** 人字拼木：±45° 板条 */
  wood() {
    const c = makeCanvas(), h = makeCanvas(), cx = c.getContext('2d'), hx = h.getContext('2d');
    cx.fillStyle = '#D9C7AC'; cx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    hx.fillStyle = '#FFFFFF'; hx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    const pw = TEX_SIZE / 10, pl = pw * 3;
    [cx, hx].forEach((g, k) => {
      g.save(); g.translate(TEX_SIZE / 2, TEX_SIZE / 2); g.rotate(Math.PI / 4); g.translate(-TEX_SIZE, -TEX_SIZE);
      for (let r = 0; r < 12; r++) for (let i = 0; i < 12; i++) {
        const flip = (r + i) % 2 === 0;                       // 交错方向形成人字
        const w = flip ? pl : pw, hh = flip ? pw : pl;
        const x = i * pl, y = r * pl;
        if (k === 0) {
          const t = 0.82 + Math.random() * 0.18;              // 板材深浅随机
          g.fillStyle = `rgb(${217 * t | 0},${199 * t | 0},${172 * t | 0})`;
          g.fillRect(x, y, w, hh);
          g.strokeStyle = 'rgba(150,125,95,.35)'; g.lineWidth = 1;
          for (let s = 0; s < 4; s++) {                        // 木纹
            g.beginPath(); g.moveTo(x + 2, y + 3 + s * (hh / 4)); g.lineTo(x + w - 2, y + 4 + s * (hh / 4)); g.stroke();
          }
        } else {
          g.fillStyle = '#FFFFFF'; g.fillRect(x, y, w, hh);
          g.strokeStyle = '#909090'; g.lineWidth = 2; g.strokeRect(x, y, w, hh); // 板缝
        }
      }
      g.restore();
    });
    return { color: c, height: h };
  },
  /** 微水泥：低频噪点 */
  cement() {
    const c = makeCanvas(), h = makeCanvas(), cx = c.getContext('2d'), hx = h.getContext('2d');
    cx.fillStyle = '#E6E4DF'; cx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    hx.fillStyle = '#FFFFFF'; hx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    for (let i = 0; i < 4200; i++) {
      const x = Math.random() * TEX_SIZE, y = Math.random() * TEX_SIZE, r = Math.random() * 9 + 2;
      const a = Math.random() * .05;
      cx.fillStyle = `rgba(120,118,112,${a})`; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
      hx.fillStyle = `rgba(90,90,90,${a * 2})`; hx.beginPath(); hx.arc(x, y, r, 0, 7); hx.fill();
    }
    return { color: c, height: h };
  },
  /** 波点马赛克（卫生间） */
  dot() {
    const c = makeCanvas(), h = makeCanvas(), cx = c.getContext('2d'), hx = h.getContext('2d');
    cx.fillStyle = '#F5F1EB'; cx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    hx.fillStyle = '#FFFFFF'; hx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    const pal = ['#E8B7B0', '#C6D8E4', '#E9CE93', '#CFE0CE'];
    const n = 8, step = TEX_SIZE / n;
    cx.strokeStyle = 'rgba(160,155,150,.25)'; hx.strokeStyle = '#8A8A8A'; cx.lineWidth = 2; hx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      [cx, hx].forEach(g => { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, TEX_SIZE); g.moveTo(0, i * step); g.lineTo(TEX_SIZE, i * step); g.stroke(); });
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (Math.random() > .45) continue;
      cx.fillStyle = pal[(Math.random() * pal.length) | 0];
      cx.beginPath(); cx.arc(i * step + step / 2, j * step + step / 2, step * .16, 0, 7); cx.fill();
    }
    return { color: c, height: h };
  },
  /** 蓝白格纹面料 */
  plaid() {
    const c = makeCanvas(256), h = makeCanvas(256), cx = c.getContext('2d'), hx = h.getContext('2d');
    cx.fillStyle = '#F4F7F8'; cx.fillRect(0, 0, 256, 256);
    hx.fillStyle = '#FFFFFF'; hx.fillRect(0, 0, 256, 256);
    const step = 32;
    cx.fillStyle = 'rgba(126,168,192,.55)';
    for (let i = 0; i < 256; i += step * 2) { cx.fillRect(i, 0, step, 256); cx.fillRect(0, i, 256, step); }
    return { color: c, height: h };
  }
};

/** 贴图缓存：同一 kind 只生成一次 @type {Map<string,any>} */
const texCache = new Map();

/** 生成一组 PBR 贴图 @param {string} kind @param {number[]} repeat */
function getMaps(kind, repeat = [1, 1]) {
  const key = kind + '|' + repeat.join(',');
  if (texCache.has(key)) return texCache.get(key);
  const painter = TEX_PAINTERS[kind]; if (!painter) return null;
  const { color, height } = painter();
  const wrap = (t, srgb) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const maps = {
    map: wrap(new THREE.CanvasTexture(color), true),
    normalMap: wrap(new THREE.CanvasTexture(heightToNormal(height)), false),
    roughnessMap: wrap(new THREE.CanvasTexture(heightToRough(height)), false)
  };
  texCache.set(key, maps); return maps;
}

/* =============================================================
 * 4. 材质工厂（统一 MeshPhysicalMaterial，带缓存与灯具登记）
 * ============================================================= */
/** @type {Map<string,THREE.MeshPhysicalMaterial>} */
const matCache = new Map();
/** 自发光材质列表，切换灯光预设时统一调强度 @type {THREE.MeshPhysicalMaterial[]} */
const lampMaterials = [];

/** @param {any} def 材质描述 @param {string} cacheKey */
function buildMaterial(def, cacheKey) {
  if (cacheKey && matCache.has(cacheKey)) return matCache.get(cacheKey);
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(def.color || '#ffffff'),
    roughness: def.roughness ?? 0.8,
    metalness: def.metalness ?? 0.0,
    clearcoat: def.clearcoat ?? 0.0,
    clearcoatRoughness: def.clearcoatRoughness ?? 0.3,
    transparent: !!def.transparent,
    opacity: def.opacity ?? 1.0,
    side: def.transparent ? THREE.DoubleSide : THREE.FrontSide
  });
  // 透射（真实玻璃）开销较大，低端设备降级为普通半透明
  if (def.transmission && !state.lowEnd) { m.transmission = def.transmission; m.thickness = def.thickness ?? 0.02; m.ior = 1.45; }
  if (def.emissive) {
    m.emissive = new THREE.Color(def.emissive);
    m.emissiveIntensity = def.emissiveIntensity ?? 1;
    m.userData.baseEmissive = m.emissiveIntensity;
    lampMaterials.push(m);
  }
  if (def.tex) Object.assign(m, getMaps(def.tex, def.repeat || [1, 1]) || {});
  if (cacheKey) matCache.set(cacheKey, m);
  return m;
}

/** 按 config.materials 的键取材质 @param {string} key */
function mat(key) {
  const def = state.cfg.materials[key];
  if (!def) { console.warn('[material] 未定义:', key); return buildMaterial({ color: '#cccccc' }, 'fallback'); }
  return buildMaterial(def, 'M:' + key);
}

/* =============================================================
 * 5. 渲染器 / 场景 / 相机 / 光照
 * ============================================================= */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;         // 线性工作空间 → sRGB 输出
renderer.toneMapping = THREE.ACESFilmicToneMapping;       // 电影级色调映射
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;         // 柔和阴影
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 60);

const shellGroup = new THREE.Group();      // 墙 / 地 / 顶（静态壳体，进 Octree）
const ceilingGroup = new THREE.Group();    // 天花（上帝视角需隐藏）
const furnitureGroup = new THREE.Group();  // 家具（懒加载）
scene.add(shellGroup, ceilingGroup, furnitureGroup);

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8378, 0.5);
scene.add(hemi);
/** @type {THREE.PointLight[]} */
const roomLights = [];

/** 用 RoomEnvironment 生成 IBL（无 HDRI 文件时的高质量兜底） */
function setupEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 1.0;
}

/* =============================================================
 * 6. 壳体构建：地面 / 天花 / 带门窗洞的墙
 * ============================================================= */
/** 生成一个盒体网格（统一入口，便于统计 draw call） */
function boxMesh(w, h, d, material, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 依据当前 floorPreset 生成地面材质 */
function floorMaterial(presetKey) {
  const p = state.cfg.floorPresets[presetKey] || Object.values(state.cfg.floorPresets)[0];
  return buildMaterial(p, 'F:' + presetKey);
}
/** 依据当前 wallPreset 生成墙面材质 */
function wallMaterial(presetKey) {
  const p = state.cfg.wallPresets[presetKey];
  return buildMaterial(p, 'W:' + presetKey);
}

/** 构建所有房间的地面与天花 */
function buildFloorsAndCeilings() {
  const H = state.cfg.meta.wallHeight;
  for (const room of state.cfg.rooms) {
    const [x0, z0, x1, z1] = room.rect;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // 地面：0.1m 厚板，顶面对齐 y=0（Octree 需要实体而非无厚度面）
    const f = boxMesh(w, 0.1, d, floorMaterial(state.floorPreset || room.floor), cx, -0.05, cz);
    f.castShadow = false;
    f.userData = { surface: 'floor', presetOfRoom: room.floor };
    shellGroup.add(f);
    // 天花：薄板，独立分组以便上帝视角隐藏
    const c = boxMesh(w, 0.06, d, mat('ceiling'), cx, H + 0.03, cz);
    c.castShadow = false; c.userData.surface = 'ceiling';
    ceilingGroup.add(c);
  }
}

/**
 * 构建一段带洞口的墙：沿墙轴向切分为「实体段 + 洞口上下过梁」
 * @param {WallDef} wall
 */
function buildWall(wall) {
  const H = state.cfg.meta.wallHeight, T = state.cfg.meta.wallThickness;
  const ax = wall.a[0], az = wall.a[1], bx = wall.b[0], bz = wall.b[1];
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);                       // 绕 Y 轴旋转角（Z 为墙长方向）
  const ux = dx / L, uz = dz / L;                          // 单位方向向量
  const wm = wallMaterial(state.wallPreset);
  const glass = mat('glass');

  /** 在 [u0,u1] 区间、[y0,y1] 高度内放一块墙体 */
  const put = (u0, u1, y0, y1, material, thick = T) => {
    const len = u1 - u0, hgt = y1 - y0;
    if (len <= 0.001 || hgt <= 0.001) return;
    const uc = (u0 + u1) / 2;
    const m = boxMesh(thick, hgt, len, material, ax + ux * uc, (y0 + y1) / 2, az + uz * uc, angle);
    m.userData.surface = material === wm ? 'wall' : 'glass';
    shellGroup.add(m);
  };

  const holes = [...(wall.holes || [])].sort((p, q) => p.at - q.at);
  let cursor = 0;
  for (const h of holes) {
    const s = h.at - h.w / 2, e = h.at + h.w / 2;
    put(cursor, s, 0, H, wm);                              // 洞口之前的整段
    put(s, e, 0, h.y0, wm);                                // 窗下墙
    put(s, e, h.y1, H, wm);                                // 门/窗上过梁
    if (h.type === 'window') put(s, e, h.y0, h.y1, glass, 0.02); // 玻璃
    cursor = e;
  }
  put(cursor, L, 0, H, wm);                                // 收尾段
}

/** 构建整套壳体并写入八叉树 */
function buildShell() {
  buildFloorsAndCeilings();
  state.cfg.walls.forEach(buildWall);
  worldOctree.fromGraphNode(shellGroup);                   // 墙地进碰撞体
}

/* =============================================================
 * 7. 家具构建（房间级懒加载 + InstancedMesh + AABB 碰撞体）
 * ============================================================= */
const worldOctree = new Octree();
/** 家具的水平碰撞盒 @type {THREE.Box3[]} */
const solidBoxes = [];
/** 可拾取网格（含 info 的家具） @type {THREE.Object3D[]} */
const pickables = [];
/** 已构建的房间 id @type {Set<string>} */
const builtRooms = new Set();

/** 依 type 生成几何体 @param {ItemDef} def */
function makeGeometry(def) {
  const [a, b, c] = def.size;
  switch (def.geom || def.type) {
    case 'round': return new RoundedBoxGeometry(a, b, c, 3, Math.min(def.r ?? 0.06, Math.min(a, b, c) / 2 - 0.001));
    case 'cyl': return new THREE.CylinderGeometry(a, b, c, 20);
    case 'sphere': return new THREE.SphereGeometry(a / 2, 20, 14);
    case 'torus': return new THREE.TorusGeometry(a, b, 10, 32);
    default: return new THREE.BoxGeometry(a, b, c);
  }
}

/** 构建单个家具（含实例化分支） @param {ItemDef} def @param {THREE.Group} group */
function buildItem(def, group) {
  const material = mat(def.mat);
  const geo = makeGeometry(def);

  if (def.type === 'instanced' && def.instances) {
    // —— 重复家具走 InstancedMesh，一次 draw call ——
    const inst = new THREE.InstancedMesh(geo, material, def.instances.length);
    inst.castShadow = inst.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    def.instances.forEach((p, i) => {
      q.setFromEuler(new THREE.Euler(0, p[3] || 0, 0));
      inst.setMatrixAt(i, m4.compose(new THREE.Vector3(p[0], p[1], p[2]), q, s));
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    return;
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(def.pos[0], def.pos[1], def.pos[2]);
  if (def.rot) mesh.rotation.y = def.rot * Math.PI / 180;
  if (def.rotX) mesh.rotation.x = def.rotX * Math.PI / 180;
  mesh.castShadow = mesh.receiveShadow = true;
  if (def.info) { mesh.userData.info = def.info; pickables.push(mesh); }
  group.add(mesh);

  if (def.solid) {                                          // 只有大件才参与碰撞，控制开销
    mesh.updateMatrixWorld(true);
    solidBoxes.push(new THREE.Box3().setFromObject(mesh));
  }
}

/** 懒加载：构建指定房间的家具 @param {string} id */
function ensureRoom(id) {
  if (builtRooms.has(id)) return;
  const room = state.cfg.rooms.find(r => r.id === id);
  if (!room) return;
  const g = new THREE.Group(); g.name = 'room:' + id;
  room.items.forEach(def => buildItem(def, g));
  furnitureGroup.add(g);
  builtRooms.add(id);
}

/** 进入房间时预载自身 + 相邻房间 @param {string} id */
function preloadAround(id) {
  ensureRoom(id);
  const room = state.cfg.rooms.find(r => r.id === id);
  room?.neighbors.forEach(n => ensureRoom(n));
}

/** 点位于哪个房间 @returns {string} */
function roomAt(x, z) {
  for (const r of state.cfg.rooms) {
    const [x0, z0, x1, z1] = r.rect;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return r.id;
  }
  return state.currentRoom;
}

/* =============================================================
 * 8. 后处理管线（可整体降级关闭）
 * ============================================================= */
/** @type {EffectComposer|null} */ let composer = null;
/** @type {OutlinePass|null} */ let outlinePass = null;
/** @type {UnrealBloomPass|null} */ let bloomPass = null;
/** @type {any} */ let gtaoPass = null;

function buildComposer() {
  const size = renderer.getSize(new THREE.Vector2());
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));

  try {                                                     // GTAO 在部分移动 GPU 上不稳定 → 保护性降级
    gtaoPass = new GTAOPass(scene, camera, size.x, size.y);
    gtaoPass.output = GTAOPass.OUTPUT.Default;
    gtaoPass.blendIntensity = 0.75;
    gtaoPass.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.2, thickness: 0.5, scale: 1.0, samples: 12 });
    composer.addPass(gtaoPass);
  } catch (e) { console.warn('[GTAO] 不可用，跳过环境光遮蔽：', e); gtaoPass = null; }

  outlinePass = new OutlinePass(new THREE.Vector2(size.x, size.y), scene, camera);
  outlinePass.edgeStrength = 3.2; outlinePass.edgeGlow = 0.4; outlinePass.edgeThickness = 1.4;
  outlinePass.visibleEdgeColor.set('#C0392E'); outlinePass.hiddenEdgeColor.set('#8FB4CA');
  composer.addPass(outlinePass);

  // 阈值 0.9：仅灯具自发光超过该亮度，等价于「只对灯泛光」
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.6, 0.9);
  composer.addPass(bloomPass);

  composer.addPass(new SMAAPass(size.x, size.y));            // 形态学抗锯齿，比 MSAA 便宜
  composer.addPass(new OutputPass());                        // 统一做 tone mapping + 色彩空间转换
}

/* =============================================================
 * 9. 灯光预设
 * ============================================================= */
/** @param {string} name */
function applyLightPreset(name) {
  const p = state.cfg.lightPresets[name]; if (!p) return;
  state.light = name;
  renderer.toneMappingExposure = p.exposure;
  scene.environmentIntensity = p.envIntensity;
  scene.background = new THREE.Color(p.bg || '#EAF2F7');
  sun.color.set(p.sun.color); sun.intensity = p.sun.intensity;
  const c = planCenter();
  sun.position.set(c.x + p.sun.dir[0], p.sun.dir[1], c.z + p.sun.dir[2]);
  sun.target.position.set(c.x, 1, c.z);
  hemi.color.set(p.hemi.sky); hemi.groundColor.set(p.hemi.ground); hemi.intensity = p.hemi.intensity;
  roomLights.forEach(l => { l.intensity = l.userData.base * (p.pointScale ?? 0.5) * 6; });
  lampMaterials.forEach(m => { m.emissiveIntensity = (m.userData.baseEmissive ?? 1) * p.lampIntensity; });
  if (bloomPass) bloomPass.strength = p.bloom;
  [...dom.lightRow.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === name)));
}

/** 户型中心点与包围盒（用于阴影相机收紧、上帝视角、小地图） */
let planBox = { x0: 0, z0: 0, x1: 1, z1: 1 };
function computePlanBox() {
  const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  state.cfg.rooms.forEach(r => {
    b.x0 = Math.min(b.x0, r.rect[0]); b.z0 = Math.min(b.z0, r.rect[1]);
    b.x1 = Math.max(b.x1, r.rect[2]); b.z1 = Math.max(b.z1, r.rect[3]);
  });
  planBox = b;
}
function planCenter() { return { x: (planBox.x0 + planBox.x1) / 2, z: (planBox.z0 + planBox.z1) / 2 }; }

/** 阴影相机按户型包围盒收紧，最大化深度精度 */
function tightenShadowCamera() {
  const w = (planBox.x1 - planBox.x0) / 2 + 1, d = (planBox.z1 - planBox.z0) / 2 + 1;
  const r = Math.max(w, d);
  const cam = /** @type {THREE.OrthographicCamera} */ (sun.shadow.camera);
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 0.5; cam.far = r * 4 + 12;
  cam.updateProjectionMatrix();
}

/* =============================================================
 * 10. 控制：第一人称 + 碰撞 + 视角切换
 * ============================================================= */
const fpv = new PointerLockControls(camera, renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.08; orbit.enabled = false;

const capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.32);

/** 把玩家胶囊放到指定位置 */
function placePlayer(x, z) {
  const eye = state.cfg.meta.eyeHeight;
  capsule.start.set(x, capsule.radius, z);
  capsule.end.set(x, eye, z);
  state.velocity.set(0, 0, 0);
  camera.position.copy(capsule.end);
}

/** 与墙体（Octree）求解碰撞 */
function wallCollisions() {
  const hit = worldOctree.capsuleIntersect(capsule);
  state.onFloor = false;
  if (!hit) return;
  state.onFloor = hit.normal.y > 0;
  if (!state.onFloor) {
    // 只消除法线方向的速度分量，保留沿墙滑动
    state.velocity.addScaledVector(hit.normal, -hit.normal.dot(state.velocity));
  }
  if (hit.depth >= 1e-5) capsule.translate(hit.normal.clone().multiplyScalar(hit.depth));
}

/** 与家具（AABB）求解水平碰撞，低矮物体（≤台阶高）允许跨过 */
function furnitureCollisions() {
  const r = capsule.radius, p = capsule.start;
  for (const box of solidBoxes) {
    if (box.max.y <= STEP_HEIGHT) continue;                 // 地毯/矮台阶不阻挡
    if (p.y > box.max.y + 0.05) continue;                   // 已站在其上
    const minX = box.min.x - r, maxX = box.max.x + r;
    const minZ = box.min.z - r, maxZ = box.max.z + r;
    if (p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ) continue;
    // 取 X / Z 四个方向中最小的推出距离
    const dxl = p.x - minX, dxr = maxX - p.x, dzl = p.z - minZ, dzr = maxZ - p.z;
    const m = Math.min(dxl, dxr, dzl, dzr);
    const d = new THREE.Vector3(
      m === dxl ? -dxl : m === dxr ? dxr : 0, 0,
      m === dzl ? -dzl : m === dzr ? dzr : 0
    );
    capsule.translate(d);
  }
}

/** 每帧更新玩家运动 @param {number} dt */
function updatePlayer(dt) {
  if (state.mode !== 'fpv') return;
  const speed = (state.keys['ShiftLeft'] || state.keys['ShiftRight'] || state.joy.run) ? 9 : 4.2;
  const damping = Math.exp(-9 * dt) - 1;                    // 指数阻尼，帧率无关

  // 相机前向 / 右向（投影到水平面）
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();

  const wish = new THREE.Vector3();
  if (state.keys['KeyW'] || state.keys['ArrowUp']) wish.add(fwd);
  if (state.keys['KeyS'] || state.keys['ArrowDown']) wish.sub(fwd);
  if (state.keys['KeyD'] || state.keys['ArrowRight']) wish.add(right);
  if (state.keys['KeyA'] || state.keys['ArrowLeft']) wish.sub(right);
  if (state.joy.x || state.joy.y) {                          // 移动端摇杆
    wish.addScaledVector(fwd, -state.joy.y).addScaledVector(right, state.joy.x);
  }
  if (wish.lengthSq() > 0) state.velocity.addScaledVector(wish.normalize(), speed * dt * 12);

  state.velocity.addScaledVector(state.velocity, damping);
  if (!state.onFloor) state.velocity.y -= GRAVITY * dt;

  capsule.translate(state.velocity.clone().multiplyScalar(dt));
  wallCollisions();
  furnitureCollisions();

  // 相机高度锁定在 1.6m（站立视高）
  camera.position.set(capsule.end.x, capsule.start.y - capsule.radius + state.cfg.meta.eyeHeight, capsule.end.z);

  const rid = roomAt(camera.position.x, camera.position.z);
  if (rid !== state.currentRoom) {
    state.currentRoom = rid;
    dom.roomName.textContent = state.cfg.rooms.find(r => r.id === rid)?.name || '—';
    preloadAround(rid);
  }
}

/** 视角模式切换 @param {'fpv'|'god'|'orbit'} m */
function setMode(m) {
  state.mode = m;
  const label = { fpv: '漫游', god: '俯瞰', orbit: '单品' }[m];
  dom.modeTag.textContent = label;
  ceilingGroup.visible = (m === 'fpv');                      // 俯瞰/单品时掀掉屋顶
  dom.cross.style.display = (m === 'fpv' && fpv.isLocked) ? 'block' : 'none';

  if (m === 'fpv') {
    orbit.enabled = false;
    placePlayer(camera.position.x, camera.position.z);
    if (!IS_TOUCH) fpv.lock();
  } else {
    if (fpv.isLocked) fpv.unlock();
    orbit.enabled = true;
    const c = planCenter();
    if (m === 'god') {
      orbit.target.set(c.x, 0, c.z);
      camera.position.set(c.x, 13, c.z + 7);
      orbit.minDistance = 5; orbit.maxDistance = 30;
    } else {                                                 // orbit：环绕选中单品
      const obj = state.selected;
      if (!obj) return setMode('god');
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(0.8, box.getSize(new THREE.Vector3()).length());
      orbit.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(radius, radius * 0.6, radius));
      orbit.minDistance = radius * 0.5; orbit.maxDistance = radius * 4;
    }
    orbit.update();
  }
}

/* =============================================================
 * 11. 拾取与信息卡
 * ============================================================= */
const raycaster = new THREE.Raycaster();

/** @param {number} nx 归一化设备坐标 @param {number} ny */
function pick(nx, ny) {
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hits = raycaster.intersectObjects(pickables, false);
  select(hits.length ? hits[0].object : null);
}

/** @param {THREE.Object3D|null} obj */
function select(obj) {
  state.selected = obj;
  if (outlinePass) outlinePass.selectedObjects = obj ? [obj] : [];
  if (!obj) { dom.card.style.display = 'none'; return; }
  const info = obj.userData.info;
  dom.cName.textContent = info.name;
  dom.cSize.textContent = info.size;
  dom.cMat.textContent = info.material;
  dom.cPrice.textContent = info.price;
  dom.card.style.display = 'block';
}

/* =============================================================
 * 12. UI：材质面板、灯光、小地图、瞬移、触控
 * ============================================================= */
function buildUI() {
  // —— 地面材质下拉（空值 = 保留各房间原始铺装）——
  dom.floorSel.appendChild(new Option('按原始设计', ''));
  Object.entries(state.cfg.floorPresets).forEach(([k, v]) => {
    dom.floorSel.appendChild(new Option(v.label, k));
  });
  dom.floorSel.value = state.floorPreset;
  dom.floorSel.onchange = () => {
    state.floorPreset = dom.floorSel.value;
    shellGroup.traverse(o => {
      if (o.userData.surface !== 'floor') return;
      o.material = floorMaterial(state.floorPreset || o.userData.presetOfRoom);
    });
  };

  // —— 墙面色下拉 ——
  Object.entries(state.cfg.wallPresets).forEach(([k, v]) => {
    dom.wallSel.appendChild(new Option(v.label, k));
  });
  dom.wallSel.value = state.wallPreset;
  dom.wallSel.onchange = () => {
    state.wallPreset = dom.wallSel.value;
    const m = wallMaterial(state.wallPreset);
    shellGroup.traverse(o => { if (o.userData.surface === 'wall') o.material = m; });
  };

  // —— 灯光预设按钮 ——
  Object.entries(state.cfg.lightPresets).forEach(([k, v]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = v.label; b.dataset.key = k;
    b.onclick = () => applyLightPreset(k);
    dom.lightRow.appendChild(b);
  });

  // —— 画质开关 ——
  dom.ppBtn.onclick = () => {
    state.usePost = !state.usePost;
    dom.ppBtn.setAttribute('aria-pressed', String(state.usePost));
  };
  dom.shadowBtn.onclick = () => {
    state.useShadow = !state.useShadow;
    renderer.shadowMap.enabled = state.useShadow;
    scene.traverse(o => { if (o.isMesh) o.material.needsUpdate = true; });
    dom.shadowBtn.setAttribute('aria-pressed', String(state.useShadow));
  };

  // —— 面板收起 ——
  dom.ctrlToggle.onclick = () => {
    dom.ctrlBody.classList.toggle('hidden');
    dom.ctrlToggle.textContent = dom.ctrlBody.classList.contains('hidden') ? '▸' : '▾';
  };

  // —— 房间瞬移按钮 ——
  state.cfg.rooms.forEach(r => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = r.name;
    b.onclick = () => {
      const cx = (r.rect[0] + r.rect[2]) / 2, cz = (r.rect[1] + r.rect[3]) / 2;
      preloadAround(r.id);
      state.currentRoom = r.id; dom.roomName.textContent = r.name;
      if (state.mode !== 'fpv') setMode('fpv');
      placePlayer(cx, cz);
    };
    dom.roomBtns.appendChild(b);
  });

  $('#card .close').addEventListener('click', () => select(null));
}

/** 小地图：户型 + 当前房间高亮 + 朝向指针 */
function drawMinimap() {
  const cv = dom.minimap, g = cv.getContext('2d');
  const pad = 8;
  const sx = (cv.width - pad * 2) / (planBox.x1 - planBox.x0);
  const sz = (cv.height - pad * 2) / (planBox.z1 - planBox.z0);
  const s = Math.min(sx, sz);
  const ox = pad, oz = pad;
  const X = (x) => ox + (x - planBox.x0) * s;
  const Z = (z) => oz + (z - planBox.z0) * s;

  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, cv.width, cv.height);
  state.cfg.rooms.forEach(r => {
    const cur = r.id === state.currentRoom;
    g.fillStyle = cur ? '#8FB4CA' : '#EDF2F5';
    g.strokeStyle = '#C6D3DB'; g.lineWidth = 1;
    const x = X(r.rect[0]), z = Z(r.rect[1]);
    g.fillRect(x, z, (r.rect[2] - r.rect[0]) * s, (r.rect[3] - r.rect[1]) * s);
    g.strokeRect(x, z, (r.rect[2] - r.rect[0]) * s, (r.rect[3] - r.rect[1]) * s);
  });

  // 玩家位置与朝向
  const px = X(camera.position.x), pz = Z(camera.position.z);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  g.fillStyle = '#C0392E';
  g.beginPath(); g.arc(px, pz, 3.4, 0, 7); g.fill();
  g.strokeStyle = '#C0392E'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(px, pz); g.lineTo(px + dir.x * 12, pz + dir.z * 12); g.stroke();
}

/** 移动端：左摇杆 + 右侧拖拽转向 */
function setupTouch() {
  document.body.classList.add('mobile');
  dom.hint.style.display = 'none';

  const R = 46;                                              // 摇杆最大位移
  let stickId = -1, look = { id: -1, x: 0, y: 0 };
  const rect = () => dom.stick.getBoundingClientRect();

  dom.stick.addEventListener('pointerdown', e => { stickId = e.pointerId; dom.stick.setPointerCapture(e.pointerId); moveStick(e); });
  dom.stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) moveStick(e); });
  const endStick = e => {
    if (e.pointerId !== stickId) return;
    stickId = -1; state.joy.x = state.joy.y = 0;
    dom.stickDot.style.transform = 'translate(0,0)';
  };
  dom.stick.addEventListener('pointerup', endStick);
  dom.stick.addEventListener('pointercancel', endStick);

  function moveStick(e) {
    const r = rect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    dom.stickDot.style.transform = `translate(${dx}px,${dy}px)`;
    state.joy.x = dx / R; state.joy.y = dy / R;
  }

  dom.runBtn.addEventListener('pointerdown', () => { state.joy.run = true; });
  dom.runBtn.addEventListener('pointerup', () => { state.joy.run = false; });

  // 右半屏拖拽 = 转向；轻触 = 拾取
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.clientX < innerWidth * 0.4) return;
    look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (e.pointerId !== look.id || state.mode !== 'fpv') return;
    const dx = e.clientX - look.x, dy = e.clientY - look.y;
    look.x = e.clientX; look.y = e.clientY; look.moved += Math.abs(dx) + Math.abs(dy);
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= dx * 0.004; euler.x -= dy * 0.004;
    euler.x = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, euler.x));
    camera.quaternion.setFromEuler(euler);
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (e.pointerId === look.id) {
      if (look.moved < 8) pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      look.id = -1;
    }
  });

  // 双指下滑 → 切换视角
  let lastTap = 0;
  renderer.domElement.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const now = performance.now();
      if (now - lastTap > 600) { cycleMode(); lastTap = now; }
    }
  }, { passive: true });
}

function cycleMode() {
  setMode(state.mode === 'fpv' ? 'god' : state.mode === 'god' ? (state.selected ? 'orbit' : 'fpv') : 'fpv');
}

/** 桌面端键鼠事件 */
function setupDesktop() {
  addEventListener('keydown', e => {
    if (e.code === 'Tab') { e.preventDefault(); cycleMode(); return; }
    state.keys[e.code] = true;
  });
  addEventListener('keyup', e => { state.keys[e.code] = false; });

  dom.hint.addEventListener('click', () => fpv.lock());
  fpv.addEventListener('lock', () => {
    dom.hint.style.display = 'none';
    if (state.mode === 'fpv') dom.cross.style.display = 'block';
  });
  fpv.addEventListener('unlock', () => {
    dom.cross.style.display = 'none';
    if (state.mode === 'fpv') dom.hint.style.display = 'block';
  });

  renderer.domElement.addEventListener('click', e => {
    if (state.mode === 'fpv') {
      if (fpv.isLocked) pick(0, 0);                          // 锁定时用屏幕中心准星拾取
      else fpv.lock();
    } else {
      pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    }
  });
}

/* =============================================================
 * 13. 自适应与主循环
 * ============================================================= */
function onResize() {
  const w = innerWidth, h = innerHeight;
  const cap = IS_TOUCH ? state.cfg.quality.mobileMaxPixelRatio : state.cfg.quality.maxPixelRatio;
  renderer.setPixelRatio(Math.min(devicePixelRatio, state.lowEnd ? 1 : cap));
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  composer?.setSize(w, h);
}

const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);               // 夹紧，避免切后台后瞬移

  updatePlayer(dt);
  if (state.mode !== 'fpv') orbit.update();

  // —— 首帧性能探测：超预算则整体降级 ——
  if (!state.probe.done) {
    state.probe.frames++; state.probe.sum += dt * 1000;
    if (state.probe.frames >= state.cfg.quality.probeFrames) {
      const avg = state.probe.sum / state.probe.frames;
      state.probe.done = true;
      if (avg > state.cfg.quality.frameBudgetMs) downgrade(avg);
    }
  }

  if (state.usePost && composer) composer.render();
  else renderer.render(scene, camera);

  drawMinimap();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    dom.fps.textContent = Math.round(fpsFrames / fpsAcc) + ' fps';
    fpsAcc = 0; fpsFrames = 0;
  }
}

/** 低端设备自动降级 */
function downgrade(avg) {
  console.info(`[quality] 平均帧耗时 ${avg.toFixed(1)}ms，自动降级`);
  state.lowEnd = true;
  state.usePost = false; dom.ppBtn.setAttribute('aria-pressed', 'false');
  renderer.shadowMap.enabled = false; state.useShadow = false;
  dom.shadowBtn.setAttribute('aria-pressed', 'false');
  sun.castShadow = false;
  renderer.setPixelRatio(1);
}

/* =============================================================
 * 14. 启动
 * ============================================================= */
async function boot() {
  state.cfg = await loadConfig();
  document.title = state.cfg.meta.title;
  state.floorPreset = ''; // 空 = 各房间使用自己的铺装

  onResize();
  setupEnvironment();
  computePlanBox();
  tightenShadowCamera();

  buildShell();

  // 房间点光（不投影，仅补光），数量受控以保护性能
  (state.cfg.pointLights || []).forEach(d => {
    const l = new THREE.PointLight(new THREE.Color(d.color), 1, d.distance, 2);
    l.position.set(d.pos[0], d.pos[1], d.pos[2]);
    l.userData.base = d.base; l.castShadow = false;
    roomLights.push(l); scene.add(l);
  });

  buildComposer();
  buildUI();

  const sp = state.cfg.meta.spawn;
  placePlayer(sp.pos[0], sp.pos[2]);
  camera.rotation.set(0, (sp.yaw || 0) * Math.PI / 180, 0);
  state.currentRoom = roomAt(sp.pos[0], sp.pos[2]);
  dom.roomName.textContent = state.cfg.rooms.find(r => r.id === state.currentRoom)?.name || '';
  preloadAround(state.currentRoom);

  applyLightPreset('day');
  IS_TOUCH ? setupTouch() : setupDesktop();
  addEventListener('resize', onResize);

  dom.loader.style.opacity = '0';
  setTimeout(() => dom.loader.remove(), 500);
  animate();
}

boot().catch(err => {
  console.error(err);
  dom.loader.innerHTML = '<h1>加载失败</h1><p>请用本地服务器打开（见 README），并检查控制台。</p>';
});
