// ステッカーシートづくり。白背景と黒背景で 2 回描いた画像の差から透明度を求め、
// 白いフチ（ダイカット）と影をつけて 1 枚のシートに並べる。

function alphaMask(white, black) {
  const w = white.width, h = white.height;
  const a = white.getContext('2d').getImageData(0, 0, w, h).data;
  const b = black.getContext('2d').getImageData(0, 0, w, h).data;
  const mask = new ImageData(w, h);
  const m = mask.data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0, p = 0; i < a.length; i += 4, p++) {
    const diff = (a[i] - b[i] + a[i + 1] - b[i + 1] + a[i + 2] - b[i + 2]) / 3;
    const alpha = Math.max(0, Math.min(255, 255 - diff));
    m[i] = m[i + 1] = m[i + 2] = 255;
    m[i + 3] = alpha;
    if (alpha > 8) {
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(mask, 0, 0);
  return { canvas: c, box: [x0, y0, x1, y1] };
}

// 1 枚のステッカー（白フチ＋影）を作る
export function makeSticker(white, black) {
  const { canvas: mask, box } = alphaMask(white, black);
  const R = Math.round(white.width * 0.022);
  const pad = R + 18;
  const [x0, y0, x1, y1] = box;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = cw + pad * 2;
  out.height = ch + pad * 2;

  const outline = document.createElement('canvas');
  outline.width = out.width;
  outline.height = out.height;
  const oc = outline.getContext('2d');
  for (const r of [R, R * 0.66, R * 0.33]) {
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      oc.drawImage(mask, x0, y0, cw, ch, pad + Math.cos(a) * r, pad + Math.sin(a) * r, cw, ch);
    }
  }
  oc.drawImage(mask, x0, y0, cw, ch, pad, pad, cw, ch);

  const ctx = out.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(60, 35, 20, 0.22)';
  ctx.shadowBlur = R * 0.9;
  ctx.shadowOffsetY = R * 0.25;
  ctx.drawImage(outline, 0, 0);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.drawImage(white, x0, y0, cw, ch, pad, pad, cw, ch);
  return out;
}

// シートに並べる
export function composeSheet(stickers) {
  const n = stickers.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cellW = 400, cellH = 420, margin = 48, head = 92, foot = 56;
  const W = margin * 2 + cols * cellW;
  const H = head + rows * cellH + foot;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#F6F1E9';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(120, 90, 70, 0.18)';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.setLineDash([]);

  ctx.fillStyle = '#3B2A22';
  ctx.font = '600 34px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.fillText('clawd plushies — sticker pack', margin, 72);

  stickers.forEach((s, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = margin + col * cellW + cellW / 2;
    const cy = head + row * cellH + cellH / 2 - 14;
    const sc = Math.min((cellW - 36) / s.canvas.width, (cellH - 80) / s.canvas.height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((i * 37) % 11 - 5) * 0.012);
    ctx.drawImage(s.canvas, (-s.canvas.width * sc) / 2, (-s.canvas.height * sc) / 2, s.canvas.width * sc, s.canvas.height * sc);
    ctx.restore();
    ctx.fillStyle = '#6E5A4E';
    ctx.font = '22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.name, cx, cy + (cellH - 80) / 2 + 40);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = 'rgba(80, 60, 50, 0.6)';
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText('非公式ファンメイド — Clawd は Anthropic のマスコットです', margin, H - 32);
  return c;
}
