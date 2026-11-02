import { deflateSync } from 'node:zlib';

// Flat, seeded illustrations for each kind of site (library shelves, city skyline, campus, gallery wall...).
// They replace the earlier striped placeholder artwork. Pure JavaScript, deterministic per seed string.

const WIDTH = 480;
const HEIGHT = 640;

function rng(text) {
  let state = 2166136261;
  for (const character of String(text)) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = value => [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)];

class Canvas {
  constructor(background) {
    this.pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
    this.rect(0, 0, WIDTH, HEIGHT, background);
  }
  set(x, y, color) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const offset = (y * WIDTH + x) * 3;
    this.pixels[offset] = color[0]; this.pixels[offset + 1] = color[1]; this.pixels[offset + 2] = color[2];
  }
  rect(x, y, w, h, color, radius = 0) {
    const c = typeof color === 'string' ? hex(color) : color;
    const x0 = Math.max(0, Math.floor(x)); const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(WIDTH, Math.ceil(x + w)); const y1 = Math.min(HEIGHT, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      if (radius) {
        const dx = Math.max(x + radius - px, 0, px - (x + w - radius));
        const dy = Math.max(y + radius - py, 0, py - (y + h - radius));
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      this.set(px, py, c);
    }
  }
  circle(cx, cy, r, color, inner = 0) {
    const c = typeof color === 'string' ? hex(color) : color;
    for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d <= r * r && d >= inner * inner) this.set(px, py, c);
    }
  }
  triangle(points, color) {
    const c = typeof color === 'string' ? hex(color) : color;
    const [[ax, ay], [bx, by], [cx, cy]] = points;
    const minX = Math.floor(Math.min(ax, bx, cx)); const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy)); const maxY = Math.ceil(Math.max(ay, by, cy));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
      const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
      if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) this.set(px, py, c);
    }
  }
}

const pick = (random, values) => values[Math.floor(random() * values.length)];
const between = (random, min, max) => min + random() * (max - min);

