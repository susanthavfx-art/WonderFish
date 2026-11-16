// Shared Species Definitions:
// 1) Exact 512x512 2D printable coloring sheet templates & silhouette masks
// 2) Exact 1:1 UV-mapped procedural 3D Three.js meshes & swimming vertex animations
// 3) Procedural hand-colored crayon demo textures for starter fishes & sample paper scans

import * as SkeletonUtils from '../vendor/SkeletonUtils.js';
import { CREATURE_OVERRIDES, EXTRA_CUSTOM_SPECIES } from './custom-creatures-config.js';

export const SPECIES_LIST = [
  {
    id: 'clownfish',
    name: 'Clownfish',
    sinhala: 'ක්ලවුන් මාළුවා (Clownfish)',
    emoji: '🐠',
    badgeColor: '#ff6b35',
    swimZone: 'mid',
    baseScale: 1.05
  },
  {
    id: 'angelfish',
    name: 'Reef Angelfish',
    sinhala: 'ඒන්ජල් මාළුවා (Angelfish)',
    emoji: '🐟',
    badgeColor: '#00b4d8',
    swimZone: 'mid-high',
    baseScale: 1.12
  },
  {
    id: 'bluetang',
    name: 'Blue Reef Fish',
    sinhala: 'නිල් මාළුවා (Blue Fish)',
    emoji: '🐟',
    badgeColor: '#2563eb',
    swimZone: 'high',
    baseScale: 1.06
  },
  {
    id: 'seahorse',
    name: 'Seahorse',
    sinhala: 'මුහුදු අශ්වයා (Seahorse)',
    emoji: '🪸',
    badgeColor: '#ff9f1c',
    swimZone: 'mid',
    baseScale: 1.10
  },
  {
    id: 'starfish',
    name: 'Sea Star',
    sinhala: 'මුහුදු තරුව (Starfish)',
    emoji: '⭐',
    badgeColor: '#ffbe0b',
    swimZone: 'reef',
    baseScale: 0.96
  },
  {
    id: 'crab',
    name: 'Crab',
    sinhala: 'කකුළුවා (Crab)',
    emoji: '🦀',
    badgeColor: '#f97316',
    swimZone: 'reef',
    baseScale: 0.98
  },
  ...(Array.isArray(EXTRA_CUSTOM_SPECIES) ? EXTRA_CUSTOM_SPECIES : [])
];

// Runtime caches for custom .glb models, 512x512 _template.png sheets, masks, & colored references
const cachedCreatureGltfs = new Map();
const cachedTemplateImages = new Map();
const cachedTemplateMasks = new Map();
const cachedColoredImages = new Map();
let imagesPreloadPromise = null;
let gltfsPreloadPromise = null;

function buildSilhouetteMaskFromTemplateImage(img) {
  if (typeof document === 'undefined') return null;
  const W = 512;
  const H = 512;
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0, 0, W, H);
  tctx.drawImage(img, 0, 0, W, H);
  const src = tctx.getImageData(0, 0, W, H).data;

  // Dilate dark ink barrier by 1px so anti-aliased strokes are 100% watertight against exterior flood-fill
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    const lum = (src[k] + src[k + 1] + src[k + 2]) / 3;
    if (lum < 165) dark[i] = 1;
  }
  const barrier = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (
        dark[idx] ||
        (x > 0 && dark[idx - 1]) ||
        (x + 1 < W && dark[idx + 1]) ||
        (y > 0 && dark[idx - W]) ||
        (y + 1 < H && dark[idx + W])
      ) {
        barrier[idx] = 1;
      }
    }
  }

  // BFS exterior flood-fill from all 4 border edges
  const outside = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let qHead = 0;
  let qTail = 0;
  const pushSeed = (x, y) => {
    const idx = y * W + x;
    if (!outside[idx] && !barrier[idx]) {
      outside[idx] = 1;
      queue[qTail++] = idx;
    }
  };
  for (let x = 0; x < W; x++) {
    pushSeed(x, 0);
    pushSeed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    pushSeed(0, y);
    pushSeed(W - 1, y);
  }
  while (qHead < qTail) {
    const cur = queue[qHead++];
    const cx = cur % W;
    const cy = (cur / W) | 0;
    if (cx > 0) {
      const n = cur - 1;
      if (!outside[n] && !barrier[n]) { outside[n] = 1; queue[qTail++] = n; }
    }
    if (cx + 1 < W) {
      const n = cur + 1;
      if (!outside[n] && !barrier[n]) { outside[n] = 1; queue[qTail++] = n; }
    }
    if (cy > 0) {
      const n = cur - W;
      if (!outside[n] && !barrier[n]) { outside[n] = 1; queue[qTail++] = n; }
    }
    if (cy + 1 < H) {
      const n = cur + W;
      if (!outside[n] && !barrier[n]) { outside[n] = 1; queue[qTail++] = n; }
    }
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');
  const outImg = mctx.createImageData(W, H);
  const od = outImg.data;
  for (let i = 0; i < W * H; i++) {
    if (!outside[i]) {
      const k = i * 4;
      od[k] = 255;
      od[k + 1] = 255;
      od[k + 2] = 255;
      od[k + 3] = 255;
    }
  }
  mctx.putImageData(outImg, 0, 0);
  return maskCanvas;
}

export function getCreatureOverrideConfig(speciesId) {
  const extra = (EXTRA_CUSTOM_SPECIES || []).find((s) => s.id === speciesId);
  return extra || CREATURE_OVERRIDES[speciesId] || null;
}

export function hasCustomTemplate(speciesId) {
  return cachedTemplateImages.has(speciesId);
}

export function preloadCustomCreatureAssets(GLTFLoaderClass = null) {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (!imagesPreloadPromise) {
    const imgTasks = [];
    for (const sp of SPECIES_LIST) {
      const cfg = getCreatureOverrideConfig(sp.id);
      if (!cfg) continue;

      if (cfg.templateUrl) {
        imgTasks.push(
          new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              cachedTemplateImages.set(sp.id, img);
              const maskC = buildSilhouetteMaskFromTemplateImage(img);
              if (maskC) cachedTemplateMasks.set(sp.id, maskC);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = cfg.templateUrl;
          })
        );
      }

      if (cfg.coloredUrl) {
        imgTasks.push(
          new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              cachedColoredImages.set(sp.id, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = cfg.coloredUrl;
          })
        );
      }
    }
    imagesPreloadPromise = Promise.all(imgTasks);
  }

  if (GLTFLoaderClass && !gltfsPreloadPromise) {
    const loader = new GLTFLoaderClass();
    const glbTasks = [];
    for (const sp of SPECIES_LIST) {
      const cfg = getCreatureOverrideConfig(sp.id);
      if (!cfg?.glbUrl) continue;
      glbTasks.push(
        new Promise((resolve) => {
          loader.load(
            cfg.glbUrl,
            (gltf) => {
              cachedCreatureGltfs.set(sp.id, gltf);
              resolve();
            },
            undefined,
            () => resolve()
          );
        })
      );
    }
    gltfsPreloadPromise = Promise.all(glbTasks);
  }

  return Promise.all([imagesPreloadPromise, gltfsPreloadPromise].filter(Boolean));
}

export function getSpeciesMeta(speciesId) {
  return SPECIES_LIST.find((s) => s.id === speciesId) || SPECIES_LIST[0];
}

// ============================================================================
// EXACT PARAMETRIC SILHOUETTE PROFILES IN 512x512 TEMPLATE SPACE
// ============================================================================

function clownfishProfile(tx) {
  // tx in [60, 466], center y = 256
  const xMin = 60;
  const xMax = 466;
  const u = Math.max(0, Math.min(1, (tx - xMin) / (xMax - xMin)));

  let topH = 0;
  let botH = 0;

  if (u < 0.74) {
    // Plump oval body from nose (u=0) to peduncle (u=0.74)
    const bu = u / 0.74;
    const baseOval = Math.sin(Math.pow(bu, 0.72) * Math.PI) * 96 + (1 - Math.abs(bu - 0.5) * 1.4) * 18;
    // Twin dorsal fin humps
    const d1 = bu > 0.24 && bu < 0.62 ? Math.pow(Math.sin(((bu - 0.24) / 0.38) * Math.PI), 0.85) * 42 : 0;
    const d2 = bu > 0.60 && bu < 0.95 ? Math.pow(Math.sin(((bu - 0.60) / 0.35) * Math.PI), 0.85) * 34 : 0;
    // Ventral & anal fins
    const v1 = bu > 0.30 && bu < 0.56 ? Math.pow(Math.sin(((bu - 0.30) / 0.26) * Math.PI), 0.9) * 34 : 0;
    const v2 = bu > 0.62 && bu < 0.94 ? Math.pow(Math.sin(((bu - 0.62) / 0.32) * Math.PI), 0.9) * 30 : 0;

    const peduncleFloor = bu > 0.82 ? 32 * ((bu - 0.82) / 0.18) : 0;
    topH = Math.max(baseOval + Math.max(d1, d2), peduncleFloor);
    botH = Math.max(baseOval * 0.96 + Math.max(v1, v2), peduncleFloor);
  } else {
    // Caudal rounded fan tail from u=0.74 to u=1.0
    const tu = (u - 0.74) / 0.26;
    const fan = 32 + Math.sin(Math.min(1, tu * 0.82) * (Math.PI * 0.5)) * 72;
    const roundTip = tu > 0.72 ? Math.cos(((tu - 0.72) / 0.28) * (Math.PI * 0.5)) : 1.0;
    const h = fan * Math.pow(Math.max(0, roundTip), 0.55);
    topH = h;
    botH = h;
  }
  return { topH, botH, u };
}

