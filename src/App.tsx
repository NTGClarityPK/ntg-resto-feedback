import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { checkSession, readBill, submitFeedback } from "./api";
import { shrinkToJpeg } from "./image";
import { extractQrToken, readQrFromPhoto } from "./qrScan";
import { ArrowIcon, BrandLine, Face, Header, Row, delay, pad2 } from "./components";
import { BAD_TAGS, CATEGORY_GROUPS, type CategoryId, type DishItem, type Face as FaceKind, type SessionInfo, type Sentiment } from "./types";


type Phase =
  | "boot" | "blocked" | "landing" | "scan" | "reading" | "confirm"
  | "dishes" | "experience" | "review" | "sending" | "thanks" | "closed";

// Browsers only let a page close a tab that a script opened, so a tab opened by scanning a QR
// code can't be closed from here. Close shows a final "All done" screen instead.

// Bills this phone has sent feedback for, so reopening one shows "All done" rather than
// "Already submitted". Keyed by the QR signature (the part after the last dot).
const SENT_KEY = "feedback-sent";
const qrKey = (qr: string) => qr.slice(qr.lastIndexOf(".") + 1).slice(0, 32);
function sentHere(qr: string): boolean {
  try { return (JSON.parse(localStorage.getItem(SENT_KEY) || "[]") as string[]).includes(qrKey(qr)); } catch { return false; }
}
function markSent(qr: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(SENT_KEY) || "[]") as string[]).filter((k) => k !== qrKey(qr));
    localStorage.setItem(SENT_KEY, JSON.stringify([...list, qrKey(qr)].slice(-50)));
  } catch { /* storage blocked: the server still stops a second submission */ }
}

type BlockReason = "missing" | "invalid" | "expired" | "already_submitted" | "limit_reached" | "error";

const BLOCK_COPY: Record<BlockReason, { title: string; body: string }> = {
  missing: { title: "Scan your receipt", body: "Scan the QR code printed on your bill to share feedback." },
  invalid: { title: "This QR code isn't valid", body: "We couldn't verify this receipt. Please scan the QR code printed on your bill." },
  expired: { title: "This receipt has expired", body: "Feedback can be given within 24 hours of your visit. Thank you for dining with us." },
  already_submitted: { title: "Already submitted", body: "You've already shared feedback for this bill. Thank you!" },
  limit_reached: { title: "Daily limit reached", body: "This device has already sent its feedback for today. Please try again tomorrow." },
  error: { title: "Something went wrong", body: "We couldn't load this bill. Please try scanning again." },
};

// Pause after a Good or Okay pick so the selection registers before the next dish appears.
const ADVANCE_MS = 560;