const SCENES = {
  library(c, r) {
    const woods = ['#6b4a2f', '#5a3d27', '#7a5638'];
    const spines = ['#0b6e79', '#f2b544', '#a8412d', '#2f5d50', '#e8d9b5', '#3e4a6b', '#c97b3d', '#8c2f39', '#5b7f95'];
    c.rect(0, 0, WIDTH, HEIGHT, '#efe6d6');
    c.rect(30, 30, WIDTH - 60, HEIGHT - 60, pick(r, woods));
    for (let shelf = 0; shelf < 4; shelf++) {
      const base = 30 + (shelf + 1) * ((HEIGHT - 60) / 4) - 14;
      c.rect(44, base - 128, WIDTH - 88, 128, '#3b2a1c');
      let x = 50;
      while (x < WIDTH - 60) {
        const w = between(r, 14, 32); const h = between(r, 86, 122);
        if (x + w > WIDTH - 52) break;
        const lean = false;
        const color = pick(r, spines);
        if (lean) c.triangle([[x, base], [x + w + 18, base], [x + 18, base - h]], color);
        else {
          c.rect(x, base - h, w, h, color);
          c.rect(x, base - h + 12, w, 4, '#2b2b2b');
          c.rect(x + 3, base - h + 20, w - 6, 3, '#f5efe0');
        }
        x += w + (lean ? 20 : between(r, 1, 3));
      }
      c.rect(36, base, WIDTH - 72, 14, '#4a3322');
    }
  },
  government(c, r) {
    const sky = pick(r, ['#8fb8e0', '#9cc2e8', '#7fa9d6']);
    c.rect(0, 0, WIDTH, HEIGHT, sky);
    c.circle(380, 110, 46, '#f6f1df');
    const stone = '#f4f1ea'; const shade = '#b9b2a4';
    c.rect(170, 160, 140, 40, stone);
    c.circle(240, 205, 92, stone);
    c.rect(140, 205, 200, 40, sky);
    c.rect(150, 200, 180, 50, stone);
    c.rect(236, 92, 8, 36, '#162e51'); c.circle(240, 92, 9, '#162e51');
    c.rect(244, 60, 34, 20, '#b50909'); c.rect(244, 66, 34, 6, '#ffffff');
    c.triangle([[60, 300], [420, 300], [240, 240]], stone);
    c.rect(60, 300, 360, 18, shade);
    for (let i = 0; i < 8; i++) { c.rect(78 + i * 44, 318, 16, 170, stone); c.rect(74 + i * 44, 318, 24, 8, shade); }
    c.rect(60, 488, 360, 20, shade);
    for (let step = 0; step < 5; step++) c.rect(40 - step * 8, 508 + step * 14, 400 + step * 16, 14, step % 2 ? '#cfc8ba' : '#e2ddd2');
    c.rect(0, 578, WIDTH, 62, '#5f7d4f');
    for (let i = 0; i < 6; i++) c.circle(20 + i * 90 + between(r, -10, 10), 580, between(r, 28, 40), '#4d6b40');
  },
  municipality(c, r) {
    c.rect(0, 0, WIDTH, HEIGHT, '#cfe3f5');
    c.rect(0, 0, WIDTH, 180, '#b9d6f0');
    c.circle(between(r, 80, 400), 120, 40, '#fcb61a');
    const colors = ['#1871bd', '#0c4d84', '#091f2f', '#4a6b85', '#2d5f8a', '#7d8fa0'];
    let x = -10;
    while (x < WIDTH) {
      const w = between(r, 50, 100); const h = between(r, 180, 420);
      const color = pick(r, colors);
      c.rect(x, 560 - h, w, h, color);
      if (r() < 0.3) c.triangle([[x, 560 - h], [x + w, 560 - h], [x + w / 2, 520 - h]], color);
      for (let wy = 560 - h + 18; wy < 540; wy += 26) for (let wx = x + 10; wx < x + w - 14; wx += 18) c.rect(wx, wy, 9, 13, r() < 0.55 ? '#fff3c4' : '#9fb7cc');
      x += w + between(r, 2, 10);
    }
    c.rect(0, 560, WIDTH, 80, '#3a3f44');
    for (let i = 0; i < 6; i++) c.rect(20 + i * 84, 596, 44, 6, '#fcb61a');
    for (let i = 0; i < 4; i++) c.circle(60 + i * 120, 548, 22, '#3f7d3a');
  },
  university(c, r) {
    c.rect(0, 0, WIDTH, HEIGHT, '#e8eef3');
    const brick = pick(r, ['#8c1515', '#9a3b2b', '#7d2e24']);
    c.rect(190, 80, 100, 160, brick);
    c.triangle([[180, 80], [300, 80], [240, 20]], '#2e2d29');
    c.circle(240, 140, 26, '#f4f1ea'); c.rect(238, 122, 4, 20, '#2e2d29'); c.rect(240, 138, 16, 4, '#2e2d29');
    c.rect(40, 230, 400, 300, brick);
    c.rect(30, 214, 420, 20, '#d9cfc0');
    for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) {
      const wx = 66 + col * 62; const wy = 270 + row * 120;
      c.rect(wx, wy, 34, 62, '#f2e6c9'); c.circle(wx + 17, wy, 17, '#f2e6c9');
      c.rect(wx + 15, wy - 14, 4, 76, brick); c.rect(wx, wy + 28, 34, 4, brick);
    }
    c.rect(210, 450, 60, 80, '#2e2d29'); c.circle(240, 450, 30, '#2e2d29');
    c.rect(0, 530, WIDTH, 110, '#6f9a5a');
    c.rect(200, 530, 80, 110, '#d9cfc0');
    for (const [tx, size] of [[40, 60], [430, 70], [120, 40], [360, 46]]) { c.rect(tx - 6, 560 - size / 2, 12, size, '#5a4030'); c.circle(tx, 520 - size / 2, size * 0.75, '#3f6e3a'); }
  },
  healthcare(c, r) {
    c.rect(0, 0, WIDTH, HEIGHT, '#eef7f7');
    c.circle(240, 300, 190, '#d4ecec');
    c.rect(110, 130, 260, 330, '#ffffff', 26);
    c.rect(110, 130, 260, 60, '#00797a', 26); c.rect(110, 160, 260, 30, '#00797a');
    c.rect(212, 230, 56, 150, '#e0524a', 8); c.rect(165, 277, 150, 56, '#e0524a', 8);
    for (let i = 0; i < 3; i++) c.rect(150, 400 + i * 18, between(r, 120, 180), 8, '#cfe3e3', 4);
    c.circle(380, 470, 52, '#00797a', 40); c.rect(370, 380, 10, 60, '#00797a'); c.circle(375, 380, 12, '#10353a');
    for (let i = 0; i < 5; i++) c.circle(between(r, 30, 450), between(r, 520, 620), between(r, 6, 14), pick(r, ['#9fd3d1', '#f5c6c2', '#cfe3e3']));
  },
  documentation(c, r) {
    c.rect(0, 0, WIDTH, HEIGHT, '#e2e8f0');
    c.rect(40, 70, 400, 500, '#0f172a', 14);
    c.rect(40, 70, 400, 40, '#1e293b', 14); c.rect(40, 96, 400, 14, '#1e293b');
    for (const [i, color] of ['#f87171', '#fbbf24', '#34d399'].entries()) c.circle(68 + i * 22, 90, 7, color);
    const tokens = ['#60a5fa', '#c084fc', '#34d399', '#fbbf24', '#e2e8f0', '#94a3b8', '#f472b6'];
    let y = 136;
    let indent = 0;
    while (y < 545) {
      c.rect(56, y, 16, 8, '#334155');
      let x = 90 + indent * 22;
      const parts = 1 + Math.floor(r() * 4);
      for (let p = 0; p < parts && x < 410; p++) { const w = between(r, 24, 90); c.rect(x, y, Math.min(w, 420 - x), 9, pick(r, tokens), 3); x += w + 8; }
      indent = Math.max(0, Math.min(3, indent + pick(r, [-1, 0, 0, 1])));
      y += 22;
    }
    c.rect(300, 470, 120, 80, '#2563eb', 10); c.rect(320, 500, 80, 10, '#ffffff', 4); c.rect(320, 518, 50, 10, '#bfdbfe', 4);
  },
  museum(c, r) {
    const wall = pick(r, ['#f5f5f3', '#ecebe6', '#e9e4dc']);
    c.rect(0, 0, WIDTH, HEIGHT, wall);
    c.rect(0, 500, WIDTH, 140, '#b9ab97');
    c.rect(0, 496, WIDTH, 6, '#8d806e');
    const frames = [[70, 110, 200, 260], [300, 150, 120, 150], [300, 330, 120, 110]];
    for (const [x, y, w, h] of frames) {
      c.rect(x - 12, y - 12, w + 24, h + 24, '#111111');
      c.rect(x, y, w, h, pick(r, ['#f3efe4', '#e7dfcf', '#f8f8f6']));
      const palette = ['#c4161c', '#1d3557', '#e9c46a', '#2a9d8f', '#111111', '#f4a261'];
      for (let s = 0; s < 4; s++) {
        const kind = r();
        const color = pick(r, palette);
        if (kind < 0.4) c.circle(x + between(r, 0.2, 0.8) * w, y + between(r, 0.2, 0.8) * h, between(r, 0.1, 0.25) * Math.min(w, h), color);
        else if (kind < 0.75) c.rect(x + between(r, 0, 0.6) * w, y + between(r, 0, 0.6) * h, between(r, 0.15, 0.4) * w, between(r, 0.15, 0.4) * h, color);
        else c.triangle([[x + between(r, 0, 1) * w, y + h], [x + between(r, 0, 1) * w, y + h], [x + between(r, 0, 1) * w, y + between(r, 0, 0.5) * h]], color);
      }
    }
    c.rect(120, 440, 4, 40, '#777'); c.rect(110, 478, 24, 4, '#777');
    c.rect(150, 540, 180, 22, '#3b3b3b'); c.rect(160, 562, 10, 30, '#3b3b3b'); c.rect(310, 562, 10, 30, '#3b3b3b');
  },
  nonprofit(c, r) {
    c.rect(0, 0, WIDTH, HEIGHT, '#fff4e0');
    c.circle(240, 300, 120, '#f9c74f');
    c.circle(60, 760, 360, '#6aa84f'); c.circle(460, 780, 380, '#2e7d32');
    const skins = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#5c3a1e'];
    const shirts = ['#bf360c', '#1b5e20', '#0277bd', '#f9a825', '#6a1b9a', '#00838f'];
    for (let i = 0; i < 5; i++) {
      const x = 70 + i * 85; const y = 430 + (i % 2) * 20;
      c.rect(x - 30, y, 60, 120, pick(r, shirts), 26);
      c.circle(x, y - 26, 26, pick(r, skins));
    }
    for (let i = 0; i < 4; i++) c.rect(70 + i * 85 + 28, 470 + (i % 2) * 20, 30, 12, pick(r, skins), 6);
    for (let i = 0; i < 6; i++) c.circle(between(r, 20, 460), between(r, 40, 160), between(r, 5, 10), '#ffffff');
  },
  records(c, r) {
    c.rect(0, 0, WIDTH, HEIGHT, '#f1ebdf');
    c.rect(0, 560, WIDTH, 80, '#8b6b4a');
    const boxes = ['#c9a878', '#bf9b6a', '#d4b58a', '#b38d5c'];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
      if (row === 3 && col === 2 && r() < 0.5) continue;
      const x = 46 + col * 134 + (row % 2) * 8; const y = 430 - row * 124;
      c.rect(x, y, 124, 118, pick(r, boxes));
      c.rect(x, y, 124, 12, '#a3825a');
      c.rect(x + 34, y + 40, 56, 34, '#f8f3e8');
      c.rect(x + 42, y + 48, 40, 4, '#6d4c2f'); c.rect(x + 42, y + 58, 28, 4, '#6d4c2f');
      c.rect(x + 52, y + 88, 20, 10, '#7a5a3a', 4);
    }
    c.rect(300, 520, 140, 44, '#efe6d2'); c.rect(304, 512, 132, 10, '#e2d6bd');
    c.rect(318, 530, 90, 4, '#9b8463'); c.rect(318, 540, 60, 4, '#9b8463');
  },
  portrait(c, r) {
    const backgrounds = ['#e8eef5', '#efe7dc', '#e6f2ee', '#f3e6ea', '#ecebf6', '#f1efe2'];
    const skins = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#5c3a1e', '#a8774f'];
    const hairs = ['#1f1a17', '#3b2a20', '#6b4a2f', '#a0522d', '#d4b06a', '#8a8a8a', '#2b2b2b'];
    const tops = ['#1d3557', '#2a9d8f', '#8c1515', '#264653', '#6a4c93', '#3d5a80', '#7a5c3e', '#14532d'];
    c.rect(0, 0, WIDTH, HEIGHT, pick(r, backgrounds));
    c.circle(240, 300, 200, pick(r, ['#ffffff', '#dfe7ee', '#f6efe4']));
    const skin = pick(r, skins); const hair = pick(r, hairs); const top = pick(r, tops);
    const long = r() < 0.45;
    if (long) c.rect(140, 220, 200, 230, hair, 60);
    c.rect(70, 470, 340, 200, top, 120);
    c.triangle([[200, 470], [280, 470], [240, 540]], pick(r, ['#ffffff', '#f2f2f2', skin]));
    c.rect(210, 380, 60, 100, skin, 20);
    c.circle(240, 300, 98, skin);
    c.circle(240, 248, 100, hair);
    c.rect(140, 250, 200, 40, skin);
    c.circle(240, 310, 92, skin);
    c.rect(142, 230, 196, 30, hair, 14);
    c.circle(206, 312, 8, '#2b2b2b'); c.circle(274, 312, 8, '#2b2b2b');
    c.rect(222, 360, 36, 8, '#9b4a3a', 4);
    if (r() < 0.35) { c.circle(206, 312, 22, '#2b2b2b', 18); c.circle(274, 312, 22, '#2b2b2b', 18); c.rect(226, 308, 28, 4, '#2b2b2b'); }
  },
  news(c, r) {
    c.rect(0, 0, WIDTH, HEIGHT, '#d9d9d6');
    c.rect(50, 40, 380, 560, '#fbfaf7');
    c.rect(70, 62, 340, 30, '#121212');
    c.rect(70, 100, 340, 3, '#121212'); c.rect(70, 108, 340, 1, '#121212');
    c.rect(70, 124, 340, 22, '#c4161c');
    c.rect(70, 160, 210, 150, pick(r, ['#5b7f95', '#7a8f6a', '#8d6e63']));
    c.circle(130 + between(r, 0, 80), 230, 30, '#f4e3c1'); c.rect(70, 260, 210, 50, '#40514e');
    for (let line = 0; line < 8; line++) c.rect(296, 164 + line * 18, between(r, 80, 114), 7, '#9a9a9a');
    for (let col = 0; col < 3; col++) for (let line = 0; line < 14; line++) c.rect(70 + col * 118, 330 + line * 18, between(r, 70, 104), 7, line === 0 ? '#333333' : '#a8a8a8');
  },
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export const MEDIA_POOL = { scenes: 8, portraits: 6 };

export function hasIllustration(domain) {
  return Object.hasOwn(SCENES, domain);
}

export function illustrationPng(domain, seedText) {
  const canvas = new Canvas('#ffffff');
  SCENES[domain](canvas, rng(`${domain}:${seedText}`));
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (WIDTH * 3 + 1)] = 0;
    canvas.pixels.copy(raw, y * (WIDTH * 3 + 1) + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
