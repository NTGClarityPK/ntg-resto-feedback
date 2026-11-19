import { useEffect, useState } from "react";
import { draftReview, type ReviewInput } from "./api";

// Copies text while the tap is still "fresh", so phones allow it. The Clipboard API is tried
// first; older browsers (and plain-http test pages) fall back to a hidden textarea.
function copyText(text: string): boolean {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    return true;
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

// Optional last step: a review drafted from the guest's answers, which they can edit, copy
// and post on the restaurant's Google page from their own account. Google does not let any
// site fill in or post a review for someone, so the guest pastes it and taps Post.
export function GoogleShare({ url, brand, input }: { url: string; brand: string; input: ReviewInput }) {
  const [text, setText] = useState("");
  const [stars, setStars] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    let live = true;
    draftReview(input)
      .then((d) => {
        if (!live) return;
        if (d) { setText(d.text); setStars(d.stars); } else setText(input.review);
      })
      .catch(() => { if (live) setText(input.review); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // The answers are fixed once feedback is sent, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function share() {
    const ok = text.trim() ? copyText(text.trim()) : false;
    setCopied(text.trim() ? (ok ? "yes" : "no") : null);
    window.open(url, "_blank", "noopener");
  }

  return (
    <section className="gshare rise" aria-labelledby="gshare-title">
      <div className="gshare-top">
        <span className="mono b">Optional</span>
        {stars && <span className="gstars" aria-label={`Suggested rating ${stars} out of 5`}>{"★".repeat(stars)}{"☆".repeat(5 - stars)}</span>}
      </div>
      <h2 id="gshare-title" className="display gshare-title">Share it on Google?</h2>
      <p className="gshare-sub">
        Help others find {brand || "us"}. We wrote this from your answers. Edit it if you like, then paste it on Google.
      </p>
      <textarea
        className="gshare-text"
        value={loading ? "" : text}
        placeholder={loading ? "Writing your review…" : "Write a few words about your visit…"}
        onChange={(e) => setText(e.target.value.slice(0, 600))}
        disabled={loading}
        aria-label="Your Google review"
      />
      <button className="cta gshare-btn" onClick={share} disabled={loading}>
        Copy &amp; open Google
      </button>
      {copied === "yes" && (
        <p className="gshare-hint" role="status">
          Copied! On Google, tap the stars{stars ? ` (you rated us ${stars}/5)` : ""}, long-press the box, choose <b>Paste</b>, then <b>Post</b>.
        </p>
      )}
      {copied === "no" && (
        <p className="gshare-hint" role="status">
          Your phone didn't allow copying. Select the text above, copy it, and paste it on Google.
        </p>
      )}
    </section>
  );
}

