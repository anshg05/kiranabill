// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { ParsedItem } from "@/domain/grammar";
import { parseTranscript } from "@/data/voiceApi";
import { BillView } from "./BillingScreen";
import { useBillLines, type BillLines } from "./useBillLines";
import { parseFailureMessage, useOrderResolver, type OrderResolver } from "./useOrderResolver";
import { VoiceUserError } from "./useVoiceBilling";
import { VoiceApiError } from "@/data/voiceApi";

// KB-358 (owner, 28 Oct 2026): a long order that cannot be read in full keeps what it CAN read on the bill, and every
// piece it could not read is its own "Not added" entry - with the real cause in words (busy, today's free limit, too slow),
// never one entry holding the whole order. Retry works on the one piece.

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, 30));
});

const catalog = SEED_PARSER_CATALOG.entries;
const U437 = "कि एक किलो मुँगडाल चैन रुपए किलो दो किलो बरबटी दाल अठ्यासथा रुपए किलो एक किलो उड़त मुगर 130 रुपए किलो एक किलो मुँग मोहगर 110 रुपए किलो";
const UNREADABLE = "कि एक किलो मुँगडाल चैन रुपए किलो दो किलो बरबटी दाल अठ्यासथा रुपए किलो";

const QUOTA = "Today's free reading limit is reached — add by hand, or try again tomorrow";
const BUSY = "Reading service is busy — Retry in a minute, or add by hand";
const SLOW = "Took too long — Retry, or add by hand";

const answer = (code: number, body: Record<string, unknown> = { error: "x" }) => new Response(JSON.stringify(body), { status: code });
const mungdal: ParsedItem = { spokenName: "मुंगडाल", catalogId: "18", isCustom: false, matchStatus: "matched", qty: 1, unit: "kg", rate: 9600, rateUnit: "kg", total: 9600, priceType: "rate" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
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
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={bill.addByHand}
    />
  );
}

function setup() {
  const api: MutableRefObject<Api | null> = { current: null };
  render(<Harness api={api} />);
  return () => api.current!;
}

async function say(get: () => Api, transcript: string): Promise<unknown> {
  let error: unknown = null;
  await act(async () => {
    await get().resolver.onTranscript(transcript).catch((e: unknown) => (error = e));
  });
  return error;
}

const leftovers = () => screen.queryAllByText(/^Not added: “/).map((el) => el.closest("li") as HTMLElement);

describe("KB-358: a long order that fails keeps what was read, and each unread piece is its own entry", () => {
  it("the 4:37 PM order, Gemini over its DAILY limit: 2 lines on the bill, 2 entries (each its own text), the limit said in words, no throw", async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { error: "Parse busy", reason: "daily_limit" }));
    const get = setup();
    expect(await say(get, U437)).toBeNull();
    expect(get().bill.rows).toHaveLength(2);
    expect(get().bill.rows.map((r) => r.item.total)).toEqual([13000, 11000]);
    const li = leftovers();
    expect(li).toHaveLength(2);
    expect(li[0]!.textContent).toContain("चैन");
    expect(li[1]!.textContent).toContain("अठ्यासथा");
    expect(li[0]!.textContent).not.toContain("130");
    for (const l of li) expect(within(l).getByText(QUOTA)).toBeTruthy();
    expect(get().bill.pending).toBe(2);
    // ONE text-only call, carrying only the two unreadable pieces
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(((fetchMock.mock.calls[0]![1] as RequestInit).body as FormData).get("meta") as string) as { transcript: string };
    expect(meta.transcript).toContain("चैन");
    expect(meta.transcript).not.toContain("130");
  });

  it("nothing readable and Google busy: no line, each piece its own entry, the status line says why", async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { error: "Parse busy", reason: "busy" }));
    const get = setup();
    const err = await say(get, UNREADABLE);
    expect(err).toBeInstanceOf(VoiceUserError);
    expect((err as Error).message).toBe(BUSY);
    expect(get().bill.rows).toHaveLength(0);
    expect(leftovers()).toHaveLength(2);
    for (const l of leftovers()) expect(within(l).getByText(BUSY)).toBeTruthy();
  });

  it("a timeout says 'too long'; a plain 502 keeps today's words", async () => {
    fetchMock.mockResolvedValueOnce(answer(504));
    const get = setup();
    await say(get, UNREADABLE);
    for (const l of leftovers()) expect(within(l).getByText(SLOW)).toBeTruthy();
    cleanup();
    fetchMock.mockResolvedValueOnce(answer(502));
    const get2 = setup();
    await say(get2, UNREADABLE);
    for (const l of leftovers()) expect(within(l).getByText("Couldn't read the items")).toBeTruthy();
  });

  it("Retry on ONE piece re-sends only that piece's text; its line is added and only its entry goes", async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { error: "Parse busy", reason: "busy" }));
    const get = setup();
    await say(get, U437);
    expect(leftovers()).toHaveLength(2);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "", items: [mungdal] }), { status: 200 }));
    const retry = screen.getAllByRole("button", { name: /^Retry “/ })[0]!;
    await act(async () => retry.click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(get().bill.rows).toHaveLength(3);
    expect(leftovers()).toHaveLength(1);
    const meta = JSON.parse(((fetchMock.mock.calls[1]![1] as RequestInit).body as FormData).get("meta") as string) as { transcript: string };
    expect(meta.transcript).toContain("चैन");
    expect(meta.transcript).not.toContain("अठ्यासथा");
  });

  it("a failed Retry names the cause too", async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { error: "Parse busy", reason: "busy" }));
    const get = setup();
    await say(get, UNREADABLE);
    fetchMock.mockResolvedValueOnce(answer(503, { error: "Parse busy", reason: "daily_limit" }));
    await act(async () => screen.getAllByRole("button", { name: /^Retry “/ })[0]!.click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(within(leftovers()[0]!).getByText(QUOTA)).toBeTruthy();
  });
});

describe("KB-358: a failure no Retry can fix (the session expired) never loses what was read", () => {
  it("2 lines on the bill, the 2 unread pieces listed with the real message", async () => {
    fetchMock.mockResolvedValueOnce(answer(401));
    const get = setup();
    expect(await say(get, U437)).toBeNull();
    expect(get().bill.rows).toHaveLength(2);
    for (const l of leftovers()) expect(within(l).getByText("Session expired — sign out and sign in again")).toBeTruthy();
    expect(leftovers()).toHaveLength(2);
  });
  it("nothing read: the error is thrown for the screen and nothing is listed, as before", async () => {
    fetchMock.mockResolvedValueOnce(answer(401));
    const get = setup();
    expect(await say(get, UNREADABLE)).toBeInstanceOf(VoiceApiError);
    expect(leftovers()).toHaveLength(0);
  });
});

describe("parseFailureMessage: the cause in words", () => {
  it("busy / today's limit / slow / anything else", () => {
    expect(parseFailureMessage(new VoiceApiError("busy", "Parse busy", 503, "daily_limit"))).toBe(QUOTA);
    expect(parseFailureMessage(new VoiceApiError("busy", "Parse busy", 503, "minute_limit"))).toBe(BUSY);
    expect(parseFailureMessage(new VoiceApiError("busy", "Parse busy", 503))).toBe(BUSY);
    expect(parseFailureMessage(new VoiceApiError("timeout", "x", 504))).toBe(SLOW);
    expect(parseFailureMessage(new VoiceApiError("server", "x", 502))).toBe("Couldn't read the items");
    expect(parseFailureMessage(new VoiceApiError("network", "x"))).toBe("Couldn't read the items");
    expect(parseFailureMessage(new Error("boom"))).toBe("Couldn't read the items");
  });
});
