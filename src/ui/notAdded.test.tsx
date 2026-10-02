// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { ParsedItem } from "@/domain/grammar";
import { PARSE_TIMEOUT_MS, parseTranscript, VoiceApiError } from "@/data/voiceApi";
import { BillView } from "./BillingScreen";
import { useBillLines, type BillLines } from "./useBillLines";
import { NOT_ADDED, useOrderResolver, type OrderResolver } from "./useOrderResolver";
import { VoiceUserError } from "./useVoiceBilling";

// KB-319 (KI-57, KI-58; owner, 2 Oct 2026): a parse that fails (5xx, 429,
// timeout, network) never loses what was said. The utterance stays listed as
// "Not added: '<transcript>'" with Retry and ✕ until the shopkeeper retries
// or dismisses it; new recordings carry on; each one counts in "N checks
// pending". Retry re-sends the TEXT only - same slice, no Groq, no re-record.
// The real voiceApi.parseTranscript and resolveUtterance run; only fetch is fake.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const catalog = SEED_PARSER_CATALOG.entries;
const MISS = "2 kuch naya"; // Layer 1 parses it but matches no product -> Gemini (Layer 2)
const HIT = "2 kilo chini"; // Layer 1 hit - never calls /voice

const geminiNaya: ParsedItem = {
  spokenName: "kuch naya", catalogId: null, isCustom: true, matchStatus: "none",
  qty: 2, unit: "", rate: null, rateUnit: null, total: null, priceType: "unknown",
};
const ok = () => new Response(JSON.stringify({ transcript: MISS, items: [geminiNaya] }), { status: 200 });
const status = (code: number) => new Response(JSON.stringify({ error: "x" }), { status: code });

function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
});

/** What each /voice call sent: its audio field and its meta. */
const sent = () =>
  fetchMock.mock.calls.map(([, init]) => {
    const form = (init as RequestInit).body as FormData;
    return { audio: form.get("audio"), meta: JSON.parse(form.get("meta") as string) as { transcript: string; catalogSlice: unknown[] } };
  });

interface Api {
  bill: BillLines;
  resolver: OrderResolver;
}

function Harness({ api }: { api: MutableRefObject<Api | null> }) {
  const bill = useBillLines(catalog);
  const resolver = useOrderResolver({
    shop: SEED_PARSER_CATALOG,
    bill,
    parse: (text, catalogSlice) => parseTranscript(text, { accessToken: "jwt", catalogSlice, fetchImpl: fetchMock as unknown as typeof fetch }),
  });
  api.current = { bill, resolver };
  return (
    <BillView
      lines={bill.rows}
      onSignOut={() => {}}
      onEdit={bill.edit}
      onRemove={bill.remove}
      flags={bill.flags}
      pending={bill.pending}
      onAcknowledge={bill.acknowledge}
      notAdded={bill.notAdded}
      onRetry={resolver.retry}
      onDismiss={bill.dismiss}
    />
  );
}

function setup() {
  const api: MutableRefObject<Api | null> = { current: null };
  render(<Harness api={api} />);
  return () => api.current!;
}

/** Speak a transcript (the mic flow's hand-off); returns what it threw, if anything. */
async function say(get: () => Api, transcript: string): Promise<unknown> {
  let error: unknown = null;
  await act(async () => {
    await get().resolver.onTranscript(transcript).catch((e: unknown) => (error = e));
  });
  return error;
}

const notAddedList = () => screen.queryByRole("list", { name: "Not added" });
const entry = (t: string) => within(notAddedList()!).getByText(`Not added: “${t}”`).closest("li") as HTMLElement;
const retryButton = (t: string) => screen.getByRole("button", { name: `Retry “${t}”` });
const dismissButton = (t: string) => screen.getByRole("button", { name: `Dismiss “${t}”` });
const pending = () => screen.queryByTestId("checks-pending")?.textContent ?? null;

async function tap(button: HTMLElement) {
  await act(async () => button.click());
}

