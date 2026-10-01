// ぬいぐるみ本体と着せ替え小物の形（距離関数）と、布の設定。
// 座標はぬいぐるみの足元が y=0、正面が +z。本体の幅は 2.0。
import {
  smin, smax, pillow, clamp, smoothstep, box2, roundRect2, extrude, capsule, star5, frame,
} from './sdf.js';

export const BODY = { cy: 1.095, a: 1.0, b: 0.725, c: 0.6, e: 5.0, m: 3.4 };
export const TOP_Y = BODY.cy + BODY.b;
// 刺繍の目（ドット絵の「^」）。中心と 1 ドットの大きさ
export const EYE = { x: 0.47, y: 1.235, px: 0.1 };

const ARM = { x: 1.05, y: 0.97, a: 0.29, b: 0.3, c: 0.36, e: 3.4, m: 3.0 };
const LEG_X = [0.25, 0.69];
const LEG = { y: 0.29, a: 0.15, b: 0.29, c: 0.25, e: 2.6, m: 2.6 };

export function bodyCore(x, y, z) {
  return pillow(x, y - BODY.cy, z, BODY.a, BODY.b, BODY.c, BODY.e, BODY.m);
}

export function clawd(x, y, z) {
  let d = bodyCore(x, y, z);
  const ax = Math.abs(x);
  if (ax > 0.5 && y > 0.45 && y < 1.5) {
    d = smin(d, pillow(ax - ARM.x, y - ARM.y, z, ARM.a, ARM.b, ARM.c, ARM.e, ARM.m), 0.1);
  }
  if (y < 0.8) {
    const lx = ax < 0.47 ? ax - LEG_X[0] : ax - LEG_X[1];
    d = smin(d, pillow(lx, y - LEG.y, z, LEG.a, LEG.b, LEG.c, LEG.e, LEG.m), 0.07);
  }
  return d;
}

// 正面（+z 側）の表面の z。顔に貼りつく小物を曲面に沿わせるのに使う。
export function frontZ(x, y) {
  const X = Math.abs(x) / BODY.a, Y = Math.abs(y - BODY.cy) / BODY.b;
  const S = Math.pow(X, BODY.e) + Math.pow(Y, BODY.e);
  if (S >= 1) return 0;
  return BODY.c * Math.pow(1 - Math.pow(S, BODY.m / BODY.e), 1 / BODY.m);
}

// 距離関数を勾配の大きさで割って、どの向きでも「実際の距離」に近づける。
// 本体から一定の厚みで浮かせる小物（帽子・ベルト・服）がまんべんなく沿うようになる。
function normalized(f) {
  const h = 0.004;
  return (x, y, z) => {
    const d = f(x, y, z);
    if (Math.abs(d) > 0.5) return d;
    const gx = f(x + h, y, z) - f(x - h, y, z);
    const gy = f(x, y + h, z) - f(x, y - h, z);
    const gz = f(x, y, z + h) - f(x, y, z - h);
    return d / Math.max(Math.sqrt(gx * gx + gy * gy + gz * gz) / (2 * h), 1e-3);
  };
}
const bodyDist = normalized(bodyCore);
const clawdDist = normalized(clawd);

const sq = (v) => v * v;
const TAU = Math.PI * 2;

/* ---------- カウボーイハット ---------- */
const COWBOY = frame([0.08, 1.8, -0.02], [-0.07, 0.15, -0.12]);
function cowboyHat(x, y, z) {
  const [hx, hy, hz] = COWBOY.apply(x, y, z);
  const t = clamp(hy / 0.6, 0, 1);
  const rx = 0.6 * (1 - 0.1 * t), rz = 0.5 * (1 - 0.1 * t);
  let crown = (Math.sqrt(sq(hx / rx) + sq(hz / rz)) - 1) * rz;
  const crease = 0.12 * Math.exp(-sq(hx / 0.17)) + 0.05 * Math.exp(-sq((hz - 0.4) / 0.16));
  crown = smax(crown, hy - (0.6 - crease), 0.1);
  crown = smax(crown, 0.02 - hy, 0.02);
  const er = Math.sqrt(sq(hx / 1.28) + sq(hz / 1.06));
  const curl = 0.3 * Math.pow(Math.min(Math.abs(hx) / 1.28, 1.15), 2.6) - 0.06 * sq(hz / 1.06);
  const brim = smax((er - 1) * 1.06, Math.abs(hy - curl) - 0.045, 0.035);
  return smin(crown, brim, 0.06);
}

