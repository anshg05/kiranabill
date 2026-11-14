// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { Ellipsis, House, Lock, Search, CircleQuestionMark, Smartphone } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Icon, KB_ICONS } from "./icons";

// KB-411 (26 §2.4): the design's icons come from lucide-react (already in the app), stroke 1.9, sizes 18 / 20 / 22 / 24.
const spec = readFileSync(join(__dirname, "..", "..", "..", "docs", "26-DESIGN-SPEC.md"), "utf8");
const list = spec.slice(spec.indexOf("Mapping used in the design:"), spec.indexOf("## 3. Motion"));
const specNames = list
  .slice(list.indexOf(":") + 1)
  .split(",")
  .map((s) => s.replace(/\(.*?\)/g, "").replace(/ or the WhatsApp mark/, "").replace(/\.\s*$/, "").trim())
  .filter(Boolean);

describe("the icons of 26 §2.4", () => {
  it("the list is read from 26 (35 names)", () => {
    expect(specNames).toHaveLength(35);
    expect(specNames).toContain("Mic");
    expect(specNames).toContain("Ear");
  });

  it("every icon 26 names is in the kit, as a lucide icon", () => {
    for (const name of specNames) expect(KB_ICONS[name as keyof typeof KB_ICONS], name).toBeTruthy();
  });

  it("the four names lucide-react 1.x calls differently map to the same drawings", () => {
    expect(KB_ICONS.Home).toBe(House);
    expect(KB_ICONS.MoreHorizontal).toBe(Ellipsis);
    expect(KB_ICONS.CircleHelp).toBe(CircleQuestionMark);
    expect(KB_ICONS.Phone).toBe(Smartphone);
  });

  it("the two icons 26 §5 draws in components (search field, locked button) are there too", () => {
    expect(KB_ICONS.Search).toBe(Search);
    expect(KB_ICONS.Lock).toBe(Lock);
  });
});

describe("<Icon>", () => {
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