function angelfishProfile(tx) {
  // Tall graceful reef angelfish: tx in [66, 462], center y = 256
  const xMin = 66;
  const xMax = 462;
  const u = Math.max(0, Math.min(1, (tx - xMin) / (xMax - xMin)));

  let topH = 0;
  let botH = 0;

  if (u < 0.74) {
    const bu = u / 0.74;
    const body = Math.sin(Math.pow(bu, 0.78) * Math.PI) * 105;
    // Sweeping tall dorsal & anal fins peaking near bu = 0.62
    const dorsalSweep =
      bu > 0.22 && bu < 0.96
        ? Math.pow(Math.sin(((bu - 0.22) / 0.74) * Math.PI), 1.15) * 96
        : 0;
    const analSweep =
      bu > 0.28 && bu < 0.96
        ? Math.pow(Math.sin(((bu - 0.28) / 0.68) * Math.PI), 1.15) * 92
        : 0;
    const waist = bu > 0.84 ? 26 * ((bu - 0.84) / 0.16) : 0;
    topH = Math.max(body + dorsalSweep, waist);
    botH = Math.max(body + analSweep, waist);
  } else {
    const tu = (u - 0.74) / 0.26;
    const spread = 26 + tu * 74;
    // Gently scalloped crescent trailing edge
    const edgeClose = tu > 0.78 ? Math.cos(((tu - 0.78) / 0.22) * (Math.PI * 0.5)) : 1;
    const h = spread * Math.pow(Math.max(0, edgeClose), 0.5);
    topH = h;
    botH = h;
  }
  return { topH, botH, u };
}

function starfishRadius(theta) {
  // 5-armed sea star centered at (256, 262)
  // Rotate so top arm points straight up (-PI/2)
  const wave = Math.cos(5 * (theta + Math.PI / 2));
  const shaped = Math.pow((wave + 1) * 0.5, 1.35);
  return 88 + shaped * 118;
}

// Smooth C1-continuous Seahorse spine + curled spiral tail in 512x512 template space
function seahorseSpinePoint(t) {
  if (t <= 0.62) {
    const u = t / 0.62; // 0 (crown) -> 1 (tail entry at 262, 384)
    // Smooth S-curve control points
    const pts = [
      { x: 244, y: 80, r: 22 },
      { x: 230, y: 112, r: 37 },
      { x: 256, y: 162, r: 24 },
      { x: 222, y: 242, r: 46 },
      { x: 258, y: 326, r: 30 },
      { x: 262, y: 384, r: 22 }
    ];
    const segF = u * (pts.length - 1);
    const idx = Math.min(pts.length - 2, Math.floor(segF));
    const f = segF - idx;
    const p0 = pts[Math.max(0, idx - 1)];
    const p1 = pts[idx];
    const p2 = pts[idx + 1];
    const p3 = pts[Math.min(pts.length - 1, idx + 2)];

    const catmull = (a, b, c, d, s) =>
      0.5 *
      (2 * b +
        (-a + c) * s +
        (2 * a - 5 * b + 4 * c - d) * s * s +
        (-a + 3 * b - 3 * c + d) * s * s * s);

    return {
      x: catmull(p0.x, p1.x, p2.x, p3.x, f),
      y: catmull(p0.y, p1.y, p2.y, p3.y, f),
      r: catmull(p0.r, p1.r, p2.r, p3.r, f)
    };
  } else {
    // Inward-curling prehensile spiral tail from (262, 384) around center (210, 384)
    const s = (t - 0.62) / 0.38;
    const spiralR = 52 * (1 - 0.64 * s);
    const alpha = s * Math.PI * 1.72;
    return {
      x: 210 + Math.cos(alpha) * spiralR,
      y: 384 + Math.sin(alpha) * spiralR,
      r: 22 * (1 - 0.76 * s)
    };
  }
}

// ============================================================================
// 2D COLORING TEMPLATE RENDERER (FOR PRINTABLE SHEETS & SILHOUETTE MASKS)
// ============================================================================

