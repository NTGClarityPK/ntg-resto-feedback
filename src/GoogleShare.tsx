import { useEffect, useState } from "react";

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

export type Draft = { text: string; stars: number } | null;

// The review card on its own screen: a review drafted from the guest's answers, which they can
// edit, copy and post on the restaurant's Google page from their own account. Google does not
// let any site fill in or post a review for someone, so the guest pastes it and taps Post.
// draft is undefined while it is still being written, null if drafting failed.
export function GoogleShare({ url, brand, draft, fallbackText }: {
  url: string; brand: string; draft: Draft | undefined; fallbackText: string;
}) {
  const loading = draft === undefined;
  const stars = draft?.stars ?? null;
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    if (!loading) setText(draft?.text ?? fallbackText);
  }, [draft, loading, fallbackText]);

  function share() {
    const ok = text.trim() ? copyText(text.trim()) : false;
    setCopied(text.trim() ? (ok ? "yes" : "no") : null);
    window.open(url, "_blank", "noopener");
  }

  return (
    <section className="gshare rise" aria-labelledby="gshare-title">
      <div className="gshare-top">
        <GoogleLogo size={22} />
        {stars && <span className="gstars" aria-label={`Suggested rating ${stars} out of 5`}>{"★".repeat(stars)}{"☆".repeat(5 - stars)}</span>}
      </div>
      <h2 id="gshare-title" className="display gshare-title">Post your review on Google</h2>
      <p className="gshare-sub">
        Help others find {brand || "us"}. We wrote this from your answers. Edit it if you like.
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
      <p className="gshare-handoff">This is where we hand you to Google.</p>
      {copied === "yes" && (
        <p className="gshare-hint" role="status">
          Copied! {stars ? `Tap ${stars} stars, ` : "Tap the stars, "}paste and post.
        </p>
      )}
      {copied === "no" && (
        <p className="gshare-hint" role="status">
          Couldn't copy. Select the text above, copy it, then paste on Google.
        </p>
      )}
    </section>
  );
}

// Google's "G" mark, for the button that leads to posting a review on Google.
export function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
