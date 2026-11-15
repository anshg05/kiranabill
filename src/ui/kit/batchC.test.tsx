// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BillCard } from "./BillCard";
import { BillLine, PriceNeededLine } from "./BillLine";
import { HeardCard } from "./HeardCard";
import { ReceiptPaper } from "./ReceiptPaper";
import { MicButton } from "./MicButton";
import { Waveform } from "./Waveform";
import { Logo } from "./Logo";
import logoUrl from "./logo-blue2.svg";

// KB-412 batch c (26 §5): each part as drawn in the named docs/design/ screen, behaving as a real control.
afterEach(cleanup);
const ROOT = join(__dirname, "..", "..", "..");
const cls = (el: Element) => el.getAttribute("class") ?? "";
const has = (el: Element, ...c: string[]) => {
  for (const x of c) expect(cls(el).split(/\s+/), `${x} in "${cls(el)}"`).toContain(x);
};

describe("BillCard (14-BillsList)", () => {
  it("a white card (radius 16, 10 / 10 / 10 / 14): the bill opens from its own button - pale tile with the 20 px receipt, title 15 / 700, 13 sub line, amount 16 / 800 - and a separate 42 px print button", () => {
    const onOpen = vi.fn();
    const onPrint = vi.fn();
    render(<BillCard title="Bill 515" meta="1:18 pm · 4 items" amount="₹610" onOpen={onOpen} printLabel="Print bill 515" onPrint={onPrint} />);
    const open = screen.getByRole("button", { name: /Bill 515/ });
    has(open.parentElement!, "bg-kb-card", "border", "border-kb-border", "rounded-[16px]", "py-[10px]", "pr-[10px]", "pl-[14px]", "gap-3");
    has(open, "flex-1", "min-h-[48px]", "kb-hit");
    has(open.querySelector("svg")!.parentElement!, "w-[42px]", "h-[42px]", "rounded-[12px]", "bg-kb-primary-pale", "text-kb-primary");
    has(screen.getByText("Bill 515"), "text-kb-15", "font-bold");
    has(screen.getByText("1:18 pm · 4 items"), "text-kb-13", "text-kb-sub");
    has(screen.getByText("₹610"), "text-kb-16", "font-extrabold");
    const print = screen.getByRole("button", { name: "Print bill 515" });
    has(print, "w-[42px]", "h-[42px]", "rounded-[12px]", "border-kb-border", "kb-hit-icon");
    expect(print.querySelector("svg")!.getAttribute("width")).toBe("19");
    fireEvent.click(open);
    fireEvent.click(print);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onPrint).toHaveBeenCalledOnce();
  });

  it("cancelled: a muted tile, the red Cancelled chip after the title, the amount struck through in sub", () => {
    render(<BillCard title="Bill 512" meta="12:05 pm · 3 items" amount="₹640" cancelledLabel="Cancelled" onOpen={() => {}} printLabel="Print bill 512" onPrint={() => {}} />);
    has(screen.getByText("Cancelled"), "bg-kb-err-pale", "text-kb-err", "text-kb-11", "font-bold", "rounded-full");
    has(screen.getByText("₹640"), "line-through", "text-kb-sub");
    has(screen.getByRole("button", { name: /Bill 512/ }).querySelector("svg")!.parentElement!, "bg-kb-muted", "text-kb-sub");
  });
});

