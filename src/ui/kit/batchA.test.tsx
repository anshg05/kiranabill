// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { AddChip, ChipGroup, ChoiceChip, FilterChip, FilterChipRow, RemovableChip } from "./Chip";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToggleRow } from "./Toggle";
import { Segmented } from "./Segmented";
import { Stepper } from "./Stepper";
import { SearchField, TextField } from "./TextField";
import { KB_ICONS } from "./icons";

// KB-412 batch a (26 §5): each part looks like the element it is drawn as in docs/design/ (the file is named on each test) and
// behaves like a real control. Sizes and colours below are the screen files' own values; the gallery shows each beside its crop.
afterEach(cleanup);
const cls = (el: Element) => el.getAttribute("class") ?? "";
const has = (el: Element, ...c: string[]) => {
  for (const x of c) expect(cls(el).split(/\s+/), `${x} in "${cls(el)}"`).toContain(x);
};

describe("Button", () => {
  it("primary (18-Printer 'Test print'): primary fill, white 16 / 700, 54 high, radius 16, the primary shadow, icon 20, pressed = deep", () => {
    render(<Button variant="primary" icon={KB_ICONS.Printer} iconSize={20}>Test print</Button>);
    const b = screen.getByRole("button", { name: "Test print" });
    has(b, "bg-kb-primary", "text-kb-card", "text-kb-16", "font-bold", "min-h-[54px]", "rounded-[16px]", "shadow-kb-primary", "gap-[10px]", "active:bg-kb-primary-deep", "kb-press", "font-kb", "w-full");
    expect(b.querySelector("svg")!.getAttribute("width")).toBe("20");
  });

  it("primary 58 (09-Recording 'Stop'): radius 18, gap 8", () => {
    render(<Button variant="primary" height={58}>Stop</Button>);
    has(screen.getByRole("button", { name: "Stop" }), "min-h-[58px]", "rounded-[18px]", "gap-2");
  });

  it("secondary (10-Review 'Re-record'): white card, 1 px border, ink 15 / 700, radius 14; 50 + the border = 52 on screen, as the file renders it", () => {
    render(<Button variant="secondary">Re-record</Button>);
    has(screen.getByRole("button", { name: "Re-record" }), "bg-kb-card", "border", "border-kb-border", "text-kb-ink", "text-kb-15", "font-bold", "min-h-[52px]", "rounded-[14px]", "w-full");
  });

  it("secondary 58 (09-Recording 'Pause'): 16 / 700, radius 18, 60 on screen with its border; fill={false} = as wide as its words", () => {
    render(<><Button variant="secondary" height={58}>Pause</Button><Button variant="secondary" fill={false}>More</Button></>);
    expect(cls(screen.getByRole("button", { name: "More" }))).not.toMatch(/\bw-full\b/);
    has(screen.getByRole("button", { name: "Pause" }), "min-h-[60px]", "rounded-[18px]", "text-kb-16");
  });

  it("tertiary (25-CancelBill 'Keep Bill 514'): text only, sub colour, 15 / 700, 46 high", () => {
    render(<Button variant="tertiary">Keep Bill 514</Button>);
    const b = screen.getByRole("button", { name: "Keep Bill 514" });
    has(b, "text-kb-sub", "text-kb-15", "font-bold", "min-h-[46px]");
    expect(cls(b)).not.toMatch(/\bbg-|\bborder\b/);
  });

  it("destructive: fill (25-CancelBill), outline (17-More 'Sign out'), text (15-BillDetail)", () => {
    render(<>
      <Button variant="destructive">Cancel fill</Button>
      <Button variant="destructive-outline">Sign out</Button>
      <Button variant="destructive-text">Cancel text</Button>
    </>);
    has(screen.getByRole("button", { name: "Cancel fill" }), "bg-kb-err", "text-kb-card", "min-h-[54px]", "rounded-[16px]", "text-kb-16");
    has(screen.getByRole("button", { name: "Sign out" }), "bg-kb-card", "border", "border-kb-border", "text-kb-err", "min-h-[52px]", "rounded-[14px]", "text-kb-15");
    has(screen.getByRole("button", { name: "Cancel text" }), "text-kb-err", "min-h-[46px]", "text-kb-15");
  });

  it("locked (12-BillReview 'Bill Banao'): disabled colours, the lock icon, said as unavailable with its reason - and the tap still reaches the screen (today a tap on a locked Bill Banao jumps to the first check, KB-307)", () => {
    const onClick = vi.fn();
    render(<><p id="why">1 item needs a price</p><Button variant="locked" reasonId="why" onClick={onClick}>Bill Banao</Button></>);
    const b = screen.getByRole("button", { name: "Bill Banao" });
    has(b, "bg-kb-disabled-bg", "text-kb-disabled-text", "min-h-[56px]", "rounded-[16px]", "text-kb-16");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("aria-describedby")).toBe("why");
    expect(b.querySelector("svg")).toBeTruthy();
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("a normal button reports a tap; it is type=button unless a form submit is asked for", () => {
    const onClick = vi.fn();
    render(<Button variant="primary" onClick={onClick}>Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b.getAttribute("type")).toBe("button");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Badge", () => {
  it("draft (12), saved with a tick (15), almost done (06), small (07) - each its drawn colours, pill, 12 / 700", () => {
    render(<>
      <Badge kind="draft">Draft · not saved</Badge>
      <Badge kind="saved">Saved</Badge>
      <Badge kind="almost">Almost done</Badge>
      <Badge kind="small">Required</Badge>
    </>);
    has(screen.getByText("Draft · not saved"), "bg-kb-muted", "text-kb-sub", "rounded-full", "text-kb-12", "font-bold");
    const saved = screen.getByText("Saved");
    has(saved, "bg-kb-ok-pale", "text-kb-ok");
    expect(saved.querySelector("svg")!.getAttribute("width")).toBe("13");
    has(screen.getByText("Almost done"), "bg-kb-primary-pale", "text-kb-primary");
    has(screen.getByText("Required"), "bg-kb-muted", "text-kb-sub", "text-kb-11");
  });

  it("recording (09): error colours, 14 / 700, a blinking 9 px dot", () => {
    render(<Badge kind="recording">Recording</Badge>);
    const b = screen.getByText("Recording");
    has(b, "bg-kb-err-pale", "text-kb-err", "text-kb-14");
    has(b.querySelector("span")!, "animate-kb-blink", "w-[9px]", "h-[9px]", "bg-kb-err");
  });
});

describe("chips", () => {
  it("filter chip (14-BillsList): 38 high, selected = primary fill, the others white with a border; said as pressed or not", () => {
    const onClick = vi.fn();
    render(<><FilterChip selected onClick={onClick}>Today</FilterChip><FilterChip selected={false} onClick={onClick}>Yesterday</FilterChip></>);
    const on = screen.getByRole("button", { name: "Today" });
    const off = screen.getByRole("button", { name: "Yesterday" });
    has(on, "bg-kb-primary", "text-kb-card", "min-h-[38px]", "rounded-full", "text-kb-14", "font-semibold");
    has(off, "bg-kb-card", "border-kb-border", "text-kb-ink");
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(off);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("choice chip (25-CancelBill reasons): 40 high, selected = pale blue with primary text", () => {
    render(<><ChoiceChip selected onClick={() => {}}>Wrong item</ChoiceChip><ChoiceChip selected={false} onClick={() => {}}>Other</ChoiceChip></>);
    has(screen.getByRole("button", { name: "Wrong item" }), "bg-kb-primary-pale", "text-kb-primary", "min-h-[40px]");
    has(screen.getByRole("button", { name: "Other" }), "bg-kb-card", "border-kb-border");
  });

  it("removable chip (19-AddItem): pale blue pill with an x that says what it removes; the add chip is dashed", () => {
    const onRemove = vi.fn();
    const onAdd = vi.fn();
    render(<><RemovableChip removeLabel="Remove तुअर दाल" onRemove={onRemove}>तुअर दाल</RemovableChip><AddChip onClick={onAdd}>Add name</AddChip></>);
    has(screen.getByText("तुअर दाल"), "bg-kb-primary-pale", "min-h-[34px]", "rounded-full");
    fireEvent.click(screen.getByRole("button", { name: "Remove तुअर दाल" }));
    expect(onRemove).toHaveBeenCalledOnce();
    const add = screen.getByRole("button", { name: "Add name" });
    has(add, "border-dashed", "text-kb-primary", "min-h-[34px]");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
  });
});

describe("ToggleRow (18-Printer)", () => {
  function Harness({ start = false }: { start?: boolean }) {
    const [on, setOn] = useState(start);
    return <ToggleRow label="Show shop phone" sub="Printed under the shop name" checked={on} onChange={setOn} />;
  }

  it("is a switch named by its row; 52 x 30, primary when on, the off colour when off; the white knob moves", () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "Show shop phone" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    has(sw, "w-[52px]", "h-[30px]", "bg-kb-toggle-off");
    has(sw.querySelector("span")!, "left-[3px]", "shadow-kb-knob");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    has(sw, "bg-kb-primary");
    has(sw.querySelector("span")!, "right-[3px]");
  });

  it("the whole row is tappable (26 §5): a tap on the label switches it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Show shop phone"));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Segmented (18-Printer paper size)", () => {
  it("a radio group: the chosen one white with the segment shadow and 700, the other sub and 600; a tap chooses", () => {
    const onChange = vi.fn();
    render(<Segmented label="Paper size" value="58" onChange={onChange} options={[{ value: "58", label: "58 mm · 2 inch" }, { value: "80", label: "80 mm · 3 inch" }]} />);
    expect(screen.getByRole("radiogroup", { name: "Paper size" })).toBeTruthy();
    const a = screen.getByRole("radio", { name: "58 mm · 2 inch" });
    const b = screen.getByRole("radio", { name: "80 mm · 3 inch" });
    expect(a.getAttribute("aria-checked")).toBe("true");
    expect(b.getAttribute("aria-checked")).toBe("false");
    has(a, "bg-kb-card", "shadow-kb-segment", "font-bold", "min-h-[46px]", "rounded-[11px]");
    has(b, "text-kb-sub", "font-semibold");
    fireEvent.click(b);
    expect(onChange).toHaveBeenCalledWith("80");
  });
});

describe("Stepper (18-Printer copies)", () => {
  it("- value +, 40 px bordered buttons with their own names; never past min or max", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper value={1} min={1} max={3} onChange={onChange} decreaseLabel="Fewer copies" increaseLabel="More copies" />);
    const minus = screen.getByRole("button", { name: "Fewer copies" });
    const plus = screen.getByRole("button", { name: "More copies" });
    has(plus, "w-10", "h-10", "rounded-[10px]", "border-kb-border");
    has(screen.getByText("1"), "text-kb-17", "font-extrabold");
    expect((minus as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(plus);
    expect(onChange).toHaveBeenLastCalledWith(2);
    rerender(<Stepper value={3} min={1} max={3} onChange={onChange} decreaseLabel="Fewer copies" increaseLabel="More copies" />);
    expect((screen.getByRole("button", { name: "More copies" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fewer copies" }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});

describe("TextField and SearchField", () => {
  it("text field (19-AddItem 'Price per kg'): label above, the box 52 high radius 14, a ₹ prefix, the helper line; focus = 1.5 px primary + the pale ring", () => {
    const onChange = vi.fn();
    render(<TextField label="Price per kg" prefix="₹" helper="Fills in when you don’t say a price." value="150" onChange={onChange} inputMode="decimal" />);
    const input = screen.getByLabelText("Price per kg") as HTMLInputElement;
    expect(input.value).toBe("150");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    const box = input.parentElement!;
    has(box, "min-h-[52px]", "rounded-[14px]", "border-kb-border", "focus-within:border-kb-primary", "focus-within:ring-4", "focus-within:ring-kb-primary/10");
    has(screen.getByText("₹"), "text-kb-sub", "text-kb-16");
    has(screen.getByText("Fills in when you don’t say a price."), "text-kb-13", "text-kb-sub");
    fireEvent.change(input, { target: { value: "160" } });
    expect(onChange).toHaveBeenCalledWith("160");
  });

  it("text field (06-ShopSetup): 54 high with a leading icon, and a lighter note after the label", () => {
    render(<TextField label="Phone" labelNote="· optional, printed on bills" height={54} prefix="+91" value="" onChange={() => {}} />);
    expect(screen.getByLabelText(/Phone/)).toBeTruthy();
    has(screen.getByText("· optional, printed on bills"), "font-normal", "text-kb-sub");
    has(screen.getByLabelText(/Phone/).parentElement!, "min-h-[54px]", "gap-[10px]");
  });

  it("search field (14-BillsList): hidden label still names it, 50 high, the search icon, 15 px text, the placeholder in sub", () => {
    render(<SearchField label="Search bill number, item or amount" placeholder="Search bill number, item or amount" value="" onChange={() => {}} />);
    const input = screen.getByRole("searchbox", { name: "Search bill number, item or amount" });
    has(input, "text-kb-15", "placeholder:text-kb-sub");
    has(input.parentElement!, "min-h-[50px]", "rounded-[14px]", "gap-[10px]");
    expect(input.parentElement!.querySelector("svg")!.getAttribute("width")).toBe("20");
  });
});

// Owner's review of batch a (14 Nov 2026).
describe("tap areas: the drawn look stays, every tappable part is at least 48 px (44 icon-only) to a finger", () => {
  const css = readFileSync(join(__dirname, "..", "..", "index.css"), "utf8");

  it("the invisible tap area is a centred ::before, at least 48 x 48 (kb-hit) or 44 x 44 (kb-hit-icon), never moving anything", () => {
    expect(css).toMatch(/\.kb-hit,\s*\.kb-hit-icon\s*\{\s*position:\s*relative;\s*\}/);
    expect(css).toMatch(/\.kb-hit::before,\s*\.kb-hit-icon::before\s*\{[^}]*content:\s*"";[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%,\s*-50%\);[^}]*\}/);
    // owner, 15 Nov 2026: never two tap areas overlapping - each stops at the middle of the gap its container declares
    expect(css).toMatch(/\.kb-hit::before\s*\{\s*width:\s*min\(max\(100%,\s*48px\),\s*calc\(100% \+ var\(--kb-gap-x,\s*48px\)\)\);\s*height:\s*min\(max\(100%,\s*48px\),\s*calc\(100% \+ var\(--kb-gap-y,\s*48px\)\)\);\s*\}/);
    expect(css).toMatch(/\.kb-hit-icon::before\s*\{\s*width:\s*min\(max\(100%,\s*44px\),\s*calc\(100% \+ var\(--kb-gap-x,\s*44px\)\)\);\s*height:\s*min\(max\(100%,\s*44px\),\s*calc\(100% \+ var\(--kb-gap-y,\s*44px\)\)\);\s*\}/);
  });

  it("every button of every batch-a part carries one (icon-only buttons the 44 one)", () => {
    const { container } = render(<>
      <Button variant="tertiary">Keep</Button><Button variant="primary">Go</Button>
      <FilterChip selected onClick={() => {}}>Today</FilterChip><ChoiceChip selected={false} onClick={() => {}}>Other</ChoiceChip>
      <RemovableChip removeLabel="Remove x" onRemove={() => {}}>x</RemovableChip><AddChip onClick={() => {}}>Add name</AddChip>
      <ToggleRow label="T" checked={false} onChange={() => {}} />
      <Segmented label="S" value="a" onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />
      <Stepper value={2} min={1} max={3} onChange={() => {}} decreaseLabel="Fewer" increaseLabel="More" />
    </>);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBe(11);
    for (const b of buttons) {
      const iconOnly = !b.textContent?.trim() && !!b.querySelector("svg"); // the switch has no words but is not an icon button: 48
      expect(cls(b).split(/\s+/), `${b.getAttribute("aria-label") ?? b.textContent}`).toContain(iconOnly ? "kb-hit-icon" : "kb-hit");
    }
  });
});

describe("icons keep their size when a label wraps (360 px + 130% text, Hindi)", () => {
  it("every icon inside a batch-a part is shrink-0", () => {
    const { container } = render(<>
      <Button variant="secondary" icon={KB_ICONS.Bluetooth}>Bluetooth settings that wrap onto two lines</Button>
      <Button variant="locked">Bill Banao</Button>
      <Badge kind="saved">Saved</Badge>
      <RemovableChip removeLabel="Remove x" onRemove={() => {}}>x</RemovableChip><AddChip onClick={() => {}}>Add name</AddChip>
      <Stepper value={2} min={1} max={3} onChange={() => {}} decreaseLabel="Fewer" increaseLabel="More" />
      <TextField label="Shop" icon={KB_ICONS.Store} value="" onChange={() => {}} />
      <SearchField label="Search" placeholder="Search" value="" onChange={() => {}} />
    </>);
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.length).toBe(9);
    for (const s of svgs) expect(s.getAttribute("class")).toMatch(/\bshrink-0\b/);
  });
});

describe("not drawn in the screens - the reviewer's choice (14 Nov 2026)", () => {
  it("Paused badge: the Recording badge's shape in the warning colours, with a still dot", () => {
    render(<Badge kind="paused">Paused</Badge>);
    const b = screen.getByText("Paused");
    has(b, "bg-kb-warn-bg", "text-kb-warn-text", "text-kb-14", "px-[14px]", "py-[7px]", "rounded-full");
    const dot = b.querySelector("span")!;
    has(dot, "w-[9px]", "h-[9px]", "bg-kb-warn-text");
    expect(cls(dot)).not.toMatch(/animate-/);
  });

  it("a stepper button at its limit: same shape, the icon in sub at reduced opacity, aria-disabled and not tappable", () => {
    const onChange = vi.fn();
    render(<Stepper value={1} min={1} max={3} onChange={onChange} decreaseLabel="Fewer copies" increaseLabel="More copies" />);
    const minus = screen.getByRole("button", { name: "Fewer copies" }) as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
    expect(minus.getAttribute("aria-disabled")).toBe("true");
    has(minus, "w-10", "h-10", "rounded-[10px]", "border-kb-border", "[&:disabled_svg]:text-kb-sub", "[&:disabled_svg]:opacity-40");
    fireEvent.click(minus);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("filter chip row (owner, 14 Nov 2026): scrolls sideways, no scrollbar, the cut chip hints at more", () => {
  it("scrolls on its own axis with the scrollbar hidden, and keeps the chips' tap areas inside it", () => {
    const { container } = render(<FilterChipRow>{["Today", "Yesterday"].map((c) => <FilterChip key={c} selected={c === "Today"} onClick={() => {}}>{c}</FilterChip>)}</FilterChipRow>);
    const row = container.firstElementChild!;
    has(row, "overflow-x-auto", "overflow-y-hidden", "[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden", "py-[5px]", "-my-[5px]");
    has(screen.getByRole("button", { name: "Today" }), "flex-none");
  });

  it("a chip reached by the keyboard is scrolled into view", () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    render(<FilterChipRow>{["Today", "Pick dates"].map((c) => <FilterChip key={c} selected={false} onClick={() => {}}>{c}</FilterChip>)}</FilterChipRow>);
    fireEvent.focus(screen.getByRole("button", { name: "Pick dates" }));
    expect(into).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });
});

describe("tap areas never overlap (owner, 15 Nov 2026): each stops at the middle of the gap", () => {
  it("a chip group (19 other names, 25 reasons) wraps with 8 px gaps and tells its chips so", () => {
    const { container } = render(<ChipGroup><ChoiceChip selected onClick={() => {}}>A</ChoiceChip></ChipGroup>);
    has(container.firstElementChild!, "flex", "flex-wrap", "gap-2", "[--kb-gap-x:8px]", "[--kb-gap-y:8px]", "[--kb-chip-gap:8px]");
  });

  it("the chip x reaches over its own chip's words but stops half way to the next chip: 12 px of chip + the gap across, 8 px of chip + the gap up and down", () => {
    render(<RemovableChip removeLabel="Remove x" onRemove={() => {}}>x</RemovableChip>);
    has(screen.getByText("x"), "[--kb-gap-x:calc(12px+var(--kb-chip-gap,48px))]", "[--kb-gap-y:calc(8px+var(--kb-chip-gap,48px))]");
  });

  it("the filter row tells its chips the 8 px gap between them", () => {
    const { container } = render(<FilterChipRow><FilterChip selected onClick={() => {}}>T</FilterChip></FilterChipRow>);
    has(container.firstElementChild!, "[--kb-gap-x:8px]");
  });
});

