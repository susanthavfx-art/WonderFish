import {
  SPECIES_LIST,
  getSpeciesMeta,
  drawCreatureSilhouette,
  preloadCustomCreatureAssets
} from './creatures.js';
import {
  renderPrintableFrameToCanvas,
  createSimulatedDeskPhoto,
  INNER_OFFSET,
  INNER_SIZE,
  FRAME_SIZE
} from './vision.js';
import { makeQrPngDataUrl } from './qr.js';

const CRAYON_COLORS = [
  '#ff5400', '#ffbe0b', '#ff006e', '#8338ec',
  '#3a86ff', '#00bbf9', '#06d6a0', '#52b788',
  '#fb5607', '#ef476f', '#8d5b4c', '#ffffff'
];

class PrintableSheetsApp {
  constructor() {
    this.activeSpecies = 'clownfish';
    this.testDrawEnabled = false;
    this.activeColor = CRAYON_COLORS[0];
    this.brushSize = 20;
    this.isDrawing = false;
    this.lastPt = null;
    this.lastBlobUrl = null;

    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = INNER_SIZE;
    this.paintCanvas.height = INNER_SIZE;
    this.clearPaintLayer();

    this.displayCanvas = document.getElementById('sheet-frame-canvas');

    this.initUI();
    this.renderSheet();
    preloadCustomCreatureAssets().then(() => this.renderSheet());
  }

  clearPaintLayer() {
    const pctx = this.paintCanvas.getContext('2d');
    pctx.fillStyle = '#ffffff';
    pctx.fillRect(0, 0, INNER_SIZE, INNER_SIZE);
  }

  initUI() {
    const tabsWrap = document.getElementById('species-tabs');
    if (tabsWrap) {
      for (const s of SPECIES_LIST) {
        const btn = document.createElement('button');
        btn.className = `species-tab ${s.id === this.activeSpecies ? 'active' : ''}`;
        btn.dataset.species = s.id;
        btn.innerHTML = `<span>${s.emoji}</span> <span>${s.name}</span>`;
        btn.addEventListener('click', () => {
          this.activeSpecies = s.id;
          document.querySelectorAll('.species-tab').forEach((b) => b.classList.toggle('active', b === btn));
          this.clearPaintLayer();
          this.renderSheet();
        });
        tabsWrap.appendChild(btn);
      }
    }

    // Pure client-side PNG QR code pointing to ./scan.html (works on GitHub Pages subpaths!)
    const scanUrl = new URL('./scan.html', window.location.href).href;
    const sheetQr = document.getElementById('sheet-qr-img');
    if (sheetQr) {
      sheetQr.src = makeQrPngDataUrl(scanUrl, 260, '#000000', '#ffffff');
    }

    document.getElementById('btn-print-sheet')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('btn-download-png')?.addEventListener('click', () => {
      this.downloadPrintableA4Png();
    });

    document.getElementById('btn-close-dl-modal')?.addEventListener('click', () => {
      document.getElementById('download-ready-modal')?.classList.add('hidden');
    });

    const toggleBtn = document.getElementById('btn-toggle-crayon');
    const toolbar = document.getElementById('crayon-toolbar');
    toggleBtn?.addEventListener('click', () => {
      this.testDrawEnabled = !this.testDrawEnabled;
      toolbar?.classList.toggle('hidden', !this.testDrawEnabled);
      toggleBtn.classList.toggle('active-pill', this.testDrawEnabled);
      this.displayCanvas.style.cursor = this.testDrawEnabled ? 'crosshair' : 'default';
    });

    const swatches = document.getElementById('crayon-swatches');
    if (swatches) {
      CRAYON_COLORS.forEach((col, i) => {
        const b = document.createElement('button');
        b.className = `swatch-btn ${i === 0 ? 'selected' : ''}`;
        b.style.background = col;
        b.addEventListener('click', () => {
          this.activeColor = col;
          document.querySelectorAll('.swatch-btn').forEach((el) => el.classList.toggle('selected', el === b));
        });
        swatches.appendChild(b);
      });
    }

    document.getElementById('brush-size-range')?.addEventListener('input', (e) => {
      this.brushSize = Number(e.target.value) || 20;
    });

    document.getElementById('btn-clear-crayon')?.addEventListener('click', () => {
      this.clearPaintLayer();
      this.renderSheet();
    });

    document.getElementById('btn-send-to-scanner')?.addEventListener('click', () => {
      const compositedInner = this.buildCompositedInnerCanvas();
      const deskPhoto = createSimulatedDeskPhoto(this.activeSpecies, compositedInner);
      try {
        localStorage.setItem(
          'quiver_virtual_sheet',
          JSON.stringify({
            species: this.activeSpecies,
            dataUrl: deskPhoto.toDataURL('image/jpeg', 0.92)
          })
        );
      } catch (_) {}
      window.location.href = `./scan.html?tank=${encodeURIComponent(activeTank)}`;
    });

    this.setupDrawingEvents();
  }

