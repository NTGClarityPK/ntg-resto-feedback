export type Face = "good" | "okay" | "bad";
export type CategoryId = "service" | "food" | "speed" | "clean" | "ambience" | "value" | "parking";
export type Sentiment = "happy" | "neutral" | "sad";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "service", label: "Service" },
  { id: "food", label: "Food quality" },
  { id: "speed", label: "Speed" },
  { id: "clean", label: "Cleanliness" },
  { id: "ambience", label: "Ambience" },
  { id: "value", label: "Value for money" },
  { id: "parking", label: "Parking" },
];

export const BAD_TAGS = [
  "Cold", "Too salty", "Too spicy", "Undercooked", "Oily", "Small portion", "Came late", "Wrong item",
] as const;

export interface DishItem {
  id: string;
  name: string;
  rating: Face | null;
  tags: string[];
}

export interface SessionInfo {
  status: "open";
  tenantId: string;
  orderId: string;
  expiresAt: string;
  remainingMs: number;
}

export type SessionStatus =
  | { status: "open"; info: SessionInfo }
  | { status: "expired" | "already_submitted" | "limit_reached" | "invalid" | "error" };
