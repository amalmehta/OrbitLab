// Small canvas line chart for training progress: success rate (0–100%) over environment steps.

export function drawChart(canvas, history) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(canvas);
  const ink = css.getPropertyValue('--ink-2').trim() || '#9aa7b8';
  const grid = css.getPropertyValue('--line').trim() || '#2a3340';
  const accent = css.getPropertyValue('--accent').trim() || '#6fd3ff';
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  ctx.font = '10px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = ink;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (const v of [0, 50, 100]) {
    const y = pad.t + H - (v / 100) * H;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
    ctx.fillText(`${v}%`, 4, y + 3);
  }
  if (history.length < 2) {
    ctx.fillText('Success rate appears here as the agent trains', pad.l + 6, pad.t + H / 2);
    return;
  }
  const x0 = history[0].steps, x1 = history[history.length - 1].steps || 1;
  const X = (s) => pad.l + ((s - x0) / Math.max(1, x1 - x0)) * W;
  ctx.fillText(`${Math.round(x0 / 1000)}k`, pad.l, h - 4);
  const right = `${Math.round(x1 / 1000)}k steps`;
  ctx.fillText(right, pad.l + W - ctx.measureText(right).width, h - 4);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => {
    const y = pad.t + H - p.success * H;
    i ? ctx.lineTo(X(p.steps), y) : ctx.moveTo(X(p.steps), y);
  });
  ctx.stroke();
}
