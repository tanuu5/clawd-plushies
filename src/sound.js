// 効果音はすべて Web Audio で合成（音声ファイルは使わない）。
let ctx = null;
let master = null;
let noise = null;
let muted = false;
let unlocked = false; // ブラウザは操作前の音を止めるので、最初のタップ/クリックまでは鳴らさない

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = muted ? 0 : 0.55;
}
export const isMuted = () => muted;

function ensure() {
  if (!unlocked) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ユーザー操作の中で一度呼んで、音を鳴らせる状態にしておく
export function unlock() {
  unlocked = true;
  ensure();
}

function env(g, t, peak, attack, release) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
}

function puff(t, { from = 900, to = 180, peak = 0.2, attack = 0.012, release = 0.15, q = 0.7 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = q;
  lp.frequency.setValueAtTime(from, t);
  lp.frequency.exponentialRampToValueAtTime(to, t + attack + release);
  const g = ctx.createGain();
  env(g, t, peak, attack, release);
  src.connect(lp).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + release + 0.05);
}

function tone(t, f0, f1, { type = 'sine', peak = 0.2, attack = 0.005, release = 0.15 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + attack + release);
  const g = ctx.createGain();
  env(g, t, peak, attack, release);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + attack + release + 0.05);
}

// むにっ（布がつぶれる、こもった音）
export function squish(strength = 1) {
  if (muted || !ensure()) return;
  const t = ctx.currentTime;
  puff(t, { from: 700 + 300 * Math.random(), to: 160, peak: 0.16 * strength, release: 0.14 });
  tone(t, 210 + 40 * Math.random(), 140, { peak: 0.05 * strength, release: 0.1 });
}

// ぽすっ（着地）
export function land(impact) {
  if (muted || !ensure()) return;
  const k = Math.min(1, impact / 16);
  if (k < 0.08) return;
  const t = ctx.currentTime;
  tone(t, 120, 52, { peak: 0.32 * k, release: 0.16 });
  puff(t, { from: 520, to: 120, peak: 0.22 * k, release: 0.18 });
}

// ひゅっ（退場）
export function whoosh() {
  if (muted || !ensure()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
  const g = ctx.createGain();
  env(g, t, 0.12, 0.08, 0.25);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.4);
}

// 届いたときのチャイム。レア度が高いほど音が増える。
export function chime(rarity = 1) {
  if (muted || !ensure()) return;
  const t = ctx.currentTime;
  const scale = [659.25, 783.99, 987.77, 1174.66, 1318.51];
  const n = 2 + rarity;
  for (let i = 0; i < n; i++) {
    const f = scale[i % scale.length] * (i >= scale.length ? 2 : 1);
    tone(t + i * 0.075, f, f * 0.999, { type: 'triangle', peak: 0.09, attack: 0.006, release: 0.38 });
  }
}

export function tick() {
  if (muted || !ensure()) return;
  tone(ctx.currentTime, 1800, 1400, { type: 'square', peak: 0.012, release: 0.02 });
}