export function drawCreatureSilhouette(ctx, species, size = 512, mode = 'outline') {
  // If user provided a custom 512x512 _template.png in models/creatures/, use it!
  const customImg = cachedTemplateImages.get(species);
  if (customImg) {
    ctx.save();
    if (mode === 'mask') {
      const maskC = cachedTemplateMasks.get(species);
      if (maskC) {
        ctx.drawImage(maskC, 0, 0, size, size);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
      }
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(customImg, 0, 0, size, size);
    }
    ctx.restore();
    return;
  }

  // mode: 'mask' (solid white on black/transparent), 'outline' (printable black strokes + inner pattern guides)
  const scale = size / 512;
  ctx.save();
  ctx.scale(scale, scale);

  const isMask = mode === 'mask';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (species === 'clownfish' || species === 'angelfish') {
    const profFn = species === 'clownfish' ? clownfishProfile : angelfishProfile;
    const xStart = species === 'clownfish' ? 60 : 66;
    const xEnd = species === 'clownfish' ? 466 : 462;

    ctx.beginPath();
    for (let x = xStart; x <= xEnd; x += 2) {
      const { topH } = profFn(x);
      const y = 256 - topH;
      if (x === xStart) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let x = xEnd; x >= xStart; x -= 2) {
      const { botH } = profFn(x);
      const y = 256 + botH;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    if (isMask) {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 7;
      ctx.stroke();

      // Internal decorative coloring guides
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 4.2;

      if (species === 'clownfish') {
        // 3 classic wavy clownfish stripes (clipped inside fish body!)
        ctx.save();
        ctx.clip();

        const drawBand = (cx, w, bend) => {
          for (const dx of [-w, w]) {
            ctx.beginPath();
            ctx.moveTo(cx + dx, 70);
            ctx.quadraticCurveTo(cx + dx + bend, 256, cx + dx, 440);
            ctx.stroke();
          }
        };
        drawBand(162, 16, -12);
        drawBand(258, 20, 14);
        drawBand(352, 13, -8);

        // Tail fin rays
        ctx.lineWidth = 2.6;
        for (const angle of [-0.36, -0.18, 0, 0.18, 0.36]) {
          ctx.beginPath();
          ctx.moveTo(368, 256 + angle * 45);
          ctx.lineTo(454, 256 + angle * 195);
          ctx.stroke();
        }
        ctx.restore();

        // Pectoral side fin
        ctx.beginPath();
        ctx.moveTo(188, 266);
        ctx.bezierCurveTo(242, 245, 252, 315, 192, 304);
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 4.5;
        ctx.stroke();

        // Happy mouth & friendly eye
        ctx.beginPath();
        ctx.arc(88, 268, 22, 0.15, 1.15);
        ctx.stroke();

        drawCuteEye(ctx, 114, 226, 17);
      } else {
        // Angelfish vertical reef bands & fin rays
        ctx.save();
        ctx.clip();
        for (const bx of [158, 215, 278, 332]) {
          ctx.beginPath();
          ctx.moveTo(bx + 18, 52);
          ctx.quadraticCurveTo(bx - 16, 256, bx + 18, 460);
          ctx.stroke();
        }
        ctx.lineWidth = 2.5;
        for (const dy of [-55, -28, 0, 28, 55]) {
          ctx.beginPath();
          ctx.moveTo(362, 256 + dy * 0.35);
          ctx.lineTo(450, 256 + dy * 1.25);
          ctx.stroke();
        }
        ctx.restore();

        // Pectoral fin
        ctx.beginPath();
        ctx.moveTo(178, 268);
        ctx.bezierCurveTo(232, 252, 236, 316, 180, 305);
        ctx.lineWidth = 4.5;
        ctx.stroke();

        // Smile & eye
        ctx.beginPath();
        ctx.arc(92, 265, 18, 0.1, 1.1);
        ctx.stroke();
        drawCuteEye(ctx, 118, 232, 16);
      }
    }
  } else if (species === 'turtle') {
    // Sea Turtle (Top-down: head at top, 4 flippers, domed oval carapace shell)
    const drawTurtleParts = (fillStyle, strokeStyle, lineWidth) => {
      const part = (fn) => {
        ctx.beginPath();
        fn();
        ctx.closePath();
        if (fillStyle) {
          ctx.fillStyle = fillStyle;
          ctx.fill();
        }
        if (strokeStyle) {
          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        }
      };

      // Head
      part(() => {
        ctx.ellipse(256, 94, 38, 48, 0, 0, Math.PI * 2);
      });
      // Front Left Flipper
      part(() => {
        ctx.moveTo(168, 172);
        ctx.bezierCurveTo(96, 138, 38, 182, 46, 234);
        ctx.bezierCurveTo(54, 264, 128, 242, 164, 224);
      });
      // Front Right Flipper
      part(() => {
        ctx.moveTo(344, 172);
        ctx.bezierCurveTo(416, 138, 474, 182, 466, 234);
        ctx.bezierCurveTo(458, 264, 384, 242, 348, 224);
      });
      // Rear Left Flipper
      part(() => {
        ctx.moveTo(182, 366);
        ctx.bezierCurveTo(126, 392, 108, 444, 142, 462);
        ctx.bezierCurveTo(172, 470, 202, 422, 212, 386);
      });
      // Rear Right Flipper
      part(() => {
        ctx.moveTo(330, 366);
        ctx.bezierCurveTo(386, 392, 404, 444, 370, 462);
        ctx.bezierCurveTo(340, 470, 310, 422, 300, 386);
      });
      // Cute little tail
      part(() => {
        ctx.moveTo(244, 396);
        ctx.lineTo(256, 442);
        ctx.lineTo(268, 396);
      });
      // Main Carapace Shell (drawn on top of flipper roots)
      part(() => {
        ctx.ellipse(256, 268, 112, 138, 0, 0, Math.PI * 2);
      });
    };

    if (isMask) {
      drawTurtleParts('#ffffff', '#ffffff', 4);
    } else {
      drawTurtleParts('#ffffff', '#111827', 6.5);

      // Inner shell rim & hexagonal scutes pattern for fun coloring!
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(256, 268, 88, 112, 0, 0, Math.PI * 2);
      ctx.stroke();

      const drawHex = (cx, cy, rx, ry) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + Math.PI / 6;
          const px = cx + Math.cos(a) * rx;
          const py = cy + Math.sin(a) * ry;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      };
      drawHex(256, 208, 32, 28);
      drawHex(256, 268, 34, 30);
      drawHex(256, 328, 32, 28);
      // Connecting spokes to shell rim
      const spokes = [
        [224, 194, 186, 178], [288, 194, 326, 178],
        [222, 254, 170, 248], [290, 254, 342, 248],
        [222, 290, 172, 304], [290, 290, 340, 304],
        [230, 344, 198, 366], [282, 344, 314, 366]
      ];
      ctx.lineWidth = 3.5;
      for (const [x1, y1, x2, y2] of spokes) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      // Eyes on turtle head
      drawCuteEye(ctx, 232, 76, 9);
      drawCuteEye(ctx, 280, 76, 9);
    }
  } else if (species === 'jellyfish') {
    // Glowing Jellyfish: Dome bell (y: 54..248) + 7 wide flowing ribbon tentacles (y: 236..466)
    const tentacleXs = [132, 173, 214, 256, 298, 339, 380];

    const drawTentacles = (fill, stroke, lw) => {
      for (let i = 0; i < tentacleXs.length; i++) {
        const bx = tentacleXs[i];
        const phase = (i % 2 === 0 ? 1 : -1) * 16;
        ctx.beginPath();
        ctx.moveTo(bx - 16, 232);
        ctx.bezierCurveTo(bx - 16 + phase, 305, bx - 14 - phase, 385, bx - 9 + phase * 0.4, 462);
        ctx.arc(bx + phase * 0.4, 462, 9, Math.PI, 0, true);
        ctx.bezierCurveTo(bx + 14 - phase, 385, bx + 16 + phase, 305, bx + 16, 232);
        ctx.closePath();
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
      }
    };

    const drawBell = (fill, stroke, lw) => {
      ctx.beginPath();
      ctx.moveTo(96, 232);
      ctx.bezierCurveTo(92, 102, 168, 52, 256, 52);
      ctx.bezierCurveTo(344, 52, 420, 102, 416, 232);
      // Scalloped cute bottom edge (6 scallops across 416 -> 96)
      const scallops = 6;
      const step = (416 - 96) / scallops;
      for (let s = 0; s < scallops; s++) {
        const sx1 = 416 - s * step;
        const sx2 = sx1 - step;
        ctx.quadraticCurveTo((sx1 + sx2) * 0.5, 256, sx2, 232);
      }
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    };

    if (isMask) {
      drawTentacles('#ffffff', '#ffffff', 6);
      drawBell('#ffffff', '#ffffff', 6);
    } else {
      drawTentacles('#ffffff', '#111827', 5.5);
      drawBell('#ffffff', '#111827', 7);

      // Decorative bell segments & spots for kids to color
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 3.2;
      for (const offset of [-85, -35, 35, 85]) {
        ctx.beginPath();
        ctx.moveTo(256 + offset * 0.22, 56);
        ctx.quadraticCurveTo(256 + offset * 1.15, 138, 256 + offset * 1.35, 234);
        ctx.stroke();
      }
      // Cute spots & happy Kawaii face on bell
      for (const [sx, sy, sr] of [[152, 134, 14], [360, 134, 14], [202, 102, 10], [310, 102, 10]]) {
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawCuteEye(ctx, 216, 182, 14);
      drawCuteEye(ctx, 296, 182, 14);
      ctx.beginPath();
      ctx.arc(256, 192, 18, 0.2, Math.PI - 0.2);
      ctx.lineWidth = 4.2;
      ctx.stroke();
    }
  } else if (species === 'starfish') {
    // 5-Pointed Plump Sea Star
    ctx.beginPath();
    const steps = 180;
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const r = starfishRadius(theta);
      const px = 256 + Math.cos(theta) * r;
      const py = 262 + Math.sin(theta) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    if (isMask) {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 7;
      ctx.stroke();

      // Decorative circles along the 5 arms + happy face
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 3.5;
      for (let arm = 0; arm < 5; arm++) {
        const angle = -Math.PI / 2 + (arm * Math.PI * 2) / 5;
        for (const [dist, rad] of [[95, 12], [134, 10], [168, 7.5]]) {
          ctx.beginPath();
          ctx.arc(256 + Math.cos(angle) * dist, 262 + Math.sin(angle) * dist, rad, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      drawCuteEye(ctx, 230, 248, 13);
      drawCuteEye(ctx, 282, 248, 13);
      ctx.beginPath();
      ctx.arc(256, 266, 20, 0.2, Math.PI - 0.2);
      ctx.lineWidth = 4.2;
      ctx.stroke();
    }
  } else if (species === 'seahorse') {
    // 1. Dorsal fin (back right of torso)
    ctx.beginPath();
    ctx.moveTo(264, 198);
    ctx.bezierCurveTo(334, 200, 344, 236, 326, 250);
    ctx.bezierCurveTo(346, 266, 330, 298, 258, 292);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (!isMask) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 6.5;
      ctx.stroke();
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 2.6;
      for (const fy of [218, 236, 254, 272]) {
        ctx.beginPath();
        ctx.moveTo(266, fy + (fy - 245) * 0.25);
        ctx.lineTo(324, fy);
        ctx.stroke();
      }
    }

    // 2. Spiky Coronet Crown on top of head
    ctx.beginPath();
    ctx.moveTo(222, 82);
    ctx.lineTo(226, 48);
    ctx.lineTo(242, 68);
    ctx.lineTo(256, 44);
    ctx.lineTo(264, 68);
    ctx.lineTo(282, 54);
    ctx.lineTo(268, 88);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (!isMask) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 6.5;
      ctx.stroke();
    }

    // 3. Trumpet Snout (facing Left)
    ctx.beginPath();
    ctx.moveTo(216, 94);
    ctx.bezierCurveTo(186, 102, 162, 106, 140, 100);
    ctx.bezierCurveTo(130, 104, 130, 132, 142, 136);
    ctx.bezierCurveTo(164, 128, 188, 128, 218, 134);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (!isMask) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 6.5;
      ctx.stroke();
    }

    // 4. S-Curved Seahorse Body + Prehensile Spiral Tail Ribbon
    const N = 90;
    const leftPts = [];
    const rightPts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = seahorseSpinePoint(t);
      const pNext = seahorseSpinePoint(Math.min(1, t + 0.01));
      const pPrev = seahorseSpinePoint(Math.max(0, t - 0.01));
      const dx = pNext.x - pPrev.x;
      const dy = pNext.y - pPrev.y;
      const len = Math.hypot(dx, dy) || 1;
      // Normal vector pointing left vs right of spine tangent
      const nx = -dy / len;
      const ny = dx / len;
      leftPts.push({ x: p.x + nx * p.r, y: p.y + ny * p.r });
      rightPts.push({ x: p.x - nx * p.r, y: p.y - ny * p.r });
    }

    ctx.beginPath();
    // Smooth top-of-head cap
    const topC = seahorseSpinePoint(0);
    ctx.moveTo(leftPts[0].x, leftPts[0].y);
    ctx.quadraticCurveTo(topC.x, topC.y - topC.r * 1.15, rightPts[0].x, rightPts[0].y);
    for (let i = 1; i <= N; i++) {
      ctx.lineTo(rightPts[i].x, rightPts[i].y);
    }
    const tipC = seahorseSpinePoint(1);
    ctx.quadraticCurveTo(tipC.x, tipC.y, leftPts[N].x, leftPts[N].y);
    for (let i = N - 1; i >= 0; i--) {
      ctx.lineTo(leftPts[i].x, leftPts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    if (!isMask) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 7;
      ctx.stroke();

      // Cute armored belly ridge rings for kids to color like rainbow stripes!
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 2.8;
      for (let i = 16; i <= 82; i += 6) {
        ctx.beginPath();
        ctx.moveTo(leftPts[i].x, leftPts[i].y);
        ctx.quadraticCurveTo(
          (leftPts[i].x + rightPts[i].x) * 0.5,
          (leftPts[i].y + rightPts[i].y) * 0.5 + 5,
          rightPts[i].x,
          rightPts[i].y
        );
        ctx.stroke();
      }

      // Cheek gill swirl
      ctx.beginPath();
      ctx.arc(248, 118, 12, -0.6, Math.PI * 0.85);
      ctx.stroke();

      drawCuteEye(ctx, 214, 108, 13.5);
    }
  } else {
    // Fallback outline for custom EXTRA_CUSTOM_SPECIES before a _template.png is dropped in
    ctx.restore();
    drawCreatureSilhouette(ctx, 'clownfish', size, mode);
    return;
  }

  ctx.restore();
}

function drawCuteEye(ctx, x, y, r) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = Math.max(3, r * 0.24);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(x - r * 0.12, y, r * 0.56, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.26, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Re-draw just the clean cute eyes on top of scanned textures if desired
export function drawEyeOverlayOnly(ctx, species, size = 512) {
  if (hasCustomTemplate(species)) return;
  const s = size / 512;
  ctx.save();
  ctx.scale(s, s);
  if (species === 'clownfish') drawCuteEye(ctx, 114, 226, 17);
  else if (species === 'angelfish') drawCuteEye(ctx, 118, 232, 16);
  else if (species === 'seahorse') drawCuteEye(ctx, 214, 108, 13.5);
  else if (species === 'turtle') {
    drawCuteEye(ctx, 232, 76, 9);
    drawCuteEye(ctx, 280, 76, 9);
  } else if (species === 'jellyfish') {
    drawCuteEye(ctx, 216, 182, 14);
    drawCuteEye(ctx, 296, 182, 14);
  } else if (species === 'starfish') {
    drawCuteEye(ctx, 230, 248, 13);
    drawCuteEye(ctx, 282, 248, 13);
  }
  ctx.restore();
}

// ============================================================================
// CUSTOM BLENDER .GLB CREATURE BUILDER (SUPPORTS RIGGED OR STATIC .GLB)
// ============================================================================

export function buildCustomGlbCreatureMesh(THREE, gltf, species, texture, overrideCfg = {}) {
  const group = new THREE.Group();
  group.userData.species = species;
  group.userData.isCustomGlb = true;
  group.userData.animParts = { waveMeshes: [] };

  // glTF 2.0 UV convention expects flipY = false so top-left (0,0) of the 512x512
  // paper coloring sheet maps right-side-up onto Blender's UV [0..1, 0..1] space!
  const gltfTex = texture.clone();
  gltfTex.flipY = false;
  gltfTex.colorSpace = THREE.SRGBColorSpace;
  gltfTex.needsUpdate = true;

  const clonedRoot = SkeletonUtils.clone(gltf.scene);
  clonedRoot.updateMatrixWorld(true);

  // Normalize bounding box size & center accurately even for 0.01-scale Maya/FBX rigs!
  const rawBox = new THREE.Box3().setFromObject(clonedRoot);
  const rawSize = new THREE.Vector3();
  rawBox.getSize(rawSize);

  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z, 0.001);
  const targetSize = overrideCfg.targetSize || 2.5;
  const normScale = targetSize / maxDim;

  clonedRoot.scale.multiplyScalar(normScale);
  clonedRoot.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(clonedRoot);
  const scaledCenter = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);
  clonedRoot.position.sub(scaledCenter);

  const orientPivot = new THREE.Group();
  orientPivot.add(clonedRoot);

  const rotY = ((overrideCfg.facingOffsetDegY ?? 180) * Math.PI) / 180;
  const rotX = ((overrideCfg.tiltOffsetDegX ?? 0) * Math.PI) / 180;
  orientPivot.rotation.set(rotX, rotY, 0);
  group.add(orientPivot);

  const hasClips = Array.isArray(gltf.animations) && gltf.animations.length > 0;
  const useAutoWave = !hasClips && overrideCfg.autoSwimWave !== false;

  const isJelly = species === 'jellyfish';

  // ---------------------------------------------------------------------------
  // PAPER CUT-OUT RENDERING (overrideCfg.flatLight)
  // ---------------------------------------------------------------------------
  // The new Blender rigs (clownfish / bluetang / crab) are "paper cut-out" shells whose
  // stored normals and triangle winding are inconsistent: half of the visible surface ends
  // up facing away from the tank lights, so it only catches the teal reef glow and turns
  // dark green while the other half stays bright ("one side looks dark" bug).
  // flatLight species therefore skip the lighting model and show the crayon texture as-is
  // (distance fog still applies), so the colours match the printed sheet everywhere.
  const flatLight = overrideCfg.flatLight === true;
  const scannedMat = flatLight
    ? new THREE.MeshBasicMaterial({
        map: gltfTex,
        color: new THREE.Color(overrideCfg.flatLightTint ?? 0xe8f4ff),
        side: THREE.DoubleSide,
        transparent: isJelly,
        opacity: isJelly ? 0.93 : 1.0
      })
    : new THREE.MeshStandardMaterial({
        map: gltfTex,
        roughness: isJelly ? 0.25 : 0.48,
        metalness: 0.04,
        emissive: isJelly ? new THREE.Color(0x3a1860) : new THREE.Color(0x091826),
        emissiveMap: gltfTex,
        emissiveIntensity: isJelly ? 0.34 : 0.14,
        transparent: isJelly,
        opacity: isJelly ? 0.93 : 1.0,
        side: THREE.DoubleSide
      });

  clonedRoot.traverse((child) => {
    if (!child.isMesh) return;
    // Clone geometry if we plan to apply procedural vertex wave so instances stay independent
    if (useAutoWave && !child.isSkinnedMesh && child.geometry?.attributes?.position) {
      child.geometry = child.geometry.clone();
      const posAttr = child.geometry.attributes.position;
      const gBox = new THREE.Box3().setFromBufferAttribute(posAttr);
      const spanX = Math.max(gBox.max.x - gBox.min.x, 0.001);
      const spanY = Math.max(gBox.max.y - gBox.min.y, 0.001);
      const span = Math.max(spanX, spanY, gBox.max.z - gBox.min.z, 0.001);
      const swimStyle = overrideCfg.swimStyle || (species === 'starfish' ? 'starfish' : species === 'seahorse' ? 'seahorse' : 'fish');
      const facesLeftInMesh = Math.abs((overrideCfg.facingOffsetDegY ?? 0) - 180) < 45;

      const base = new Float32Array(posAttr.count * 4);
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const vz = posAttr.getZ(i);
        base[i * 4] = vx;
        base[i * 4 + 1] = vy;
        base[i * 4 + 2] = vz;

        if (swimStyle === 'fish') {
          // u = 0 at nose -> 1 at tail tip!
          base[i * 4 + 3] = facesLeftInMesh
            ? (vx - gBox.min.x) / spanX
            : (gBox.max.x - vx) / spanX;
        } else if (swimStyle === 'seahorse') {
          // u = 0 at head/crown -> 1 at curled tail; add +10 flag if vertex is on back dorsal fan fin!
          const uSpine = (gBox.max.y - vy) / spanY;
          const xBack = facesLeftInMesh ? (vx - gBox.min.x) / spanX : (gBox.max.x - vx) / spanX;
          const isDorsalFin = xBack > 0.62 && uSpine > 0.42 && uSpine < 0.78;
          base[i * 4 + 3] = isDorsalFin ? 10.0 + (xBack - 0.62) / 0.38 : uSpine;
        } else {
          // Radial distance from center for starfish arm flexing
          base[i * 4 + 3] = Math.min(1.0, Math.hypot(vx, vy) / (span * 0.5));
        }
      }
      child.geometry.userData.basePositions = base;
      child.geometry.userData.swimStyle = swimStyle;
      child.geometry.userData.waveAmp = span * 0.105;
      group.userData.animParts.waveMeshes.push(child);
    }

    // Preserve materials explicitly named "Keep*" or "Eye*" or "Glass*"; apply scanned paper UV map to everything else
    const matName = child.material?.name || '';
    if (!/^(keep|eye|glass)/i.test(matName)) {
      child.material = scannedMat;
    }
    child.castShadow = true;
    child.frustumCulled = false; // Prevent scaled Maya/Blender SkinnedMeshes from culling prematurely
  });

  if (hasClips) {
    const mixer = new THREE.AnimationMixer(clonedRoot);
    for (const clip of gltf.animations) {
      mixer.clipAction(clip).play();
    }
    mixer.update(Math.random() * 1.2);
    group.userData.mixer = mixer;
    // Per-species clip tempo (crabs & bottom dwellers idle slowly, fish at 1.0)
    group.userData.clipSpeed = overrideCfg.clipSpeed ?? 1.0;
    group.userData.lastAnimTime = null;
  }

  return group;
}

