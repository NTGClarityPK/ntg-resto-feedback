import type { ReactNode } from "react";
import type { Sentiment } from "./types";

export function Face({ kind, size = 34 }: { kind: Sentiment; size?: number }) {
  const mouth =
    kind === "happy" ? "M9 15c1.6 1.6 4.4 1.6 6 0" :
    kind === "neutral" ? "M9 15.5h6" :
    "M9 16.5c1.6-1.4 4.4-1.4 6 0";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="9" cy="10" r=".6" fill="currentColor" />
      <circle cx="15" cy="10" r=".6" fill="currentColor" />
      <path d={mouth} />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <path d="M12 8v5M12 16.5v.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function Progress({ step }: { step: number }) {
  return (
    <div className="progress" aria-label={`Step ${step + 1} of 4`}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i <= step ? "on" : ""} />
      ))}
    </div>
  );
}

export function TopBar({ onBack, timer, brand }: { onBack?: () => void; timer?: string; brand: string }) {
  const low = timer !== undefined && parseSeconds(timer) < 5 * 60;
  return (
    <div className="topbar">
      {onBack ? (
        <button className="iconbtn" onClick={onBack} aria-label="Back"><BackIcon /></button>
      ) : (
        <span className="brand">{brand}</span>
      )}
      {timer !== undefined && (
        <span className={`timer ${low ? "low" : ""}`} aria-live="off">{timer} left</span>
      )}
    </div>
  );
}

function parseSeconds(mmss: string): number {
  const [m, s] = mmss.split(":").map(Number);
  return m * 60 + s;
}

export function Centered({ icon, tone = "ok", title, children }: { icon: ReactNode; tone?: "ok" | "warn"; title: string; children?: ReactNode }) {
  return (
    <div className="screen center fade">
      <div className={`badge ${tone === "warn" ? "warn" : ""}`}>{icon}</div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}
