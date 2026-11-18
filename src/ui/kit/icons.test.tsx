// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { Ellipsis, Lock, Search, CircleQuestionMark, Smartphone } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Icon, KB_ICONS } from "./icons";

// KB-411 (26 §2.4): the design's icons come from lucide-react (already in the app), stroke 1.9, sizes 18 / 20 / 22 / 24.
const spec = readFileSync(join(__dirname, "..", "..", "..", "docs", "26-DESIGN-SPEC.md"), "utf8");
const list = spec.slice(spec.indexOf("Mapping used in the design:"), spec.indexOf("## 3. Motion"));
const specNames = list
  .slice(list.indexOf(":") + 1, list.indexOf("\n"))
  .split(",")
  .map((s) => s.replace(/\(.*?\)/g, "").replace(/ or the WhatsApp mark/, "").replace(/\.\s*$/, "").trim())
  .filter(Boolean);

describe("the icons of 26 §2.4", () => {
  it("the list is read from 26 (35 names, before the exceptions note)", () => {
    expect(specNames).toHaveLength(35);
    expect(specNames).toContain("Mic");
    expect(specNames).toContain("Ear");
  });

  it("every icon 26 names is in the kit, as a lucide icon", () => {
    for (const name of specNames) expect(KB_ICONS[name as keyof typeof KB_ICONS], name).toBeTruthy();
  });

  it("the names lucide-react 1.x calls differently map to the same drawings (Home is the design's own house)", () => {
    expect(KB_ICONS.MoreHorizontal).toBe(Ellipsis);
    expect(KB_ICONS.CircleHelp).toBe(CircleQuestionMark);
    expect(KB_ICONS.Phone).toBe(Smartphone);
  });

  it("the two icons 26 §5 draws in components (search field, locked button) are there too", () => {
    expect(KB_ICONS.Search).toBe(Search);
    expect(KB_ICONS.Lock).toBe(Lock);
  });
});