// ============================================================================
// 3D PROCEDURAL MESH BUILDER WITH EXACT 1:1 TEMPLATE UV PROJECTION
// ============================================================================

export function buildCreatureMesh(THREE, species, texture) {
  // 1. Check if user dropped a custom Blender .glb model for this species!
  const customGltf = cachedCreatureGltfs.get(species);
  if (customGltf) {
    const cfg = getCreatureOverrideConfig(species) || {};
    return buildCustomGlbCreatureMesh(THREE, customGltf, species, texture, cfg);
  }

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const group = new THREE.Group();
  group.userData.species = species;
  group.userData.animParts = {};

  const isJelly = species === 'jellyfish';
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: isJelly ? 0.22 : 0.48,
    metalness: 0.04,
    emissive: isJelly ? new THREE.Color(0x3a1860) : new THREE.Color(0x091826),
    emissiveMap: texture,
    emissiveIntensity: isJelly ? 0.36 : 0.14,
    transparent: isJelly,
    opacity: isJelly ? 0.93 : 1.0,
    side: THREE.DoubleSide
  });

  if (species === 'clownfish' || species === 'angelfish') {
    const profFn = species === 'clownfish' ? clownfishProfile : angelfishProfile;
    const xStart = species === 'clownfish' ? 60 : 66;
    const xEnd = species === 'clownfish' ? 466 : 462;
    const bodyGeom = buildLoftedProfileGeometry(THREE, profFn, xStart, xEnd, {
      nu: 58,
      nv: 28,
      maxThick: species === 'clownfish' ? 0.34 : 0.22
    });
    const bodyMesh = new THREE.Mesh(bodyGeom, mat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);
    group.userData.animParts.spineMesh = bodyMesh;

    // Two articulated 3D pectoral side fins mapped directly to the template's pectoral fin region!
    const pecGeomL = buildPectoralFinGeometry(THREE, 182, 286, 62, 34, 1);
    const pecGeomR = buildPectoralFinGeometry(THREE, 182, 286, 62, 34, -1);
    const pecL = new THREE.Mesh(pecGeomL, mat);
    const pecR = new THREE.Mesh(pecGeomR, mat);

    const attachX = (256 - 186) / 155;
    const attachY = (256 - 284) / 155;
    const attachZ = species === 'clownfish' ? 0.27 : 0.18;

    pecL.position.set(attachX, attachY, attachZ);
    pecR.position.set(attachX, attachY, -attachZ);
    group.add(pecL, pecR);
    group.userData.animParts.pecL = pecL;
    group.userData.animParts.pecR = pecR;
  } else if (species === 'turtle') {
    // Top-down template -> 3D horizontal swimming turtle (+X forward, +Y up, +-Z left/right)
    // Template: Head at (256, 94), Shell at (256, 268), Flippers at left/right!
    // Map template (tx, ty) -> local 3D: forward X = (268 - ty)/145, lateral Z = (tx - 256)/145
    const shellGeom = buildEllipsoidPatch(THREE, 256, 268, 112, 138, 0.42, -0.16);
    const shellMesh = new THREE.Mesh(shellGeom, mat);
    group.add(shellMesh);

    const headGeom = buildEllipsoidPatch(THREE, 256, 94, 38, 48, 0.20, -0.14);
    const headPivot = new THREE.Group();
    const headOriginX = (268 - 134) / 145;
    headPivot.position.set(headOriginX, 0.02, 0);
    headGeom.translate(-headOriginX, -0.02, 0);
    const headMesh = new THREE.Mesh(headGeom, mat);
    headPivot.add(headMesh);
    group.add(headPivot);

    // 4 Articulated 3D Flippers
    const flFrontL = buildTurtleFlipper(THREE, mat, 164, 198, -118, 22, 34);
    const flFrontR = buildTurtleFlipper(THREE, mat, 348, 198, 118, 22, 34);
    const flRearL = buildTurtleFlipper(THREE, mat, 196, 376, -62, 82, 24);
    const flRearR = buildTurtleFlipper(THREE, mat, 316, 376, 62, 82, 24);

    group.add(flFrontL, flFrontR, flRearL, flRearR);
    group.userData.animParts = { headPivot, flFrontL, flFrontR, flRearL, flRearR };
  } else if (species === 'jellyfish') {
    // 3D Pulsing Dome Bell + 7 Wavy 3D Ribbon Tentacles
    const bellGeom = buildJellyBellGeometry(THREE);
    const bellMesh = new THREE.Mesh(bellGeom, mat);
    group.add(bellMesh);

    const tentacleXs = [132, 173, 214, 256, 298, 339, 380];
    const tentacles = [];
    for (let i = 0; i < tentacleXs.length; i++) {
      const angle = (i / tentacleXs.length) * Math.PI * 2;
      const ringR = i === 3 ? 0.08 : 0.48;
      const tGeom = buildJellyTentacleGeometry(THREE, tentacleXs[i], i);
      const tMesh = new THREE.Mesh(tGeom, mat);
      tMesh.position.set(Math.cos(angle) * ringR, 0.08, Math.sin(angle) * ringR);
      tMesh.rotation.y = -angle + Math.PI * 0.5;
      group.add(tMesh);
      tentacles.push(tMesh);
    }
    group.userData.animParts = { bellMesh, tentacles };
  } else if (species === 'starfish') {
    const starGeom = buildStarfishGeometry(THREE);
    const starMesh = new THREE.Mesh(starGeom, mat);
    group.add(starMesh);
    group.userData.animParts = { starMesh };
  } else if (species === 'seahorse') {
    const { bodyMesh, snoutMesh, crownMesh, dorsalPivot } = buildSeahorseParts(THREE, mat);
    group.add(bodyMesh, snoutMesh, crownMesh, dorsalPivot);
    group.userData.animParts = { bodyMesh, dorsalPivot };
  } else {
    // Fallback procedural 3D mesh for custom species before a .glb is uploaded
    const bodyGeom = buildLoftedProfileGeometry(THREE, clownfishProfile, 60, 466, {
      nu: 54,
      nv: 26,
      maxThick: 0.32
    });
    const bodyMesh = new THREE.Mesh(bodyGeom, mat);
    group.add(bodyMesh);
    group.userData.animParts.spineMesh = bodyMesh;
  }

  return group;
}