/* ---------- まほうつかいの帽子とステッキ ---------- */
const WIZ = frame([-0.04, 1.9, 0.0], [0.05, 0.0, 0.05]);
const WIZ_H = 1.1;
function wizCone(x, y, z) {
  const [hx, hy, hz] = WIZ.apply(x, y, z);
  const t = clamp(hy / WIZ_H, 0, 1);
  const bend = 0.42 * Math.pow(t, 2.4);
  const r = 0.64 * Math.pow(1 - t, 1.05) + 0.035;
  let d = (Math.sqrt(sq(hx - bend) + hz * hz) - r) * 0.85;
  d = smax(d, 0.04 - hy, 0.03);
  d = smax(d, hy - WIZ_H, 0.03);
  const tip = Math.sqrt(sq(hx - 0.42) + sq(hy - WIZ_H + 0.02) + hz * hz) - 0.065;
  return smin(d, tip, 0.04);
}
function wizBrim(x, y, z) {
  const [hx, hy, hz] = WIZ.apply(x, y, z);
  const rr = Math.sqrt(hx * hx + hz * hz);
  const wave = 0.035 * Math.sin(Math.atan2(hz, hx) * 3 + 0.6) - 0.16 * Math.pow(rr / 1.05, 4);
  return smax(rr - 1.05, Math.abs(hy - wave) - 0.045, 0.035);
}
function wizBand(x, y, z) {
  const [hx, hy, hz] = WIZ.apply(x, y, z);
  const rr = Math.sqrt(hx * hx + hz * hz);
  return smax(Math.abs(rr - 0.625) - 0.04, Math.abs(hy - 0.12) - 0.075, 0.03);
}
const WAND_A = [1.0, 0.5, 0.44], WAND_B = [1.27, 1.33, 0.47];
function wandStick(x, y, z) {
  return capsule(x, y, z, WAND_A, WAND_B, 0.032);
}
const STAR = frame([1.31, 1.47, 0.5], [0, 0.3, -0.22]);
function wandStar(x, y, z) {
  const [sx, sy, sz] = STAR.apply(x, y, z);
  return extrude(star5(sx, sy, 0.25, 0.46), sz, 0.055, 0.05);
}