describe("BillLine and PriceNeededLine (12-BillReview)", () => {
  it("a bill line: white card radius 16, 12 / 14; the name 17 / 600 as said, the detail 14 sub, the amount 17 / 800, a 40 px edit button with its own name", () => {
    const onEdit = vi.fn();
    render(<BillLine name="चीनी" detail="2 kg × ₹45" amount="₹90" editLabel="Edit चीनी" onEdit={onEdit} />);
    has(screen.getByText("चीनी"), "text-kb-17", "font-semibold");
    has(screen.getByText("2 kg × ₹45"), "text-kb-14", "text-kb-sub");
    has(screen.getByText("₹90"), "text-kb-17", "font-extrabold");
    const edit = screen.getByRole("button", { name: "Edit चीनी" });
    has(edit, "w-10", "h-10", "rounded-[10px]", "bg-kb-muted", "text-kb-sub", "kb-hit-icon");
    has(edit.parentElement!, "bg-kb-card", "border", "border-kb-border", "rounded-[16px]", "py-3", "px-[14px]");
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("a filled price carries its mark: a pale-blue pill, the 11 px star, 11 / 700 (the words come from the screen)", () => {
    render(<BillLine name="टाटा नमक" detail="1 pc × ₹30" amount="₹30" mark="your price" editLabel="Edit" onEdit={() => {}} />);
    const mark = screen.getByText("your price");
    has(mark, "bg-kb-primary-pale", "text-kb-primary", "rounded-full", "text-kb-11", "font-bold", "px-2", "py-[2px]");
    expect(mark.querySelector("svg")!.getAttribute("width")).toBe("11");
  });

  it("Price needed: warn background, 1.5 px warn border, the warning icon + words in warn text, an inline ₹ field (warn-field border) with its own label, and the ink Add button", () => {
    const onAdd = vi.fn();
    const onChange = vi.fn();
    render(<PriceNeededLine name="दाने" detail="1 kg" needLabel="Price needed" inputLabel="Price for दाने" placeholder="Price per kg" value="" onChange={onChange} addLabel="Add" onAdd={onAdd} />);
    const need = screen.getByText("Price needed");
    has(need, "text-kb-warn-text", "text-kb-14", "font-bold");
    expect(need.querySelector("svg")!.getAttribute("width")).toBe("17");
    const input = screen.getByLabelText("Price for दाने");
    expect(input.getAttribute("placeholder")).toBe("Price per kg");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    has(input.parentElement!, "min-w-0", "min-h-[48px]", "box-content", "rounded-[12px]", "border-kb-warn-field", "bg-kb-card"); // 48 + its border, as the file sizes it
    fireEvent.change(input, { target: { value: "150" } });
    expect(onChange).toHaveBeenCalledWith("150");
    const add = screen.getByRole("button", { name: "Add" });
    has(add, "bg-kb-ink", "text-kb-card", "min-h-[48px]", "rounded-[12px]", "text-kb-15", "font-bold");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
    has(add.closest("[class*='bg-kb-warn-bg']")!, "border-[1.5px]", "border-kb-warn-border", "rounded-[16px]");
    has(screen.getByText("1 kg"), "text-kb-warn-text");
  });
});

describe("HeardCard (12-BillReview): every recording shows what was heard (KB-385)", () => {
  it("the ear, 'Heard:' in ink, the words 13 sub at 1.5 clamped to 2 lines; the chevron button opens and closes the rest", () => {
    render(<HeardCard label="Heard:" text="2 किलो चीनी 45 रुपये किलो, चावल 5 किलो 340" expandLabel="Show all" collapseLabel="Show less" />);
    const words = screen.getByText(/2 किलो चीनी/);
    has(words, "text-kb-13", "text-kb-sub", "leading-[1.5]", "line-clamp-2");
    has(screen.getByText("Heard:"), "text-kb-ink");
    const more = screen.getByRole("button", { name: "Show all" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(cls(words)).not.toMatch(/line-clamp-2/);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
    has(words.closest("[class*='rounded-[16px]']")!, "bg-kb-card", "border-kb-border", "py-[10px]", "px-[14px]");
  });
});

describe("ReceiptPaper (13-BillSaved, 15-BillDetail)", () => {
  it("a frame only: the receipt drop shadow, today's receipt inside unchanged, the torn zig-zag edge under it when asked", () => {
    const { container } = render(<ReceiptPaper width={320} torn><p>today's receipt</p></ReceiptPaper>);
    const paper = container.firstElementChild as HTMLElement;
    has(paper, "drop-shadow-kb-receipt");
    expect(paper.style.width).toBe("320px");
    expect(screen.getByText("today's receipt")).toBeTruthy();
    const edge = paper.querySelector("svg")!;
    expect(edge.getAttribute("viewBox")).toBe("0 0 280 10");
    expect(edge.getAttribute("preserveAspectRatio")).toBe("none");
    has(edge, "text-kb-card");
    expect(edge.querySelector("path")!.getAttribute("fill")).toBe("currentColor");
  });

  it("without torn there is no edge (15-BillDetail)", () => {
    const { container } = render(<ReceiptPaper width={340}><p>r</p></ReceiptPaper>);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("Receipt.tsx itself is not touched by the kit (D110: the receipt keeps today's content)", () => {
    const kitFiles = ["ReceiptPaper.tsx"].map((f) => readFileSync(join(__dirname, f), "utf8"));
    for (const src of kitFiles) expect(src).not.toMatch(/from "\.\.\/Receipt"/);
  });
});

describe("MicButton (08-Home / 26-FirstDay; 09-Recording)", () => {
  it("home: a named button, 138 tap area, the pulsing ring 12 in, the 114 primary circle with the mic shadow and a white 48 mic", () => {
    const onClick = vi.fn();
    render(<MicButton variant="home" label="Record order" onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Record order" });
    has(b, "w-[138px]", "h-[138px]");
    const [ring, circle] = [...b.children] as HTMLElement[];
    has(ring!, "inset-3", "animate-kb-pulse", "bg-kb-primary", "rounded-full");
    has(circle!, "w-[114px]", "h-[114px]", "bg-kb-primary", "shadow-kb-mic", "text-kb-card");
    expect(circle!.querySelector("svg")!.getAttribute("width")).toBe("48");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("recording: not a button (Pause / Stop are) - a 210 pale circle, the ring 18 in, the 132 circle with the large shadow and a 56 mic at stroke 2", () => {
    const { container } = render(<MicButton variant="recording" />);
    expect(screen.queryByRole("button")).toBeNull();
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    has(box, "w-[210px]", "h-[210px]");
    has(box.querySelector("[class*='inset-[18px]']")!, "animate-kb-pulse");
    const circle = box.querySelector("[class*='w-[132px]']")!;
    has(circle, "shadow-kb-mic-lg");
    const svg = circle.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("56");
    expect(svg.getAttribute("stroke-width")).toBe("2");
  });
});

describe("Waveform (09-Recording live, 10-Review playback)", () => {
  const H = [10, 22, 36, 18, 48, 30, 56, 26];
  it("live: 5 px primary bars, radius 3, 4 apart, each with its height and the kb-bar animation staggered 0.11 s in sevens", () => {
    const { container } = render(<Waveform heights={H} live height={64} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    has(box, "gap-1");
    expect(box.style.height).toBe("64px");
    const bars = [...box.children] as HTMLElement[];
    expect(bars).toHaveLength(8);
    has(bars[0]!, "w-[5px]", "rounded-[3px]", "bg-kb-primary", "animate-kb-bar", "origin-center");
    expect(bars.map((b) => b.style.height)).toEqual(H.map((h) => `${h}px`));
    expect(bars.map((b) => b.style.animationDelay)).toEqual(["0s", "0.11s", "0.22s", "0.33s", "0.44s", "0.55s", "0.66s", "0s"]);
  });

  it("playback: the played colour, no animation", () => {
    const { container } = render(<Waveform heights={H} height={30} />);
    const bar = container.firstElementChild!.firstElementChild!;
    has(bar, "bg-kb-wave-played");
    expect(cls(bar)).not.toMatch(/animate-/);
  });
});

describe("Logo (26 §4: logo-blue2.svg)", () => {
  it("is the approved file, byte for byte", () => {
    expect(readFileSync(join(__dirname, "logo-blue2.svg"), "utf8")).toBe(readFileSync(join(ROOT, "docs", "design", "logo-blue2.svg"), "utf8"));
  });

  it("the drawn sizes and corners: 42 (radius 9), 52 (12), 76 (16); the blue shadow where the screen draws it", () => {
    const { container } = render(<><Logo size={42} shadow /><Logo size={52} /><Logo size={76} shadow alt="KiranaBill logo" /></>);
    const [a, b, c] = [...container.querySelectorAll("img")];
    for (const img of [a, b, c]) expect(img!.getAttribute("src")).toBe(logoUrl);
    expect([a, b, c].map((i) => i!.getAttribute("width"))).toEqual(["42", "52", "76"]);
    has(a!, "rounded-[9px]", "shadow-kb-logo");
    has(b!, "rounded-[12px]");
    expect(cls(b!)).not.toMatch(/shadow/);
    has(c!, "rounded-[16px]");
    expect(a!.getAttribute("alt")).toBe(""); // decorative unless named
    expect(c!.getAttribute("alt")).toBe("KiranaBill logo");
  });
});

describe("every batch-c icon keeps its size; every tappable part has its tap area", () => {
  it("icons shrink-0, buttons kb-hit / kb-hit-icon", () => {
    const { container } = render(<>
      <BillCard title="Bill 1" meta="m" amount="₹1" onOpen={() => {}} printLabel="Print" onPrint={() => {}} />
      <BillLine name="n" detail="d" amount="₹1" mark="m" editLabel="Edit" onEdit={() => {}} />
      <PriceNeededLine name="n" detail="d" needLabel="Price needed" inputLabel="P" placeholder="p" value="" onChange={() => {}} addLabel="Add" onAdd={() => {}} />
      <HeardCard label="Heard:" text="t" expandLabel="More" collapseLabel="Less" />
      <MicButton variant="home" label="Record" onClick={() => {}} />
    </>);
    for (const s of container.querySelectorAll("svg")) expect(s.getAttribute("class")).toMatch(/\bshrink-0\b/);
    for (const b of container.querySelectorAll("button")) {
      const iconOnly = !b.textContent?.trim() && !!b.querySelector("svg") && b.getAttribute("aria-label") !== "Record";
      if (b.getAttribute("aria-label") === "Record") continue; // 138 px, larger than any tap area
      expect(cls(b).split(/\s+/), b.getAttribute("aria-label") ?? b.textContent ?? "").toContain(iconOnly ? "kb-hit-icon" : "kb-hit");
    }
  });
});

// Reviewer, 15 Nov 2026 (360 px + 130% text): nothing on the right of a part is ever pushed outside it, and a chip never breaks inside.
describe("right-side actions stay inside; words wrap on the left; chips never break", () => {
  it("bill card: the bill number never breaks, the name / time column shrinks and wraps (the Cancelled chip moves under it), the amount and the print button never shrink", () => {
    render(<BillCard title="Bill 512" meta="12:05 pm · 3 items" amount="₹640" cancelledLabel="Cancelled" onOpen={() => {}} printLabel="Print bill 512" onPrint={() => {}} />);
    const open = screen.getByRole("button", { name: /Bill 512/ });
    has(open, "min-w-0");
    has(screen.getByText("Bill 512"), "whitespace-nowrap");
    has(screen.getByText("Bill 512").parentElement!, "flex-wrap");
    has(screen.getByText("Bill 512").parentElement!.parentElement!, "min-w-0");
    has(screen.getByText("Cancelled"), "whitespace-nowrap");
    has(screen.getByText("₹640"), "flex-none", "whitespace-nowrap");
    has(screen.getByRole("button", { name: "Print bill 512" }), "flex-none");
  });

  it("bill line: the words shrink and wrap, the amount and edit button never shrink; the mark never breaks and moves to its own line when the row is full", () => {
    render(<BillLine name="टाटा नमक" detail="1 pc × ₹30" amount="₹30" mark="your price" editLabel="Edit" onEdit={() => {}} />);
    has(screen.getByText("टाटा नमक").parentElement!, "min-w-0");
    has(screen.getByText("₹30", { selector: "div" }), "flex-none", "whitespace-nowrap");
    const mark = screen.getByText("your price");
    has(mark, "whitespace-nowrap", "flex-none");
    has(mark.parentElement!, "flex-wrap");
  });

  it("Price needed: the name shrinks, 'Price needed' never breaks or shrinks", () => {
    render(<PriceNeededLine name="दाने" detail="1 kg" needLabel="Price needed" inputLabel="P" placeholder="p" value="" onChange={() => {}} addLabel="Add" onAdd={() => {}} />);
    has(screen.getByText("दाने").parentElement!, "min-w-0");
    has(screen.getByText("Price needed"), "flex-none", "whitespace-nowrap");
    has(screen.getByRole("button", { name: "Add" }), "flex-none", "whitespace-nowrap");
  });
});

