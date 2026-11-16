// Computer Vision Pipeline for Quiver Digital Aquarium Paper Coloring Sheets:
// 1) Printable Sheet Fiducial Frame Drawer (4 concentric corner markers + 6-bit orientation & species code bar)
// 2) Automatic 4-Corner Concentric Marker Detector (QR-inspired scanline ratio finder + clustering)
// 3) Exact 8-DOF Perspective Homography Matrix Solver & Bilinear Unwarp (640x640 -> 512x512 UV space)
// 4) Auto Rotation (0/90/180/270) & Species Code Reader
// 5) Illumination Shadow Removal, Crayon Vibrance Boost, & Silhouette Edge-Padding

import { SPECIES_LIST, drawCreatureSilhouette, drawEyeOverlayOnly } from './creatures.js';
import { EXTRA_CUSTOM_SPECIES } from './custom-creatures-config.js';

export const FRAME_SIZE = 640;
export const MARKER_CENTER_MIN = 44;
export const MARKER_CENTER_MAX = 596; // span = 552
export const INNER_OFFSET = 64;      // 64..576 => exact 512x512 creature canvas!
export const INNER_SIZE = 512;

const CODE_DOT_XS = [216, 256, 296, 336, 376, 416];
const CODE_DOT_Y = 40;

const SPECIES_BITS = {
  clownfish: [1, 0, 0, 1, 0, 1],
  angelfish: [1, 0, 1, 0, 0, 1],
  bluetang:  [1, 0, 1, 1, 0, 1],
  seahorse:  [1, 1, 1, 0, 0, 1],
  starfish:  [1, 1, 0, 1, 0, 1],
  crab:      [1, 1, 0, 0, 1, 1]  // kept >=2 bits away from every other code so scans never collide
};

if (Array.isArray(EXTRA_CUSTOM_SPECIES)) {
  for (const sp of EXTRA_CUSTOM_SPECIES) {
    if (sp?.id && Array.isArray(sp.codeBits) && sp.codeBits.length === 6) {
      SPECIES_BITS[sp.id] = sp.codeBits;
    }
  }
}

// ============================================================================
// 1. DRAW PRINTABLE SHEET SCAN FRAME (640x640 CANONICAL COORDINATES)
// ============================================================================

export function renderPrintableFrameToCanvas(canvas, species, customInnerCanvas = null) {
  canvas.width = FRAME_SIZE;
  canvas.height = FRAME_SIZE;
  const ctx = canvas.getContext('2d');

  // Pure white paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);

  // Subtle light guide border connecting the 4 corner markers
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(
    MARKER_CENTER_MIN,
    MARKER_CENTER_MIN,
    MARKER_CENTER_MAX - MARKER_CENTER_MIN,
    MARKER_CENTER_MAX - MARKER_CENTER_MIN
  );
  ctx.setLineDash([]);

  // Draw the inner 512x512 creature outline (or custom colored inner canvas)
  if (customInnerCanvas) {
    ctx.drawImage(customInnerCanvas, INNER_OFFSET, INNER_OFFSET, INNER_SIZE, INNER_SIZE);
  } else {
    ctx.save();
    ctx.translate(INNER_OFFSET, INNER_OFFSET);
    drawCreatureSilhouette(ctx, species, INNER_SIZE, 'outline');
    ctx.restore();
  }

  // Draw the 4 High-Contrast Concentric Corner Fiducial Markers (1:1:2:1:1 ratio = 56px outer)
  const corners = [
    [MARKER_CENTER_MIN, MARKER_CENTER_MIN],
    [MARKER_CENTER_MAX, MARKER_CENTER_MIN],
    [MARKER_CENTER_MAX, MARKER_CENTER_MAX],
    [MARKER_CENTER_MIN, MARKER_CENTER_MAX]
  ];
  for (const [cx, cy] of corners) {
    drawFiducialMarker(ctx, cx, cy, 56);
  }

  // Draw the 6-dot Orientation & Species Binary Code Bar along top edge (y = 40)
  const bits = SPECIES_BITS[species] || SPECIES_BITS.clownfish;
  for (let i = 0; i < CODE_DOT_XS.length; i++) {
    const dx = CODE_DOT_XS[i];
    if (bits[i] === 1) {
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(dx, CODE_DOT_Y, 8.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(dx, CODE_DOT_Y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  return canvas;
}

function drawFiducialMarker(ctx, cx, cy, size) {
  // White quiet zone around marker
  const q = size + 14;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - q / 2, cy - q / 2, q, q);

  // Outer black square (7 units)
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);

  // Inner white ring (5 units)
  const s2 = (size * 5) / 7;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - s2 / 2, cy - s2 / 2, s2, s2);

  // Core solid black square (3 units)
  const s3 = (size * 3) / 7;
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - s3 / 2, cy - s3 / 2, s3, s3);
}

