import { useState } from "react";

/**
 * KB-303: a tappable value (44px) that becomes an inline number input - the
 * numeric keyboard (inputmode=decimal), Enter / blur commits, Escape cancels.
 * A rejected value keeps the input open with the reason under it; nothing
 * changes until a value is accepted.
 */
export function EditableValue({
  label,
  fieldId,
  text,
  initial,
  onCommit,
  startOpen = false,
  kind = "number",
  pendingTarget = false,
}: {
  label: string;
  fieldId: string;
  text: string;
  initial: string;
  onCommit: (value: string) => string | null;
  /** KB-305: open (focused, value selected) when the line arrives. */
  startOpen?: boolean;
  /** KB-306: the keyboard - numbers (default), text (a name) or a phone number. */
  kind?: "number" | "text" | "tel";
  /** KB-307: where a Bill Banao tap sends focus when this value is what's missing. */
  pendingTarget?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(startOpen ? initial : null);
  const [error, setError] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={label}
        data-pending-target={pendingTarget || undefined}
        onClick={() => {
          setDraft(initial);
          setError(null);
        }}
        className="min-h-11 min-w-11 rounded-[6px] border border-line bg-paper px-2 tabular-nums text-ink"
      >
        {text}
      </button>
    );
  }
  const commit = () => {
    const message = onCommit(draft);
    if (message) setError(message);
    else {
      setDraft(null);
      setError(null);
    }
  };
  return (
    <span className="inline-flex flex-col items-end">
      <input
        id={fieldId}
        name={fieldId}
        aria-label={label}
        type={kind === "tel" ? "tel" : "text"}
        inputMode={kind === "number" ? "decimal" : kind}
        autoCapitalize={kind === "text" ? "words" : undefined}
        // Never the browser's saved values - for a phone field that would be the shopkeeper's own number.
        autoComplete="off"
        enterKeyHint="done"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
        // Owner: typing replaces the value; a small correction is one keystroke.
        onFocus={(e) => e.currentTarget.select()}
        // Leaving an untouched editor (e.g. for the unit picker beside it) just
        // closes it - only a changed value, or an explicit Enter, commits (KB-305).
        onBlur={() => {
          if (draft === initial) {
            setDraft(null);
            setError(null);
          } else commit();
        }}
        className={`h-11 rounded-[6px] border border-line bg-surface px-2 tabular-nums ${kind === "number" ? "w-24 text-right" : "w-44"}`}
      />
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
