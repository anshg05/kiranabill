import { Fragment } from "react";

/** KB-414 (owner, 16 Nov 2026): a "1:02 pm · 38 items · Ramesh" line - each part never breaks inside ("1:02 / pm"); a narrow screen
 *  or a big text size wraps it only at the " · " between parts. Home's Recent bills and 14's bill cards. */
export function MetaLine({ text, className }: { text: string; className: string }) {
  return (
    <span data-meta className={className}>
      {text.split(" · ").map((part, j) => (
        <Fragment key={j}>
          {j > 0 && " · "}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