/* ---------- ドット絵のサングラス ---------- */
const SHADES_ROWS = [
  '##################',
  '.#######..#######.',
  '..#####....#####..',
];
const SHADES_PX = 0.1, SHADES_TOP = 1.41;
const SHADES_RECTS = [];
SHADES_ROWS.forEach((row, r) => {
  let start = -1;
  for (let c = 0; c <= row.length; c++) {
    const on = row[c] === '#';
    if (on && start < 0) start = c;
    if (!on && start >= 0) {
      const x0 = -0.9 + start * SHADES_PX, x1 = -0.9 + c * SHADES_PX;
      // 下の行は上の行へ少し食い込ませ、行の境目に溝ができないようにする
      const y1 = SHADES_TOP - r * SHADES_PX + (r > 0 ? 0.03 : 0), y0 = SHADES_TOP - (r + 1) * SHADES_PX;
      SHADES_RECTS.push([(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2]);
      start = -1;
    }
  }
});
function shades(x, y, z) {
  let d2 = 1e9;
  for (const [cx, cy, hx, hy] of SHADES_RECTS) d2 = Math.min(d2, box2(x - cx, y - cy, hx, hy));
  return extrude(d2, z - (frontZ(x, y) + 0.04), 0.035, 0.014);
}

/* ---------- かがくしゃ（ゴーグル・実験着・フラスコ） ---------- */
const G_Y = 1.57;
function gogStrap(x, y, z) {
  return smax(Math.abs(bodyDist(x, y, z) - 0.04) - 0.03, Math.abs(y - G_Y - 0.03 * x) - 0.085, 0.02);
}
function gogFrame(x, y, z) {
  return extrude(roundRect2(x, y - G_Y, 0.64, 0.215, 0.13), z - (frontZ(x, y) + 0.075), 0.05, 0.03);
}
function gogLens(x, y, z) {
  return extrude(roundRect2(x, y - G_Y, 0.52, 0.13, 0.09), z - (frontZ(x, y) + 0.125), 0.03, 0.025);
}
function coat(x, y, z) {
  const ax = Math.abs(x);
  const top = 1.06 + 0.26 * smoothstep(0.72, 0.98, ax);
  let d = smax(Math.abs(clawdDist(x, y, z) - 0.045) - 0.026, Math.max(y - top, 0.46 - y), 0.05);
  d = smax(d, -Math.max(ax - 0.47, 0.2 - z), 0.05);
  return d;
}
const FLASK = frame([-1.13, 0.7, 0.52], [0.1, 0, 0.3]);
function flask(x, y, z) {
  const [hx, hy, hz] = FLASK.apply(x, y, z);
  const rr = Math.sqrt(hx * hx + hz * hz);
  const r = hy < 0.3 ? 0.21 - 0.14 * (Math.max(hy, 0) / 0.3) : 0.07;
  let d = (rr - r) * 0.9;
  d = smax(d, -hy, 0.04);
  d = smax(d, hy - 0.52, 0.02);
  const lip = smax(rr - 0.095, Math.abs(hy - 0.49) - 0.035, 0.02);
  return smin(d, lip, 0.02);
}

/* ---------- ニット帽（オリジナル） ---------- */
function beanie(x, y, z) {
  if (y < 1.38) return 1.38 - y + 0.1;
  const b = bodyDist(x, y, z);
  const off = 0.05 + 0.2 * smoothstep(1.62, 2.05, y);
  const hat = smax(Math.abs(b - off) - 0.045, 1.5 - y, 0.03);
  const cuff = smax(Math.abs(b - 0.075) - 0.06, Math.abs(y - 1.57) - 0.08, 0.04);
  return smin(hat, cuff, 0.03);
}
function pompom(x, y, z) {
  return Math.sqrt(x * x + sq(y - 2.17) + z * z) - 0.2;
}

/* ---------- ヘッドホン（オリジナル） ---------- */
const HP_Y = 1.56;
function hpBand(x, y, z) {
  return smax(smax(Math.abs(bodyDist(x, y, z) - 0.13) - 0.04, Math.abs(z) - 0.085, 0.02), HP_Y - y, 0.03);
}
function hpCups(x, y, z) {
  const r = Math.sqrt(sq(y - HP_Y) + z * z);
  return extrude(r - 0.25, Math.abs(x) - 1.15, 0.075, 0.06);
}
function hpPads(x, y, z) {
  const r = Math.sqrt(sq(y - HP_Y) + z * z);
  return extrude(r - 0.21, Math.abs(x) - 1.04, 0.05, 0.045);
}

/* ---------- おうさまの王冠（オリジナル） ---------- */
const CROWN = frame([0.08, 1.78, 0.04], [-0.1, 0, -0.14]);
const CROWN_R = 0.38;
function crownGold(x, y, z) {
  const [hx, hy, hz] = CROWN.apply(x, y, z);
  const rr = Math.sqrt(hx * hx + hz * hz);
  const f = (Math.atan2(hz, hx) / TAU) * 5 - 1.25;
  const saw = Math.abs(f - Math.floor(f) - 0.5) * 2; // 1=とがり, 0=谷
  const top = 0.2 + 0.17 * saw;
  let d = smax(Math.abs(rr - CROWN_R) - 0.045, Math.max(-hy, hy - top), 0.02);
  for (let k = 0; k < 5; k++) {
    const a = ((k + 0.25) / 5) * TAU + Math.PI * 0.0;
    const bx = Math.cos(a) * CROWN_R, bz = Math.sin(a) * CROWN_R;
    d = smin(d, Math.sqrt(sq(hx - bx) + sq(hy - 0.4) + sq(hz - bz)) - 0.055, 0.02);
  }
  return d;
}
function crownGems(x, y, z) {
  const [hx, hy, hz] = CROWN.apply(x, y, z);
  let d = 1e9;
  for (const a of [Math.PI / 2, Math.PI / 2 + 0.9, Math.PI / 2 - 0.9]) {
    const gx = Math.cos(a) * (CROWN_R + 0.045), gz = Math.sin(a) * (CROWN_R + 0.045);
    const lx = hx - gx, ly = hy - 0.1, lz = hz - gz;
    d = Math.min(d, (Math.sqrt(sq(lx / 0.06) + sq(ly / 0.06) + sq(lz / 0.035)) - 1) * 0.035);
  }
  return d;
}

/* ---------- 布の設定 ---------- */
// fur: 毛足の長さ / density: 毛の密度（1 単位あたり）/ shells: 毛の層の数 / root: 根元の暗さ
const PLUSH = { furLen: 0.036, density: 190, shells: 22, root: 0.68, roughness: 0.95 };
const FELT = { furLen: 0.013, density: 240, shells: 8, root: 0.82, roughness: 0.95 };
const felt = (color, extra = {}) => ({ ...FELT, color, ...extra });

export const PARTS = {
  body: {
    sdf: clawd, bounds: [[-1.42, -0.06, -0.7], [1.42, 1.9, 0.7]], cell: 0.03,
    mat: { ...PLUSH, color: '#E36E40', sheen: '#FF9A68', pattern: 1, patA: '#151214' },
  },
  cowboyHat: {
    sdf: cowboyHat, bounds: [[-1.45, 1.3, -1.25], [1.65, 2.55, 1.25]], cell: 0.022,
    mat: felt('#80614A', { sheen: '#C7A88F' }),
  },
  wizCone: {
    sdf: wizCone, bounds: [[-0.85, 1.75, -0.8], [0.95, 3.1, 0.8]], cell: 0.02,
    mat: felt('#2F6BD3', { sheen: '#8FB4FF', pattern: 2, patA: '#F3D447', frame: WIZ }),
  },
  wizBrim: {
    sdf: wizBrim, bounds: [[-1.25, 1.5, -1.15], [1.2, 2.15, 1.15]], cell: 0.02,
    mat: felt('#2F6BD3', { sheen: '#8FB4FF', pattern: 2, patA: '#F3D447', frame: WIZ }),
  },
  wizBand: {
    sdf: wizBand, bounds: [[-0.8, 1.8, -0.78], [0.8, 2.22, 0.78]], cell: 0.016,
    mat: felt('#1E2A73', { sheen: '#6170D0' }),
  },
  wandStick: {
    sdf: wandStick, bounds: [[0.9, 0.4, 0.33], [1.38, 1.44, 0.58]], cell: 0.012,
    mat: felt('#8A5A3A', { sheen: '#C9946C' }),
  },
  wandStar: {
    sdf: wandStar, bounds: [[0.98, 1.13, 0.28], [1.64, 1.8, 0.72]], cell: 0.014,
    mat: { ...PLUSH, furLen: 0.02, density: 200, shells: 10, root: 0.75, color: '#F4D35E', sheen: '#FFF1B0' },
  },
  shades: {
    sdf: shades, bounds: [[-1.0, 1.02, 0.28], [1.0, 1.5, 0.76]], cell: 0.015,
    mat: felt('#1A1A20', { sheen: '#55556A' }),
  },
  gogStrap: {
    sdf: gogStrap, bounds: [[-1.15, 1.38, -0.75], [1.15, 1.8, 0.75]], cell: 0.02,
    mat: felt('#232327', { sheen: '#5A5A66' }),
  },
  gogFrame: {
    sdf: gogFrame, bounds: [[-0.75, 1.3, 0.2], [0.75, 1.84, 0.8]], cell: 0.016,
    mat: felt('#1C1C21', { sheen: '#55556A' }),
  },
  gogLens: {
    sdf: gogLens, bounds: [[-0.6, 1.39, 0.3], [0.6, 1.75, 0.82]], cell: 0.014,
    mat: felt('#8E9493', { sheen: '#D8E2E2' }),
  },
  coat: {
    sdf: coat, bounds: [[-1.5, 0.36, -0.82], [1.5, 1.42, 0.82]], cell: 0.024,
    mat: felt('#B9BCB8', { sheen: '#E6E8E4' }),
  },
  flask: {
    sdf: flask, bounds: [[-1.5, 0.6, 0.24], [-0.82, 1.3, 0.82]], cell: 0.013,
    mat: felt('#A4D7EF', { sheen: '#E8F7FF', pattern: 4, patA: '#2E86DA', patLevel: 0.19, frame: FLASK }),
  },
  beanie: {
    sdf: beanie, bounds: [[-1.3, 1.4, -0.92], [1.3, 2.18, 0.92]], cell: 0.022,
    mat: { ...PLUSH, furLen: 0.018, density: 220, shells: 10, root: 0.72, color: '#3F6E53', sheen: '#9CC7AD', pattern: 3, patLevel: 1.67 },
  },
  pompom: {
    sdf: pompom, bounds: [[-0.28, 1.88, -0.28], [0.28, 2.46, 0.28]], cell: 0.016,
    mat: { ...PLUSH, furLen: 0.1, density: 120, shells: 24, root: 0.55, color: '#F1E2C4', sheen: '#FFFFFF' },
  },
  hpBand: {
    sdf: hpBand, bounds: [[-1.3, 1.45, -0.16], [1.3, 2.08, 0.16]], cell: 0.016,
    mat: felt('#2A2A30', { sheen: '#60606E' }),
  },
  hpCups: {
    sdf: hpCups, bounds: [[-1.32, 1.24, -0.34], [1.32, 1.88, 0.34]], cell: 0.016,
    mat: felt('#EEE7D6', { sheen: '#FFFFFF' }),
  },
  hpPads: {
    sdf: hpPads, bounds: [[-1.16, 1.28, -0.3], [1.16, 1.84, 0.3]], cell: 0.016,
    mat: felt('#2A2A30', { sheen: '#60606E' }),
  },
  crownGold: {
    sdf: crownGold, bounds: [[-0.45, 1.62, -0.48], [0.62, 2.35, 0.55]], cell: 0.013,
    mat: felt('#E4B23E', { sheen: '#FFE9A6', roughness: 0.75 }),
  },
  crownGems: {
    sdf: crownGems, bounds: [[-0.42, 1.68, -0.1], [0.55, 2.05, 0.6]], cell: 0.01,
    mat: felt('#D7404A', { sheen: '#FF9AA0', roughness: 0.7 }),
  },
};

/* ---------- ガチャのラインナップ ---------- */
export const VARIANTS = [
  { id: 'plain', name: 'いつもの Clawd', rarity: 1, weight: 22, parts: [], note: 'ふかふか。なにも着ていない。' },
  { id: 'cowboy', name: 'カウボーイ Clawd', rarity: 2, weight: 15, parts: ['cowboyHat'], note: 'フェルトのハットで荒野へ。' },
  { id: 'shades', name: 'サングラス Clawd', rarity: 2, weight: 15, parts: ['shades'], note: 'ドット絵のサングラス。' },
  { id: 'beanie', name: 'ニット帽 Clawd', rarity: 2, weight: 13, parts: ['beanie', 'pompom'], note: 'ぽんぽん付き。秋の新作。' },
  { id: 'headphones', name: 'ヘッドホン Clawd', rarity: 2, weight: 13, parts: ['hpBand', 'hpCups', 'hpPads'], note: '作業用BGMを聴いている。' },
  { id: 'wizard', name: 'まほうつかい Clawd', rarity: 3, weight: 9, parts: ['wizCone', 'wizBrim', 'wizBand', 'wandStick', 'wandStar'], note: '星のステッキつき。' },
  { id: 'scientist', name: 'かがくしゃ Clawd', rarity: 3, weight: 9, parts: ['gogStrap', 'gogFrame', 'gogLens', 'coat', 'flask'], note: 'ゴーグルと実験着とフラスコ。' },
  { id: 'crown', name: 'おうさま Clawd', rarity: 4, weight: 4, parts: ['crownGold', 'crownGems'], note: 'めったに届かない。' },
];

export const variantById = (id) => VARIANTS.find((v) => v.id === id);

export function pickRandomVariant(exceptId) {
  const pool = VARIANTS.filter((v) => v.id !== exceptId);
  let r = Math.random() * pool.reduce((s, v) => s + v.weight, 0);
  for (const v of pool) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return pool[0];
}
