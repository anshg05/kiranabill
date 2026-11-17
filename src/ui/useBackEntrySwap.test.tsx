// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBackEntry } from "./useBackEntry";

// Its own file: useBackEntry keeps module-level state (the open overlays, the entries waiting to come off), so these start clean.
const closed: string[] = [];
function Overlay({ k, name, onClose }: { k: string; name: string; onClose: () => void }) {
  useBackEntry(k, onClose);
  return <p>{name} open</p>;
}
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => {
  closed.length = 0;
});

// KB-414 step 3 phone check (owner, 17 Nov 2026): Items -> "+ Add" -> New item, then Back, went HOME. The sheet closed in the same tap
// the page opened: its entry was still in history, under the page. Back off the page landed on that left-over entry; the Items tab
// did not know it, took it for "below me" and closed too. An entry that is waiting to be taken off is never "below" anyone.
describe("a sheet closing in the same tap another page opens over the same screen", () => {
  afterEach(async () => {
    cleanup();
    await act(async () => void (await tick(250)));
  });
  function Swap() {
    const [step, setStep] = useState<"sheet" | "page" | "none">("sheet");
    return (
      <>
        <Overlay k="kbCatalog" name="Items" onClose={() => closed.push("Items")} />
        {step === "sheet" && <Overlay k="kbAddItems" name="Sheet" onClose={() => closed.push("Sheet")} />}
        {step === "page" && <Overlay k="kbAddProduct" name="Page" onClose={() => (closed.push("Page"), setStep("none"))} />}
        <button type="button" onClick={() => setStep("page")}>pick</button>
        <button type="button" onClick={() => setStep("none")}>arrow</button>
      </>
    );
  }
  it("Android Back from the page closes ONLY the page - the screen under it stays", async () => {
    render(<Swap />);
    await act(async () => void (await tick()));
    fireEvent.click(screen.getByText("pick"));
    await act(async () => void (await tick()));
    await act(async () => {
      window.history.back();
      await tick(120);
    });
    expect(closed).toEqual(["Page"]);
    expect(screen.getByText("Items open")).toBeTruthy();
  });
  it("the page's own Back arrow too - and after it, one more Android Back closes the screen (nothing left behind)", async () => {
    render(<Swap />);
    await act(async () => void (await tick()));
    fireEvent.click(screen.getByText("pick"));
    await act(async () => void (await tick()));
    fireEvent.click(screen.getByText("arrow"));
    await act(async () => void (await tick(150)));
    expect(closed).toEqual([]);
    await act(async () => {
      window.history.back();
      await tick(120);
    });
    expect(closed).toEqual(["Items"]);
  });
});