// ============================================================================
// 2. AUTOMATIC 4-CORNER FIDUCIAL DETECTOR (LIVE CAMERA & PHOTOS)
// ============================================================================

export function detectSheetCorners(imageSource) {
  // Downscale to max ~720px for fast <15ms real-time detection
  const srcW = imageSource.videoWidth || imageSource.naturalWidth || imageSource.width;
  const srcH = imageSource.videoHeight || imageSource.naturalHeight || imageSource.height;
  if (!srcW || !srcH) return null;

  const maxDim = 680;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageSource, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Compute grayscale + integral image for adaptive local thresholding (handles uneven shadows!)
  const gray = new Uint8Array(w * h);
  const integral = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const pOff = y * w;
    const iOff = (y + 1) * (w + 1);
    const prevOff = y * (w + 1);
    for (let x = 0; x < w; x++) {
      const idx = (pOff + x) * 4;
      const lum = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
      gray[pOff + x] = lum;
      rowSum += lum;
      integral[iOff + x + 1] = integral[prevOff + x + 1] + rowSum;
    }
  }

  const bin = new Uint8Array(w * h);
  const win = Math.max(12, Math.round(Math.min(w, h) / 16));
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - win);
    const y2 = Math.min(h - 1, y + win);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - win);
      const x2 = Math.min(w - 1, x + win);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
        integral[y1 * (w + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (w + 1) + x1] +
        integral[y1 * (w + 1) + x1];
      // 1 = black, 0 = white
      bin[y * w + x] = gray[y * w + x] * area < sum * 0.84 ? 1 : 0;
    }
  }

  // Scan horizontal lines for 1:1:3:1:1 black-white-black-white-black finder pattern
  const candidates = [];
  const checkRatio = (s0, s1, s2, s3, s4) => {
    const total = s0 + s1 + s2 + s3 + s4;
    if (total < 10 || total > Math.min(w, h) * 0.35) return false;
    const moduleSize = total / 7.0;
    const tol = moduleSize * 0.68;
    return (
      Math.abs(s0 - moduleSize) < tol &&
      Math.abs(s1 - moduleSize) < tol &&
      Math.abs(s2 - 3 * moduleSize) < 2.1 * tol &&
      Math.abs(s3 - moduleSize) < tol &&
      Math.abs(s4 - moduleSize) < tol
    );
  };

  const verifyVertical = (cx, cy, approxTotal) => {
    const x = Math.round(cx);
    const yStart = Math.round(cy);
    if (x < 0 || x >= w || yStart < 0 || yStart >= h || bin[yStart * w + x] !== 1) return null;

    const maxSpan = Math.ceil(approxTotal * 1.6);
    let y = yStart;
    // Center black
    let c2 = 0;
    while (y >= 0 && bin[y * w + x] === 1 && c2 <= maxSpan) { c2++; y--; }
    if (y < 0 || c2 > maxSpan) return null;
    // Upper white
    let c1 = 0;
    while (y >= 0 && bin[y * w + x] === 0 && c1 <= maxSpan) { c1++; y--; }
    if (y < 0 || c1 > maxSpan) return null;
    // Upper black
    let c0 = 0;
    while (y >= 0 && bin[y * w + x] === 1 && c0 <= maxSpan) { c0++; y--; }

    y = yStart + 1;
    while (y < h && bin[y * w + x] === 1 && c2 <= maxSpan) { c2++; y++; }
    if (y >= h || c2 > maxSpan) return null;
    let c3 = 0;
    while (y < h && bin[y * w + x] === 0 && c3 <= maxSpan) { c3++; y++; }
    if (y >= h || c3 > maxSpan) return null;
    let c4 = 0;
    while (y < h && bin[y * w + x] === 1 && c4 <= maxSpan) { c4++; y++; }

    if (!checkRatio(c0, c1, c2, c3, c4)) return null;
    const vTotal = c0 + c1 + c2 + c3 + c4;
    if (Math.abs(vTotal - approxTotal) > Math.max(vTotal, approxTotal) * 0.48) return null;
    const centerY = y - c4 - c3 - c2 * 0.5;
    return { x: cx, y: centerY, size: (approxTotal + vTotal) * 0.5 };
  };

  for (let y = 2; y < h - 2; y += 2) {
    const row = y * w;
    const state = [0, 0, 0, 0, 0];
    let cur = 0;
    for (let x = 0; x < w; x++) {
      if (bin[row + x] === 1) {
        if ((cur & 1) === 1) cur++;
        state[cur]++;
      } else {
        if ((cur & 1) === 1) {
          state[cur]++;
        } else {
          if (cur === 4) {
            if (checkRatio(state[0], state[1], state[2], state[3], state[4])) {
              const hTotal = state[0] + state[1] + state[2] + state[3] + state[4];
              const centerX = x - state[4] - state[3] - state[2] * 0.5;
              const hit = verifyVertical(centerX, y, hTotal);
              if (hit) candidates.push(hit);
            }
            state[0] = state[2];
            state[1] = state[3];
            state[2] = state[4];
            state[3] = 1;
            state[4] = 0;
            cur = 3;
          } else {
            cur++;
            state[cur]++;
          }
        }
      }
    }
  }

  // Cluster nearby marker hits into distinct fiducial centers
  const clusters = [];
  for (const c of candidates) {
    let merged = false;
    for (const cl of clusters) {
      const dist = Math.hypot(c.x - cl.x, c.y - cl.y);
      if (dist < Math.max(c.size, cl.size) * 0.65) {
        cl.x = (cl.x * cl.weight + c.x) / (cl.weight + 1);
        cl.y = (cl.y * cl.weight + c.y) / (cl.weight + 1);
        cl.size = (cl.size * cl.weight + c.size) / (cl.weight + 1);
        cl.weight++;
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ x: c.x, y: c.y, size: c.size, weight: 1 });
    }
  }

  // Filter clusters that had multiple scanline confirmations and pick best 4 forming a convex quad
  clusters.sort((a, b) => b.weight - a.weight);
  const top = clusters.slice(0, 8);
  if (top.length < 4) return null;

  let bestQuad = null;
  let bestScore = -1;

  // Test 4-combinations of top clusters for largest well-proportioned convex quad
  for (let a = 0; a < top.length - 3; a++) {
    for (let b = a + 1; b < top.length - 2; b++) {
      for (let c = b + 1; c < top.length - 1; c++) {
        for (let d = c + 1; d < top.length; d++) {
          const group = [top[a], top[b], top[c], top[d]];
          const sizes = group.map((g) => g.size);
          if (Math.max(...sizes) / Math.max(1, Math.min(...sizes)) > 2.15) continue;

          const pts = orderQuadClockwise(group);
          const area = quadArea(pts);
          if (area < w * h * 0.04) continue;
          if (!isConvexQuad(pts)) continue;

          const sideLens = [0, 1, 2, 3].map((i) =>
            Math.hypot(pts[(i + 1) % 4].x - pts[i].x, pts[(i + 1) % 4].y - pts[i].y)
          );
          if (Math.min(...sideLens) / Math.max(...sideLens) < 0.45) continue;

          const weightSum = top[a].weight + top[b].weight + top[c].weight + top[d].weight;
          const score = area * Math.sqrt(weightSum);
          if (score > bestScore) {
            bestScore = score;
            bestQuad = pts;
          }
        }
      }
    }
  }

  if (!bestQuad) return null;

  // Map back to full-resolution source coordinates: [TL, TR, BR, BL]
  return bestQuad.map((p) => ({
    x: p.x / scale,
    y: p.y / scale
  }));
}

