import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VARIANTS, PARTS, variantById, pickRandomVariant } from './parts.js';
import { Plush, ensureGeometries, loadGeometry, isBuilt } from './plush.js';
import { Terminal } from './terminal.js';
import { makeSticker, composeSheet } from './stickers.js';
import * as sfx from './sound.js';

const $ = (s) => document.querySelector(s);

/* ---------- 保存（ブラウザ内だけ。使えなくても動く） ---------- */
const KEY = 'clawd-plushies:';
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(KEY + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(KEY + k, JSON.stringify(v));
    } catch {
      /* 保存できない環境では何もしない */
    }
  },
};
const owned = new Set(store.get('owned', ['plain']).filter((id) => variantById(id)));
owned.add('plain');
const saveOwned = () => store.set('owned', [...owned]);

/* ---------- 画質 ---------- */
const coarse = matchMedia('(pointer: coarse)').matches;
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let shellScale = coarse ? 0.6 : 1;

/* ---------- レンダラとシーン ---------- */
const canvas = $('#scene');
const term = new Terminal({
  out: $('#out'),
  form: $('#form'),
  input: $('#cmd'),
  chips: [...document.querySelectorAll('[data-cmd]')],
  onCommand: (c) => handleCommand(c),
});

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  term.line('WebGL が使えないため、ぬいぐるみを表示できませんでした。', 'err');
  throw err;
}
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const BG = new THREE.Color('#EFEAE3');
const scene = new THREE.Scene();
scene.background = BG;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const key = new THREE.DirectionalLight(0xfff0e0, 2.2);
key.position.set(-3.2, 6.5, 4.6);
key.target.position.set(0, 1, 0);
key.castShadow = true;
key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -3.2, right: 3.2, top: 3.4, bottom: -2.4, near: 1, far: 20 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffe2cf, 1.0);
rim.position.set(3.5, 3.2, -5);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xfff8f0, 0xcbbcae, 0.35));

const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ color: 0x5b3a26, opacity: 0.2 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const blob = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: 0x4a2c1c, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  m.renderOrder = 2;
  scene.add(m);
  return m;
})();

/* ---------- カメラと配置 ---------- */
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
const FRAME = { y: 1.32, r: 1.72 };
let camEl = 0.16;
let camDist = 10;

function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const top = 60;
  const bottom = Math.max(0, h - $('#term').getBoundingClientRect().top) + 6;
  const avail = Math.max(180, h - top - bottom);
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfV = Math.atan((t * avail) / h);
  const halfH = Math.atan((t * w) / h);
  camDist = FRAME.r / Math.sin(Math.min(halfV, halfH));
  camera.setViewOffset(w, h, 0, (bottom - top) / 2, w, h);
  camera.updateProjectionMatrix();
}
const dbg = new URLSearchParams(location.search).has('debug') ? { zoom: 1, look: null } : null;
function placeCamera() {
  const d = camDist / (dbg?.zoom || 1);
  const ty = dbg?.look ? dbg.look[1] : FRAME.y;
  const tx = dbg?.look ? dbg.look[0] : 0;
  camera.position.set(tx, ty + Math.sin(camEl) * d, Math.cos(camEl) * d);
  camera.lookAt(tx, ty, 0);
}
window.addEventListener('resize', layout);

/* ---------- ぬいぐるみの出し入れ ---------- */
let current = null;
const plushes = [];
const hooks = {
  onLand: (impact) => sfx.land(impact),
  onLeave: () => sfx.whoosh(),
};

async function deliver(variant) {
  await ensureGeometries(variant);
  if (current) current.leave();
  const p = new Plush(variant, { shellScale });
  p.drop(current ? 8 : 6);
  scene.add(p.outer);
  plushes.push(p);
  current = p;
  store.set('last', variant.id);
}

/* ---------- 操作 ---------- */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(cx, cy) {
  if (!current || current.leaving) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  current.outer.updateMatrixWorld(true);
  return raycaster.intersectObjects(current.pickables, false)[0] || null;
}

