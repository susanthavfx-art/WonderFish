import qrcode from '../vendor/qrcode.mjs';

// Pure client-side QR PNG generator (works on GitHub Pages with zero backend server!)
export function makeQrPngDataUrl(text, size = 260, dark = '#062038', light = '#ffffff') {
  const qr = qrcode(0, 'M');
  qr.addData(String(text || ''));
  qr.make();

  const count = qr.getModuleCount();
  const margin = 2;
  const total = count + margin * 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);

  const cell = size / total;
  ctx.fillStyle = dark;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        const x = Math.floor((c + margin) * cell);
        const y = Math.floor((r + margin) * cell);
        const w = Math.ceil((c + margin + 1) * cell) - x;
        const h = Math.ceil((r + margin + 1) * cell) - y;
        ctx.fillRect(x, y, w, h);
      }
    }
  }

  return canvas.toDataURL('image/png');
}
