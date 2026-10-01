// ぬいぐるみ 1 体ぶんの組み立て（形・毛並み・変形・物理）。
// 毛並みはシェル法：同じ形を法線方向に少しずつ膨らませた層を重ね、各層で「毛の断面」だけを残す。
// 変形（押す・潰れる・揺れる）は頂点シェーダで行い、本体・毛・小物・影がすべて同じ動きをする。
import * as THREE from 'three';
import { meshSDF } from './sdf.js';
import { PARTS, EYE, TOP_Y } from './parts.js';

/* ---------- 形の読み込み（Web Worker で計算し、できたものを使い回す） ---------- */
const geoCache = new Map();
const pending = new Map();
let worker = null;
try {
  worker = new Worker(new URL('./mesher.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { key, position, normal, index } = e.data;
    finish(key, { position, normal, index });
  };
  worker.onerror = () => {
    worker = null;
    for (const key of pending.keys()) finish(key, buildHere(key));
  };
} catch {
  worker = null;
}

function buildHere(key) {
  const p = PARTS[key];
  return meshSDF(p.sdf, p.bounds[0], p.bounds[1], p.cell);
}

function finish(key, m) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  geoCache.set(key, geo);
  const resolve = pending.get(key)?.resolve;
  pending.delete(key);
  resolve?.(geo);
}

export function loadGeometry(key) {
  if (geoCache.has(key)) return Promise.resolve(geoCache.get(key));
  if (pending.has(key)) return pending.get(key).promise;
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  pending.set(key, { promise, resolve });
  if (worker) worker.postMessage(key);
  else setTimeout(() => finish(key, buildHere(key)), 0);
  return promise;
}

export const isBuilt = (key) => geoCache.has(key);

export function ensureGeometries(variant) {
  return Promise.all(['body', ...variant.parts].map(loadGeometry));
}

/* ---------- シェーダ ---------- */
const VERT_PARS = /* glsl */ `
uniform vec4 uDentP[4];
uniform vec4 uDentD[4];
uniform vec3 uSquash;
uniform vec3 uShear;
uniform vec3 uFurLag;
uniform float uFloorY;
uniform float uFurLen;
uniform float uShells;
varying vec3 vRest;
varying vec3 vRestN;
varying float vH;

vec3 deformP(vec3 p) {
  for (int i = 0; i < 4; i++) {
    vec3 d = p - uDentP[i].xyz;
    float r = uDentD[i].w;
    p += uDentD[i].xyz * (uDentP[i].w * exp(-dot(d, d) / (r * r)));
  }
  float t = clamp(p.y / uSquash.z, 0.0, 1.4);
  p.xz *= 1.0 + (uSquash.y - 1.0) * (0.6 + 1.6 * t * (1.0 - t));
  p.y *= uSquash.x;
  p.xz += uShear.xz * (t * t);
  return p;
}
`;

