// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TopBar, ScreenTitle } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { GroupLabel, ListCard, ListRow } from "./ListRow";
import { BottomSheet } from "./BottomSheet";
import { InfoBanner, LinkBanner, OfflineStrip } from "./Banner";
import { TipCard } from "./TipCard";
import { HeroCard } from "./HeroCard";
import { FilterChip, ChoiceChip, AddChip, RemovableChip } from "./Chip";
import { Badge } from "./Badge";
import { KB_ICONS } from "./icons";

// KB-412 batch b (26 §5): each part as drawn in the named docs/design/ screen, and behaving as a real control.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 30)); // useBackEntry's deferred history clean-up
});
const cls = (el: Element) => el.getAttribute("class") ?? "";
const has = (el: Element, ...c: string[]) => {
  for (const x of c) expect(cls(el).split(/\s+/), `${x} in "${cls(el)}"`).toContain(x);
};

describe("TopBar (12-BillReview) and ScreenTitle (16-Items)", () => {
  it("top bar: a 44 px back button with its name and the 24 px chevron, the title 18 / 700, an optional badge on the right; no coloured background", () => {
    const onBack = vi.fn();
    const { container } = render(<TopBar title="New bill" backLabel="Back" onBack={onBack} right={<Badge kind="draft">Draft · not saved</Badge>} />);
    const back = screen.getByRole("button", { name: "Back" });
    has(back, "w-11", "h-11");
    expect(back.querySelector("svg")!.getAttribute("width")).toBe("24");
    has(screen.getByRole("heading", { name: "New bill" }), "text-kb-18", "font-bold", "flex-1");
    expect(screen.getByText("Draft · not saved")).toBeTruthy();
    expect(cls(container.firstElementChild!)).not.toMatch(/\bbg-/);
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("screen title: 26 / 800 with -0.5 tracking; the optional action is a small primary button (44 high, radius 12, 14 / 700, plus 18)", () => {
    const onAdd = vi.fn();
    render(<ScreenTitle title="Items" action={{ label: "Add", icon: KB_ICONS.Plus, onClick: onAdd }} />);
    has(screen.getByRole("heading", { name: "Items" }), "text-kb-26", "font-extrabold", "tracking-[-0.5px]");
    const add = screen.getByRole("button", { name: "Add" });
    has(add, "min-h-[44px]", "rounded-[12px]", "bg-kb-primary", "text-kb-card", "text-kb-14", "font-bold", "kb-hit");
    expect(add.querySelector("svg")!.getAttribute("width")).toBe("18");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
  });
});

describe("BottomNav (17-More)", () => {
  const items = (active: string, onClick = vi.fn()) =>
    (["Home", "Bills", "Items", "More"] as const).map((k) => ({ key: k, label: k, icon: KB_ICONS[k === "Bills" ? "ReceiptText" : k === "Items" ? "Package" : k === "More" ? "MoreHorizontal" : "Home"], active: k === active, onClick: () => onClick(k) }));

  it("a named navigation of four 58 px tabs; the active one is the current page: primary 700 on the pale pill; the others sub 500", () => {
    render(<BottomNav label="Main" items={items("More")} />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    const more = screen.getByRole("button", { name: "More" });
    const home = screen.getByRole("button", { name: "Home" });
    expect(more.getAttribute("aria-current")).toBe("page");
    expect(home.getAttribute("aria-current")).toBeNull();
    has(more, "text-kb-primary", "font-bold", "min-h-[58px]", "text-kb-12");
    has(home, "text-kb-sub", "font-medium");
    has(more.querySelector("span")!, "bg-kb-primary-pale", "rounded-full", "kb-tab");
    expect(cls(home.querySelector("span")!)).not.toMatch(/bg-kb-primary-pale/);
    expect(more.querySelector("svg")!.getAttribute("width")).toBe("22");
  });

  it("a tap reports its tab; the bar clears the phone's home bar (safe area)", () => {
    const onClick = vi.fn();
    render(<BottomNav label="Main" items={items("Home", onClick)} />);
    fireEvent.click(screen.getByRole("button", { name: "Bills" }));
    expect(onClick).toHaveBeenCalledWith("Bills");
    has(screen.getByRole("navigation"), "pb-[max(8px,env(safe-area-inset-bottom))]", "border-t", "border-kb-border", "bg-kb-card");
  });
});

describe("ListRow, ListCard, GroupLabel (17-More)", () => {
  it("a 60 px row (+ its divider, as drawn): a 38 px pale tile with a 19 px icon, title 15 / 600, sub 13, a value, the 18 px chevron", () => {
    const onClick = vi.fn();
    render(<ListCard><ListRow icon={KB_ICONS.Languages} title="App language" value="English" onClick={onClick} /><ListRow icon={KB_ICONS.Printer} title="Printer" sub="Not connected" onClick={onClick} /></ListCard>);
    const row = screen.getByRole("button", { name: /App language/ });
    has(row, "min-h-[61px]", "border-b", "border-kb-border", "px-[14px]", "gap-3", "kb-hit", "w-full");
    const svgs = row.querySelectorAll("svg");
    expect(svgs[0]!.getAttribute("width")).toBe("19");
    expect(svgs[1]!.getAttribute("width")).toBe("18");
    has(svgs[0]!.parentElement!, "w-[38px]", "h-[38px]", "rounded-[11px]", "bg-kb-primary-pale", "text-kb-primary");
    has(screen.getByText("App language"), "text-kb-15", "font-semibold");
    has(screen.getByText("English"), "text-kb-13", "text-kb-sub");
    has(screen.getByText("Not connected"), "text-kb-13", "text-kb-sub");
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
    has(row.parentElement!, "bg-kb-card", "border", "border-kb-border", "rounded-[16px]", "overflow-hidden");
  });

  it("group label: 12 / 700 sub, 0.5 tracking, upper case", () => {
    render(<GroupLabel>Billing</GroupLabel>);
    has(screen.getByText("Billing"), "text-kb-12", "font-bold", "text-kb-sub", "tracking-[.5px]", "uppercase", "px-1");
  });
});

describe("BottomSheet (25-CancelBill) - the same Back / Escape / backdrop / focus behaviour as today's sheets (KB-342)", () => {
  const open = (onClose = vi.fn()) => {
    render(
      <>
        <button type="button">Behind</button>
        <BottomSheet backKey="kbKitSheet" title="Cancel Bill 514?" intro="Bill 514 stays in history." onClose={onClose}>
          <button type="button">First</button>
          <button type="button">Last</button>
        </BottomSheet>
      </>,
    );
    return onClose;
  };

  it("a modal dialog named by its title; the bg colour, radius 28 on top, the 44 x 5 handle, 22 / 800 title, the 45% ink backdrop", () => {
    open();
    const d = screen.getByRole("dialog", { name: "Cancel Bill 514?" });
    expect(d.getAttribute("aria-modal")).toBe("true");
    has(d, "bg-kb-bg", "rounded-t-[28px]", "animate-kb-sheet", "font-kb");
    has(screen.getByRole("heading", { name: "Cancel Bill 514?" }), "text-kb-22", "font-extrabold");
    // the backdrop covers the screen below the offline strip (KB-414 phone check, 17 Nov 2026)
    has(d.parentElement!, "bg-kb-ink/45", "animate-kb-fade", "fixed", "inset-x-0", "bottom-0", "top-[var(--kb-tab-top,0px)]");
    has(d.querySelector("[aria-hidden='true']")!, "w-[44px]", "h-[5px]", "bg-kb-handle");
  });

  it("Escape closes it", () => {
    const onClose = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Android Back closes it", async () => {
    const onClose = open();
    window.history.back();
    await new Promise((r) => setTimeout(r, 50));
    expect(onClose).toHaveBeenCalled();
  });

  it("a tap on the dim backdrop closes it; a tap inside does not", () => {
    const onClose = open();
    const d = screen.getByRole("dialog");
    fireEvent.pointerDown(d);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(d.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focus moves into the sheet and Tab stays inside it - from the last control to the first, Shift+Tab back", () => {
    open();
    const d = screen.getByRole("dialog");
    expect(document.activeElement).toBe(d);
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("a field inside that focuses itself on opening keeps the focus (KB-413: the hand-added line's quantity editor)", () => {
    render(<BottomSheet backKey="kbKitSheet3" title="T" onClose={() => {}}><input aria-label="Qty" autoFocus /></BottomSheet>);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Qty" }));
  });

  it("focus goes back to where it was when the sheet closes", () => {
    const behind = () => screen.getByRole("button", { name: "Behind" });
    const { rerender } = render(<button type="button">Behind</button>);
    behind().focus();
    rerender(<><button type="button">Behind</button><BottomSheet backKey="kbKitSheet2" title="T" onClose={() => {}}><button type="button">X</button></BottomSheet></>);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    rerender(<button type="button">Behind</button>);
    expect(document.activeElement).toBe(behind());
  });
});

describe("banners (24-Offline, 16-Items)", () => {
  it("offline strip: ink background, white 14 / 600, the wifi-off icon 18; announced as a status", () => {
    render(<OfflineStrip>No internet · billing still works</OfflineStrip>);
    const s = screen.getByRole("status");
    has(s, "bg-kb-ink", "text-kb-card", "text-kb-14", "font-semibold", "px-4", "py-[10px]");
    expect(s.querySelector("svg")!.getAttribute("width")).toBe("18");
  });

  it("info banner (24): pale blue, the pale-blue line, radius 18, a 46 px white tile with a 22 px primary icon, title 16 / 700; busy = the small spinner", () => {
    render(<InfoBanner icon={KB_ICONS.Cloud} title="Order saved · will send when online" sub="Recording 1:05" busy />);
    const t = screen.getByText("Order saved · will send when online");
    has(t, "text-kb-16", "font-bold");
    const box = t.closest("div[class*='rounded-[18px]']")!;
    has(box, "bg-kb-primary-pale", "border-kb-primary-line", "p-[14px]");
    has(box.querySelector("svg")!.parentElement!, "w-[46px]", "h-[46px]", "bg-kb-card", "text-kb-primary");
    has(box.querySelector("[class*='animate-kb-spin']")!, "border-kb-spinner-track", "border-t-kb-primary", "w-[18px]", "h-[18px]");
  });

  it("link banner (16): the pale-blue to white gradient, a 40 px primary tile with a white 20 px icon, title 15 / 700, chevron 20; a tap reports", () => {
    const onClick = vi.fn();
    render(<LinkBanner icon={KB_ICONS.Sparkles} title="3 prices learned from your bills" sub="Check them once" onClick={onClick} />);
    const b = screen.getByRole("button", { name: /3 prices learned/ });
    has(b, "bg-linear-[120deg]", "from-kb-primary-pale", "to-kb-card", "border-kb-primary-line", "rounded-[16px]", "kb-hit");
    has(b.querySelector("svg")!.parentElement!, "w-10", "h-10", "bg-kb-primary", "text-kb-card");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("TipCard (11-Generating warm, 22-PrinterSearch white, 09-Recording white dense)", () => {
  it("warm: warn background and text, the bulb 20, a 13 / 700 heading and 14 / 1.5 words", () => {
    render(<TipCard variant="warm" title="DID YOU KNOW">Say a price once.</TipCard>);
    has(screen.getByText("DID YOU KNOW"), "text-kb-13", "font-bold", "text-kb-warn-text");
    const words = screen.getByText("Say a price once.");
    has(words, "text-kb-14", "text-kb-warn-text", "leading-[1.5]");
    has(words.closest("[class*='bg-kb-warn-bg']")!, "rounded-[16px]", "py-[14px]", "px-4");
  });

  it("white: card with a border, the amber bulb, 14 sub words at 1.5; dense = 09's 12 / 14 padding, centred", () => {
    const { container } = render(<><TipCard variant="white">Not listed?</TipCard><TipCard variant="white-dense">Say item · quantity · price.</TipCard></>);
    const [a, b] = [...container.children] as Element[];
    has(a!, "bg-kb-card", "border", "border-kb-border", "p-[14px]", "items-start");
    has(a!.querySelector("svg")!.parentElement!, "text-kb-amber");
    has(b!, "py-3", "px-[14px]", "items-center", "gap-[10px]"); // 09: 10 apart
    has(a!, "gap-3");
  });

  it("note (KB-413, 10-Review): the white card at 14 / 16, the primary ear 2 px down, 14 / 1.5 sub words", () => {
    render(<TipCard variant="note">Listen once if the shop was noisy.</TipCard>);
    const words = screen.getByText("Listen once if the shop was noisy.");
    has(words, "text-kb-14", "text-kb-sub", "leading-[1.5]");
    const card = words.parentElement!;
    has(card, "bg-kb-card", "border", "border-kb-border", "rounded-[16px]", "py-[14px]", "px-4", "gap-3", "items-start");
    has(card.querySelector("svg")!.parentElement!, "text-kb-primary", "mt-[2px]");
  });
});

describe("HeroCard (26-FirstDay): the first-use hero, one action", () => {
  it("white to pale-blue at 170°, radius 26, the hero shadow; title 20 / 800, one line 14 sub; its action inside", () => {
    render(<HeroCard title="Make your first bill" sub="Try it now — say any order you know"><button type="button">Record</button></HeroCard>);
    const title = screen.getByRole("heading", { name: "Make your first bill" });
    has(title, "text-kb-20", "font-extrabold");
    has(screen.getByText("Try it now — say any order you know"), "text-kb-14", "text-kb-sub", "-mt-[6px]");
    const card = title.parentElement!;
    has(card, "bg-linear-[170deg]", "from-kb-card", "to-kb-primary-pale", "rounded-[26px]", "shadow-kb-hero", "border-kb-border");
    expect(screen.getByRole("button", { name: "Record" })).toBeTruthy();
  });
});

describe("every batch-b icon keeps its size and every tappable part reaches 48 px (44 icon-only)", () => {
  it("icons are shrink-0; buttons carry kb-hit / kb-hit-icon", () => {
    const { container } = render(<>
      <TopBar title="T" backLabel="Back" onBack={() => {}} />
      <ScreenTitle title="Items" action={{ label: "Add", icon: KB_ICONS.Plus, onClick: () => {} }} />
      <ListRow icon={KB_ICONS.Printer} title="Printer" onClick={() => {}} />
      <LinkBanner icon={KB_ICONS.Sparkles} title="L" onClick={() => {}} />
      <OfflineStrip>Off</OfflineStrip>
      <TipCard variant="warm" title="T">x</TipCard>
    </>);
    for (const s of container.querySelectorAll("svg")) expect(s.getAttribute("class")).toMatch(/\bshrink-0\b/);
    for (const b of container.querySelectorAll("button")) {
      const iconOnly = !b.textContent?.trim() || b.getAttribute("aria-label") === "Back";
      expect(cls(b).split(/\s+/), b.textContent ?? "").toContain(iconOnly ? "kb-hit-icon" : "kb-hit");
    }
  });
});

describe("right-side actions stay inside (reviewer, 15 Nov 2026)", () => {
  it("list row: the words shrink and wrap, the value never shrinks or breaks", () => {
    render(<ListRow icon={KB_ICONS.Languages} title="App language" value="English" onClick={() => {}} />);
    has(screen.getByText("App language").parentElement!, "min-w-0");
    has(screen.getByText("English"), "flex-none", "whitespace-nowrap");
  });

  it("top bar: the title shrinks and wraps; the badge never shrinks; every badge and chip never breaks inside", () => {
    render(<><TopBar title="New bill" backLabel="Back" onBack={() => {}} right={<Badge kind="draft">Draft · not saved</Badge>} />
      <FilterChip selected onClick={() => {}}>This week</FilterChip><ChoiceChip selected={false} onClick={() => {}}>Wrong price</ChoiceChip>
      <AddChip onClick={() => {}}>Add name</AddChip><RemovableChip removeLabel="r" onRemove={() => {}}>तुअर दाल</RemovableChip></>);
    has(screen.getByRole("heading", { name: "New bill" }), "min-w-0");
    has(screen.getByText("Draft · not saved").parentElement!, "flex-none");
    for (const t of ["Draft · not saved", "This week", "Wrong price", "Add name", "तुअर दाल"]) has(screen.getByText(t), "whitespace-nowrap");
  });

  it("banners: the words shrink and wrap beside the tile", () => {
    render(<><InfoBanner icon={KB_ICONS.Cloud} title="Order saved" busy /><LinkBanner icon={KB_ICONS.Lightbulb} title="3 prices" onClick={() => {}} /></>);
    has(screen.getByText("Order saved").parentElement!, "min-w-0");
    has(screen.getByText("3 prices").parentElement!, "min-w-0");
  });
});