describe("KB-319 - a failed parse is kept, never lost", () => {
  it("502: 'Not added: “2 kuch naya”' with Retry and ✕, 1 check pending, no lines; the status line points to Retry", async () => {
    fetchMock.mockResolvedValueOnce(status(502));
    const get = setup();
    const err = await say(get, MISS);
    expect(err).toBeInstanceOf(VoiceUserError);
    expect((err as Error).message).toBe(NOT_ADDED);
    expect(NOT_ADDED).toBe("Couldn't read the items — Retry below");
    expect(get().bill.rows).toHaveLength(0);
    const li = entry(MISS);
    expect(li.dataset.severity).toBe("HIGH");
    expect(li.querySelector("svg")).not.toBeNull(); // icon + text, never colour alone
    expect(within(li).getByText("Couldn't read the items")).toBeTruthy();
    expect(retryButton(MISS)).toBeTruthy();
    expect(dismissButton(MISS)).toBeTruthy();
    expect(pending()).toBe("1 check pending");
    expect(get().bill.pending).toBe(1);
  });

  it.each([
    ["429 (the shop's limit)", () => fetchMock.mockResolvedValueOnce(status(429))],
    ["503 (Gemini busy)", () => fetchMock.mockResolvedValueOnce(status(503))],
    ["504 (the server's 6 s deadline)", () => fetchMock.mockResolvedValueOnce(status(504))],
    ["a network failure", () => fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
  ])("%s -> kept as 'Not added'", async (_label, arrange) => {
    arrange();
    const get = setup();
    expect(await say(get, MISS)).toBeInstanceOf(VoiceUserError);
    expect(entry(MISS)).toBeTruthy();
  });

  it("the client's 8 s timeout -> kept as 'Not added'", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const get = setup();
    let err: unknown = null;
    act(() => void get().resolver.onTranscript(MISS).catch((e: unknown) => (err = e)));
    await act(async () => vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS));
    expect(err).toBeInstanceOf(VoiceUserError);
    expect(entry(MISS)).toBeTruthy();
  });

  it.each([
    [401, "unauthorized"],
    [400, "bad_request"],
  ] as const)("%i is not retryable - nothing listed; the screen shows its own message", async (code, kind) => {
    fetchMock.mockResolvedValueOnce(status(code));
    const get = setup();
    const err = await say(get, MISS);
    expect(err).toBeInstanceOf(VoiceApiError);
    expect((err as VoiceApiError).kind).toBe(kind);
    expect(notAddedList()).toBeNull();
  });
});

describe("KB-319 - new recordings carry on; several may be pending", () => {
  it("fail -> a new recording adds its lines; the failed one is still listed with Retry", async () => {
    fetchMock.mockResolvedValueOnce(status(502));
    const get = setup();
    await say(get, MISS);
    expect(await say(get, HIT)).toBeNull();
    expect(get().bill.rows.map((r) => r.displayName)).toEqual(["Chini"]);
    expect(entry(MISS)).toBeTruthy();
    expect(retryButton(MISS)).toBeTruthy();
    expect(pending()).toBe("1 check pending");
  });

  it("two failures -> two entries, 2 checks pending; ✕ removes one and the count drops", async () => {
    fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(status(503));
    const get = setup();
    await say(get, MISS);
    await say(get, "3 aur kuch");
    expect(within(notAddedList()!).getAllByRole("listitem")).toHaveLength(2);
    expect(pending()).toBe("2 checks pending");
    await tap(dismissButton(MISS));
    expect(within(notAddedList()!).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText(`Not added: “${MISS}”`)).toBeNull();
    expect(pending()).toBe("1 check pending");
    await tap(dismissButton("3 aur kuch"));
    expect(notAddedList()).toBeNull();
    expect(pending()).toBeNull();
  });
});