const pointers = new Map();
let lastTap = { t: 0, x: 0, y: 0 };
let hintShown = true;
function hideHint() {
  if (!hintShown) return;
  hintShown = false;
  $('#hint').classList.add('gone');
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  canvas.setPointerCapture(e.pointerId);
  const hit = pick(e.clientX, e.clientY);
  const st = { x: e.clientX, y: e.clientY, t0: performance.now(), lastT: performance.now(), moved: 0, plush: current, dent: null, mode: 'rotate' };
  if (hit) {
    const { p, d } = current.toLocal(hit.point, raycaster.ray.direction);
    st.mode = 'squish';
    st.dent = current.pressStart(p, d);
    sfx.squish(0.9);
    hideHint();
    canvas.style.cursor = 'grabbing';
  } else if (current) {
    current.dragging = true;
    current.yawVel = 0;
  }
  pointers.set(e.pointerId, st);
});

let hoverQueued = false;
canvas.addEventListener('pointermove', (e) => {
  const st = pointers.get(e.pointerId);
  if (!st) {
    if (e.pointerType === 'mouse' && !hoverQueued) {
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        canvas.style.cursor = pick(e.clientX, e.clientY) ? 'grab' : 'default';
      });
    }
    return;
  }
  const dx = e.clientX - st.x, dy = e.clientY - st.y;
  st.x = e.clientX;
  st.y = e.clientY;
  st.moved += Math.abs(dx) + Math.abs(dy);
  const now = performance.now();
  const dt = Math.max(8, now - st.lastT) / 1000;
  st.lastT = now;
  if (st.mode === 'squish') {
    if (st.plush !== current || !st.dent?.held) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit) {
      const { p, d } = current.toLocal(hit.point, raycaster.ray.direction);
      current.pressMove(st.dent, p, d);
    }
  } else if (current) {
    current.yaw += dx * 0.011;
    current.yawVel = current.yawVel * 0.5 + ((dx * 0.011) / dt) * 0.5;
    camEl = THREE.MathUtils.clamp(camEl + dy * 0.003, -0.02, 0.6);
  }
});