export function orderQuadClockwise(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // Start with Top-Left (smallest x + y)
  let minIdx = 0;
  let minSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const sum = sorted[i].x + sorted[i].y;
    if (sum < minSum) {
      minSum = sum;
      minIdx = i;
    }
  }
  return [
    sorted[minIdx],
    sorted[(minIdx + 1) % 4],
    sorted[(minIdx + 2) % 4],
    sorted[(minIdx + 3) % 4]
  ];
}

function quadArea(pts) {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) * 0.5;
}

function isConvexQuad(pts) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 4];
    const p2 = pts[(i + 2) % 4];
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cross) < 1e-3) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

// ============================================================================
// 3. EXACT 8-DOF PERSPECTIVE HOMOGRAPHY SOLVER & BILINEAR UNWARP
// ============================================================================

function solveHomography(dstPts, srcPts) {
  // Maps canonical destination (u, v) -> source photo (x, y) for inverse bilinear sampling!
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const u = dstPts[i].x;
    const v = dstPts[i].y;
    const x = srcPts[i].x;
    const y = srcPts[i].y;
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    B.push(y);
  }

  // Gaussian elimination with partial pivoting (8x8)
  const n = 8;
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    [B[col], B[maxRow]] = [B[maxRow], B[col]];

    const pivot = A[col][col] || 1e-12;
    for (let j = col; j < n; j++) A[col][j] /= pivot;
    B[col] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = A[row][col];
        for (let j = col; j < n; j++) A[row][j] -= factor * A[col][j];
        B[row] -= factor * B[col];
      }
    }
  }

  return [B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], 1];
}

