import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { checkSession, readBill, submitFeedback } from "./api";
import { shrinkToJpeg } from "./image";
import { extractQrToken, readQrFromPhoto } from "./qrScan";
import { AlertIcon, Centered, CheckIcon, Face, Progress, TopBar } from "./components";
import { BAD_TAGS, CATEGORIES, type CategoryId, type DishItem, type Face as FaceKind, type SessionInfo, type Sentiment } from "./types";

const RESTAURANT = "Umair's Test Kitchen";

type Phase =
  | "boot" | "blocked" | "landing" | "scan" | "reading" | "confirm"
  | "dishes" | "experience" | "review" | "sending" | "thanks";

type BlockReason = "missing" | "invalid" | "expired" | "already_submitted" | "limit_reached" | "error";

const BLOCK_COPY: Record<BlockReason, { title: string; body: string; warn: boolean }> = {
  missing: { title: "Scan your receipt", body: "Scan the QR code printed on your bill to share feedback.", warn: false },
  invalid: { title: "This QR code isn't valid", body: "We couldn't verify this receipt. Please scan the QR code printed on your bill.", warn: true },
  expired: { title: "This receipt has expired", body: "Feedback can be given within 24 hours of your visit. Thank you for dining with us.", warn: true },
  already_submitted: { title: "Already submitted", body: "You've already shared feedback for this bill. Thank you!", warn: false },
  limit_reached: { title: "Daily limit reached", body: "This device has already sent its feedback for today. Please try again tomorrow.", warn: true },
  error: { title: "Something went wrong", body: "We couldn't load this bill. Please try scanning again.", warn: true },
};

let idCounter = 0;
const newId = () => `d${Date.now()}-${idCounter++}`;

