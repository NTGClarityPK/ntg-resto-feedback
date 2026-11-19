import type { CategoryId, DishItem, Sentiment, SessionInfo, SessionStatus } from "./types";

const BASE = import.meta.env.VITE_FUNCTIONS_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// 128 random bits as hex. crypto.randomUUID() is not used because browsers only offer it on
// https (or localhost) pages; getRandomValues works everywhere, including a plain-http address.
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// A random id kept on the device. The server only ever stores a keyed hash of it.
let memoryDeviceId: string | null = null;
function deviceId(): string {
  const key = "tf_device";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = randomId();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // Storage blocked (some private modes): keep one id for this page visit.
    return (memoryDeviceId ??= randomId());
  }
}

async function call<T>(fn: string, body: unknown): Promise<T & { status?: string; error?: string }> {
  const res = await fetch(`${BASE}/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      authorization: `Bearer ${ANON}`,
      "x-device-id": deviceId(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ...(data as T), status: data.status ?? (res.ok ? undefined : "error"), error: data.error };
}

export function checkSession(qr: string): Promise<SessionStatus> {
  return call<Record<string, unknown>>("session", { qr }).then((d) => {
    if (d.status === "open") return { status: "open", info: d as unknown as SessionInfo };
    return { status: (d.status as "expired") ?? "error" };
  });
}

export async function readBill(qr: string, imageBase64: string, mediaType: string) {
  const d = await call<{ dishes: string[]; rawText: string }>("read-bill", { qr, imageBase64, mediaType });
  if (d.status !== "ok") throw new Error(d.error ?? "ocr_failed");
  return { dishes: d.dishes ?? [], rawText: d.rawText ?? "" };
}

export interface SubmitInput {
  qr: string;
  ocrText: string;
  dishes: DishItem[];
  categories: Partial<Record<CategoryId, Sentiment>>;
  review: string;
}

export async function submitFeedback(input: SubmitInput): Promise<"saved" | "already_submitted" | "limit_reached" | "expired"> {
  const d = await call<Record<string, unknown>>("submit-feedback", {
    qr: input.qr,
    ocrText: input.ocrText,
    dishes: input.dishes.map((x) => ({ name: x.name })),
    dishRatings: input.dishes
      .filter((x) => x.rating)
      .map((x) => ({ name: x.name, rating: x.rating, tags: x.tags })),
    categoryRatings: input.categories,
    review: input.review,
  });
  if (d.status === "saved" || d.status === "already_submitted" || d.status === "limit_reached" || d.status === "expired") {
    return d.status;
  }
  throw new Error(d.error ?? "submit_failed");
}

export interface ReviewInput {
  qr: string;
  dishes: DishItem[];
  categories: Partial<Record<CategoryId, Sentiment>>;
  review: string;
}

// Drafts a Google review from the guest's answers. null when the receipt has no Google link.
export async function draftReview(input: ReviewInput): Promise<{ text: string; stars: number } | null> {
  const d = await call<{ text?: string; stars?: number }>("draft-review", {
    qr: input.qr,
    dishRatings: input.dishes
      .filter((x) => x.rating)
      .map((x) => ({ name: x.name, rating: x.rating, tags: x.tags })),
    categoryRatings: input.categories,
    review: input.review,
  });
  if (d.status !== "ok" || typeof d.text !== "string") return null;
  return { text: d.text, stars: typeof d.stars === "number" ? d.stars : 5 };
}