// Owner, 14 Nov 2026 (D110 item 9): where lucide's drawing differs from the screen file, the kit draws the file's own SVG.
describe("the design's own drawings (26 §2.4 exceptions)", () => {
  const design = (file: string, before: string) => {
    const t = readFileSync(join(__dirname, "..", "..", "..", "docs", "design", "screens", file), "utf8");
    const i = t.indexOf(before);
    const s = t.lastIndexOf("<svg", i);
    const d = new DOMParser().parseFromString(t.slice(s, t.indexOf("</svg>", s) + 6), "image/svg+xml").documentElement;
    return d;
  };
  const shapes = (svg: Element) =>
    [...svg.children].map((c) => [c.tagName, ...["d", "x", "y", "width", "height", "rx"].map((a) => c.getAttribute(a) ?? "")].join(" "));

  it.each([
    ["Pause", "09-Recording.html", "Pause</a>", true],
    ["Square", "09-Recording.html", "Stop</a>", true],
    ["Sparkles", "10-Review.html", "Generate bill", false],
    ["LogOut", "17-More.html", "Sign out", false],
    ["Home", "17-More.html", "<span>Home</span>", false],
    ["ReceiptText", "17-More.html", "<span>Bills</span>", false],
    ["BillDesign", "17-More.html", "Bill design</div>", false],
    ["ShieldCheck", "17-More.html", "Privacy</div>", false],
    // batch c (15 Nov 2026)
    ["Mic", "12-BillReview.html", "More</a>", false],
    ["Pencil", "12-BillReview.html", "class=\"kb-s2\"", false], // the first line's edit button
    ["TriangleAlert", "12-BillReview.html", "Price needed</div>", false],
    ["Ear", "12-BillReview.html", "Heard:</b>", false],
    // KB-414 step 1 (16 Nov 2026)
    ["Profile", "08-Home.html", '<path d="M4 21c1.5-4', false],
    ["Keyboard", "08-Home.html", "Type items</a>", false],
    ["Keyboard", "10-Review.html", '<path d="M7 10h.01', false],
    ["Keyboard", "23-ReadFailed.html", '<path d="M7 10h.01', false],
    ["Keyboard", "11-Generating.html", '<path d="M7 10h.01', false],
    // KB-415 (18 Nov 2026): 05-SignIn's trust rows
    ["Devices", "05-SignIn.html", "Bill from more than one phone", false],
    ["ShieldTick", "05-SignIn.html", "We never post to your Google account", false],
  ] as const)("%s is the drawing of %s", (name, file, before, filled) => {
    const want = design(file, before);
    const { container } = render(<Icon icon={KB_ICONS[name]} size={20} />);
    const svg = container.querySelector("svg")!;
    expect(shapes(svg)).toEqual(shapes(want));
    for (const c of svg.children) {
      expect(c.getAttribute("fill") ?? "none", name).toBe(filled ? "currentColor" : "none");
      if (filled) expect(c.getAttribute("stroke-width")).toBe("1.6");
    }
  });

  it("Twinkle (KB-414 step 1) is 08-Home's filled star - filled with its colour, no stroke", () => {
    const want = design("08-Home.html", 'fill="#D69A35"/></svg></div>');
    const { container } = render(<Icon icon={KB_ICONS.Twinkle} size={14} />);
    const svg = container.querySelector("svg")!;
    expect(shapes(svg)).toEqual(shapes(want));
    expect(svg.firstElementChild!.getAttribute("fill")).toBe("currentColor");
    expect(svg.firstElementChild!.getAttribute("stroke")).toBe("none");
  });

    it("Play (KB-413 step 2) is 10-Review's filled triangle, at the file's stroke 1.5", () => {
    const want = design("10-Review.html", 'M8 5l11 7-11 7z"/></svg></button>');
    const { container } = render(<Icon icon={KB_ICONS.Play} size={20} />);
    const svg = container.querySelector("svg")!;
    expect(shapes(svg)).toEqual(shapes(want));
    expect(svg.firstElementChild!.getAttribute("fill")).toBe("currentColor");
    expect(svg.firstElementChild!.getAttribute("stroke-width")).toBe("1.5");
  });

  it("26 §2.4 records these exceptions", () => {
    expect(list).toMatch(/Pause and Stop[^.]*filled[^.]*09-Recording/);
    expect(list).toMatch(/Sparkles[^.]*4-point star[^.]*10-Review/);
    expect(list).toMatch(/LogOut[^.]*17-More/);
    expect(list).toMatch(/Home[^.]*house[^.]*17-More/);
    expect(list).toMatch(/ReceiptText[^.]*17-More/);
    expect(list).toMatch(/ShieldCheck[^.]*plain shield[^.]*17-More/);
    expect(list).toMatch(/Mic[^.]*12-BillReview/);
    expect(list).toMatch(/Pencil[^.]*12-BillReview/);
    expect(list).toMatch(/TriangleAlert[^.]*12-BillReview/);
    expect(list).toMatch(/Ear[^.]*12-BillReview/);
    expect(list).toMatch(/Play[^.]*filled triangle[^.]*10-Review/);
    expect(list).toMatch(/Profile[^.]*08-Home/);
    expect(list).toMatch(/Twinkle[^.]*08-Home/);
    expect(list).toMatch(/Keyboard is the files' own[^.]*08-Home[^.]*10-Review[^.]*23-ReadFailed[^.]*11-Generating/);
  });
});

describe("<Icon>", () => {
  it("never shrinks when its label wraps (owner's review, 14 Nov 2026: a squeezed Bluetooth icon at 360 px + 130% text)", () => {
    const { container } = render(<Icon icon={KB_ICONS.Bluetooth} size={18} />);
    expect(container.querySelector("svg")!.getAttribute("class")).toMatch(/\bshrink-0\b/);
  });

  it("draws with stroke 1.9 at the size asked, hidden from a screen reader (the button or row carries the words)", () => {
    for (const size of [18, 20, 22, 24] as const) {
      const { container, unmount } = render(<Icon icon={KB_ICONS.Mic} size={size} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("stroke-width")).toBe("1.9");
      expect(svg.getAttribute("width")).toBe(String(size));
      expect(svg.getAttribute("height")).toBe(String(size));
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("takes the colour of its text (currentColor), never a colour of its own", () => {
    const { container } = render(<Icon icon={KB_ICONS.Printer} size={20} />);
    expect(container.querySelector("svg")!.getAttribute("stroke")).toBe("currentColor");
  });
});
