// 形の計算（SDF → メッシュ）を画面の描画と別スレッドで行う。
import { PARTS } from './parts.js';
import { meshSDF } from './sdf.js';

self.onmessage = (e) => {
  const key = e.data;
  const p = PARTS[key];
  const m = meshSDF(p.sdf, p.bounds[0], p.bounds[1], p.cell);
  self.postMessage({ key, ...m }, [m.position.buffer, m.normal.buffer, m.index.buffer]);
};