export function unwarpSheetAndExtractTexture(imageSource, quadCorners, forcedSpecies = 'auto', keepCrispInk = true) {
  // Draw source image onto full-res canvas
  const srcW = imageSource.videoWidth || imageSource.naturalWidth || imageSource.width;
  const srcH = imageSource.videoHeight || imageSource.naturalHeight || imageSource.height;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(imageSource, 0, 0, srcW, srcH);
  const srcData = sctx.getImageData(0, 0, srcW, srcH).data;

  // Canonical target positions of the 4 corner markers in 640x640 sheet space
  const dstCorners = [
    { x: MARKER_CENTER_MIN, y: MARKER_CENTER_MIN },
    { x: MARKER_CENTER_MAX, y: MARKER_CENTER_MIN },
    { x: MARKER_CENTER_MAX, y: MARKER_CENTER_MAX },
    { x: MARKER_CENTER_MIN, y: MARKER_CENTER_MAX }
  ];

  const H = solveHomography(dstCorners, quadCorners);

  // Bilinear perspective unwarp into 640x640 sheet canvas
  const warpedCanvas = document.createElement('canvas');
  warpedCanvas.width = FRAME_SIZE;
  warpedCanvas.height = FRAME_SIZE;
  const wctx = warpedCanvas.getContext('2d', { willReadFrequently: true });
  const warpedImg = wctx.createImageData(FRAME_SIZE, FRAME_SIZE);
  const dst = warpedImg.data;

  for (let v = 0; v < FRAME_SIZE; v++) {
    for (let u = 0; u < FRAME_SIZE; u++) {
      const denom = H[6] * u + H[7] * v + 1;
      const sx = (H[0] * u + H[1] * v + H[2]) / denom;
      const sy = (H[3] * u + H[4] * v + H[5]) / denom;

      const outIdx = (v * FRAME_SIZE + u) * 4;
      if (sx < 0 || sy < 0 || sx >= srcW - 1 || sy >= srcH - 1) {
        dst[outIdx] = 255;
        dst[outIdx + 1] = 255;
        dst[outIdx + 2] = 255;
        dst[outIdx + 3] = 255;
        continue;
      }

      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + srcW * 4;
      const i11 = i01 + 4;

      dst[outIdx] = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      dst[outIdx + 1] = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      dst[outIdx + 2] = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      dst[outIdx + 3] = 255;
    }
  }
  wctx.putImageData(warpedImg, 0, 0);

  // Auto-detect orientation (0, 90, 180, 270) & species code bar!
  const { rotatedCanvas, detectedSpecies } = orientAndDecodeSheet(warpedCanvas);
  const finalSpecies = forcedSpecies && forcedSpecies !== 'auto' ? forcedSpecies : (detectedSpecies || 'clownfish');

  // Crop inner 512x512 creature area
  const uvCanvas = document.createElement('canvas');
  uvCanvas.width = INNER_SIZE;
  uvCanvas.height = INNER_SIZE;
  const uctx = uvCanvas.getContext('2d', { willReadFrequently: true });
  uctx.drawImage(
    rotatedCanvas,
    INNER_OFFSET,
    INNER_OFFSET,
    INNER_SIZE,
    INNER_SIZE,
    0,
    0,
    INNER_SIZE,
    INNER_SIZE
  );

  // Apply Shadow Normalization + Crayon Vibrance Boost + Edge Padding!
  enhanceCreatureUV(uvCanvas, finalSpecies, keepCrispInk);

  return {
    species: finalSpecies,
    detectedSpecies,
    uvCanvas,
    warpedSheetCanvas: rotatedCanvas
  };
}

