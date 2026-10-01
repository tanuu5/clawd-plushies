// 距離関数（SDF）の小道具と、SDF をなめらかなメッシュに変える Surface Nets。
// ぬいぐるみは「綿を詰めた布」なので、角の丸い形を距離関数で作るのがいちばん自然に見える。
// Web Worker からも読み込むので、three.js には依存させない。

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}
export const smax = (a, b, k) => -smin(-a, -b, k);

// 「まくら」型の超楕円体。e は正面シルエットの角ばり、m は奥行き方向のふくらみ。
export function pillow(x, y, z, a, b, c, e, m) {
  const X = Math.abs(x) / a, Y = Math.abs(y) / b, Z = Math.abs(z) / c;
  const s = Math.pow(Math.pow(X, e) + Math.pow(Y, e), m / e) + Math.pow(Z, m);
  return (Math.pow(s, 1 / m) - 1) * Math.min(a, b, c);
}

export function box2(px, py, hx, hy) {
  const dx = Math.abs(px) - hx, dy = Math.abs(py) - hy;
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0);
}

export const roundRect2 = (px, py, hx, hy, r) => box2(px, py, hx - r, hy - r) - r;

// 2D の SDF を厚み 2h に押し出し、縁を r だけ丸める。
export function extrude(d2, z, h, r) {
  const wx = d2 + r, wy = Math.abs(z) - h + r;
  const ox = Math.max(wx, 0), oy = Math.max(wy, 0);
  return Math.min(Math.max(wx, wy), 0) + Math.sqrt(ox * ox + oy * oy) - r;
}

export function capsule(px, py, pz, a, b, r) {
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

// 5 つ角の星（Inigo Quilez の sdStar5 を移植）
export function star5(px, py, r, rf) {
  const k1x = 0.809016994375, k1y = -0.587785252292;
  const k2x = -k1x, k2y = k1y;
  px = Math.abs(px);
  let d = Math.max(k1x * px + k1y * py, 0);
  px -= 2 * d * k1x; py -= 2 * d * k1y;
  d = Math.max(k2x * px + k2y * py, 0);
  px -= 2 * d * k2x; py -= 2 * d * k2y;
  px = Math.abs(px);
  py -= r;
  const bax = rf * -k1y, bay = rf * k1x - 1;
  const h = clamp((px * bax + py * bay) / (bax * bax + bay * bay), 0, r);
  const qx = px - bax * h, qy = py - bay * h;
  return Math.sqrt(qx * qx + qy * qy) * Math.sign(py * bax - px * bay);
}

// 小物の置き場所（位置と XYZ オイラー角）。apply() はぬいぐるみ座標 → 小物ローカル座標への変換。
// inverse は three.js の Matrix4 と同じ列優先の 16 要素（シェーダの模様に使う）。
export function frame(pos, euler) {
  const [x, y, z] = euler;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // R の列優先（three.js の makeRotationFromEuler, order 'XYZ' と同じ）
  const te = [c * e, af + be * d, bf - ae * d, 0, -c * f, ae - bf * d, be + af * d, 0, d, -b * c, a * c, 0];
  const R = (i, j) => te[j * 4 + i];
  const [tx, ty, tz] = pos;
  const inverse = new Array(16).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) inverse[j * 4 + i] = R(j, i);
    inverse[12 + i] = -(R(0, i) * tx + R(1, i) * ty + R(2, i) * tz);
  }
  inverse[15] = 1;
  const m = inverse;
  const out = [0, 0, 0];
  return {
    inverse,
    apply(px, py, pz) {
      out[0] = m[0] * px + m[4] * py + m[8] * pz + m[12];
      out[1] = m[1] * px + m[5] * py + m[9] * pz + m[13];
      out[2] = m[2] * px + m[6] * py + m[10] * pz + m[14];
      return out;
    },
  };
}

