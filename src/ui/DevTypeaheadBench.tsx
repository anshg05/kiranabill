import { useEffect, useMemo, useState } from "react";
import { catalog, type CatalogEntry } from "@/domain/catalog";
import { prepareParserCatalog, searchCatalog, type ParserCatalog } from "@/domain/catalogIndex";

// DEV ONLY (KB-305, NI-28): the 16 ms keystroke budget (05 §10) measured on a
// REAL phone. Open http://<laptop-ip>:5173/__dev/typeahead from the phone
// (`npm run dev -- --host`); no sign-in. Loaded by a dynamic import that sits
// behind import.meta.env.DEV in main.tsx, so neither this page nor the seed
// catalog it uses reaches `npm run build` (VERIFY greps dist/).

/** The perf test's synthetic 10,000-product catalog (catalogIndex.perf.test.ts). */
function scaled(to: number): CatalogEntry[] {
  const active = catalog.filter((e) => e.isActive);
  const out: CatalogEntry[] = [];
  for (let copy = 0; out.length < to; copy++) {
    const suffix = copy === 0 ? "" : ` v${copy}`;
    for (const e of active) out.push({ ...e, id: `${e.id}-dup${copy}`, displayName: `${e.displayName}${suffix}`, aliases: e.aliases.map((a) => `${a}${suffix}`) });
  }
  return out;
}

const QUERIES = ["ch", "chi", "chin", "chini", "cheeni", "ची", "चीनी", "शक्कर", "aata", "आटा", "parle", "sabun", "साबुन", "surf", "dal", "toor", "xyzq"];

interface Stats {
  median: number;
  p95: number;
  max: number;
  n: number;
}

function stats(ms: number[]): Stats {
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return { median: at(0.5), p95: at(0.95), max: s[s.length - 1]!, n: s.length };
}

const fmt = (x: number) => x.toFixed(2);

/** Every query, 30 rounds, after a warm-up (D35: the budget is steady-state). */
function bench(pc: ParserCatalog): Stats {
  for (const q of QUERIES) searchCatalog(pc, q);
  const ms: number[] = [];
  for (let round = 0; round < 30; round++) {
    for (const q of QUERIES) {
      const t0 = performance.now();
      searchCatalog(pc, q);
      ms.push(performance.now() - t0);
    }
  }
  return stats(ms);
}

export function DevTypeaheadBench() {
  const catalogs = useMemo(() => {
    const t0 = performance.now();
    const small = prepareParserCatalog(catalog.filter((e) => e.isActive));
    const t1 = performance.now();
    const big = prepareParserCatalog(scaled(10_000));
    const t2 = performance.now();
    return { small, big, buildSmallMs: t1 - t0, buildBigMs: t2 - t1 };
  }, []);
  const [results, setResults] = useState<{ small: Stats; big: Stats } | null>(null);
  const [query, setQuery] = useState("");
  const [typedAt, setTypedAt] = useState<number | null>(null);
  const [paints, setPaints] = useState<number[]>([]);
  const found = useMemo(() => searchCatalog(catalogs.big, query), [catalogs.big, query]);

  // Keystroke -> results painted: from the input event to the next frame after this render.
  useEffect(() => {
    if (typedAt === null) return;
    requestAnimationFrame(() => setPaints((p) => [...p.slice(-199), performance.now() - typedAt]));
  }, [found, typedAt]);

  const run = () => setResults({ small: bench(catalogs.small), big: bench(catalogs.big) });
  const row = (label: string, s: Stats) => `${label}: median ${fmt(s.median)} · p95 ${fmt(s.p95)} · max ${fmt(s.max)} ms (n=${s.n})`;
  const paint = paints.length ? stats(paints) : null;

  return (
    <main className="mx-auto max-w-[720px] space-y-3 bg-paper p-4 text-[15px] text-ink">
      <h1 className="text-[20px] font-semibold">Type-ahead bench (NI-28)</h1>
      <p className="text-[13px] text-ink-soft">
        {navigator.userAgent}
        <br />
        Index build (one-time): {catalogs.small.entries.length} products {fmt(catalogs.buildSmallMs)} ms · {catalogs.big.entries.length} products{" "}
        {fmt(catalogs.buildBigMs)} ms
      </p>
      <button type="button" onClick={run} className="min-h-11 rounded-[6px] bg-indigo px-4 font-medium text-surface">
        Run lookup bench
      </button>
      {results && (
        <pre data-testid="bench" className="whitespace-pre-wrap text-[13px]">
          {row(`${catalogs.small.entries.length} products`, results.small)}
          {"\n"}
          {row(`${catalogs.big.entries.length} products`, results.big)}
          {"\n"}budget: 16 ms per keystroke (05 §10)
        </pre>
      )}
      <label className="block text-[13px] text-ink-soft" htmlFor="bench-type">
        Type here (10,000-product catalog) - keystroke → results painted:
      </label>
      <input
        id="bench-type"
        name="bench-type"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setTypedAt(performance.now());
          setQuery(e.target.value);
        }}
        className="h-11 w-full rounded-[6px] border border-line bg-surface px-3"
      />
      {paint && <p className="text-[13px] tabular-nums">{row("keystroke → paint", paint)}</p>}
      <ul className="text-[13px]">
        {found.map((r) => (
          <li key={r.entry.id}>{r.entry.displayName}</li>
        ))}
      </ul>
    </main>
  );
}