// Helper: Build smooth watertight double-sided lofted 3D fish geometry from 2D profile
function buildLoftedProfileGeometry(THREE, profFn, xStart, xEnd, { nu = 56, nv = 26, maxThick = 0.32 }) {
  const scale = 1 / 155;
  const positions = [];
  const basePositions = [];
  const uvs = [];
  const indices = [];

  // Build front (+Z) and back (-Z) grids sharing perimeter seam cleanly
  const cols = nu + 1;
  const rows = nv + 1;

  const addGrid = (zSign) => {
    const offset = positions.length / 3;
    for (let i = 0; i <= nu; i++) {
      const uNorm = i / nu;
      const tx = xStart + uNorm * (xEnd - xStart);
      const { topH, botH } = profFn(tx);

      // Longitudinal thickness envelope (plump torso, thin fins & tail)
      let xThick = 0.035;
      if (uNorm < 0.75) {
        const bu = uNorm / 0.75;
        xThick = Math.sin(Math.pow(bu, 0.65) * Math.PI) * maxThick + 0.025;
      } else {
        const tu = (uNorm - 0.75) / 0.25;
        xThick = (1 - tu) * 0.055 + 0.014;
      }

      for (let j = 0; j <= nv; j++) {
        const vSym = (j / nv) * 2 - 1; // -1 (top dorsal edge) .. +1 (bottom ventral edge)
        const ty = 256 + (vSym < 0 ? vSym * topH : vSym * botH);

        // Cross-sectional inflation: plump around spine (|vSym| < 0.65), sleek along fin margins
        const cross = Math.sqrt(Math.max(0, 1 - vSym * vSym));
        const coreBoost = Math.exp(-vSym * vSym * 3.2) * 0.65 + 0.35;
        const z = zSign * xThick * cross * coreBoost;

        const px = (256 - tx) * scale; // +X is nose forward!
        const py = (256 - ty) * scale; // +Y is dorsal up!

        positions.push(px, py, z);
        basePositions.push(px, py, z, uNorm);
        uvs.push(tx / 512, 1 - ty / 512);
      }
    }

    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = offset + i * rows + j;
        const b = offset + (i + 1) * rows + j;
        const c = offset + (i + 1) * rows + (j + 1);
        const d = offset + i * rows + (j + 1);
        if (zSign > 0) {
          indices.push(a, d, b, b, d, c);
        } else {
          indices.push(a, b, d, b, c, d);
        }
      }
    }
  };

  addGrid(1);
  addGrid(-1);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.userData.basePositions = new Float32Array(basePositions);
  return geom;
}

function buildPectoralFinGeometry(THREE, baseTx, baseTy, lenPx, heightPx, zSide) {
  const nu = 10;
  const nv = 8;
  const positions = [];
  const uvs = [];
  const indices = [];
  const scale = 1 / 155;

  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const h = Math.sin(Math.pow(u, 0.55) * Math.PI) * heightPx * 0.55 + (1 - u) * 8;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      const tx = baseTx + u * lenPx;
      const ty = baseTy + v * h;
      const px = -u * lenPx * scale * 0.85;
      const py = -v * h * scale - u * 0.06;
      const pz = zSide * (u * 0.24 + Math.sin(u * Math.PI) * 0.05);
      positions.push(px, py, pz);
      uvs.push(tx / 512, 1 - ty / 512);
    }
  }
  const rows = nv + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * rows + j;
      const b = (i + 1) * rows + j;
      const c = (i + 1) * rows + (j + 1);
      const d = i * rows + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Sea Turtle 3D domed shell & head builder mapped directly to top-down template
function buildEllipsoidPatch(THREE, cx, cy, rx, ry, topHeight, botDepth) {
  const nTheta = 36;
  const nR = 14;
  const scale = 1 / 145;
  const positions = [];
  const uvs = [];
  const indices = [];

  const buildSide = (yHeight, flip) => {
    const offset = positions.length / 3;
    for (let ir = 0; ir <= nR; ir++) {
      const rNorm = ir / nR;
      const dome = Math.sqrt(Math.max(0, 1 - rNorm * rNorm));
      for (let it = 0; it <= nTheta; it++) {
        const theta = (it / nTheta) * Math.PI * 2;
        const tx = cx + Math.cos(theta) * rx * rNorm;
        const ty = cy + Math.sin(theta) * ry * rNorm;

        const px = (268 - ty) * scale;
        const py = yHeight * dome;
        const pz = (tx - 256) * scale;

        positions.push(px, py, pz);
        uvs.push(tx / 512, 1 - ty / 512);
      }
    }
    const cols = nTheta + 1;
    for (let ir = 0; ir < nR; ir++) {
      for (let it = 0; it < nTheta; it++) {
        const a = offset + ir * cols + it;
        const b = offset + (ir + 1) * cols + it;
        const c = offset + (ir + 1) * cols + (it + 1);
        const d = offset + ir * cols + (it + 1);
        if (!flip) indices.push(a, b, d, b, c, d);
        else indices.push(a, d, b, b, d, c);
      }
    }
  };

  buildSide(topHeight, false);
  buildSide(botDepth, true);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function buildTurtleFlipper(THREE, mat, rootTx, rootTy, tipDx, tipDy, widthPx) {
  const nu = 12;
  const nv = 8;
  const scale = 1 / 145;
  const positions = [];
  const uvs = [];
  const indices = [];

  const rootX = (268 - rootTy) * scale;
  const rootZ = (rootTx - 256) * scale;

  const addSide = (ySign) => {
    const offset = positions.length / 3;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const w = Math.sin(Math.pow(u, 0.55) * Math.PI) * widthPx + (1 - u) * (widthPx * 0.45);
      // Perpendicular normal in template plane
      const len = Math.hypot(tipDx, tipDy) || 1;
      const nx = -tipDy / len;
      const ny = tipDx / len;

      for (let j = 0; j <= nv; j++) {
        const v = (j / nv) * 2 - 1;
        const tx = rootTx + tipDx * u + nx * v * w;
        const ty = rootTy + tipDy * u + ny * v * w;
        const thick = ySign * 0.055 * (1 - u * 0.7) * Math.sqrt(Math.max(0, 1 - v * v));

        const px = (268 - ty) * scale - rootX;
        const py = thick;
        const pz = (tx - 256) * scale - rootZ;

        positions.push(px, py, pz);
        uvs.push(tx / 512, 1 - ty / 512);
      }
    }
    const rows = nv + 1;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = offset + i * rows + j;
        const b = offset + (i + 1) * rows + j;
        const c = offset + (i + 1) * rows + (j + 1);
        const d = offset + i * rows + (j + 1);
        if (ySign > 0) indices.push(a, b, d, b, c, d);
        else indices.push(a, d, b, b, d, c);
      }
    }
  };

  addSide(1);
  addSide(-1);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const pivot = new THREE.Group();
  pivot.position.set(rootX, -0.04, rootZ);
  pivot.add(new THREE.Mesh(geom, mat));
  return pivot;
}

