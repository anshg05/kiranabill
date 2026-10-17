import { Fragment, type ReactNode } from "react";

// KB-332 (D84): a translated sentence with a component inside it (a bold word, a receipt number that may break after a
// hyphen). The sentence is rendered with a marker where the part goes - mark("n") - then split at the markers, so each
// language puts the part where its own word order needs it. The markers never reach the screen.

export const mark = (key: string): string => `\u0001${key}\u0002`;

export function inject(text: string, parts: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return text.split(/\u0001(\w+)\u0002/).map((piece, i) => (i % 2 === 1 ? <Fragment key={i}>{parts[piece]}</Fragment> : piece));
}
