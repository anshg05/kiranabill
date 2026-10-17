// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useBackEntry } from "./useBackEntry";

// KB-325 follow-up: "Cancel only" closed the Cancel sheet, the bill detail AND History. Cause (found in the browser with a
// popstate log, not a guess): each overlay closed itself on ANY popstate whose state was not its own entry. With three
// overlays open (History > bill > Cancel sheet), closing the top one lands on the MIDDLE entry, and the bottom one saw a
// foreign entry and closed too. Nested overlays must close only when history has gone BELOW their own entry.

const closed: string[] = [];
// Like the app: an overlay that history closed is gone (unmounted).
function Stack({ keys }: { keys: readonly [string, string][] }) {
  const [gone, setGone] = useState<readonly string[]>([]);
  return (
    <>
      {keys
        .filter(([, name]) => !gone.includes(name))
        .map(([k, name]) => (
          <Overlay
            key={name}
            k={k}
            name={name}
            onClose={() => {
              closed.push(name);
              setGone((g) => [...g, name]);
            }}
          />
        ))}
    </>
  );
}
function Overlay({ k, name, onClose }: { k: string; name: string; onClose: () => void }) {
  useBackEntry(k, onClose);
  return <p>{name} open</p>;
}
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const three: [string, string][] = [["kbHistory", "A"], ["kbBillDetail", "B"], ["kbCancelBill", "C"]];

beforeEach(() => {
  closed.length = 0;
  window.history.replaceState(null, "", "/");
});
afterEach(async () => {
  cleanup();
  await tick();
});

async function openOneByOne(all: [string, string][]) {
  const view = render(<Stack keys={all.slice(0, 1)} />);
  await tick();
  for (let n = 2; n <= all.length; n++) {
    view.rerender(<Stack keys={all.slice(0, n)} />);
    await tick();
  }
  return view;
}

describe("nested overlays", () => {
  it("closing the TOP one by the app (the Cancel sheet after 'Cancel only') leaves the two below open", async () => {
    const view = await openOneByOne(three);
    view.rerender(<Stack keys={three.slice(0, 2)} />);
    await tick(120);
    expect(closed).toEqual([]);
    expect(screen.getByText("A open")).toBeTruthy();
    expect(screen.getByText("B open")).toBeTruthy();
  });

  it("the Back button closes the top overlay only, then the next", async () => {
    await openOneByOne(three);
    window.history.back();
    await tick(120);
    expect(closed).toEqual(["C"]);
    window.history.back();
    await tick(120);
    expect(closed).toEqual(["C", "B"]);
  });

  it("two overlays of the SAME kind (a bill opened over a bill) each keep their own entry", async () => {
    const two: [string, string][] = [["kbBillDetail", "A"], ["kbBillDetail", "B"]];
    const view = await openOneByOne(two);
    view.rerender(<Stack keys={two.slice(0, 1)} />);
    await tick(120);
    expect(closed).toEqual([]);
    expect(screen.getByText("A open")).toBeTruthy();
  });

  it("an overlay closed and re-opened at once (StrictMode, a quick re-open) still stacks one entry", async () => {
    const view = render(<Stack keys={[["kbHistory", "A"]]} />);
    await tick();
    view.rerender(<Stack keys={[]} />);
    view.rerender(<Stack keys={[["kbHistory", "A"]]} />);
    await tick(120);
    expect(closed).toEqual([]);
    expect(screen.getByText("A open")).toBeTruthy();
    window.history.back();
    await tick(120);
    expect(closed).toEqual(["A"]);
    expect(window.history.state).toEqual(null); // one entry was ever needed - none is left under the page
  });
});

describe("closing several overlays at once ('Cancel and make a new bill' closes History, the bill and the sheet together)", () => {
  it("leaves no history entry behind - the first Back on the screen underneath is not swallowed", async () => {
    const before = window.history.state as unknown;
    const view = await openOneByOne(three);
    view.rerender(<Stack keys={[]} />);
    await tick(200);
    expect(closed).toEqual([]);
    expect(window.history.state).toEqual(before);
  });

  it("an overlay below one that stays open is not popped from under it", async () => {
    const view = await openOneByOne(three);
    view.rerender(<Stack keys={[three[0]!, three[2]!]} />); // B goes away, C stays on top of A
    await tick(200);
    expect(screen.getByText("A open")).toBeTruthy();
    expect(screen.getByText("C open")).toBeTruthy();
    expect(closed).toEqual([]);
  });
});
