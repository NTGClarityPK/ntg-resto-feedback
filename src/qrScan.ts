import jsQR from "jsqr";

// Reads a QR code from a camera photo. Uses a photo instead of a live camera
// stream because a live stream needs HTTPS, and this also works on plain http.
export async function readQrFromPhoto(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("bad_image"));
      i.src = url;
    });
    // Try a few sizes: large phone photos are slow to scan, small ones lose detail.
    for (const maxSide of [1000, 1600, 600]) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
      if (code?.data) return code.data;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
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