// Countdown text: "2:59:59" while an hour or more is left, then "59:59".
function fmt(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// The token is read from #qr=... (new receipts: the part after # never reaches the web server,
// so receipt contents stay out of hosting logs) or ?qr=... (older receipts).
function readQr(): string {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("qr");
  return fromHash || new URLSearchParams(window.location.search).get("qr") || "";
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [reason, setReason] = useState<BlockReason>("invalid");
  const [qr] = useState(readQr);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [now, setNow] = useState(Date.now());

  const [ocrText, setOcrText] = useState("");
  const [dishes, setDishes] = useState<DishItem[]>([]);
  const [dishIdx, setDishIdx] = useState(0);
  const [newDish, setNewDish] = useState("");
  const [categories, setCategories] = useState<Partial<Record<CategoryId, Sentiment>>>({});
  const [review, setReview] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const advancing = useRef(false);

  const block = (r: BlockReason) => { setReason(r); setPhase("blocked"); };

  // Check the signed QR once on load.
  useEffect(() => {
    if (!qr) return void block("missing");
    checkSession(qr).then((s) => {
      if (s.status === "open") {
        setSession(s.info);
        // The QR lists what was ordered: no photo or OCR needed.
        const fromReceipt = s.info.receipt?.dishes ?? [];
        if (fromReceipt.length) setDishes(fromReceipt.map((name) => ({ id: newId(), name, rating: null, tags: [] })));
        setPhase("landing");
      } else {
        block(s.status === "error" ? "error" : (s.status as BlockReason));
      }
    }).catch(() => block("error"));
  }, [qr]);

  // Live countdown. Closing the window blocks the form.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remainingMs = session ? new Date(session.expiresAt).getTime() - now : 0;
  useEffect(() => {
    if (session && remainingMs <= 0 && phase !== "thanks" && phase !== "blocked") block("expired");
  }, [remainingMs, session, phase]);

  const timer = session && remainingMs > 0 ? fmt(remainingMs) : undefined;

  const currentDish = dishes[dishIdx];
  // True when the dishes came from the signed QR; the photo and confirm steps are skipped.
  const receiptDishes = (session?.receipt?.dishes.length ?? 0) > 0;
  const brand = session?.receipt?.restaurant || RESTAURANT;

  async function handlePhoto(file: File) {
    setNotice(null);
    setPhase("reading");
    try {
      const { base64, mediaType } = await shrinkToJpeg(file);
      const out = await readBill(qr, base64, mediaType);
      setOcrText(out.rawText);
      setDishes(out.dishes.map((name) => ({ id: newId(), name, rating: null, tags: [] })));
      if (out.dishes.length === 0) setNotice("We couldn't read any dishes. Add them below.");
      setPhase("confirm");
    } catch {
      setNotice("We couldn't read that photo. Try again in better light, or add your dishes manually.");
      setPhase("scan");
    }
  }

  function addDish() {
    const name = newDish.trim().slice(0, 80);
    if (!name) return;
    setDishes((d) => [...d, { id: newId(), name, rating: null, tags: [] }]);
    setNewDish("");
  }

  function removeDish(id: string) {
    setDishes((d) => d.filter((x) => x.id !== id));
  }

  function startRating() {
    setDishIdx(0);
    setPhase(dishes.length ? "dishes" : "experience");
  }

  function setRating(face: FaceKind) {
    if (!currentDish) return;
    setDishes((list) => list.map((d, i) => (i === dishIdx ? { ...d, rating: face, tags: face === "bad" ? d.tags : [] } : d)));
    if (face !== "bad" && !advancing.current) {
      advancing.current = true;
      // Brief beat so the selection registers before the next dish appears.
      setTimeout(() => {
        advancing.current = false;
        goNextDish();
      }, 260);
    }
  }

  function toggleTag(tag: string) {
    setDishes((list) => list.map((d, i) => (
      i === dishIdx
        ? { ...d, tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag] }
        : d
    )));
  }

  function goNextDish() {
    if (dishIdx < dishes.length - 1) setDishIdx(dishIdx + 1);
    else setPhase("experience");
  }

  function skipDish() {
    setDishes((list) => list.map((d, i) => (i === dishIdx ? { ...d, rating: null, tags: [] } : d)));
    goNextDish();
  }

  function toggleCategory(id: CategoryId, v: Sentiment) {
    setCategories((c) => ({ ...c, [id]: c[id] === v ? undefined : v }));
  }

  async function send() {
    setPhase("sending");
    setNotice(null);
    try {
      const result = await submitFeedback({ qr, ocrText, dishes, categories, review: review.trim() });
      if (result === "saved") setPhase("thanks");
      else block(result === "expired" ? "expired" : result);
    } catch {
      setNotice("Something went wrong sending your feedback. Your answers are still here, so please try again.");
      setPhase("review");
    }
  }

  const rated = useMemo(() => dishes.filter((d) => d.rating).length, [dishes]);

  // ---------- screens ----------

  if (phase === "boot") {
    return <Shell><div className="screen center"><p className="sub">Loading…</p></div></Shell>;
  }

  if (phase === "blocked") {
    const c = BLOCK_COPY[reason];
    return (
      <Shell>
        <Centered icon={<AlertIcon />} tone={c.warn ? "warn" : "ok"} title={c.title}>
          <p className="sub narrow">{c.body}</p>
          {reason !== "limit_reached" && <ScanQrButton />}
        </Centered>
      </Shell>
    );
  }

  if (phase === "landing" && session) {
    return (
      <Shell>
        <div className="screen fade">
          <TopBar brand={brand} timer={timer} />
          <div className="hero"><div className="hero-mark"><Face kind="happy" size={72} /></div></div>
          <div className="eyebrow">{session.receipt?.table ? `Table ${session.receipt.table}` : "Table feedback"}</div>
          <h1>How was your meal?</h1>
          <p className="sub">
            {receiptDishes
              ? `Rate the ${dishes.length === 1 ? "dish" : `${dishes.length} dishes`} on your bill and tell us about your visit. It takes about a minute.`
              : "Snap a photo of your bill, rate what you ordered, and tell us about your visit. It takes about a minute."}
          </p>
          <div className="meta">
            <div><span className="dot" />Skip anything you like</div>
            <div><span className="dot" />One feedback per bill</div>
            <div><span className="dot" />Your review goes to the restaurant only</div>
          </div>
          <div className="footer">
            <button className="btn" onClick={() => (receiptDishes ? startRating() : setPhase("scan"))}>Start</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "scan") {
    return (
      <Shell>
        <div className="screen fade">
          <TopBar onBack={() => setPhase("landing")} timer={timer} brand={brand} />
          <Progress step={0} />
          <h1>Scan your bill</h1>
          <p className="sub">Take a clear photo of the bill so we can find what you ordered.</p>
          {notice && <p className="notice">{notice}</p>}
          <div className="footer">
            <label className="btn file-btn">
              Take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ""; }}
              />
            </label>
            <button className="link" onClick={() => { setDishes([]); setPhase("confirm"); }}>Enter dishes manually</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "reading") {
    return (
      <Shell>
        <div className="screen center fade">
          <div className="spinner" aria-hidden="true" />
          <h1>Reading your bill…</h1>
          <p className="sub">This takes a few seconds.</p>
        </div>
      </Shell>
    );
  }

  if (phase === "confirm") {
    return (
      <Shell>
        <div className="screen fade">
          <TopBar onBack={() => setPhase("scan")} timer={timer} brand={brand} />
          <Progress step={0} />
          <h1>Your dishes</h1>
          <p className="sub">Remove anything that isn't on your bill, or add what we missed.</p>
          <div className="chips">
            {dishes.map((d) => (
              <span key={d.id} className="chip">
                {d.name}
                <button aria-label={`Remove ${d.name}`} onClick={() => removeDish(d.id)}>×</button>
              </span>
            ))}
          </div>
          <form className="add-row" onSubmit={(e) => { e.preventDefault(); addDish(); }}>
            <input value={newDish} onChange={(e) => setNewDish(e.target.value)} placeholder="Add a dish" maxLength={80} />
            <button type="submit" className="add-btn" disabled={!newDish.trim()}>Add</button>
          </form>
          <div className="footer">
            <button className="btn" onClick={startRating}>{dishes.length ? "Rate my dishes" : "Continue"}</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "dishes" && currentDish) {
    return (
      <Shell>
        <div className="screen fade">
          <TopBar onBack={() => (dishIdx > 0 ? setDishIdx(dishIdx - 1) : setPhase(receiptDishes ? "landing" : "confirm"))} timer={timer} brand={brand} />
          <Progress step={1} />
          <div className="eyebrow">Dish {dishIdx + 1} of {dishes.length}</div>
          <h1 className="h1-sm">{currentDish.name}</h1>
          <p className="sub spaced">How was it?</p>
          <div className="card stack-14">
            <div className="seg">
              <RateButton face="good" label="Good" selected={currentDish.rating === "good"} onClick={() => setRating("good")} />
              <RateButton face="okay" label="Okay" selected={currentDish.rating === "okay"} onClick={() => setRating("okay")} />
              <RateButton face="bad" label="Not good" selected={currentDish.rating === "bad"} onClick={() => setRating("bad")} />
            </div>
            {currentDish.rating === "bad" && (
              <div>
                <div className="eyebrow tight">What went wrong? (optional)</div>
                <div className="tags">
                  {BAD_TAGS.map((t) => (
                    <button key={t} className={`tag ${currentDish.tags.includes(t) ? "on" : ""}`} onClick={() => toggleTag(t)}>{t}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="footer">
            {currentDish.rating === "bad" && (
              <button className="btn" onClick={goNextDish}>{dishIdx < dishes.length - 1 ? "Next dish" : "Continue"}</button>
            )}
            <button className="link" onClick={skipDish}>Skip this dish</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "experience") {
    return (
      <Shell>
        <div className="screen fade">
          <TopBar onBack={() => (dishes.length ? (setDishIdx(dishes.length - 1), setPhase("dishes")) : setPhase("confirm"))} timer={timer} brand={brand} />
          <Progress step={2} />
          <h1>Your visit</h1>
          <p className="sub spaced">Rate what you noticed. Skip anything you didn't experience.</p>
          <div className="stack">
            {CATEGORIES.map((c) => (
              <div key={c.id} className="card stack-12">
                <div className="cat-label">{c.label}</div>
                <div className="faces">
                  {(["happy", "neutral", "sad"] as Sentiment[]).map((k) => (
                    <button
                      key={k}
                      className={`face-btn ${categories[c.id] === k ? "on" : ""}`}
                      onClick={() => toggleCategory(c.id, k)}
                      aria-pressed={categories[c.id] === k}
                    >
                      <Face kind={k} size={28} />
                      {k === "happy" ? "Good" : k === "neutral" ? "Okay" : "Poor"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="footer">
            <button className="btn" onClick={() => setPhase("review")}>Continue</button>
            <button className="link" onClick={() => setPhase("review")}>Skip this step</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "review" || phase === "sending") {
    const sending = phase === "sending";
    return (
      <Shell>
        <div className="screen fade">
          <TopBar onBack={() => setPhase("experience")} timer={timer} brand={brand} />
          <Progress step={3} />
          <h1>Anything else?</h1>
          <p className="sub spaced">Optional. Share a short review for the team.</p>
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            maxLength={500}
            placeholder="Tell us what made your visit memorable, or what we could do better…"
            disabled={sending}
          />
          <div className="counter">{review.length}/500</div>
          {notice && <p className="notice">{notice}</p>}
          <div className="footer">
            <p className="sub small center-text">You can submit once for this bill. {rated > 0 ? `${rated} dish${rated > 1 ? "es" : ""} rated.` : ""}</p>
            <button className="btn" onClick={send} disabled={sending}>{sending ? "Sending…" : "Submit feedback"}</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "thanks") {
    return (
      <Shell>
        <Centered icon={<CheckIcon />} title="Thank you">
          <p className="sub narrow">Your feedback for this table has been sent to {brand}.</p>
          <p className="sub small narrow">This bill is now closed for feedback.</p>
        </Centered>
      </Shell>
    );
  }

  return <Shell><div className="screen center"><p className="sub">Loading…</p></div></Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="device">{children}</div>;
}

// Opens the camera, reads the QR on the bill and loads it on this same site.
// Keeping the current origin means a QR printed with another domain still works here.
// The scan error is also kept in sessionStorage. Opening the camera sends the browser to the
// background, and some phones reload the page when it comes back, which would wipe the message.
const SCAN_ERROR_KEY = "tf_scan_error";
function loadScanError(): string | null {
  try { return sessionStorage.getItem(SCAN_ERROR_KEY); } catch { return null; }
}
function saveScanError(msg: string | null) {
  try {
    if (msg) sessionStorage.setItem(SCAN_ERROR_KEY, msg);
    else sessionStorage.removeItem(SCAN_ERROR_KEY);
  } catch {
    // Storage blocked (private mode etc.); the message still shows until a reload.
  }
}

function ScanQrButton() {
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState<string | null>(loadScanError);
  const setError = (msg: string | null) => { saveScanError(msg); setErrorState(msg); };

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const text = await readQrFromPhoto(file);
      const token = text ? extractQrToken(text) : null;
      if (!token) {
        setError(text
          ? "That QR code isn't one of our receipts. Please scan the QR printed on your bill."
          : "We couldn't find a QR code in that photo. Fill most of the photo with the QR, hold steady, and avoid glare.");
        return;
      }
      // Load the bill on this site. The token goes after # so it never reaches the web server,
      // and the reload makes the app start over with it (changing only the # does not reload).
      saveScanError(null);
      window.history.replaceState(null, "", `${window.location.pathname}#qr=${encodeURIComponent(token)}`);
      window.location.reload();
    } catch {
      setError("We couldn't read that photo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scan-qr">
      <label className={`btn file-btn${busy ? " disabled" : ""}`}>
        {busy ? "Reading QR…" : error ? "Try again" : "Scan QR code"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
      </label>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}

function RateButton({ face, label, selected, onClick }: { face: FaceKind; label: string; selected: boolean; onClick: () => void }) {
  const cls = selected ? (face === "good" ? "sel-good" : face === "okay" ? "sel-okay" : "sel-bad") : "";
  const sentiment: Sentiment = face === "good" ? "happy" : face === "okay" ? "neutral" : "sad";
  return (
    <button className={`opt ${cls}`} onClick={onClick} aria-pressed={selected}>
      <Face kind={sentiment} size={22} />
      {label}
    </button>
  );
}