const VERT_NORMAL = /* glsl */ `
vec3 pzRp = position;
vec3 pzRn = normalize(normal);
vRest = pzRp;
vRestN = pzRn;
vec3 pzT1 = normalize(cross(pzRn, abs(pzRn.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
vec3 pzT2 = cross(pzRn, pzT1);
vec3 pzP0 = deformP(pzRp);
vec3 pzN = normalize(cross(deformP(pzRp + pzT1 * 0.02) - pzP0, deformP(pzRp + pzT2 * 0.02) - pzP0));
#ifdef SHELL
  float pzH = (float(gl_InstanceID) + 1.0) / uShells;
#else
  float pzH = 0.0;
#endif
vH = pzH;
vec3 pzPos = pzP0 + pzN * (uFurLen * pzH) + (vec3(0.0, -0.3 * uFurLen, 0.0) + uFurLag) * (pzH * pzH);
pzPos.y = max(pzPos.y, uFloorY);
vec3 objectNormal = pzN;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform float uFurLen;
uniform float uDensity;
uniform float uRootShade;
uniform vec3 uPatA;
uniform mat4 uPatFrame;
uniform float uPatLevel;
varying vec3 vRest;
varying vec3 vRestN;
varying float vH;

float pzHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 pzHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float pzNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(pzHash13(i), pzHash13(i + vec3(1, 0, 0)), f.x), mix(pzHash13(i + vec3(0, 1, 0)), pzHash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(pzHash13(i + vec3(0, 0, 1)), pzHash13(i + vec3(1, 0, 1)), f.x), mix(pzHash13(i + vec3(0, 1, 1)), pzHash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float pzBox(vec2 q, vec2 c, vec2 h, float aa) {
  vec2 d = abs(q - c) - h;
  return 1.0 - smoothstep(-aa, aa, max(d.x, d.y));
}
// ドット絵の「^」の目。上段 2 ドット、下段は左右に 1 ドットずつ。
float pzEye(vec2 p) {
  vec2 q = (vec2(abs(p.x), p.y) - vec2(${EYE.x.toFixed(3)}, ${EYE.y.toFixed(3)})) / ${EYE.px.toFixed(3)};
  float aa = max(fwidth(q.x), fwidth(q.y)) * 0.7 + 1e-4;
  float m = pzBox(q, vec2(0.0, 0.5), vec2(1.0, 0.5), aa);
  m = max(m, pzBox(q, vec2(-1.5, -0.5), vec2(0.5, 0.5), aa));
  m = max(m, pzBox(q, vec2(1.5, -0.5), vec2(0.5, 0.5), aa));
  return m;
}
`;

const FRAG_COLOR = /* glsl */ `
float pzThread = 0.0;
{
  vec3 rn = normalize(vRestN);
  float lenMul = 1.0;
  vec3 col = diffuseColor.rgb;
#if PATTERN == 1
  float front = smoothstep(0.3, 0.5, rn.z);
  float em = pzEye(vRest.xy) * front;
  float seam = 1.0 - smoothstep(0.0, 0.045, abs(abs(rn.z) - 0.6));
  vec2 sq = vRest.xy / ${EYE.px.toFixed(3)};
  float st = 0.5 + 0.5 * sin((sq.x * 0.6 + sq.y) * 18.85);
  col = mix(col, mix(vec3(0.010), vec3(0.045), st), em);
  col *= 1.0 - 0.16 * seam;
  lenMul *= (1.0 - em) * (1.0 - 0.6 * seam);
  pzThread = em;
#elif PATTERN == 2
  vec3 lp = (uPatFrame * vec4(vRest, 1.0)).xyz;
  vec3 ln = normalize(mat3(uPatFrame) * rn);
  vec3 sc = lp / 0.17;
  vec3 f = fract(sc) - 0.5;
  f -= ln * dot(f, ln);
  float aa = (fwidth(sc.x) + fwidth(sc.y) + fwidth(sc.z)) * 0.5 + 1e-4;
  float star = step(pzHash13(floor(sc) + 3.7), 0.2) * (1.0 - smoothstep(0.19 - aa, 0.19 + aa, max(abs(f.x), max(abs(f.y), abs(f.z)))));
  col = mix(col, uPatA, star);
  lenMul *= 1.0 - 0.4 * star;
#elif PATTERN == 3
  vec3 lp = (uPatFrame * vec4(vRest, 1.0)).xyz;
  float ang = atan(lp.z, lp.x);
  float ribs = 0.5 + 0.5 * cos(ang * (lp.y < uPatLevel ? 46.0 : 30.0));
  col *= 0.78 + 0.27 * ribs;
  lenMul *= 0.75 + 0.25 * ribs;
#elif PATTERN == 4
  vec3 lp = (uPatFrame * vec4(vRest, 1.0)).xyz;
  float lw = fwidth(lp.y) + 1e-4;
  col = mix(uPatA, col, smoothstep(uPatLevel - lw, uPatLevel + lw, lp.y));
#endif
  float mottle = pzNoise(vRest * 3.5) * 0.65 + pzNoise(vRest * 9.0) * 0.35;
  col *= 0.92 + 0.16 * mottle;
#ifdef SHELL
  vec3 cp = vRest * uDensity;
  vec3 rnd = pzHash33(floor(cp));
  vec3 ff = fract(cp) - 0.5 - (rnd - 0.5) * 0.4;
  ff -= (rnd.zxy - 0.5) * (vH * 1.3);
  ff -= rn * dot(ff, rn);
  float len = mix(0.45, 1.0, rnd.y) * lenMul;
  float sd = 0.62 * (1.0 - vH / max(len, 1e-3)) - length(ff);
  float aa2 = length(fwidth(cp)) * 0.5 + 1e-3;
  float cov = smoothstep(-aa2, aa2, sd);
  if (cov < 0.02) discard;
  diffuseColor.a = cov;
  col *= 0.96 + 0.08 * rnd.x;
#endif
  col *= mix(uRootShade, 1.0, pow(vH, 0.8));
  diffuseColor.rgb = col;
}
`;