// Jellyfish 3D Dome Bell + Flowing Tentacles
function buildJellyBellGeometry(THREE) {
  const nSeg = 40;
  const nRing = 18;
  const positions = [];
  const basePositions = [];
  const uvs = [];
  const indices = [];

  for (let ir = 0; ir <= nRing; ir++) {
    const v = ir / nRing; // 0 = crown top (ty=54), 1 = scalloped rim (ty=238)
    const thetaLat = v * (Math.PI * 0.54);
    const radius = Math.sin(thetaLat) * 0.92;

    for (let is = 0; is <= nSeg; is++) {
      const phi = (is / nSeg) * Math.PI * 2;
      const scallop = v > 0.8 ? Math.sin(phi * 6) * 0.045 * ((v - 0.8) / 0.2) : 0;
      const px = Math.cos(phi) * radius;
      const py = Math.cos(thetaLat) * 0.95 + scallop;
      const pz = Math.sin(phi) * radius;

      // Map smoothly across template bell (tx: 98..414, ty: 54..238)
      const horizMirror = Math.cos(phi); // -1..+1 wraps cleanly front & back!
      const tx = 256 + horizMirror * v * 156;
      const ty = 54 + v * 184;

      positions.push(px, py, pz);
      basePositions.push(px, py, pz, v);
      uvs.push(tx / 512, 1 - ty / 512);
    }
  }

  const cols = nSeg + 1;
  for (let ir = 0; ir < nRing; ir++) {
    for (let is = 0; is < nSeg; is++) {
      const a = ir * cols + is;
      const b = (ir + 1) * cols + is;
      const c = (ir + 1) * cols + (is + 1);
      const d = ir * cols + (is + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.userData.basePositions = new Float32Array(basePositions);
  return geom;
}

function buildJellyTentacleGeometry(THREE, centerTx, index) {
  const nSegY = 20;
  const positions = [];
  const basePositions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= nSegY; i++) {
    const v = i / nSegY; // 0 = top (ty=236), 1 = tip (ty=462)
    const halfW = (1 - v * 0.45) * 0.12;
    const py = -v * 1.55;
    const ty = 236 + v * 226;

    for (let j = 0; j <= 2; j++) {
      const s = j - 1; // -1, 0, +1
      const px = s * halfW;
      const pz = (1 - Math.abs(s)) * 0.03; // slight 3D curvature
      const tx = centerTx + s * 15;
      positions.push(px, py, pz);
      basePositions.push(px, py, pz, v);
      uvs.push(tx / 512, 1 - ty / 512);
    }
  }

  for (let i = 0; i < nSegY; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      const b = (i + 1) * 3 + j;
      const c = (i + 1) * 3 + (j + 1);
      const d = i * 3 + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.userData.basePositions = new Float32Array(basePositions);
  geom.userData.phaseOffset = index * 0.9;
  return geom;
}

// 5-Pointed 3D Sea Star Geometry
function buildStarfishGeometry(THREE) {
  const nTheta = 100;
  const nR = 14;
  const scale = 1 / 160;
  const positions = [];
  const basePositions = [];
  const uvs = [];
  const indices = [];

  const addSide = (zSign) => {
    const offset = positions.length / 3;
    for (let ir = 0; ir <= nR; ir++) {
      const rNorm = ir / nR;
      for (let it = 0; it <= nTheta; it++) {
        const theta = (it / nTheta) * Math.PI * 2;
        const R = starfishRadius(theta);
        const tx = 256 + Math.cos(theta) * R * rNorm;
        const ty = 262 + Math.sin(theta) * R * rNorm;

        // Raised 3D arm spine ridge
        const armRidge = (Math.cos(5 * (theta + Math.PI / 2)) + 1) * 0.5;
        const prof = Math.sqrt(Math.max(0, 1 - rNorm * rNorm));
        const thick = (zSign > 0 ? 0.28 : -0.12) * prof * (0.68 + armRidge * 0.32);

        const px = (tx - 256) * scale;
        const py = (262 - ty) * scale;
        const pz = thick;

        positions.push(px, py, pz);
        basePositions.push(px, py, pz, rNorm);
        uvs.push(tx / 512, 1 - ty / 512);
      }
    }
    const cols = nTheta + 1;
    for (let ir = 0; ir < nR; ir++) {
      for (let it = 0; it < nTheta; it++) {
        const a = offset + ir * cols + it;
        const b = offset + (ir + 1) * cols + it;
        const c = offset + (ir + 1) * cols + (it + 1);
        const d = offset + ir * cols + (it + 1);
        if (zSign > 0) indices.push(a, d, b, b, d, c);
        else indices.push(a, b, d, b, c, d);
      }
    }
  };

  addSide(1);
  addSide(-1);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.userData.basePositions = new Float32Array(basePositions);
  return geom;
}

// 3D Sculpted Upright Seahorse (S-Curved Tubular Body + Spiral Tail + Trumpet Snout + Crown + Fluttering Dorsal Fin)
function buildSeahorseParts(THREE, mat) {
  const scale = 1 / 145;
  const cx = 232;
  const cy = 248;

  // 1. S-Curved Tubular Body + Prehensile Spiral Tail mapped 1:1 from seahorseSpinePoint(t)
  const nSpine = 72;
  const nRing = 18;
  const positions = [];
  const basePositions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= nSpine; i++) {
    const t = i / nSpine;
    const p = seahorseSpinePoint(t);
    const pNext = seahorseSpinePoint(Math.min(1, t + 0.01));
    const pPrev = seahorseSpinePoint(Math.max(0, t - 0.01));
    const dx = pNext.x - pPrev.x;
    const dy = pNext.y - pPrev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    // Armored seahorse ridge ring modulation!
    const ridgeBump = t > 0.16 && t < 0.92 ? 1 + Math.sin(t * Math.PI * 30) * 0.055 : 1;

    for (let j = 0; j <= nRing; j++) {
      const phi = (j / nRing) * Math.PI * 2;
      // cos(phi) spans +1 (left/belly side) to -1 (right/back side) in 2D template!
      const sideCos = Math.cos(phi);
      const depthSin = Math.sin(phi);

      const tx = p.x + nx * p.r * sideCos;
      const ty = p.y + ny * p.r * sideCos;

      const px = (cx - tx) * scale * ridgeBump;
      const py = (cy - ty) * scale * ridgeBump;
      const pz = depthSin * (p.r * scale * 0.78) * ridgeBump;

      positions.push(px, py, pz);
      basePositions.push(px, py, pz, t);
      uvs.push(tx / 512, 1 - ty / 512);
    }
  }

  const cols = nRing + 1;
  for (let i = 0; i < nSpine; i++) {
    for (let j = 0; j < nRing; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + (j + 1);
      const d = i * cols + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const bodyGeom = new THREE.BufferGeometry();
  bodyGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bodyGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bodyGeom.setIndex(indices);
  bodyGeom.computeVertexNormals();
  bodyGeom.userData.basePositions = new Float32Array(basePositions);
  const bodyMesh = new THREE.Mesh(bodyGeom, mat);
  bodyMesh.castShadow = true;

  // 2. 3D Tubular Trumpet Snout (tx: 218 -> 134, ty around 116)
  const snoutPos = [];
  const snoutUvs = [];
  const snoutIdx = [];
  const nSnout = 12;
  for (let i = 0; i <= nSnout; i++) {
    const u = i / nSnout; // 0 at head (tx=218) -> 1 at snout tip (tx=134)
    const txCenter = 218 - u * 84;
    const tyCenter = 114 + Math.sin(u * Math.PI) * 3;
    // Slight trumpet flare right at the tip (u > 0.78)
    const radPx = u < 0.78 ? 18 * (1 - u * 0.38) : 11.2 + ((u - 0.78) / 0.22) * 6.5;

    for (let j = 0; j <= nRing; j++) {
      const phi = (j / nRing) * Math.PI * 2;
      const ty = tyCenter + Math.cos(phi) * radPx;
      const px = (cx - txCenter) * scale;
      const py = (cy - ty) * scale;
      const pz = Math.sin(phi) * radPx * scale * 0.85;
      snoutPos.push(px, py, pz);
      snoutUvs.push(txCenter / 512, 1 - ty / 512);
    }
  }
  for (let i = 0; i < nSnout; i++) {
    for (let j = 0; j < nRing; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + (j + 1);
      const d = i * cols + (j + 1);
      snoutIdx.push(a, d, b, b, d, c);
    }
  }
  const snoutGeom = new THREE.BufferGeometry();
  snoutGeom.setAttribute('position', new THREE.Float32BufferAttribute(snoutPos, 3));
  snoutGeom.setAttribute('uv', new THREE.Float32BufferAttribute(snoutUvs, 2));
  snoutGeom.setIndex(snoutIdx);
  snoutGeom.computeVertexNormals();
  const snoutMesh = new THREE.Mesh(snoutGeom, mat);

  // 3. 3D Coronet Crown on Head (tx: 222..282, ty: 44..88)
  const crownPos = [];
  const crownUvs = [];
  const crownIdx = [];
  const nCx = 12;
  const nCy = 6;
  const addCrownSide = (zSign) => {
    const off = crownPos.length / 3;
    for (let iy = 0; iy <= nCy; iy++) {
      const v = iy / nCy; // 0 = base (ty=86), 1 = spiky tips
      for (let ix = 0; ix <= nCx; ix++) {
        const u = ix / nCx;
        const tx = 222 + u * 58;
        const spike = Math.abs(Math.sin(u * Math.PI * 3));
        const tyTop = 68 - spike * 22;
        const ty = 86 + (tyTop - 86) * v;
        const thick = zSign * 0.045 * (1 - v * 0.75) * Math.sin(u * Math.PI);
        crownPos.push((cx - tx) * scale, (cy - ty) * scale, thick);
        crownUvs.push(tx / 512, 1 - ty / 512);
      }
    }
    const cCols = nCx + 1;
    for (let iy = 0; iy < nCy; iy++) {
      for (let ix = 0; ix < nCx; ix++) {
        const a = off + iy * cCols + ix;
        const b = off + (iy + 1) * cCols + ix;
        const c = off + (iy + 1) * cCols + (ix + 1);
        const d = off + iy * cCols + (ix + 1);
        if (zSign > 0) crownIdx.push(a, b, d, b, c, d);
        else crownIdx.push(a, d, b, b, d, c);
      }
    }
  };
  addCrownSide(1);
  addCrownSide(-1);
  const crownGeom = new THREE.BufferGeometry();
  crownGeom.setAttribute('position', new THREE.Float32BufferAttribute(crownPos, 3));
  crownGeom.setAttribute('uv', new THREE.Float32BufferAttribute(crownUvs, 2));
  crownGeom.setIndex(crownIdx);
  crownGeom.computeVertexNormals();
  const crownMesh = new THREE.Mesh(crownGeom, mat);

  // 4. Articulated Fluttering 3D Dorsal Fin on Back (tx: 262..338, ty: 198..294)
  const dorsalPivot = new THREE.Group();
  const pivX = (cx - 262) * scale;
  const pivY = (cy - 246) * scale;
  dorsalPivot.position.set(pivX, pivY, 0);

  const finPos = [];
  const finUvs = [];
  const finIdx = [];
  const nFu = 8;
  const nFv = 10;
  for (let iv = 0; iv <= nFv; iv++) {
    const v = iv / nFv; // 0 = top (ty=198) -> 1 = bottom (ty=294)
    const tyBase = 204 + v * 84;
    const lobe = 1 - 0.22 * Math.pow(Math.sin(v * Math.PI * 2), 2);
    const spanPx = 70 * Math.sin(v * Math.PI * 0.92 + 0.12) * lobe;
    for (let iu = 0; iu <= nFu; iu++) {
      const u = iu / nFu;
      const tx = 262 + u * spanPx;
      const ty = tyBase + (v - 0.5) * u * 18;
      finPos.push((cx - tx) * scale - pivX, (cy - ty) * scale - pivY, 0);
      finUvs.push(tx / 512, 1 - ty / 512);
    }
  }
  for (let iv = 0; iv < nFv; iv++) {
    for (let iu = 0; iu < nFu; iu++) {
      const a = iv * (nFu + 1) + iu;
      const b = (iv + 1) * (nFu + 1) + iu;
      const c = (iv + 1) * (nFu + 1) + (iu + 1);
      const d = iv * (nFu + 1) + (iu + 1);
      finIdx.push(a, b, d, b, c, d);
    }
  }
  const finGeom = new THREE.BufferGeometry();
  finGeom.setAttribute('position', new THREE.Float32BufferAttribute(finPos, 3));
  finGeom.setAttribute('uv', new THREE.Float32BufferAttribute(finUvs, 2));
  finGeom.setIndex(finIdx);
  finGeom.computeVertexNormals();
  const finMesh = new THREE.Mesh(finGeom, mat);
  dorsalPivot.add(finMesh);

  return { bodyMesh, snoutMesh, crownMesh, dorsalPivot };
}

// ============================================================================
// REALTIME 3D VERTEX & LIMB SWIMMING ANIMATION
// ============================================================================

export function animateCreatureMesh(meshGroup, time, speedBoost = 1.0) {
  // ---------------------------------------------------------------------------
  // SMOOTH INTEGRATED ANIMATION CLOCK (fixes "suddenly spinning / speeding up" twitches)
  // ---------------------------------------------------------------------------
  // The wave maths used to be Math.sin(time * FREQ * speedBoost) with `time` being an ever
  // growing absolute clock. speedBoost changes constantly (idle ~0.45 -> food chase 1.65+),
  // so every change multiplied a huge number and teleported the wave phase: fins, tails and
  // limbs snapped to random positions (worst on the seahorse dorsal fin, which ran at 16.5x).
  // We now integrate the (ramped) speed into a clock, so only the RATE changes and the wave
  // stays perfectly continuous.
  const prevClockTime = meshGroup.userData.animClockTime;
  const dt = typeof prevClockTime === 'number' ? Math.min(Math.max(time - prevClockTime, 0), 0.1) : 0.016;
  meshGroup.userData.animClockTime = time;

  const wantedSpeed = Math.max(0.25, Math.min(2.2, speedBoost));
  const prevSpeed = typeof meshGroup.userData.animSpeed === 'number' ? meshGroup.userData.animSpeed : wantedSpeed;
  const animSpeed = prevSpeed + (wantedSpeed - prevSpeed) * Math.min(1, dt * 6);
  meshGroup.userData.animSpeed = animSpeed;

  // animation clock advances faster while chasing food / fleeing, slower while idling
  const clock = (meshGroup.userData.animClock || 0) + dt * animSpeed;
  meshGroup.userData.animClock = clock;

  // 1. Custom Blender .GLB creature animation (skeletal AnimationMixer or gentle procedural wave)
  if (meshGroup.userData.isCustomGlb) {
    if (meshGroup.userData.mixer) {
      // playback rate = per-species tempo * ramped swim speed (idle = slow flutter, chase = fast)
      const clipSpeed = meshGroup.userData.clipSpeed || 1.0;
      meshGroup.userData.mixer.update(dt * animSpeed * clipSpeed);
    }
    const waveMeshes = meshGroup.userData.animParts?.waveMeshes;
    if (waveMeshes && waveMeshes.length > 0) {
      for (const m of waveMeshes) {
        const base = m.geometry.userData.basePositions;
        const amp = m.geometry.userData.waveAmp || 0.12;
        const swimStyle = m.geometry.userData.swimStyle || 'fish';
        const pos = m.geometry.attributes.position;
        const arr = pos.array;

        if (swimStyle === 'fish') {
          const freq = meshGroup.userData.species === 'angelfish' ? 5.6 : 6.8; // speed is in `clock`
          for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
            const u = base[i + 3]; // 0 at nose -> 1 at tail tip
            const tailFlex = Math.pow(u, 1.85);
            const w = Math.sin(clock * freq - u * 4.6) * amp * tailFlex;
            arr[k] = base[i];
            arr[k + 1] = base[i + 1];
            arr[k + 2] = base[i + 2] + w;
          }
        } else if (swimStyle === 'seahorse') {
          for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
            const code = base[i + 3];
            if (code >= 10.0) {
              // Rapid fluttering back fan dorsal fin!
              const finSpan = code - 10.0;
              const flutter = Math.sin(clock * 16.5 - finSpan * 2.5) * (amp * 0.85) * finSpan;
              arr[k] = base[i];
              arr[k + 1] = base[i + 1];
              arr[k + 2] = base[i + 2] + flutter;
            } else {
              const tailFlex = Math.pow(code, 1.6);
              const sway = Math.sin(clock * 3.6 - code * 3.8) * (amp * 0.65) * tailFlex;
              arr[k] = base[i];
              arr[k + 1] = base[i + 1];
              arr[k + 2] = base[i + 2] + sway;
            }
          }
        } else {
          // Starfish gentle 5-arm ocean wave
          for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
            const bx = base[i];
            const by = base[i + 1];
            const rNorm = base[i + 3];
            const ang = Math.atan2(by, bx);
            const curl = Math.sin(clock * 2.3 + ang * 2.5) * (amp * 0.72) * Math.pow(rNorm, 1.5);
            arr[k] = bx;
            arr[k + 1] = by;
            arr[k + 2] = base[i + 2] + curl;
          }
        }
        pos.needsUpdate = true;
      }
    }
    return;
  }

  const species = meshGroup.userData.species;
  const parts = meshGroup.userData.animParts || {};

  if (species === 'clownfish' || species === 'angelfish') {
    const spine = parts.spineMesh;
    if (spine && spine.geometry.userData.basePositions) {
      const base = spine.geometry.userData.basePositions;
      const pos = spine.geometry.attributes.position;
      const arr = pos.array;
      const freq = species === 'clownfish' ? 7.2 : 5.6; // speed is in `clock`
      const amp = species === 'clownfish' ? 0.28 : 0.24;

      for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
        const bx = base[i];
        const by = base[i + 1];
        const bz = base[i + 2];
        const uNorm = base[i + 3]; // 0 at nose -> 1 at tail tip
        const tailFlex = Math.pow(uNorm, 1.65);
        const wave = Math.sin(clock * freq - uNorm * 4.6) * amp * tailFlex;
        arr[k] = bx;
        arr[k + 1] = by;
        arr[k + 2] = bz + wave;
      }
      pos.needsUpdate = true;
    }
    if (parts.pecL && parts.pecR) {
      const flap = Math.sin(clock * 9.5) * 0.42;
      parts.pecL.rotation.y = -0.28 + flap;
      parts.pecR.rotation.y = 0.28 - flap;
    }
  } else if (species === 'turtle') {
    const stroke = Math.sin(clock * 3.1);
    const twist = Math.cos(clock * 3.1);
    if (parts.flFrontL && parts.flFrontR) {
      parts.flFrontL.rotation.x = -stroke * 0.52;
      parts.flFrontL.rotation.z = twist * 0.18;
      parts.flFrontR.rotation.x = stroke * 0.52;
      parts.flFrontR.rotation.z = twist * 0.18;
    }
    if (parts.flRearL && parts.flRearR) {
      parts.flRearL.rotation.y = Math.sin(clock * 2.6) * 0.22;
      parts.flRearR.rotation.y = -Math.sin(clock * 2.6) * 0.22;
    }
    if (parts.headPivot) {
      parts.headPivot.rotation.z = Math.sin(clock * 1.8) * 0.08;
    }
  } else if (species === 'jellyfish') {
    const pulse = Math.sin(clock * 2.8);
    if (parts.bellMesh && parts.bellMesh.geometry.userData.basePositions) {
      const base = parts.bellMesh.geometry.userData.basePositions;
      const pos = parts.bellMesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
        const bx = base[i];
        const by = base[i + 1];
        const bz = base[i + 2];
        const v = base[i + 3];
        const radialScale = 1 + pulse * 0.15 * Math.pow(v, 1.2);
        const yStretch = 1 - pulse * 0.09 * v;
        arr[k] = bx * radialScale;
        arr[k + 1] = by * yStretch;
        arr[k + 2] = bz * radialScale;
      }
      pos.needsUpdate = true;
    }
    if (parts.tentacles) {
      for (const tMesh of parts.tentacles) {
        const base = tMesh.geometry.userData.basePositions;
        const phase = tMesh.geometry.userData.phaseOffset || 0;
        const pos = tMesh.geometry.attributes.position;
        const arr = pos.array;
        for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
          const bx = base[i];
          const by = base[i + 1];
          const bz = base[i + 2];
          const v = base[i + 3];
          const swayZ = Math.sin(clock * 3.0 - v * 4.2 + phase) * 0.22 * v;
          const swayX = Math.cos(clock * 2.3 - v * 3.4 + phase) * 0.10 * v;
          arr[k] = bx + swayX;
          arr[k + 1] = by * (1 + pulse * 0.08);
          arr[k + 2] = bz + swayZ;
        }
        pos.needsUpdate = true;
      }
    }
  } else if (species === 'starfish') {
    if (parts.starMesh && parts.starMesh.geometry.userData.basePositions) {
      const base = parts.starMesh.geometry.userData.basePositions;
      const pos = parts.starMesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
        const bx = base[i];
        const by = base[i + 1];
        const bz = base[i + 2];
        const rNorm = base[i + 3];
        const angle = Math.atan2(by, bx);
        const curl = Math.sin(clock * 2.4 + angle * 2.5) * 0.12 * Math.pow(rNorm, 1.6);
        arr[k] = bx;
        arr[k + 1] = by;
        arr[k + 2] = bz + curl;
      }
      pos.needsUpdate = true;
    }
  } else if (species === 'seahorse') {
    // Rapid fluttering dorsal fin + gentle S-spine & spiral tail curl!
    if (parts.dorsalPivot) {
      parts.dorsalPivot.rotation.y = Math.sin(clock * 16.0) * 0.36;
    }
    if (parts.bodyMesh && parts.bodyMesh.geometry.userData.basePositions) {
      const base = parts.bodyMesh.geometry.userData.basePositions;
      const pos = parts.bodyMesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
        const bx = base[i];
        const by = base[i + 1];
        const bz = base[i + 2];
        const t = base[i + 3];
        const tailFlex = Math.pow(t, 1.5);
        const swayZ = Math.sin(clock * 3.8 - t * 3.8) * 0.16 * tailFlex;
        const curlX = Math.cos(clock * 2.4 - t * 2.6) * 0.07 * Math.max(0, t - 0.55);
        arr[k] = bx + curlX;
        arr[k + 1] = by;
        arr[k + 2] = bz + swayZ;
      }
      pos.needsUpdate = true;
    }
  } else if (parts.spineMesh && parts.spineMesh.geometry.userData.basePositions) {
    // Fallback custom species swim wave
    const base = parts.spineMesh.geometry.userData.basePositions;
    const pos = parts.spineMesh.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0, k = 0; i < base.length; i += 4, k += 3) {
      const uNorm = base[i + 3];
      arr[k] = base[i];
      arr[k + 1] = base[i + 1];
      arr[k + 2] = base[i + 2] + Math.sin(clock * 6.5 - uNorm * 4.4) * 0.25 * Math.pow(uNorm, 1.6);
    }
    pos.needsUpdate = true;
  }
}

