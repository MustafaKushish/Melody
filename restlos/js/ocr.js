// Texterkennung für Kassenbon-Fotos – läuft komplett im Browser (Tesseract.js), das Foto verlässt das Gerät nicht.
// Die Bibliothek (~3 MB inkl. deutscher Sprachdaten) wird erst beim ersten Scan geladen.
const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading;

function loadLib() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => resolve(globalThis.Tesseract);
    s.onerror = () => { loading = null; reject(new Error('Texterkennung konnte nicht geladen werden. Bist du online?')); };
    document.head.append(s);
  });
  return loading;
}

// Bon-Fotos sind oft schief beleuchtet: verkleinern, Graustufen, Kontrast hoch.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 140));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function recognize(file, onProgress = () => {}) {
  onProgress(0.02, 'Texterkennung wird geladen …');
  const T = await loadLib();
  const worker = await T.createWorker('deu', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'Bon wird gelesen …');
      else if (m.status?.includes('loading')) onProgress(0.05 + (m.progress || 0) * 0.25, 'Sprachdaten werden geladen …');
    },
  });
  try {
    const canvas = await prepare(file);
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    worker.terminate();
  }
}