// Surface Nets：格子の各セルに頂点を 1 つ置き、符号が変わる辺ごとに四角形を張る。
// 最後に頂点を等値面へ 1 回ニュートン射影し、法線は SDF の勾配から取る。
export function meshSDF(f, bmin, bmax, cell) {
  const nx = Math.ceil((bmax[0] - bmin[0]) / cell) + 1;
  const ny = Math.ceil((bmax[1] - bmin[1]) / cell) + 1;
  const nz = Math.ceil((bmax[2] - bmin[2]) / cell) + 1;
  const [ox, oy, oz] = bmin;
  const sxy = nx * ny;
  const v = new Float32Array(sxy * nz);
  let n = 0;
  for (let k = 0; k < nz; k++) {
    const z = oz + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * cell;
      for (let i = 0; i < nx; i++) v[n++] = f(ox + i * cell, y, z);
    }
  }

  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellV = new Int32Array(cnx * cny * cnz).fill(-1);
  const P = [];
  const CO = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1];
  const E = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  const cv = new Float64Array(8);
  for (let k = 0; k < cnz; k++) {
    for (let j = 0; j < cny; j++) {
      for (let i = 0; i < cnx; i++) {
        const b = i + nx * j + sxy * k;
        cv[0] = v[b]; cv[1] = v[b + 1]; cv[2] = v[b + nx]; cv[3] = v[b + nx + 1];
        cv[4] = v[b + sxy]; cv[5] = v[b + sxy + 1]; cv[6] = v[b + sxy + nx]; cv[7] = v[b + sxy + nx + 1];
        let inside = 0;
        for (let c = 0; c < 8; c++) if (cv[c] < 0) inside++;
        if (inside === 0 || inside === 8) continue;
        let ax = 0, ay = 0, az = 0, cnt = 0;
        for (let e = 0; e < 24; e += 2) {
          const a = E[e], c = E[e + 1];
          const va = cv[a], vb = cv[c];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          ax += CO[a * 3] + t * (CO[c * 3] - CO[a * 3]);
          ay += CO[a * 3 + 1] + t * (CO[c * 3 + 1] - CO[a * 3 + 1]);
          az += CO[a * 3 + 2] + t * (CO[c * 3 + 2] - CO[a * 3 + 2]);
          cnt++;
        }
        cellV[i + cnx * (j + cny * k)] = P.length / 3;
        P.push(ox + (i + ax / cnt) * cell, oy + (j + ay / cnt) * cell, oz + (k + az / cnt) * cell);
      }
    }
  }

  const C = (i, j, k) => cellV[i + cnx * (j + cny * k)];
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const va = v[i + nx * j + sxy * k];
        const inA = va < 0;
        if (i < nx - 1 && j >= 1 && k >= 1 && j < ny - 1 && k < nz - 1) {
          if (inA !== (v[i + 1 + nx * j + sxy * k] < 0)) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k), !inA);
        }
        if (j < ny - 1 && i >= 1 && k >= 1 && i < nx - 1 && k < nz - 1) {
          if (inA !== (v[i + nx * (j + 1) + sxy * k] < 0)) quad(C(i - 1, j, k - 1), C(i, j, k - 1), C(i, j, k), C(i - 1, j, k), inA);
        }
        if (k < nz - 1 && i >= 1 && j >= 1 && i < nx - 1 && j < ny - 1) {
          if (inA !== (v[i + nx * j + sxy * (k + 1)] < 0)) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k), !inA);
        }
      }
    }
  }

  const pos = new Float32Array(P);
  const nor = new Float32Array(P.length);
  const h = cell * 0.25;
  for (let q = 0; q < pos.length; q += 3) {
    let x = pos[q], y = pos[q + 1], z = pos[q + 2];
    for (let it = 0; it < 2; it++) {
      const d = f(x, y, z);
      const gx = (f(x + h, y, z) - f(x - h, y, z)) / (2 * h);
      const gy = (f(x, y + h, z) - f(x, y - h, z)) / (2 * h);
      const gz = (f(x, y, z + h) - f(x, y, z - h)) / (2 * h);
      const g2 = gx * gx + gy * gy + gz * gz + 1e-12;
      const gl = Math.sqrt(g2);
      if (it === 1) {
        nor[q] = gx / gl; nor[q + 1] = gy / gl; nor[q + 2] = gz / gl;
        break;
      }
      let s = d / g2;
      const step = Math.abs(s) * gl;
      if (step > cell * 0.6) s *= (cell * 0.6) / step;
      x -= s * gx; y -= s * gy; z -= s * gz;
    }
    pos[q] = x; pos[q + 1] = y; pos[q + 2] = z;
  }

  const index = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { position: pos, normal: nor, index };
}