  setupDrawingEvents() {
    if (!this.displayCanvas) return;

    const toInnerPt = (e) => {
      const rect = this.displayCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const fx = ((clientX - rect.left) / rect.width) * FRAME_SIZE;
      const fy = ((clientY - rect.top) / rect.height) * FRAME_SIZE;
      return { x: fx - INNER_OFFSET, y: fy - INNER_OFFSET };
    };

    const strokeSegment = (p1, p2) => {
      const ctx = this.paintCanvas.getContext('2d');
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.activeColor;
      ctx.lineWidth = this.brushSize;
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
      this.renderSheet();
    };

    const down = (e) => {
      if (!this.testDrawEnabled) return;
      e.preventDefault();
      this.isDrawing = true;
      this.lastPt = toInnerPt(e);
      strokeSegment(this.lastPt, this.lastPt);
    };

    const move = (e) => {
      if (!this.testDrawEnabled || !this.isDrawing) return;
      e.preventDefault();
      const pt = toInnerPt(e);
      strokeSegment(this.lastPt, pt);
      this.lastPt = pt;
    };

    const up = () => {
      this.isDrawing = false;
      this.lastPt = null;
    };

    this.displayCanvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);

    this.displayCanvas.addEventListener('touchstart', down, { passive: false });
    this.displayCanvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  }

  buildCompositedInnerCanvas() {
    const out = document.createElement('canvas');
    out.width = INNER_SIZE;
    out.height = INNER_SIZE;
    const ctx = out.getContext('2d');

    drawCreatureSilhouette(ctx, this.activeSpecies, INNER_SIZE, 'outline');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.paintCanvas, 0, 0);
    ctx.restore();
    return out;
  }

  renderSheet() {
    const meta = getSpeciesMeta(this.activeSpecies);
    const titleEl = document.getElementById('sheet-species-title');
    if (titleEl) titleEl.textContent = `${meta.emoji} ${meta.sinhala}`;

    const inner = this.buildCompositedInnerCanvas();
    renderPrintableFrameToCanvas(this.displayCanvas, this.activeSpecies, inner);
  }

  buildA4SheetCanvas() {
    const meta = getSpeciesMeta(this.activeSpecies);
    const a4 = document.createElement('canvas');
    a4.width = 1240;
    a4.height = 1754;
    const ctx = a4.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, a4.width, a4.height);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QUIVER DIGITAL AQUARIUM', a4.width / 2, 95);

    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(`Coloring Sheet: ${meta.name} (${meta.emoji})`, a4.width / 2, 148);

    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('1. Color inside the lines   •   2. Keep the 4 black corner squares clean   •   3. Scan with Phone Camera!', a4.width / 2, 198);

    const frameSize = 1040;
    ctx.drawImage(this.displayCanvas, (a4.width - frameSize) / 2, 245, frameSize, frameSize);

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(220, 1420);
    ctx.lineTo(1020, 1420);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillText('Artist Name / ඔයාගේ නම', a4.width / 2, 1465);

    const qrImg = document.getElementById('sheet-qr-img');
    if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
      ctx.drawImage(qrImg, a4.width / 2 - 75, 1505, 150, 150);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText('Scan QR to open Camera Scanner', a4.width / 2, 1685);
    }

    return a4;
  }

  downloadPrintableA4Png() {
    const a4 = this.buildA4SheetCanvas();
    const filename = `Digital-Aquarium-Sheet-${this.activeSpecies}.png`;

    a4.toBlob((blob) => {
      if (!blob) return;
      if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
      const blobUrl = URL.createObjectURL(blob);
      this.lastBlobUrl = blobUrl;

      // 1-click native download on GitHub Pages & regular browser tabs!
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);

      // Also show preview modal if running inside a sandboxed iframe
      if (window.self !== window.top) {
        const modal = document.getElementById('download-ready-modal');
        const modalImg = document.getElementById('dl-modal-img');
        const openTab = document.getElementById('dl-open-newtab');
        const directLink = document.getElementById('dl-direct-link');
        if (modalImg) modalImg.src = blobUrl;
        if (openTab) openTab.href = `./coloring-sheets/${filename}`;
        if (directLink) {
          directLink.href = `./coloring-sheets/${filename}`;
          directLink.setAttribute('download', filename);
        }
        modal?.classList.remove('hidden');
      }
    }, 'image/png');
  }
}

new PrintableSheetsApp();