let idCounter = 0;
const newId = () => `d${Date.now()}-${idCounter++}`;

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
  const [visitIdx, setVisitIdx] = useState(0); // which of the visit-rating screens is showing
  const [newDish, setNewDish] = useState("");
  const [categories, setCategories] = useState<Partial<Record<CategoryId, Sentiment>>>({});
  const [review, setReview] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const advanceTimer = useRef<number | undefined>(undefined);

  const block = (r: BlockReason) => { setReason(r); setPhase("blocked"); };
  const cancelAdvance = () => window.clearTimeout(advanceTimer.current);

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
      } else if (s.status === "already_submitted" && sentHere(qr)) {
        setPhase("closed");
      } else {
        block(s.status === "error" ? "error" : (s.status as BlockReason));
      }
    }).catch(() => block("error"));
  }, [qr]);

  // Checks the clock every few seconds so an open bill closes when its feedback window ends.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => cancelAdvance, []);

  // No countdown is shown to the guest. The bill still closes when its window ends.
  const remainingMs = session ? new Date(session.expiresAt).getTime() - now : 0;
  useEffect(() => {
    if (session && remainingMs <= 0 && phase !== "thanks" && phase !== "closed" && phase !== "blocked") block("expired");
  }, [remainingMs, session, phase]);

  const currentDish = dishes[dishIdx];
  // True when the dishes came from the signed QR; the photo and confirm steps are skipped.
  const receiptDishes = (session?.receipt?.dishes.length ?? 0) > 0;
  // Restaurant name from the signed receipt QR. Older QRs have none, and then no name is shown.
  const brand = session?.receipt?.restaurant || "";
  const table = session?.receipt?.table;

  // One step per dish, one per visit-rating screen, and the review.
  const totalSteps = dishes.length + CATEGORY_GROUPS.length + 1;

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
    setVisitIdx(0);
    setPhase(dishes.length ? "dishes" : "experience");
  }

  function setRating(face: FaceKind) {
    if (!currentDish) return;
    cancelAdvance();
    setDishes((list) => list.map((d, i) => (i === dishIdx ? { ...d, rating: face, tags: face === "bad" ? d.tags : [] } : d)));
    if (face !== "bad") advanceTimer.current = window.setTimeout(goNextDish, ADVANCE_MS);
  }

  function toggleTag(tag: string) {
    setDishes((list) => list.map((d, i) => (
      i === dishIdx
        ? { ...d, tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag] }
        : d
    )));
  }

  function goNextDish() {
    cancelAdvance();
    if (dishIdx < dishes.length - 1) setDishIdx(dishIdx + 1);
    else { setVisitIdx(0); setPhase("experience"); }
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
      if (result === "saved") { markSent(qr); setPhase("thanks"); }
      else block(result === "expired" ? "expired" : result);
    } catch {
      setNotice("Something went wrong sending your feedback. Your answers are still here, so please try again.");
      setPhase("review");
    }
  }

  const rated = useMemo(() => dishes.filter((d) => d.rating).length, [dishes]);

  // ---------- screens ----------

  if (phase === "boot") {
    return <Shell><div className="screen center"><p className="mono muted">Loading…</p></div></Shell>;
  }

  if (phase === "blocked") {
    const c = BLOCK_COPY[reason];
    return (
      <Shell>
        <div className="screen pad-b">
          <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
            <h1 className="rise display h-screen">{c.title}<span className="red">.</span></h1>
            <p className="rise lede" style={delay(80)}>{c.body}</p>
          </div>
          {reason !== "limit_reached" && <div className="rise" style={delay(160)}><ScanQrButton /></div>}
        </div>
      </Shell>
    );
  }

  if (phase === "landing" && session) {
    return (
      <Shell>
        <div className="screen pad-b">
          <div className="rise" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 14 }}>
            <BrandLine brand={brand} table={table} />
          </div>
          <hr className="rule rise" />
          <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 24 }}>
            <h1 className="rise display h-hero" style={delay(90)}>How was your meal<span className="red">?</span></h1>
            <p className="rise" style={{ ...delay(170), margin: 0, fontSize: 17, lineHeight: 1.5, color: "var(--muted)" }}>
              {receiptDishes
                ? `Rate the ${dishes.length === 1 ? "dish" : `${dishes.length} dishes`} on your bill and tell us about your visit. It takes about a minute.`
                : "Snap a photo of your bill, rate what you ordered, and tell us about your visit. It takes about a minute."}
            </p>
            <div className="rise receipt" style={delay(250)}>
              <Row label="Dishes to rate" value={receiptDishes ? pad2(dishes.length) : "From bill"} />
              <Row label="Time" value="~1 min" />
              <Row label="Skip anything" value="Yes" />
              <Row label="Feedback per bill" value="01" />
              <Row label="Seen by" value="Restaurant only" valueStyle={{ color: "var(--accent-text)" }} />
            </div>
          </div>
          <div className="rise" style={delay(340)}>
            <button className="cta" onClick={() => (receiptDishes ? startRating() : setPhase("scan"))}>Start<ArrowIcon /></button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "scan") {
    return (
      <Shell>
        <Header onBack={() => setPhase("landing")} />
        <div className="screen">
          <h1 className="rise display h-screen">Scan your bill<span className="red">.</span></h1>
          <p className="rise lede" style={delay(60)}>Take a clear photo of the bill so we can find what you ordered.</p>
          <hr className="rule rise" style={{ ...delay(100), marginTop: 20 }} />
          {notice && <p className="notice rise" role="alert">{notice}</p>}
          <div className="grow" />
          <div className="rise actions" style={delay(200)}>
            <label className="cta file-btn">
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
        <div className="screen center" style={{ alignItems: "center", textAlign: "center", gap: 18 }}>
          <div className="spinner" aria-hidden="true" />
          <h1 className="rise display h-screen">Reading your bill<span className="red">…</span></h1>
          <p className="rise mono muted" style={delay(60)}>This takes a few seconds</p>
        </div>
      </Shell>
    );
  }

  if (phase === "confirm") {
    return (
      <Shell>
        <Header onBack={() => setPhase("scan")} />
        <div className="screen">
          <h1 className="rise display h-screen">Your dishes<span className="red">.</span></h1>
          <p className="rise lede" style={delay(60)}>Remove anything that isn't on your bill, or add what we missed.</p>
          <hr className="rule rise" style={{ ...delay(100), marginTop: 20, marginBottom: 20 }} />
          {notice && <p className="notice" style={{ marginTop: 0, marginBottom: 16 }}>{notice}</p>}
          <div className="chips">
            {dishes.map((d) => (
              <span key={d.id} className="chip dish-chip">
                {d.name}
                <button aria-label={`Remove ${d.name}`} onClick={() => removeDish(d.id)}>×</button>
              </span>
            ))}
          </div>
          <form className="add-row" onSubmit={(e) => { e.preventDefault(); addDish(); }}>
            <input value={newDish} onChange={(e) => setNewDish(e.target.value)} placeholder="Add a dish" maxLength={80} />
            <button type="submit" className="add-btn" disabled={!newDish.trim()}>Add</button>
          </form>
          <div className="grow" />
          <div style={{ marginTop: 20 }}>
            <button className="cta" onClick={startRating}>{dishes.length ? "Rate my dishes" : "Continue"}<ArrowIcon /></button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "dishes" && currentDish) {
    const isLast = dishIdx >= dishes.length - 1;
    const back = () => {
      cancelAdvance();
      if (dishIdx > 0) setDishIdx(dishIdx - 1);
      else setPhase(receiptDishes ? "landing" : "confirm");
    };
    const opts: { face: FaceKind; label: string; letter: string; mood: Sentiment }[] = [
      { face: "good", label: "Good", letter: "A", mood: "happy" },
      { face: "okay", label: "Okay", letter: "B", mood: "neutral" },
      { face: "bad", label: "Not good", letter: "C", mood: "sad" },
    ];
    return (
      <Shell>
        <Header onBack={back} step={dishIdx + 1} total={totalSteps} />
        <div className="screen" key={dishIdx}>
          <p className="mono rise muted" style={{ margin: 0 }}>Item {pad2(dishIdx + 1)} / {pad2(dishes.length)}</p>
          <h1 className="rise display h-screen" style={{ ...delay(60), marginTop: 10 }}>{currentDish.name}</h1>
          <hr className="rule rise" style={{ ...delay(100), marginTop: 20 }} />
          <p className="mono rise muted" style={{ ...delay(120), margin: "16px 0 0" }}>How was it?<span className="caret" /></p>
          <div className="stack">
            {opts.map((o, j) => {
              const on = currentDish.rating === o.face;
              return (
                <div key={o.face} className="rise" style={delay(160 + j * 70)}>
                  <button className={on ? "opt on" : "opt"} aria-pressed={on} onClick={() => setRating(o.face)}>
                    <Face kind={o.mood} size={26} />
                    <span>{o.label}</span>
                    <span className="key" aria-hidden="true">{o.letter}</span>
                  </button>
                </div>
              );
            })}
          </div>
          {currentDish.rating === "bad" && (
            <div style={{ marginTop: 22 }}>
              <p className="mono rise muted" style={{ margin: "0 0 10px" }}>What went wrong? / Optional</p>
              <div className="chips">
                {BAD_TAGS.map((t, j) => {
                  const on = currentDish.tags.includes(t);
                  return (
                    <div key={t} className="rise" style={delay(j * 35)}>
                      <button className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => toggleTag(t)}>{t}</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grow" />
          <div className="actions" style={{ marginTop: 20 }}>
            {currentDish.rating === "bad" && (
              <div className="rise">
                <button className="cta" onClick={goNextDish}>{isLast ? "Continue" : "Next dish"}<ArrowIcon /></button>
              </div>
            )}
            <button className="link" onClick={skipDish}>Skip this dish</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "experience") {
    // One screen per group of three visit ratings.
    const group = CATEGORY_GROUPS[visitIdx];
    const lastGroup = visitIdx === CATEGORY_GROUPS.length - 1;
    const next = () => (lastGroup ? setPhase("review") : setVisitIdx(visitIdx + 1));
    const skip = () => {
      setCategories((c) => {
        const out = { ...c };
        for (const item of group.items) delete out[item.id];
        return out;
      });
      next();
    };
    const back = () => {
      if (visitIdx > 0) setVisitIdx(visitIdx - 1);
      else if (dishes.length) { setDishIdx(dishes.length - 1); setPhase("dishes"); }
      else setPhase(receiptDishes ? "landing" : "confirm");
    };
    // "Food & Service" → "Food <red>&</red> Service"
    const [left, right] = group.title.split(" & ");
    return (
      <Shell>
        <Header onBack={back} step={dishes.length + 1 + visitIdx} total={totalSteps} />
        <div className="screen" key={visitIdx}>
          <h1 className="rise display h-screen">
            {right !== undefined ? <>{left} <span className="red">&amp;</span> {right}</> : group.title}
          </h1>
          <p className="rise lede" style={delay(60)}>{group.sub} Skip anything you didn't notice.</p>
          <hr className="rule rise" style={{ ...delay(100), marginTop: 20 }} />
          <div className="svc">
            {group.items.map((c, j) => (
              <div key={c.id} className="rise" style={delay(140 + j * 90)}>
                <p className="mono b" style={{ margin: "0 0 8px" }}>{c.label}</p>
                <div className="segrow">
                  {(["happy", "neutral", "sad"] as Sentiment[]).map((k) => {
                    const on = categories[c.id] === k;
                    return (
                      <button key={k} className={on ? "opt on" : "opt"} aria-pressed={on} onClick={() => toggleCategory(c.id, k)}>
                        <Face kind={k} size={20} />
                        <span>{k === "happy" ? "Good" : k === "neutral" ? "Okay" : "Poor"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="grow" />
          <div className="rise actions" style={{ ...delay(420), marginTop: 20 }}>
            <button className="cta" onClick={next}>Continue</button>
            <button className="link" onClick={skip}>Skip this step</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "review" || phase === "sending") {
    const sending = phase === "sending";
    return (
      <Shell>
        <Header
          onBack={() => { if (!sending) { setVisitIdx(CATEGORY_GROUPS.length - 1); setPhase("experience"); } }}
          step={totalSteps}
          total={totalSteps}
        />
        <div className="screen pad-b">
          <h1 className="rise display h-screen">Anything else<span className="red">?</span></h1>
          <p className="rise lede" style={delay(60)}>Optional. Share a short review for the team.</p>
          <div className="rise" style={{ ...delay(140), marginTop: 22 }}>
            <label htmlFor="mb-review" className="mono b" style={{ display: "block", marginBottom: 8 }}>Note for the team</label>
            <textarea
              id="mb-review"
              value={review}
              onChange={(e) => setReview(e.target.value.slice(0, 500))}
              maxLength={500}
              placeholder="Tell us what made your visit memorable, or what we could do better…"
              disabled={sending}
            />
            <p className="mono muted" style={{ margin: "8px 0 0", textAlign: "right" }}>{review.length}/500</p>
          </div>
          {notice && <p className="notice" role="alert">{notice}</p>}
          <div className="grow" />
          <hr className="rule rise" style={{ ...delay(220), marginTop: 20 }} />
          <p className="mono rise muted" style={{ ...delay(240), margin: "12px 0 16px", textAlign: "center", lineHeight: 1.6, letterSpacing: ".06em" }}>
            You can submit once for this bill. {rated} {rated === 1 ? "dish" : "dishes"} rated.
          </p>
          <div className="rise" style={delay(300)}>
            <button className="cta" onClick={send} disabled={sending}>{sending ? "Sending…" : "Submit feedback"}</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "thanks") {
    return (
      <Shell>
        <div className="screen center" style={{ padding: 24 }}>
          <div className="print ticket">
            <div className="ticket-head"><BrandLine brand={brand} table={table} /></div>
            <hr className="rule" style={{ marginTop: 14 }} />
            <h1 className="display h-done">Thank you<span className="red">.</span></h1>
            <p style={{ margin: "14px 0 0", fontSize: 16, lineHeight: 1.5, color: "var(--muted)" }}>
              Your feedback for this table has been sent to {brand ? <strong style={{ color: "var(--ink)" }}>{brand}</strong> : "the restaurant"}.
            </p>
            <hr className="rule" style={{ marginTop: 20 }} />
            <div style={{ marginTop: 10 }}>
              <Row label="Dishes rated" value={pad2(rated)} />
              <Row label="Feedback" value="Sent" />
              <Row label="This bill" value="Closed for feedback" />
            </div>
            <div className="stamp stamp-box" aria-hidden="true">RECEIVED</div>
          </div>
          <p className="mono muted rise" style={{ ...delay(1000), margin: "16px 0 0", textAlign: "center" }}>Resto by NTG Clarity</p>
        </div>
        <div className="rise" style={{ ...delay(1200), padding: "0 24px 30px" }}>
          <button className="cta" onClick={() => setPhase("closed")}>Close</button>
        </div>
      </Shell>
    );
  }

  // Final screen after Close, and when this phone reopens a bill it already sent.
  if (phase === "closed") {
    return (
      <Shell>
        <div className="screen center" style={{ padding: 24 }}>
          <div className="rise ticket">
            <div className="ticket-head"><BrandLine brand={brand} table={table} /></div>
            <hr className="rule" style={{ marginTop: 14 }} />
            <h1 className="display h-done">All done<span className="red">.</span></h1>
            <p style={{ margin: "14px 0 0", fontSize: 16, lineHeight: 1.5, color: "var(--muted)" }}>
              You can close this tab now. Thank you for dining with us!
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  return <Shell><div className="screen center"><p className="mono muted">Loading…</p></div></Shell>;
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
    <div>
      {error && <p className="notice" role="alert" style={{ marginTop: 0, marginBottom: 16 }}>{error}</p>}
      <label className={`cta file-btn${busy ? " disabled" : ""}`}>
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
    </div>
  );
}