function patchStandard(shader, U, partU) {
  Object.assign(shader.uniforms, U, partU);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_PARS)
    .replace('#include <beginnormal_vertex>', VERT_NORMAL)
    .replace('#include <begin_vertex>', 'vec3 transformed = pzPos;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, pzThread);');
}

function patchDepth(shader, U, partU) {
  Object.assign(shader.uniforms, U, partU);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_PARS)
    .replace('#include <begin_vertex>', 'vec3 transformed = deformP(position);\ntransformed.y = max(transformed.y, uFloorY);');
}

function makeMaterials(spec, U, shellCount) {
  const partU = {
    uFurLen: { value: spec.furLen },
    uDensity: { value: spec.density },
    uRootShade: { value: spec.root },
    uShells: { value: shellCount },
    uPatA: { value: new THREE.Color(spec.patA || '#000000') },
    uPatFrame: { value: spec.frame ? new THREE.Matrix4().fromArray(spec.frame.inverse) : new THREE.Matrix4() },
    uPatLevel: { value: spec.patLevel ?? 0 },
  };
  const params = {
    color: new THREE.Color(spec.color),
    roughness: spec.roughness ?? 0.95,
    metalness: 0,
    specularIntensity: spec.specular ?? 0.18,
    sheen: 0.6,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(spec.sheen || spec.color).multiplyScalar(0.3),
  };
  const defines = { PATTERN: spec.pattern || 0 };

  const base = new THREE.MeshPhysicalMaterial(params);
  base.defines = { ...defines };
  base.onBeforeCompile = (sh) => patchStandard(sh, U, partU);

  const shell = new THREE.MeshPhysicalMaterial(params);
  shell.defines = { ...defines, SHELL: '' };
  shell.alphaToCoverage = true;
  shell.onBeforeCompile = (sh) => patchStandard(sh, U, partU);

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => patchDepth(sh, U, partU);

  return { base, shell, depth, partU };
}

/* ---------- ぬいぐるみ 1 体 ---------- */
const G = 22;
const PIVOT = 0.95;
const MAX_DENT = 0.2;