// Check all 4 rotations for the 6-bit orientation & species bar at y = 40
function orientAndDecodeSheet(sheetCanvas) {
  let bestRot = 0;
  let bestSpecies = null;
  let bestConfidence = -Infinity;

  for (const rot of [0, 90, 180, 270]) {
    const candidate = rotateCanvas(sheetCanvas, rot);
    const ctx = candidate.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data;

    // Sample average luminance around paper margin to calibrate dark/light threshold
    const bgLum = sampleDiskLum(data, 150, 40, 6) * 0.5 + sampleDiskLum(data, 490, 40, 6) * 0.5;
    const dotLums = CODE_DOT_XS.map((dx) => sampleDiskLum(data, dx, CODE_DOT_Y, 5));
    // Also verify bottom edge does NOT have dark dots (disambiguates 180 deg)
    const botLum = sampleDiskLum(data, CODE_DOT_XS[0], FRAME_SIZE - CODE_DOT_Y, 5);

    // Bit 0 and Bit 5 must be dark (< bgLum * 0.72), bottom must be bright
    const syncScore = (bgLum - dotLums[0]) + (bgLum - dotLums[5]) + (botLum - dotLums[0]) * 0.6;
    const readBits = dotLums.map((l) => (l < bgLum * 0.76 ? 1 : 0));

    for (const [sp, pattern] of Object.entries(SPECIES_BITS)) {
      let matches = 0;
      for (let i = 0; i < 6; i++) {
        if (readBits[i] === pattern[i]) matches++;
      }
      const score = matches * 40 + syncScore;
      if (matches >= 5 && score > bestConfidence) {
        bestConfidence = score;
        bestRot = rot;
        bestSpecies = sp;
      }
    }
  }

  return {
    rotatedCanvas: bestRot === 0 ? sheetCanvas : rotateCanvas(sheetCanvas, bestRot),
    detectedSpecies: bestSpecies
  };
}

function sampleDiskLum(data, cx, cy, r) {
  let sum = 0;
  let count = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        const x = Math.max(0, Math.min(FRAME_SIZE - 1, Math.round(cx + dx)));
        const y = Math.max(0, Math.min(FRAME_SIZE - 1, Math.round(cy + dy)));
        const idx = (y * FRAME_SIZE + x) * 4;
        sum += data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        count++;
      }
    }
  }
  return count ? sum / count : 255;
}

function rotateCanvas(src, deg) {
  if (deg === 0) return src;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -c.width / 2, -c.height / 2);
  return c;
}