function endPointer(e) {
  const st = pointers.get(e.pointerId);
  if (!st) return;
  pointers.delete(e.pointerId);
  const now = performance.now();
  if (st.mode === 'squish') {
    if (st.dent) st.plush.pressEnd(st.dent);
    canvas.style.cursor = 'grab';
    if (now - st.t0 < 280 && st.moved < 14) {
      if (now - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap.t = 0;
        if (st.plush === current && current.toss()) sfx.squish(0.6);
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    } else if (now - st.t0 > 400) {
      sfx.squish(0.45);
    }
  } else if (st.plush) {
    st.plush.dragging = [...pointers.values()].some((p) => p.mode === 'rotate' && p.plush === st.plush);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

/* ---------- コマンド ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(4 - n);

function handleCommand(raw) {
  sfx.unlock();
  const c = raw.trim().replace(/^[/／]/, '').toLowerCase();
  if (['plushies', 'plushie', 'plush', 'ぬいぐるみ'].includes(c)) return cmdPlushies();
  if (['stickers', 'sticker', 'ステッカー'].includes(c)) return cmdStickers();
  if (['collection', 'col', '図鑑', 'ずかん'].includes(c)) return cmdCollection();
  if (['help', '?', 'へるぷ'].includes(c)) return cmdHelp();
  if (c === 'clear') return term.clear();
  term.line(`「${raw}」は知らないコマンドです。/help で一覧を出せます。`, 'dim');
}

async function cmdPlushies() {
  if (busy) return term.line('いま梱包中です。少し待ってね。', 'dim');
  busy = true;
  const v = (dbg?.next && variantById(dbg.next)) || pickRandomVariant(current?.variant.id);
  const sp = term.spinner(['綿をつめています', 'ちくちく縫っています', 'ふかふかにしています', 'タグをつけています', '箱に入れています']);
  await Promise.all([ensureGeometries(v), sleep(1000)]);
  sp.stop();
  const isNew = !owned.has(v.id);
  owned.add(v.id);
  saveOwned();
  await deliver(v);
  setTimeout(() => sfx.chime(v.rarity), 380);
  term.line(`✓ ${v.name} が届きました  ${stars(v.rarity)}${isNew ? '  NEW!' : ''}`, 'ok');
  term.line(`  ${v.note}  （コレクション ${owned.size}/${VARIANTS.length}）`, 'dim');
  busy = false;
}

function cmdCollection() {
  term.line(`コレクション ${owned.size}/${VARIANTS.length}（名前をクリックすると呼び出せます）`);
  for (const v of VARIANTS) {
    if (owned.has(v.id)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'linkish';
      b.textContent = `▸ ${v.name}  ${stars(v.rarity)}`;
      b.addEventListener('click', async () => {
        if (busy || current?.variant.id === v.id) return;
        busy = true;
        await deliver(v);
        busy = false;
        term.line(`${v.name} を呼び出しました。`, 'dim');
      });
      term.line(b);
    } else {
      term.line(`  ？？？  ${stars(v.rarity)}`, 'dim');
    }
  }
}

function cmdHelp() {
  [
    '/plushies    ランダムなぬいぐるみが届きます',
    '/stickers    集めたぬいぐるみのステッカーシートを作ります',
    '/collection  集めたぬいぐるみの一覧（呼び出しもできます）',
    '/clear       画面をきれいにします',
    'さわりかた：押す＝むにっ ／ 押したまま動かす＝なでる',
    '　　　　　　背景をドラッグ＝回す ／ ダブルタップ＝ジャンプ',
  ].forEach((t) => term.line(t, 'dim'));
}

/* ---------- ステッカー ---------- */
function renderStickerPair(variant) {
  const gl = renderer.domElement;
  const size = Math.min(gl.width, gl.height, 1000);
  const css = size / renderer.getPixelRatio();
  const p = new Plush(variant, { shellScale: 1 });
  p.yaw = -0.42;
  p.writeUniforms();
  const hidden = [floor, blob, ...plushes.map((q) => q.outer)];
  hidden.forEach((o) => (o.visible = false));
  scene.add(p.outer);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  const d = 2.0 / Math.sin(THREE.MathUtils.degToRad(12));
  cam.position.set(Math.sin(0.12) * d, 1.3 + Math.sin(0.2) * d, Math.cos(0.12) * d);
  cam.lookAt(0, 1.32, 0);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, css, css);
  renderer.setScissor(0, 0, css, css);
  const out = [];
  for (const bg of ['#ffffff', '#000000']) {
    scene.background = new THREE.Color(bg);
    renderer.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(gl, 0, gl.height - size, size, size, 0, 0, size, size);
    out.push(c);
  }
  scene.background = BG;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  hidden.forEach((o) => (o.visible = true));
  p.dispose();
  draw(); // 撮影用の絵が画面に残らないよう、すぐ通常の画面を描き直す
  return out;
}

let sheetUrl = null;
async function cmdStickers() {
  if (busy) return term.line('いま作業中です。少し待ってね。', 'dim');
  busy = true;
  const list = VARIANTS.filter((v) => owned.has(v.id));
  const sp = term.spinner(['ステッカーを刷っています', 'ふちを白く切っています', '台紙に並べています']);
  await sleep(150);
  const stickers = [];
  await Promise.all(list.map(ensureGeometries));
  for (const v of list) {
    const [white, black] = renderStickerPair(v);
    stickers.push({ canvas: makeSticker(white, black), name: v.name });
    await sleep(16);
  }
  const sheet = composeSheet(stickers);
  const blobFile = await new Promise((r) => sheet.toBlob(r, 'image/png'));
  sp.stop();
  busy = false;
  if (!blobFile) return term.line('ステッカーを作れませんでした。', 'err');
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = URL.createObjectURL(blobFile);
  term.line(`✓ ステッカーパック（${list.length} 枚）を刷りました`, 'ok');
  if (list.length < VARIANTS.length) term.line('  /plushies で集めるほど増えます。', 'dim');
  $('#sheet').src = sheetUrl;
  $('#save').href = sheetUrl;
  $('#stickerDlg').showModal();
}
$('#closeDlg').addEventListener('click', () => $('#stickerDlg').close());
$('#stickerDlg').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

/* ---------- 音のオンオフ ---------- */
const soundBtn = $('#sound');
function syncSound() {
  soundBtn.setAttribute('aria-pressed', String(!sfx.isMuted()));
  soundBtn.title = sfx.isMuted() ? '音を出す' : '音を消す';
}
sfx.setMuted(store.get('muted', false));
syncSound();
soundBtn.addEventListener('click', () => {
  sfx.setMuted(!sfx.isMuted());
  store.set('muted', sfx.isMuted());
  syncSound();
  sfx.unlock();
});

/* ---------- ループ ---------- */
let last = performance.now();
let frameAvg = 16;
let qTimer = 0;
function degrade() {
  if (dpr > 1.25) {
    dpr = Math.max(1, dpr - 0.25);
    renderer.setPixelRatio(dpr);
    layout();
  } else if (shellScale > 0.4) {
    shellScale = Math.max(0.4, shellScale - 0.15);
    plushes.forEach((p) => p.setShellScale(shellScale));
  }
}

function simulate(dt) {
  for (const p of plushes) p.update(dt, hooks);
  for (let i = plushes.length - 1; i >= 0; i--) {
    if (plushes[i].gone) {
      plushes[i].dispose();
      plushes.splice(i, 1);
    }
  }
  if (current) {
    const h = Math.max(0, current.pos.y);
    const k = 1 / (1 + h * 0.6);
    blob.position.x = current.pos.x;
    blob.position.z = current.pos.z;
    blob.rotation.z = current.yaw;
    blob.scale.set((2.85 * (0.7 + 0.3 * k)) / Math.sqrt(current.s), 1.55 * (0.7 + 0.3 * k), 1);
    blob.material.opacity = 0.3 * k;
  }
}

function draw() {
  placeCamera();
  renderer.render(scene, camera);
}

function loop(now) {
  requestAnimationFrame(loop);
  const ms = now - last;
  last = now;
  const dt = Math.min(1 / 30, ms / 1000);

  if (!document.hidden && ms < 120) {
    frameAvg += (ms - frameAvg) * 0.05;
    qTimer += dt;
    if (qTimer > 3) {
      qTimer = 0;
      if (frameAvg > 26) degrade();
    }
  }
  simulate(dt);
  draw();
}

/* ---------- 起動 ---------- */
async function prebuildAll() {
  for (const k of Object.keys(PARTS)) if (!isBuilt(k)) await loadGeometry(k);
}

async function start() {
  term.line('Clawd plushies へようこそ（非公式のファンメイドです）');
  const sp = term.spinner(['綿をつめています']);
  layout();
  const first = variantById(store.get('last', 'plain')) || VARIANTS[0];
  owned.add(first.id);
  await ensureGeometries(first);
  sp.stop();
  term.line('/plushies と打つと、ランダムなぬいぐるみが届きます。', 'dim');
  await deliver(first);
  renderer.compile(scene, camera);
  requestAnimationFrame((t) => {
    last = t;
    loop(t);
  });
  setTimeout(prebuildAll, 1500);
}

start();

if (dbg) {
  Object.assign(dbg, { renderer, scene, camera, plushes, deliver: (id) => deliver(variantById(id)), setEl: (v) => (camEl = v),
    ownAll: () => { VARIANTS.forEach((v) => owned.add(v.id)); saveOwned(); },
    ready: () => Promise.all(VARIANTS.map(ensureGeometries)),
    step: (n = 60) => {
      for (let i = 0; i < n; i++) simulate(1 / 60);
      draw();
    },
  });
  Object.defineProperty(dbg, 'current', { get: () => current });
  window.__dbg = dbg;
}
