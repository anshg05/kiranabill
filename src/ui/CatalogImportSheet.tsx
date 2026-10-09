import { useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { LocalShopProduct } from "@/data/db";
import type { ImportOutcome, ImportRow } from "@/data/catalogImport";
import { readImportFile } from "@/data/catalogImportFile";
import {
  FIELD_LABELS,
  SAMPLE_CSV,
  buildPreview,
  detectMapping,
  type ColumnMapping,
  type ImportField,
  type ImportTable,
  type PreviewRow,
} from "@/domain/catalogImport";
import { formatRupees } from "@/domain/money";
import { useBackEntry } from "./useBackEntry";

// KB-314 (owner, 10 Oct 2026; docs/07-DECISIONS.md D68): import products from a spreadsheet or CSV, over the Catalog.
//   pick a file -> the columns it found (changeable) -> a PREVIEW of what will be added, what is already in the shop
//   (skipped - its price and unit are NEVER changed) and what is wrong (with the line and the reason) -> Add.
// ADD-ONLY and ONLINE-only (the writes are batched inserts - data/catalogImport.ts). Every value from the file is shown as
// text. Open, this is an overlay (useBackEntry): an app update never reloads the page under an import.

const LISTED = 20;
const FIELDS: readonly ImportField[] = ["name", "price", "unit", "category", "aliases", "sku", "barcode"];
const ACCEPT = ".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OFFLINE_ADD = "Needs internet to add products";
const RUN_FAILED = "Couldn't add the products — check the internet and try again. Anything already added is kept, and running it again skips it.";

export interface CatalogImportSheetProps {
  /** Every product in the shop, hidden ones too - the database refuses a name that is already used. */
  existing: readonly LocalShopProduct[];
  online: boolean;
  run: (rows: ImportRow[], onProgress: (done: number, total: number) => void) => Promise<ImportOutcome>;
  onClose: () => void;
}

type Stage =
  | { kind: "pick"; error: string | null }
  | { kind: "reading" }
  | { kind: "preview"; fileName: string; table: ImportTable; mapping: ColumnMapping; error: string | null }
  | { kind: "running"; done: number; total: number }
  | { kind: "result"; outcome: ImportOutcome };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const priceUnit = (paise: number | null, unit: string) => `${paise === null ? "—" : formatRupees(paise)} / ${unit}`;

function downloadSample(): void {
  const blob = new Blob(["﻿" + SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kiranabill-products-sample.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function CatalogImportSheet({ existing, online, run, onClose }: CatalogImportSheetProps) {
  useBackEntry("kbImport", onClose);
  const [stage, setStage] = useState<Stage>({ kind: "pick", error: null });
  const fileInput = useRef<HTMLInputElement>(null);
  const known = useMemo(() => existing.map((p) => ({ displayName: p.displayName, unit: p.unit, pricePaise: p.pricePaise, aliases: p.aliases, isActive: p.isActive })), [existing]);
  const preview = useMemo(() => (stage.kind === "preview" ? buildPreview(stage.table, stage.mapping, known) : null), [stage, known]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setStage({ kind: "reading" });
    const read = await readImportFile(file);
    if (!read.ok) return setStage({ kind: "pick", error: read.error });
    setStage({ kind: "preview", fileName: read.fileName, table: read.table, mapping: detectMapping(read.table.headers), error: null });
  }

  async function onAdd() {
    if (stage.kind !== "preview" || !preview || !online) return;
    const rows: ImportRow[] = preview.rows.flatMap((r) =>
      r.status.kind === "new" && r.pricePaise !== null
        ? [{ name: r.name, pricePaise: r.pricePaise, unit: r.unit, category: r.category, aliases: r.aliases, sku: r.sku, barcode: r.barcode }]
        : [],
    );
    if (rows.length === 0) return;
    setStage({ kind: "running", done: 0, total: rows.length });
    try {
      const outcome = await run(rows, (done, total) => setStage({ kind: "running", done, total }));
      setStage({ kind: "result", outcome });
    } catch (err) {
      console.warn("[import] run failed:", err instanceof Error ? err.name : "error");
      setStage({ kind: "preview", fileName: stage.fileName, table: stage.table, mapping: stage.mapping, error: RUN_FAILED });
    }
  }

  const busy = stage.kind === "running" || stage.kind === "reading";
  return (
    <section aria-label="Import products" className="fixed inset-0 z-30 flex flex-col bg-paper text-ink text-[15px]">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <button type="button" aria-label="Back" aria-disabled={busy} onClick={busy ? undefined : onClose} className="flex size-11 items-center justify-center rounded-[6px] text-ink-soft aria-disabled:opacity-50">
            <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          </button>
          <h2 className="text-[20px] font-semibold">Import products</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {(stage.kind === "pick" || stage.kind === "reading") && (
            <div className="flex flex-col gap-3">
              <p>
                Pick a spreadsheet (.xlsx) or a CSV file. The first row must be the column names. <strong>Name</strong>, <strong>Price</strong> and <strong>Unit</strong> are needed; Category, Aliases
                (other names, separated by commas), SKU and Barcode are optional. Products already in your shop are skipped — nothing in your shop is changed.
              </p>
              <input
                ref={fileInput}
                type="file"
                aria-label="Choose a file"
                accept={ACCEPT}
                disabled={stage.kind === "reading"}
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
                className="block w-full text-[15px] file:mr-3 file:min-h-11 file:rounded-[6px] file:border file:border-line file:bg-surface file:px-4 file:font-medium"
              />
              {stage.kind === "reading" && <p role="status" aria-label="Progress" className="text-ink-soft">Reading the file…</p>}
              {stage.kind === "pick" && stage.error && <p role="alert" className="text-danger">{stage.error}</p>}
              <button type="button" onClick={downloadSample} className="min-h-11 self-start rounded-[6px] border border-line bg-surface px-4 font-medium">
                Download sample CSV
              </button>
            </div>
          )}

          {stage.kind === "preview" && preview && (
            <Preview
              fileName={stage.fileName}
              headers={stage.table.headers}
              mapping={stage.mapping}
              preview={preview}
              error={stage.error}
              online={online}
              onMapping={(field, at) => setStage({ ...stage, error: null, mapping: withField(stage.mapping, field, at) })}
              onAdd={() => void onAdd()}
              onOther={() => setStage({ kind: "pick", error: null })}
            />
          )}

          {stage.kind === "running" && (
            <p role="status" aria-label="Progress" className="py-6 text-center">
              Adding {stage.done} of {stage.total}…
            </p>
          )}

          {stage.kind === "result" && <Result outcome={stage.outcome} onDone={onClose} />}
        </div>
      </div>
    </section>
  );
}

function withField(mapping: ColumnMapping, field: ImportField, at: number | undefined): ColumnMapping {
  const next: ColumnMapping = { ...mapping };
  // a column serves one field
  if (at !== undefined) for (const f of FIELDS) if (f !== field && next[f] === at) delete next[f];
  if (at === undefined) delete next[field];
  else next[field] = at;
  return next;
}

function Preview({ fileName, headers, mapping, preview, error, online, onMapping, onAdd, onOther }: {
  fileName: string;
  headers: readonly string[];
  mapping: ColumnMapping;
  preview: ReturnType<typeof buildPreview>;
  error: string | null;
  online: boolean;
  onMapping: (field: ImportField, at: number | undefined) => void;
  onAdd: () => void;
  onOther: () => void;
}) {
  const { counts } = preview;
  const newRows = preview.rows.filter((r) => r.status.kind === "new");
  const existingRows = preview.rows.filter((r) => r.status.kind === "exists");
  const problems = preview.rows.filter((r) => r.status.kind === "problem");
  const dropped = newRows.flatMap((r) => r.droppedAliases.map((d) => ({ row: r, ...d })));
  const canAdd = counts.new > 0 && online;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-soft [overflow-wrap:anywhere]">
        {fileName} ·{" "}
        <button type="button" onClick={onOther} className="underline">
          choose another file
        </button>
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-medium tracking-[0.02em] text-ink-soft">Columns in your file</legend>
        {FIELDS.map((field) => (
          <label key={field} className="flex items-center justify-between gap-3">
            <span>
              {FIELD_LABELS[field]}
              {["name", "price", "unit"].includes(field) ? " *" : ""}
            </span>
            <select
              aria-label={`${FIELD_LABELS[field]} column`}
              value={mapping[field] === undefined ? "" : String(mapping[field])}
              onChange={(e) => onMapping(field, e.target.value === "" ? undefined : Number(e.target.value))}
              className="min-h-11 max-w-[60%] rounded-[6px] border border-line bg-surface px-2"
            >
              <option value="">— none —</option>
              {headers.map((h, i) => (
                <option key={i} value={i}>
                  {h || `(column ${i + 1})`}
                </option>
              ))}
            </select>
          </label>
        ))}
        {preview.ignoredColumns.length > 0 && <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">Not used: {preview.ignoredColumns.join(", ")}</p>}
      </fieldset>

      {preview.missingColumns.length > 0 ? (
        <p role="alert" className="text-danger">
          Choose the column for: {preview.missingColumns.map((f) => FIELD_LABELS[f]).join(", ")}. Nothing is guessed.
        </p>
      ) : (
        <>
          <p role="status" aria-label="Summary" className="font-medium">
            {counts.new} to add · {counts.exists} already in your shop · {plural(counts.problem, "problem")}
          </p>

          {preview.units.length > 0 && (
            <section>
              <h3 className="text-[13px] font-medium tracking-[0.02em] text-ink-soft">Units found — check the spelling</h3>
              <ul aria-label="Units found" className="mt-1 flex flex-col gap-1">
                {preview.units.map((u) => (
                  <li key={u.unit} className={u.known ? "" : "text-warn"}>
                    {u.unit} · {u.count}
                    {u.known ? "" : " · not a unit the app knows (kept as typed)"}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {problems.length > 0 && (
            <Section title="Problems — these rows are skipped" label="Problems">
              {problems.slice(0, LISTED).map((r) => (
                <li key={r.line} className="text-danger [overflow-wrap:anywhere]">
                  Line {r.line}{r.name ? ` — ${r.name}` : ""}: {r.status.kind === "problem" ? r.status.reason : ""}
                </li>
              ))}
              {problems.length > LISTED && <li className="text-ink-soft">…and {problems.length - LISTED} more</li>}
            </Section>
          )}

          {existingRows.length > 0 && (
            <Section title="Already in your shop — skipped, not changed" label="Already in your shop">
              {existingRows.slice(0, LISTED).map((r) => (
                <li key={r.line} className="[overflow-wrap:anywhere]">
                  {r.name}
                  {r.status.kind === "exists" && (
                    <span className="text-ink-soft">
                      {" "}— your shop has {priceUnit(r.status.existingPricePaise, r.status.existingUnit)}; the file says {priceUnit(r.status.filePricePaise, r.unit)}. Not changed.
                      {r.status.hidden ? " (a hidden product)" : ""}
                    </span>
                  )}
                </li>
              ))}
              {existingRows.length > LISTED && <li className="text-ink-soft">…and {existingRows.length - LISTED} more</li>}
            </Section>
          )}

          {newRows.length > 0 && (
            <Section title="To add" label="To add">
              {newRows.slice(0, LISTED).map((r: PreviewRow) => (
                <li key={r.line} className="[overflow-wrap:anywhere]">
                  {r.name} <span className="text-ink-soft">— {priceUnit(r.pricePaise, r.unit)}</span>
                </li>
              ))}
              {newRows.length > LISTED && <li className="text-ink-soft">…and {newRows.length - LISTED} more</li>}
            </Section>
          )}

          {dropped.length > 0 && (
            <Section title="Aliases left out — the product is still added" label="Aliases left out">
              {dropped.slice(0, LISTED).map((d, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {d.row.name}: “{d.alias}” — {d.why}
                </li>
              ))}
              {dropped.length > LISTED && <li className="text-ink-soft">…and {dropped.length - LISTED} more</li>}
            </Section>
          )}
        </>
      )}

      {error && <p role="alert" className="text-danger">{error}</p>}
      {!online && preview.missingColumns.length === 0 && counts.new > 0 && <p className="text-[13px] text-ink-soft">{OFFLINE_ADD}</p>}
      {preview.missingColumns.length === 0 && counts.new === 0 && <p className="text-ink-soft">Nothing new to add from this file.</p>}
      {preview.missingColumns.length === 0 && counts.new > 0 && (
        <button
          type="button"
          aria-disabled={!canAdd}
          onClick={canAdd ? onAdd : undefined}
          className="min-h-11 self-start rounded-[6px] bg-indigo px-5 font-medium text-white aria-disabled:opacity-50"
        >
          Add {plural(counts.new, "product")}
        </button>
      )}
    </div>
  );
}

function Section({ title, label, children }: { title: string; label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[13px] font-medium tracking-[0.02em] text-ink-soft">{title}</h3>
      <ul aria-label={label} className="mt-1 flex flex-col gap-1">
        {children}
      </ul>
    </section>
  );
}

function Result({ outcome, onDone }: { outcome: ImportOutcome; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[18px] font-semibold">Import finished</h3>
      <p role="status" aria-label="Result" className="font-medium">
        Added {outcome.added} · already there {outcome.alreadyThere} · failed {outcome.failed.length}
      </p>
      {outcome.stopReason && (
        <p role="alert" className="text-danger">
          The import stopped early; {outcome.notSent} products were not sent ({outcome.stopReason}). Run the import again with the same file — what is already added is skipped.
        </p>
      )}
      {outcome.failed.length > 0 && (
        <Section title="Not added" label="Not added">
          {outcome.failed.slice(0, LISTED).map((f, i) => (
            <li key={i} className="text-danger [overflow-wrap:anywhere]">
              {f.name} — {f.reason}
            </li>
          ))}
          {outcome.failed.length > LISTED && <li className="text-ink-soft">…and {outcome.failed.length - LISTED} more</li>}
        </Section>
      )}
      <button type="button" onClick={onDone} className="min-h-11 self-start rounded-[6px] bg-indigo px-5 font-medium text-white">
        Done
      </button>
    </div>
  );
}
