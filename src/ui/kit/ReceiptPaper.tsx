import { useState, type ReactNode } from "react";

// KB-412 batch c (26 §5 receipt), the FRAME only, as drawn on 13-BillSaved / 15-BillDetail: the paper's width and its drop shadow
// (a drop shadow, so the torn edge casts it too), and on 13 the zig-zag torn bottom edge (10 px, 28 teeth). The receipt inside is
// today's Receipt.tsx, passed in by the screen and unchanged (D110: the receipt keeps today's content).
// KB-413 step 4: never wider than the phone (a 320 px phone keeps its gutters); `print` = 13's print-out (26 §3: max-height 0 -> 520 px
// in 1.2 s, on this element as the file draws it, so the shadow is never clipped). Once it has run the 520 px cap comes off - a long
// bill is never cut. Reduced motion: no animation, the receipt simply there.
export function ReceiptPaper({ width, torn = false, print = false, children }: { width: number; torn?: boolean; print?: boolean; children: ReactNode }) {
  const [printed, setPrinted] = useState(false);
  const printing = print && !printed;
  return (
    <div
      data-receipt-print={print || undefined}
      onAnimationEnd={print ? () => setPrinted(true) : undefined}
      className={`drop-shadow-kb-receipt ${printing ? "overflow-hidden animate-kb-print-saved" : ""}`}
      style={{ width, maxWidth: "100%" }}
    >
      {children}
      {torn && (
        <svg width="100%" height="10" viewBox="0 0 280 10" preserveAspectRatio="none" aria-hidden="true" className="block text-kb-card">
          <path
            fill="currentColor"
            d="M0 0 L280 0 L280 2 L275 10 L270 2 L265 10 L260 2 L255 10 L250 2 L245 10 L240 2 L235 10 L230 2 L225 10 L220 2 L215 10 L210 2 L205 10 L200 2 L195 10 L190 2 L185 10 L180 2 L175 10 L170 2 L165 10 L160 2 L155 10 L150 2 L145 10 L140 2 L135 10 L130 2 L125 10 L120 2 L115 10 L110 2 L105 10 L100 2 L95 10 L90 2 L85 10 L80 2 L75 10 L70 2 L65 10 L60 2 L55 10 L50 2 L45 10 L40 2 L35 10 L30 2 L25 10 L20 2 L15 10 L10 2 L5 10 L0 2 Z"
          />
        </svg>
      )}
    </div>
  );
}