// ============================================================================
// REALISTIC HAND-COLORED CRAYON TEXTURE GENERATOR (FOR STARTER DEMO & SAMPLES)
// ============================================================================

export function generateHandColoredCanvas(species, palette, includePaperSheet = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // If we have the artist-colored reference image for this custom species, use it directly!
  const customColImg = cachedColoredImages.get(species);
  if (customColImg) {
    if (!includePaperSheet) {
      ctx.drawImage(customColImg, 0, 0, 512, 512);
      return canvas;
    }
    // For simulated paper desk scans: white paper outside silhouette + colored creature + subtle crayon texture!
    ctx.fillStyle = '#fdfcf7';
    ctx.fillRect(0, 0, 512, 512);

    const fg = document.createElement('canvas');
    fg.width = 512;
    fg.height = 512;
    const fctx = fg.getContext('2d');
    fctx.drawImage(customColImg, 0, 0, 512, 512);

    // Add realistic kid crayon stroke texture
    fctx.globalAlpha = 0.14;
    for (let i = 0; i < 420; i++) {
      const rx = Math.random() * 512;
      const ry = Math.random() * 512;
      fctx.strokeStyle = i % 2 === 0 ? '#ffffff' : (palette?.[i % palette.length] || '#ffd166');
      fctx.lineWidth = 2 + Math.random() * 3.5;
      fctx.beginPath();
      fctx.moveTo(rx, ry);
      fctx.lineTo(rx + 12 + Math.random() * 12, ry - 10 - Math.random() * 10);
      fctx.stroke();
    }
    fctx.globalAlpha = 1.0;

    const maskC = cachedTemplateMasks.get(species);
    if (maskC) {
      fctx.globalCompositeOperation = 'destination-in';
      fctx.drawImage(maskC, 0, 0, 512, 512);
    }
    ctx.drawImage(fg, 0, 0);

    const tmplImg = cachedTemplateImages.get(species);
    if (tmplImg) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(tmplImg, 0, 0, 512, 512);
      ctx.restore();
    }
    return canvas;
  }

  if (includePaperSheet) {
    ctx.fillStyle = '#fdfcf7';
    ctx.fillRect(0, 0, 512, 512);
  }

  // Create silhouette mask
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = 512;
  maskCanvas.height = 512;
  const mctx = maskCanvas.getContext('2d');
  drawCreatureSilhouette(mctx, species, 512, 'mask');

  // Paint organic hand-drawn crayon strokes!
  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = 512;
  paintCanvas.height = 512;
  const pctx = paintCanvas.getContext('2d');

  // Rich base wash + textured crayon strokes
  const grad = pctx.createLinearGradient(50, 60, 460, 450);
  grad.addColorStop(0, palette[0]);
  grad.addColorStop(0.5, palette[1] || palette[0]);
  grad.addColorStop(1, palette[2] || palette[0]);
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, 512, 512);

  // Species-specific kid-colored patterns!
  if (species === 'clownfish') {
    // White stripes with dark accents like a real colored Nemo!
    pctx.fillStyle = palette[3] || '#fff8f0';
    for (const [cx, w] of [[162, 17], [258, 21], [352, 14]]) {
      pctx.beginPath();
      pctx.ellipse(cx, 256, w, 190, 0, 0, Math.PI * 2);
      pctx.fill();
    }
  } else if (species === 'turtle') {
    // Colorful shell scutes + green flippers
    pctx.fillStyle = palette[1] || '#52b788';
    pctx.fillRect(0, 0, 512, 512);
    pctx.fillStyle = palette[0];
    pctx.beginPath();
    pctx.ellipse(256, 268, 110, 136, 0, 0, Math.PI * 2);
    pctx.fill();
    pctx.fillStyle = palette[2] || '#ffd166';
    for (const cy of [208, 268, 328]) {
      pctx.beginPath();
      pctx.arc(256, cy, 29, 0, Math.PI * 2);
      pctx.fill();
    }
  } else if (species === 'jellyfish') {
    // Glowing dome + multi-colored tentacles
    const jg = pctx.createLinearGradient(256, 52, 256, 465);
    jg.addColorStop(0, palette[0]);
    jg.addColorStop(0.45, palette[1] || '#f72585');
    jg.addColorStop(1, palette[2] || '#4cc9f0');
    pctx.fillStyle = jg;
    pctx.fillRect(0, 0, 512, 512);
    pctx.fillStyle = palette[3] || '#ffee99';
    for (const [sx, sy, sr] of [[152, 134, 15], [360, 134, 15], [202, 102, 11], [310, 102, 11]]) {
      pctx.beginPath();
      pctx.arc(sx, sy, sr, 0, Math.PI * 2);
      pctx.fill();
    }
  } else if (species === 'starfish') {
    const sg = pctx.createRadialGradient(256, 262, 25, 256, 262, 210);
    sg.addColorStop(0, palette[2] || '#ffe66d');
    sg.addColorStop(0.55, palette[0]);
    sg.addColorStop(1, palette[1] || '#ef476f');
    pctx.fillStyle = sg;
    pctx.fillRect(0, 0, 512, 512);
  } else if (species === 'seahorse') {
    // Golden-coral gradient body + vibrant cyan/magenta dorsal fin & crown!
    const shg = pctx.createLinearGradient(180, 50, 280, 445);
    shg.addColorStop(0, palette[0] || '#ff9f1c');
    shg.addColorStop(0.5, palette[1] || '#ff5d8f');
    shg.addColorStop(1, palette[2] || '#ffd166');
    pctx.fillStyle = shg;
    pctx.fillRect(0, 0, 512, 512);
    // Bright dorsal fin & crown highlight
    pctx.fillStyle = palette[3] || '#00f5d4';
    pctx.beginPath();
    pctx.ellipse(302, 246, 46, 56, 0, 0, Math.PI * 2);
    pctx.fill();
    pctx.beginPath();
    pctx.ellipse(252, 64, 38, 24, 0, 0, Math.PI * 2);
    pctx.fill();
  }

  // Add realistic crayon grain texture!
  pctx.globalAlpha = 0.22;
  for (let i = 0; i < 650; i++) {
    const rx = Math.random() * 512;
    const ry = Math.random() * 512;
    pctx.strokeStyle = i % 3 === 0 ? '#ffffff' : palette[i % palette.length];
    pctx.lineWidth = 2 + Math.random() * 4;
    pctx.beginPath();
    pctx.moveTo(rx, ry);
    pctx.lineTo(rx + 12 + Math.random() * 14, ry - 10 - Math.random() * 12);
    pctx.stroke();
  }
  pctx.globalAlpha = 1;

  if (!includePaperSheet) {
    // Full bleed colors + crisp template ink overlay + cute eyes!
    ctx.drawImage(paintCanvas, 0, 0);
    // Draw outline ink without opaque white fill by drawing outline on temp canvas and multiplying!
    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = 512;
    lineCanvas.height = 512;
    const lctx = lineCanvas.getContext('2d');
    drawCreatureSilhouette(lctx, species, 512, 'outline');
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lineCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    drawEyeOverlayOnly(ctx, species, 512);
  } else {
    // Simulate a kid coloring inside the silhouette on white paper!
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(maskCanvas, 0, 0);
    // First draw white paper + outline, then multiply kid's crayon strokes!
    drawCreatureSilhouette(ctx, species, 512, 'outline');
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(paintCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    drawEyeOverlayOnly(ctx, species, 512);
  }

  return canvas;
}
