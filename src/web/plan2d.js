// The ward from above: how disruptive each spot is for a sleeper, rooms and doors, beds coloured
// by how often their patient is woken, the sounds, and where the plan moves patients.
import { heatColour } from './engine.js';

const KIND_COLOUR = { alarm: '#ff8a8a', talk: '#8fb4ff', phone: '#f5b85b', impact: '#ffd27a', trolley: '#c7a6ff' };

export class PlanView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = {};
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setWard(ward) {
    this.ward = ward;
    this.state = {}; // the last ward's beds and sounds don't apply
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const r of ward.rooms) {
      x0 = Math.min(x0, r.rect[0]); y0 = Math.min(y0, r.rect[1]);
      x1 = Math.max(x1, r.rect[2]); y1 = Math.max(y1, r.rect[3]);
    }
    this.box = [x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5];
    this.draw();
  }

  /** heat, vmax, closed (Set), tiles (Set), moved (Map), wakes (Map bed -> 0..1|null),
   *  arrows: [[fromBedId, toBedId]] */
  set(state) {
    this.state = { ...this.state, ...state };
    this.draw();
  }

  draw() {
    if (!this.ward) return;
    const [bx0, by0, bx1, by1] = this.box;
    const W = bx1 - bx0;
    const H = by1 - by0;
    const cssW = this.canvas.clientWidth || 700;
    const s = cssW / W;
    const cssH = Math.round(H * s);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.canvas.style.height = `${cssH}px`;
    }
    const g = this.ctx;
    const px = 1 / s;
    g.setTransform(dpr * s, 0, 0, dpr * s, -bx0 * dpr * s, -by0 * dpr * s);
    g.fillStyle = '#0a111d';
    g.fillRect(bx0, by0, W, H);
    const st = this.state;
    for (const r of this.ward.rooms) {
      const [a, b, c, d] = r.rect;
      g.fillStyle = r.kind === 'corridor' ? '#15203a' : '#1d2b46';
      g.fillRect(a, b, c - a, d - b);
    }
    if (st.heat) {
      const h = st.heat;
      const off = document.createElement('canvas');
      off.width = h.nx;
      off.height = h.ny;
      const og = off.getContext('2d');
      const img = og.createImageData(h.nx, h.ny);
      h.values.forEach((v, k) => {
        if (!Number.isFinite(v)) return;
        const [r, gg, b] = heatColour(v / st.vmax);
        img.data.set([r, gg, b, 175], k * 4);
      });
      og.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(off, h.x0, h.y0, h.nx * h.cell, h.ny * h.cell);
    }
    for (const r of this.ward.rooms) {
      const [a, b, c, d] = r.rect;
      g.strokeStyle = '#6f86ad';
      g.lineWidth = 2 * px;
      g.strokeRect(a, b, c - a, d - b);
      if (st.tiles?.has(r.id)) {
        g.strokeStyle = '#5fd3c6';
        g.setLineDash([6 * px, 4 * px]);
        g.strokeRect(a + 0.15, b + 0.15, c - a - 0.3, d - b - 0.3);
        g.setLineDash([]);
      }
      if (r.door) {
        const [dx, dy] = r.door;
        const horiz = Math.abs(dy - b) < 1e-6 || Math.abs(dy - d) < 1e-6;
        const half = r.doorWidth / 2;
        g.lineWidth = 4 * px;
        g.strokeStyle = st.closed?.has(r.id) ? '#f5b85b' : '#0a111d';
        g.beginPath();
        if (horiz) { g.moveTo(dx - half, dy); g.lineTo(dx + half, dy); } else { g.moveTo(dx, dy - half); g.lineTo(dx, dy + half); }
        g.stroke();
      }
      if (c - a >= 3.5) {
        g.fillStyle = '#c9d6ea';
        g.font = `${12 * px}px "Public Sans", sans-serif`;
        g.fillText(r.name, a + 0.25, b + 0.25 + 12 * px);
      }
    }
    for (const b of this.ward.beds) {
      const v = st.wakes?.get(b.id);
      const [r, gg, bl] = heatColour(v ?? 0);
      g.beginPath();
      g.arc(b.at[0], b.at[1], 0.45, 0, Math.PI * 2);
      g.fillStyle = v === null || v === undefined ? '#33415c' : `rgb(${r},${gg},${bl})`;
      g.fill();
      g.lineWidth = 1.5 * px;
      g.strokeStyle = '#e9eef6';
      g.stroke();
    }
    for (const sdef of this.ward.sources) {
      const at = st.moved?.get(sdef.id) ?? sdef.at;
      const x = at[0] + (sdef.bed ? 0.55 : 0);
      g.beginPath();
      g.arc(x, at[1], 0.2, 0, Math.PI * 2);
      g.fillStyle = KIND_COLOUR[sdef.kind] ?? '#fff';
      g.fill();
    }
    if (st.arrows?.length) {
      const pos = new Map(this.ward.beds.map((b) => [b.id, b.at]));
      g.strokeStyle = '#f5b85b';
      g.fillStyle = '#f5b85b';
      g.lineWidth = 2 * px;
      for (const [from, to] of st.arrows) {
        const [ax, ay] = pos.get(from);
        const [cx, cy] = pos.get(to);
        const ang = Math.atan2(cy - ay, cx - ax);
        const ex = cx - Math.cos(ang) * 0.55;
        const ey = cy - Math.sin(ang) * 0.55;
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(ex, ey);
        g.stroke();
        g.beginPath();
        g.moveTo(ex, ey);
        g.lineTo(ex - Math.cos(ang - 0.4) * 0.45, ey - Math.sin(ang - 0.4) * 0.45);
        g.lineTo(ex - Math.cos(ang + 0.4) * 0.45, ey - Math.sin(ang + 0.4) * 0.45);
        g.closePath();
        g.fill();
      }
    }
  }
}
