export type Face = "good" | "okay" | "bad";
export type CategoryId = "service" | "food" | "speed" | "clean" | "ambience" | "value";
export type Sentiment = "happy" | "neutral" | "sad";

export interface Category { id: CategoryId; label: string }

// The visit ratings, shown three per screen so nobody has to scroll.
export const CATEGORY_GROUPS: { title: string; sub: string; items: Category[] }[] = [
  {
    title: "Food & Service",
    sub: "How were the food and the team looking after you?",
    items: [
      { id: "food", label: "Food quality" },
      { id: "service", label: "Service" },
      { id: "speed", label: "Speed" },
    ],
  },
  {
    title: "Place & Value",
    sub: "How did the place feel, and was it worth it?",
    items: [
      { id: "clean", label: "Cleanliness" },
      { id: "ambience", label: "Ambience" },
      { id: "value", label: "Value for money" },
    ],
  },
];

// "What went wrong?" options: short labels that fit any item on the menu,
// whether a curry, a dessert or a drink.
export const BAD_TAGS = [
  "Taste",        // too salty, too sweet, too spicy, bland...
  "Freshness",
  "Temperature",  // hot food served cold, ice cream melted, warm drink...
  "Cooking",      // under or over done, soggy, burnt, watery...
  "Portion Size",
  "Long Wait",
  "Wrong Item",
  "Hygiene",
] as const;

export interface DishItem {
  id: string;
  name: string;
  rating: Face | null;
  tags: string[];
}

// Receipt details from a v2 QR. dishes is empty when the bill was too long to fit in the QR,
// in which case the guest photographs the bill instead.
export interface SessionReceipt {
  restaurant: string | null;
  table: string | null;
  dishes: string[];
  itemCount: number | null;
  googleReviewUrl?: string | null; // set when the restaurant added its Google review link
}

export interface SessionInfo {
  status: "open";
  tenantId: string;
  orderId: string;
  expiresAt: string;
  remainingMs: number;
  receipt: SessionReceipt | null;
}

export type SessionStatus =
  | { status: "open"; info: SessionInfo }
  | { status: "expired" | "already_submitted" | "limit_reached" | "invalid" | "error" };
