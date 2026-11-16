import jsQR from "jsqr";

// Minimal typing for the browser's built-in barcode reader (Chrome on Android, some others).
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

// Draws a region of the photo onto a canvas, scaled so its longest side is maxSide.
function draw(img: HTMLImageElement, crop: number, maxSide: number): HTMLCanvasElement {
  const sw = img.width * crop;
  const sh = img.height * crop;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Reads a QR code from a camera photo. Uses a photo instead of a live camera
// stream because a live stream needs HTTPS, and this also works on plain http.
export async function readQrFromPhoto(file: File): Promise<string | null> {
  const { img, done } = await loadImage(file);
  try {
    // 1. The phone's own QR reader, when the browser offers one. Most reliable on real photos.
    const detector = await nativeDetector();
    if (detector) {
      for (const [crop, side] of [[1, 2000], [0.6, 2000], [1, 1000]] as const) {
        try {
          const found = await detector.detect(draw(img, crop, side));
          if (found[0]?.rawValue) return found[0].rawValue;
        } catch {
          // Fall through to the next attempt.
        }
      }
    }

    // 2. JavaScript decoder. Try the whole photo and zoomed-in centre crops at a few sizes,
    // because a QR that fills only part of a large photo is easy to miss.
    for (const crop of [1, 0.7, 0.5]) {
      for (const side of [1200, 800, 1800, 600]) {
        const canvas = draw(img, crop, side);
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const code = jsQR(data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) return code.data;
      }
    }
    return null;
  } finally {
    done();
  }
}

// Accepts either a full link (https://.../?qr=<token>) or a bare token, and returns the token.
export function extractQrToken(text: string): string | null {
  const trimmed = text.trim();
  try {
    const token = new URL(trimmed).searchParams.get("qr");
    if (token) return token;
  } catch {
    // Not a URL; fall through and check for a bare token.
  }
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}