export class Plush {
  constructor(variant, { shellScale = 1 } = {}) {
    this.variant = variant;
    this.U = {
      uDentP: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
      uDentD: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -1, 0.3)) },
      uSquash: { value: new THREE.Vector3(1, 1, TOP_Y) },
      uShear: { value: new THREE.Vector3() },
      uFurLag: { value: new THREE.Vector3() },
      uFloorY: { value: -100 },
    };
    this.outer = new THREE.Group();
    this.flip = new THREE.Group();
    this.inner = new THREE.Group();
    this.flip.position.y = PIVOT;
    this.inner.position.y = -PIVOT;
    this.outer.add(this.flip);
    this.flip.add(this.inner);

    this.pickables = [];
    this.shellMeshes = [];
    this.materials = [];
    for (const key of ['body', ...variant.parts]) {
      const spec = PARTS[key].mat;
      const geo = geoCache.get(key);
      const n = Math.max(4, Math.round(spec.shells * shellScale));
      const m = makeMaterials(spec, this.U, n);
      const base = new THREE.Mesh(geo, m.base);
      base.castShadow = true;
      base.receiveShadow = true;
      base.customDepthMaterial = m.depth;
      base.frustumCulled = false;
      const shells = new THREE.InstancedMesh(geo, m.shell, n);
      shells.receiveShadow = true;
      shells.frustumCulled = false;
      shells.renderOrder = 1;
      shells.userData = { baseCount: spec.shells, partU: m.partU };
      // 毛先の透明度はカバレッジ（アンチエイリアス）にだけ使い、キャンバスの透明度には書かない。
      // 書くとページの背景色が毛の隙間から透けて、白っぽく光って見える。
      shells.onBeforeRender = (r) => r.getContext().colorMask(true, true, true, false);
      shells.onAfterRender = (r) => r.getContext().colorMask(true, true, true, true);
      this.inner.add(base, shells);
      this.pickables.push(base);
      this.shellMeshes.push(shells);
      this.materials.push(m.base, m.shell, m.depth);
    }

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawVel = 0;
    this.dragging = false;
    this.flipA = 0;
    this.flipV = 0;
    this.s = 1;
    this.sv = 0;
    this.shear = new THREE.Vector2();
    this.shearV = new THREE.Vector2();
    this.dents = Array.from({ length: 4 }, () => ({
      p: new THREE.Vector3(), d: new THREE.Vector3(0, 0, -1), amp: 0, v: 0, target: 0, r: 0.3, held: false, t: 0,
    }));
    this.leaving = false;
    this.leaveT = 0;
    this.leaveSide = 1;
    this.gone = false;
    this.landed = false;
  }

  setShellScale(scale) {
    for (const s of this.shellMeshes) {
      const n = Math.max(4, Math.round(s.userData.baseCount * scale));
      s.count = n;
      s.userData.partU.uShells.value = n;
    }
  }

  // 上から落とす
  drop(height = 7) {
    this.pos.set(0, height, 0);
    this.vel.set(0, 0, 0);
    const side = Math.random() < 0.5 ? -1 : 1;
    this.yaw = side * (0.22 + Math.random() * 0.25);
  }

  // 前のぬいぐるみが跳んで画面外へ
  leave() {
    this.leaving = true;
    this.leaveT = 0.14;
    this.leaveSide = Math.random() < 0.5 ? -1 : 1;
    for (const d of this.dents) { d.held = false; d.target = 0; }
  }

  toss() {
    if (this.pos.y > 0.05 || this.leaving) return false;
    const v0 = 7.2;
    this.vel.y = v0;
    this.flipV = (Math.PI * 2) / ((2 * v0) / G) * (Math.random() < 0.5 ? -1 : 1);
    this.sv -= 1.2;
    for (const d of this.dents) { d.held = false; d.target = 0; }
    return true;
  }

  // ---- 押す・なでる ----
  pressStart(localP, localDir) {
    let best = null;
    for (const d of this.dents) {
      if (!d.held && (!best || Math.abs(d.amp) < Math.abs(best.amp))) best = d;
    }
    best ??= this.dents[0];
    best.p.copy(localP);
    best.d.copy(localDir);
    best.held = true;
    best.t = 0;
    best.target = 0.06;
    best.v += 2.6;
    const down = Math.max(0, -localDir.y);
    this.sv -= 0.5 * (0.3 + down);
    const h = Math.min(1, Math.max(0, localP.y / TOP_Y));
    this.shearV.x += localDir.x * 0.9 * h;
    this.shearV.y += localDir.z * 0.9 * h;
    return best;
  }

  pressMove(dent, localP, localDir) {
    const dx = localP.x - dent.p.x, dz = localP.z - dent.p.z;
    dent.p.lerp(localP, 0.6);
    dent.d.lerp(localDir, 0.4).normalize();
    this.shearV.x += dx * 1.4;
    this.shearV.y += dz * 1.4;
  }

  pressEnd(dent) {
    dent.held = false;
    dent.target = 0;
  }

  update(dt, hooks = {}) {
    // 位置・落下
    if (this.leaving) {
      if (this.leaveT > 0) {
        this.leaveT -= dt;
        if (this.leaveT <= 0) {
          this.vel.set(this.leaveSide * 3.2, 13, 0);
          this.yawVel = this.leaveSide * 7;
          this.flipV = -this.leaveSide * 3;
          hooks.onLeave?.();
        }
      } else {
        this.vel.y -= G * 0.15 * dt;
        this.pos.addScaledVector(this.vel, dt);
        this.leaveT -= dt;
        if (this.pos.y > 10 || this.leaveT < -3) this.gone = true;
      }
    } else if (this.pos.y > 0 || this.vel.y > 0) {
      this.vel.y -= G * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= 0 && this.vel.y < 0) {
        const impact = -this.vel.y;
        this.pos.y = 0;
        this.sv -= Math.min(impact * 0.26, 3.2);
        this.shearV.x += (Math.random() - 0.5) * Math.min(impact, 10) * 0.12;
        this.shearV.y += (Math.random() - 0.5) * Math.min(impact, 10) * 0.12;
        if (impact > 5 && Math.abs(this.flipV) < 0.01) {
          this.vel.y = Math.min(impact * 0.2, 3.0);
        } else {
          this.vel.set(0, 0, 0);
          this.flipA = 0;
          this.flipV = 0;
        }
        hooks.onLand?.(impact);
      }
    }

    this.flipA += this.flipV * dt;
    if (!this.dragging) {
      this.yaw += this.yawVel * dt;
      this.yawVel *= Math.exp(-2.6 * dt);
    }

    // へこみ
    let sTarget = 1;
    let shx = 0, shz = 0;
    for (const d of this.dents) {
      if (d.held) {
        d.t += dt;
        d.target = Math.min(MAX_DENT, 0.06 + d.t * 0.5);
        const depth = d.amp / MAX_DENT;
        const h = Math.min(1, Math.max(0, d.p.y / TOP_Y));
        sTarget -= 0.16 * depth * (0.3 + 0.7 * Math.max(0, -d.d.y));
        shx += d.d.x * 0.1 * depth * h;
        shz += d.d.z * 0.1 * depth * h;
      }
      d.v += (-(d.amp - d.target) * 420 - d.v * 21) * dt;
      d.amp += d.v * dt;
    }

    // 潰れ（体積をだいたい保つ）とゆれ
    this.sv += (-(this.s - sTarget) * 230 - this.sv * 10.5) * dt;
    this.s = Math.min(1.35, Math.max(0.6, this.s + this.sv * dt));
    this.shearV.x += (-(this.shear.x - shx) * 170 - this.shearV.x * 8) * dt;
    this.shearV.y += (-(this.shear.y - shz) * 170 - this.shearV.y * 8) * dt;
    this.shear.x = Math.max(-0.4, Math.min(0.4, this.shear.x + this.shearV.x * dt));
    this.shear.y = Math.max(-0.4, Math.min(0.4, this.shear.y + this.shearV.y * dt));

    this.writeUniforms();
  }

  writeUniforms() {
    const U = this.U;
    this.dents.forEach((d, i) => {
      U.uDentP.value[i].set(d.p.x, d.p.y, d.p.z, d.amp);
      U.uDentD.value[i].set(d.d.x, d.d.y, d.d.z, d.r);
    });
    U.uSquash.value.set(this.s, 1 / Math.sqrt(this.s), TOP_Y);
    U.uShear.value.set(this.shear.x, 0, this.shear.y);
    const lag = (v) => Math.max(-0.03, Math.min(0.03, -v * 0.0022));
    U.uFurLag.value.set(lag(this.vel.x), lag(this.vel.y), lag(this.vel.z));
    U.uFloorY.value = !this.leaving && Math.abs(this.flipA) < 1e-3 ? -this.pos.y + 0.002 : -100;

    this.outer.position.copy(this.pos);
    this.outer.rotation.y = this.yaw;
    this.flip.rotation.x = this.flipA;
  }

  // ワールド座標 → ぬいぐるみ座標
  toLocal(worldP, worldDir) {
    this.inner.updateWorldMatrix(true, false);
    const inv = this.inner.matrixWorld.clone().invert();
    const p = worldP.clone().applyMatrix4(inv);
    const d = worldDir.clone().transformDirection(inv);
    return { p, d };
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    for (const s of this.shellMeshes) s.dispose();
    this.outer.removeFromParent();
  }
}
