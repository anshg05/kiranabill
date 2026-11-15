// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageSample } from "../DevKitGallery";

// Reviewer, 15 Nov 2026: the dev gallery's "Catalog words" show each catalog word in the REAL kit part it belongs to - never a stand-in.
afterEach(cleanup);

describe("the gallery's catalog-words sample uses the real parts", () => {
  it("Paused is the amber Paused badge; 'Price needed' is the Price needed line's label; the marks are bill-line marks", () => {
    render(<LanguageSample />);
    expect(screen.getByText("Paused").className).toMatch(/\bbg-kb-warn-bg\b/);
    expect(screen.getByText("Price needed", { selector: "div" }).className).toMatch(/\btext-kb-warn-text\b/);
    expect(screen.getByText("Price needed", { selector: "div" }).closest("[class*='border-kb-warn-border']")).toBeTruthy();
    expect(screen.getByText("your price").className).toMatch(/\bbg-kb-primary-pale\b/);
    expect(screen.getByText("price said earlier").className).toMatch(/\bbg-kb-primary-pale\b/);
  });
});