// ============================================================================
// 5. ILLUMINATION WHITE-BALANCE, VIBRANCE BOOST & SILHOUETTE EDGE BLEED
// ============================================================================

function enhanceCreatureUV(uvCanvas, species, keepCrispInk = true) {
  const ctx = uvCanvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, INNER_SIZE, INNER_SIZE);
  const d = img.data;

  // Build exact silhouette mask
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = INNER_SIZE;
  maskCanvas.height = INNER_SIZE;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  drawCreatureSilhouette(mctx, species, INNER_SIZE, 'mask');
  const maskData = mctx.getImageData(0, 0, INNER_SIZE, INNER_SIZE).data;

  // Estimate paper white-point from bright pixels outside the silhouette mask!
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let i = 0; i < d.length; i += 16) {
    if (maskData[i + 3] < 30) {
      const lum = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      if (lum > 110) {
        sumR += d[i];
        sumG += d[i + 1];
        sumB += d[i + 2];
        count++;
      }
    }
  }

  const whiteR = count > 40 ? Math.max(140, sumR / count) : 242;
  const whiteG = count > 40 ? Math.max(140, sumG / count) : 242;
  const whiteB = count > 40 ? Math.max(140, sumB / count) : 242;

  const gainR = 252 / whiteR;
  const gainG = 252 / whiteG;
  const gainB = 252 / whiteB;

  // Normalize paper lighting & apply crayon vibrance boost!
  let avgInR = 0, avgInG = 0, avgInB = 0, inCount = 0;
  for (let i = 0; i < d.length; i += 4) {
    let r = Math.min(255, d[i] * gainR);
    let g = Math.min(255, d[i + 1] * gainG);
    let b = Math.min(255, d[i + 2] * gainB);

    // Boost saturation so pale pencil/crayon strokes look magical underwater!
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const satBoost = 1.42;
    r = Math.max(0, Math.min(255, gray + (r - gray) * satBoost));
    g = Math.max(0, Math.min(255, gray + (g - gray) * satBoost));
    b = Math.max(0, Math.min(255, gray + (b - gray) * satBoost));

    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;

    // Collect dominant colored pixels inside silhouette for smooth outside edge bleed
    if (maskData[i + 3] > 200) {
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC > 18 || maxC < 235) {
        avgInR += r;
        avgInG += g;
        avgInB += b;
        inCount++;
      }
    }
  }

  // Edge bleed outside silhouette so 3D seam boundaries never show white paper fringes!
  const fallbackR = inCount > 20 ? avgInR / inCount : 255;
  const fallbackG = inCount > 20 ? avgInG / inCount : 145;
  const fallbackB = inCount > 20 ? avgInB / inCount : 65;

  for (let i = 0; i < d.length; i += 4) {
    if (maskData[i + 3] < 128) {
      d[i] = fallbackR;
      d[i + 1] = fallbackG;
      d[i + 2] = fallbackB;
    }
  }

  ctx.putImageData(img, 0, 0);

  // Optionally restore crisp ink lines & glossy eyes so the 3D creature looks super sharp!
  if (keepCrispInk) {
    const inkCanvas = document.createElement('canvas');
    inkCanvas.width = INNER_SIZE;
    inkCanvas.height = INNER_SIZE;
    const ictx = inkCanvas.getContext('2d');
    drawCreatureSilhouette(ictx, species, INNER_SIZE, 'outline');

    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(inkCanvas, 0, 0);
    ctx.restore();

    drawEyeOverlayOnly(ctx, species, INNER_SIZE);
  }
}

// ============================================================================
// 6. GENERATE REALISTIC TILTED PAPER PHOTO ON WOODEN DESK (FOR INSTANT DEMO!)
// ============================================================================

