// The ward at night in 3D: walls cut away low, beds glowing by how often their patient is woken,
// sounds pulsing where they start, closed doors, acoustic ceilings, and the floor painted with
// how disruptive each spot would be for someone sleeping there.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heatColour } from './engine.js';

const WALL_H = 0.9;
const KIND_COLOUR = { alarm: 0xff8a8a, talk: 0x8fb4ff, phone: 0xf5b85b, impact: 0xffd27a, trolley: 0xc7a6ff };
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class WardScene {
  constructor(canvas, { interactive = true, spin = false } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a111d, 30, 80);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a111d, 0.9));
    const moon = new THREE.DirectionalLight(0xc9dbff, 0.9);
    moon.position.set(-10, 20, 8);
    this.scene.add(moon);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.root = new THREE.Group();
    this.pivot.add(this.root);
    this.rings = [];
    this.spin = spin && !reduced();
    if (interactive) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.maxPolarAngle = Math.PI * 0.46;
      this.controls.minDistance = 6;
      this.controls.maxDistance = 70;
      this.controls.addEventListener('change', () => this.kick());
    }
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.running = false;
  }

  resize() {
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kick();
  }

  bounds(ward) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const r of ward.rooms) {
      x0 = Math.min(x0, r.rect[0]); y0 = Math.min(y0, r.rect[1]);
      x1 = Math.max(x1, r.rect[2]); y1 = Math.max(y1, r.rect[3]);
    }
    return [x0, y0, x1, y1];
  }

  setWard(ward) {
    this.ward = ward;
    this.root.clear();
    this.rings = [];
    this.beds = new Map();
    this.sources = new Map();
    this.doors = new Map();
    this.tiles = new Map();
    const [x0, y0, x1, y1] = this.bounds(ward);
    this.size = [x1 - x0, y1 - y0];
    this.root.position.set(-(x0 + x1) / 2, 0, -(y0 + y1) / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a2740, roughness: 0.95 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4f73, roughness: 0.8 });
    for (const r of ward.rooms) {
      const [a, b, c, d] = r.rect;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(c - a, d - b), floorMat.clone());
      floor.material.color.setHex(r.kind === 'corridor' ? 0x15203a : 0x1d2b46);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((a + c) / 2, 0, (b + d) / 2);
      this.root.add(floor);
      // Walls along the edges, with a gap for the door.
      const edges = [[a, b, c, b], [c, b, c, d], [a, d, c, d], [a, b, a, d]];
      for (const [ex0, ey0, ex1, ey1] of edges) {
        const horiz = ey0 === ey1;
        let spans = [[horiz ? ex0 : ey0, horiz ? ex1 : ey1]];
        if (r.door) {
          const [dx, dy] = r.door;
          const on = horiz ? Math.abs(dy - ey0) < 1e-6 : Math.abs(dx - ex0) < 1e-6;
          if (on) {
            const m = horiz ? dx : dy;
            const half = r.doorWidth / 2;
            spans = spans.flatMap(([s, e]) => [[s, m - half], [m + half, e]].filter(([p, q]) => q - p > 0.05));
          }
        }
        for (const [s, e] of spans) {
          const len = e - s;
          const wall = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 0.12, WALL_H, horiz ? 0.12 : len), wallMat);
          wall.position.set(horiz ? (s + e) / 2 : ex0, WALL_H / 2, horiz ? ey0 : (s + e) / 2);
          this.root.add(wall);
        }
      }
      if (r.door) {
        const [dx, dy] = r.door;
        const horiz = Math.abs(dy - b) < 1e-6 || Math.abs(dy - d) < 1e-6;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(horiz ? r.doorWidth : 0.06, 2.0, horiz ? 0.06 : r.doorWidth),
          new THREE.MeshStandardMaterial({ color: 0xf5b85b, roughness: 0.6, transparent: true, opacity: 0.85 }));
        leaf.position.set(dx, 1.0, dy);
        leaf.visible = false;
        this.root.add(leaf);
        this.doors.set(r.id, leaf);
      }
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(c - a - 0.2, d - b - 0.2),
        new THREE.MeshBasicMaterial({ color: 0x5fd3c6, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      tile.rotation.x = -Math.PI / 2;
      tile.position.set((a + c) / 2, r.height, (b + d) / 2);
      tile.visible = false;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(tile.geometry), new THREE.LineBasicMaterial({ color: 0x5fd3c6 }));
      tile.add(edge);
      this.root.add(tile);
      this.tiles.set(r.id, tile);
    }
    for (const b of ward.beds) {
      const g = new THREE.Group();
      const room = ward.rooms.find((r) => r.id === b.room);
      // Beds point away from the nearest wall.
      const [a, bb, c, d] = room.rect;
      const dists = [b.at[0] - a, c - b.at[0], b.at[1] - bb, d - b.at[1]];
      const k = dists.indexOf(Math.min(...dists));
      const along = k < 2 ? 'x' : 'z';
      const bed = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 2.0 : 0.95, 0.55, along === 'x' ? 0.95 : 2.0), new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: 0.7 }));
      const off = [0.8, -0.8, 0.8, -0.8][k];
      bed.position.set(along === 'x' ? off : 0, 0.3, along === 'z' ? off : 0);
      g.add(bed);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: 0x5fd3c6, transparent: true, opacity: 0.55, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.02;
      g.add(glow);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffe2b8, emissive: 0x3a2a10 }));
      head.position.set(0, 0.68, 0);
      g.add(head);
      g.position.set(b.at[0], 0, b.at[1]);
      this.root.add(g);
      this.beds.set(b.id, { group: g, glow, head });
    }
    for (const s of ward.sources) {
      const colour = KIND_COLOUR[s.kind] ?? 0xffffff;
      const g = new THREE.Group();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: colour }));
      dot.position.y = s.bed ? 1.1 : 1.3;
      g.add(dot);
      for (let k = 0; k < 2; k++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        ring.userData = { phase: k / 2, base: s.level };
        g.add(ring);
        this.rings.push(ring);
      }
      g.position.set(s.at[0] + (s.bed ? 0.5 : 0), 0, s.at[1]);
      this.root.add(g);
      this.sources.set(s.id, { group: g, home: [...s.at], bed: !!s.bed });
    }
    this.heat = null;
    this.kick();
  }

  frame() {
    const d = Math.max(...this.size);
    this.camera.position.set(d * 0.08, d * 0.78, d * 0.72);
    this.camera.lookAt(0, 0, 0);
    if (this.controls) { this.controls.target.set(0, 0, 0); this.controls.update(); }
    this.kick();
  }

  /** closed, tiles: sets of room ids; moved: map source id -> [x, y]; quiet: map source id -> dB;
   *  wakes: map bed id -> 0..1 for the glow (null for an empty bed). */
  setState({ closed = new Set(), tiles = new Set(), moved = new Map(), quiet = new Map(), wakes = new Map() } = {}) {
    for (const [id, leaf] of this.doors) leaf.visible = closed.has(id);
    for (const [id, t] of this.tiles) t.visible = tiles.has(id);
    for (const s of this.ward.sources) {
      const src = this.sources.get(s.id);
      const at = moved.get(s.id) ?? src.home;
      src.group.position.set(at[0] + (src.bed ? 0.5 : 0), 0, at[1]);
      src.group.userData.quiet = quiet.get(s.id) ?? 0;
    }
    for (const [id, b] of this.beds) {
      const v = wakes.get(id);
      b.head.visible = v !== null && v !== undefined;
      const [r, g, bl] = heatColour(v ?? 0);
      b.glow.material.color.setRGB(r / 255, g / 255, bl / 255);
      b.glow.material.opacity = v === null || v === undefined ? 0.12 : 0.6;
    }
    this.kick();
  }

  setHeat(h, vmax) {
    if (this.heat) this.root.remove(this.heat);
    this.heat = null;
    if (h) {
      const c = document.createElement('canvas');
      c.width = h.nx;
      c.height = h.ny;
      const g = c.getContext('2d');
      const img = g.createImageData(h.nx, h.ny);
      h.values.forEach((v, k) => {
        if (!Number.isFinite(v)) return;
        const [r, gg, b] = heatColour(v / vmax);
        img.data.set([r, gg, b, 150], k * 4);
      });
      g.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(h.nx * h.cell, h.ny * h.cell), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(h.x0 + (h.nx * h.cell) / 2, 0.01, h.y0 + (h.ny * h.cell) / 2);
      this.heat = plane;
      this.root.add(plane);
    }
    this.kick();
  }

  kick() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame((t) => this.tick(t));
  }

  tick(t) {
    let again = false;
    if (this.controls) again = this.controls.update() || again;
    const still = reduced();
    for (const ring of this.rings) {
      const quiet = ring.parent.userData.quiet || 0;
      const reach = Math.max(0.6, (ring.userData.base - quiet - 40) / 8);
      const f = still ? 0.55 : ((t / 2600 + ring.userData.phase) % 1);
      ring.scale.setScalar(0.2 + f * reach);
      ring.material.opacity = 0.55 * (1 - f);
    }
    if (!still) again = true;
    if (this.spin) this.pivot.rotation.y = Math.sin(t / 12000) * 0.18;
    this.renderer.render(this.scene, this.camera);
    this.running = false;
    if (again && document.visibilityState !== 'hidden') this.kick();
    else if (again) setTimeout(() => this.kick(), 600);
  }
}
