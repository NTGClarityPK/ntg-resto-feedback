import jsQR from "jsqr";
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

// Serve the ZXing engine from this app instead of the default public CDN.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? zxingWasmUrl : prefix + path),
  },
});

const ZXING_OPTIONS: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

// Minimal typing for the browser's built-in barcode reader. Browsers only offer it on
// https pages, so it is missing on a plain-http test address and the code below takes over.
type Detector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts: { formats: string[] }): Detector;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

async function nativeDetector(): Promise<Detector | null> {
  const BD = window.BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new BD({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

function loadImage(file: File): Promise<{ img: HTMLImageElement; done: () => void }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad_image")); };
    img.src = url;
  });
}

// Draws the centre `crop` share of the photo onto a canvas whose longest side is maxSide.
function draw(img: HTMLImageElement, crop: number, maxSide: number): HTMLCanvasElement {
  const sw = img.naturalWidth * crop;
  const sh = img.naturalHeight * crop;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const pixels = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);

// Whole photo first, then zoomed-in centre crops, at sizes that suit a phone's memory.
const ATTEMPTS: Array<[crop: number, maxSide: number]> = [[1, 1600], [0.6, 1600], [1, 2400], [0.4, 1200], [1, 1000]];

// Reads a QR code from a camera photo. Uses a photo instead of a live camera
// stream because a live stream needs HTTPS, and this also works on plain http.
export async function readQrFromPhoto(file: File): Promise<string | null> {
  const { img, done } = await loadImage(file);
  try {
    // 1. The phone's own reader, when the browser offers it (https pages only).
    const detector = await nativeDetector();
    if (detector) {
      for (const [crop, side] of ATTEMPTS.slice(0, 3)) {
        try {
          const found = await detector.detect(draw(img, crop, side));
          if (found[0]?.rawValue) return found[0].rawValue;
        } catch {
          // Try the next attempt.
        }
      }
    }

    // 2. ZXing: the same decoder many scanning apps use. Copes with blur, angle and uneven light.
    for (const [crop, side] of ATTEMPTS) {
      try {
        const [hit] = await readBarcodes(pixels(draw(img, crop, side)), ZXING_OPTIONS);
        if (hit?.isValid && hit.text) return hit.text;
      } catch {
        break; // The engine failed to load; fall back to jsQR below.
      }
    }

    // 3. Last resort: the small JavaScript decoder.
    for (const [crop, side] of ATTEMPTS) {
      const data = pixels(draw(img, crop, side));
      const code = jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
      if (code?.data) return code.data;
    }
    return null;
  } finally {
    done();
  }
}

// Accepts a full link (https://.../#qr=<token> or https://.../?qr=<token>) or a bare token,
// and returns the token. Tokens are "<payload>.<sig>" (v1) or "2.<payload>.<sig>" (v2).
const TOKEN = /^(2\.)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export function extractQrToken(text: string): string | null {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const token = new URLSearchParams(url.hash.slice(1)).get("qr") || url.searchParams.get("qr");
    if (token) return TOKEN.test(token) ? token : null;
  } catch {
    // Not a URL; fall through and check for a bare token.
  }
  return TOKEN.test(trimmed) ? trimmed : null;
}