export function createSimulatedDeskPhoto(species, customInnerCanvas = null) {
  const sheet = document.createElement('canvas');
  renderPrintableFrameToCanvas(sheet, species, customInnerCanvas);

  const photoW = 900;
  const photoH = 720;
  const photo = document.createElement('canvas');
  photo.width = photoW;
  photo.height = photoH;
  const ctx = photo.getContext('2d');

  // Warm wooden classroom table background
  const woodGrad = ctx.createLinearGradient(0, 0, photoW, photoH);
  woodGrad.addColorStop(0, '#8d5b36');
  woodGrad.addColorStop(0.5, '#a46c42');
  woodGrad.addColorStop(1, '#754929');
  ctx.fillStyle = woodGrad;
  ctx.fillRect(0, 0, photoW, photoH);

  // Wood grain lines
  ctx.strokeStyle = 'rgba(55, 28, 10, 0.16)';
  ctx.lineWidth = 2;
  for (let y = 8; y < photoH; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(photoW * 0.33, y + 8, photoW * 0.66, y - 8, photoW, y + 4);
    ctx.stroke();
  }

  // Perspective-tilted A4 paper quad on the table!
  // Let's render the 640x640 sheet frame onto a realistic perspective quad using strip homography!
  const paperPadding = 38;
  const fullPaper = document.createElement('canvas');
  fullPaper.width = FRAME_SIZE + paperPadding * 2;
  fullPaper.height = FRAME_SIZE + paperPadding * 2 + 44;
  const fpCtx = fullPaper.getContext('2d');
  fpCtx.fillStyle = '#faf8f2';
  fpCtx.fillRect(0, 0, fullPaper.width, fullPaper.height);
  fpCtx.fillStyle = '#0f172a';
  fpCtx.font = 'bold 20px system-ui, sans-serif';
  fpCtx.textAlign = 'center';
  fpCtx.fillText(`QUIVER DIGITAL AQUARIUM • ${species.toUpperCase()} SHEET`, fullPaper.width / 2, 34);
  fpCtx.drawImage(sheet, paperPadding, paperPadding + 26);

  // Perspective quad of the full paper on the desk (slight camera angle!)
  const pQuad = [
    { x: 205, y: 68 },
    { x: 702, y: 86 },
    { x: 764, y: 648 },
    { x: 138, y: 626 }
  ];

  // Drop shadow under paper
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath();
  ctx.moveTo(pQuad[0].x + 12, pQuad[0].y + 18);
  ctx.lineTo(pQuad[1].x + 16, pQuad[1].y + 18);
  ctx.lineTo(pQuad[2].x + 18, pQuad[2].y + 22);
  ctx.lineTo(pQuad[3].x + 10, pQuad[3].y + 22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Warp fullPaper onto photo using inverse homography!
  const srcCorners = [
    { x: 0, y: 0 },
    { x: fullPaper.width, y: 0 },
    { x: fullPaper.width, y: fullPaper.height },
    { x: 0, y: fullPaper.height }
  ];
  const Hinv = solveHomography(pQuad, srcCorners);
  const fpData = fpCtx.getImageData(0, 0, fullPaper.width, fullPaper.height).data;
  const outImg = ctx.getImageData(0, 0, photoW, photoH);
  const od = outImg.data;

  for (let y = 50; y < 665; y++) {
    for (let x = 120; x < 780; x++) {
      const denom = Hinv[6] * x + Hinv[7] * y + 1;
      const u = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / denom;
      const v = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / denom;
      if (u >= 0 && v >= 0 && u < fullPaper.width - 1 && v < fullPaper.height - 1) {
        const ui = u | 0;
        const vi = v | 0;
        const sIdx = (vi * fullPaper.width + ui) * 4;
        const dIdx = (y * photoW + x) * 4;
        // Subtle indoor warm room shadow gradient across the paper!
        const shade = 0.86 + (1 - x / photoW) * 0.12;
        od[dIdx] = Math.min(255, fpData[sIdx] * shade);
        od[dIdx + 1] = Math.min(255, fpData[sIdx + 1] * shade * 0.98);
        od[dIdx + 2] = Math.min(255, fpData[sIdx + 2] * shade * 0.94);
      }
    }
  }
  ctx.putImageData(outImg, 0, 0);
  return photo;
}