describe("KB-319 - Retry re-sends the text only", () => {
  it("success: ONE text-only call (no audio, same transcript, same slice); lines added once; the entry goes", async () => {
    fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok());
    const get = setup();
    await say(get, MISS);
    await tap(retryButton(MISS));
    const [first, retry] = sent();
    expect(sent()).toHaveLength(2);
    expect(retry!.audio).toBeNull();
    expect(retry!.meta.transcript).toBe(MISS);
    expect(retry!.meta.catalogSlice).toEqual(first!.meta.catalogSlice);
    expect(retry!.meta.catalogSlice.length).toBeGreaterThan(0);
    expect(get().bill.rows.map((r) => [r.displayName, r.item.qty])).toEqual([["kuch naya", 2]]);
    expect(notAddedList()).toBeNull();
    expect(pending()).toBeNull();
  });

  it("while a Retry is in flight its button is disabled ('Reading…') - no second call", async () => {
    const answer = deferred();
    fetchMock.mockResolvedValueOnce(status(502)).mockReturnValueOnce(answer.promise);
    const get = setup();
    await say(get, MISS);
    await tap(retryButton(MISS));
    const button = retryButton(MISS) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Reading…");
    await tap(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => answer.resolve(ok()));
    expect(get().bill.rows).toHaveLength(1);
  });

  it("Retry fails again: the entry stays, Retry usable again, still 1 check pending", async () => {
    fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(status(503));
    const get = setup();
    await say(get, MISS);
    await tap(retryButton(MISS));
    expect((retryButton(MISS) as HTMLButtonElement).disabled).toBe(false);
    expect(within(entry(MISS)).getByText("Couldn't read the items")).toBeTruthy();
    expect(get().bill.rows).toHaveLength(0);
    expect(pending()).toBe("1 check pending");
  });

  it("Retry hears no item: the entry stays with 'Couldn't find an item — add it manually' (nothing silently dropped)", async () => {
    const nothing = { ...geminiNaya, qty: null };
    fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(new Response(JSON.stringify({ items: [nothing] }), { status: 200 }));
    const get = setup();
    await say(get, MISS);
    await tap(retryButton(MISS));
    expect(within(entry(MISS)).getByText("Couldn't find an item — add it manually")).toBeTruthy();
    expect(get().bill.rows).toHaveLength(0);
  });
});

describe("KB-319 - races: never two sets of lines for one utterance", () => {
  it("a response arriving after the 8 s timeout is ignored; the entry stays", async () => {
    vi.useFakeTimers();
    const late = deferred();
    fetchMock.mockReturnValueOnce(late.promise);
    const get = setup();
    act(() => void get().resolver.onTranscript(MISS).catch(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS));
    await act(async () => late.resolve(ok()));
    expect(get().bill.rows).toHaveLength(0);
    expect(entry(MISS)).toBeTruthy();
  });

  it("timeout -> Retry succeeds -> the first attempt's late answer arrives: still exactly one set of lines", async () => {
    vi.useFakeTimers();
    const late = deferred();
    fetchMock.mockReturnValueOnce(late.promise).mockResolvedValueOnce(ok());
    const get = setup();
    act(() => void get().resolver.onTranscript(MISS).catch(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS));
    await tap(retryButton(MISS));
    expect(get().bill.rows).toHaveLength(1);
    await act(async () => late.resolve(ok()));
    expect(get().bill.rows).toHaveLength(1);
    expect(notAddedList()).toBeNull();
  });

  it("✕ while a Retry is in flight: its late success adds nothing", async () => {
    const answer = deferred();
    fetchMock.mockResolvedValueOnce(status(502)).mockReturnValueOnce(answer.promise);
    const get = setup();
    await say(get, MISS);
    await tap(retryButton(MISS));
    await tap(dismissButton(MISS));
    await act(async () => answer.resolve(ok()));
    expect(get().bill.rows).toHaveLength(0);
    expect(notAddedList()).toBeNull();
    expect(pending()).toBeNull();
  });

  it("a Retry that times out returns the entry to Retry; its late answer is ignored", async () => {
    vi.useFakeTimers();
    const late = deferred();
    fetchMock.mockResolvedValueOnce(status(502)).mockReturnValueOnce(late.promise);
    const get = setup();
    await say(get, MISS);
    await tap(retryButton(MISS));
    await act(async () => vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS));
    expect((retryButton(MISS) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => late.resolve(ok()));
    expect(get().bill.rows).toHaveLength(0);
    expect(entry(MISS)).toBeTruthy();
  });
});
