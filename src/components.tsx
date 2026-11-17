import type { CSSProperties, ReactNode } from "react";
import type { Sentiment } from "./types";

// Face icons from the design, in its three moods.
export function Face({ kind, size = 26 }: { kind: Sentiment; size?: number }) {
  const mouth =
    kind === "happy" ? "M8.5 14.3c.9 1.3 2.1 1.9 3.5 1.9s2.6-.6 3.5-1.9" :
    kind === "neutral" ? "M8.8 15h6.4" :
    "M8.5 16.4c.9-1.3 2.1-1.9 3.5-1.9s2.6.6 3.5 1.9";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d={mouth} />
      <circle cx="9" cy="9.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="square" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="square" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export const pad2 = (n: number) => (n < 10 ? "0" : "") + n;

// Back button, one segment per step, and "03/06". step is 1-based; 0 shows no step yet.
export function Header({ onBack, step, total }: { onBack: () => void; step?: number; total?: number }) {
  return (
    <div className="hdr">
      <button className="iconbtn" aria-label="Go back" onClick={onBack}><BackIcon /></button>
      {total ? (
        <>
          <div className="segs" aria-label={`Step ${step} of ${total}`}>
            {Array.from({ length: total }, (_, i) => {
              const n = i + 1;
              const cls = step && n < step ? "seg done" : n === step ? "seg cur" : "seg";
              return <span key={n} className={cls} />;
            })}
          </div>
          <span className="mono b">{pad2(step ?? 0)}/{pad2(total)}</span>
        </>
      ) : <div className="grow" />}
    </div>
  );
}

// "Restaurant ........ Table 01" line at the top of the welcome and thank-you screens.
export function BrandLine({ brand, table }: { brand: string; table: string | null | undefined }) {
  return (
    <>
      <span className="mono brand">{brand}</span>
      {table ? <span className="mono">Table {table}</span> : <span />}
    </>
  );
}

export function Row({ label, value, valueStyle }: { label: string; value: ReactNode; valueStyle?: CSSProperties }) {
  return (
    <div className="row"><span>{label}</span><span className="lead" /><span className="v" style={valueStyle}>{value}</span></div>
  );
}

// Inline style for a staggered .rise animation.
export const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
