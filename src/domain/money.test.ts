import { describe, it, expect } from "vitest";
import { lineTotalPaise, sumPaise, rupeesToPaise, formatRupees } from "./money";

describe("formatRupees", () => {
  it("renders 4550 paise as ₹45.50 (18-AGENT-CONTRACT.md section 8 proof)", () => {
    expect(formatRupees(4550)).toBe("₹45.50");
  });

  it("shows paise only when non-zero", () => {
    expect(formatRupees(4500)).toBe("₹45");
  });

  it("pads a single-digit paise remainder", () => {
    expect(formatRupees(4505)).toBe("₹45.05");
  });

  it("renders a genuinely zero amount as ₹0, not blank", () => {
    expect(formatRupees(0)).toBe("₹0");
  });

  it("renders sub-rupee amounts correctly", () => {
    expect(formatRupees(15)).toBe("₹0.15");
  });

  it("handles negative amounts (e.g. a refund line)", () => {
    expect(formatRupees(-4550)).toBe("-₹45.50");
  });
});

describe("rupeesToPaise", () => {
  it("converts whole rupees", () => {
    expect(rupeesToPaise(45)).toBe(4500);
  });

  it("converts two-decimal rupees", () => {
    expect(rupeesToPaise(45.5)).toBe(4550);
  });

  it("converts sub-rupee per-unit prices (e.g. price per gram/ml)", () => {
    expect(rupeesToPaise(0.15)).toBe(15);
    expect(rupeesToPaise(0.5)).toBe(50);
  });
});

describe("lineTotalPaise", () => {
  it("computes a simple integer case", () => {
    expect(lineTotalPaise(2, 4500)).toBe(9000); // 2 kg chini at ₹45/kg
  });

  it("computes a fractional-quantity case with no rounding needed", () => {
    expect(lineTotalPaise(0.5, 11000)).toBe(5500); // 0.5 kg moong daal at ₹110/kg
  });

  it("rounds a genuine half-paise tie HALF-UP, not to even (D11)", () => {
    // 0.5 kg at Rs 30.33/kg = Rs 15.165 = 1516.5 paise exactly.
    // Half-up -> 1517 paise (Rs 15.17). Banker's rounding would give 1516.
    expect(lineTotalPaise(0.5, 3033)).toBe(1517);
  });

  it("rounds a second half-paise tie half-up too, confirming it is not banker's rounding", () => {
    // 0.5 kg at Rs 30.37/kg = Rs 15.185 = 1518.5 paise exactly. The whole part
    // (1518) is even, so banker's rounding would round DOWN to 1518 here -
    // the opposite of the first test's direction. Half-up always rounds to 1519.
    expect(lineTotalPaise(0.5, 3037)).toBe(1519);
  });
});

describe("sumPaise", () => {
  it("never re-rounds - sums already-rounded line totals exactly", () => {
    // The predecessor's bug: Rs 10.60 + Rs 10.60 rounded per line AND on the
    // sum, displaying as 11 + 11 = 21. Summing already-rounded paise avoids it.
    const lineA = lineTotalPaise(1, 1060);
    const lineB = lineTotalPaise(1, 1060);
    expect(sumPaise([lineA, lineB])).toBe(2120); // Rs 21.20, matching 10.60 + 10.60 exactly
  });

  it("proves no floating-point drift over many additions", () => {
    const lines = Array.from({ length: 1000 }, () => lineTotalPaise(0.1, 333));
    // Every line is exactly 33 paise; summing 1000 of them must be exactly 33000,
    // not 32999.999999... or 33000.000000001 the way repeated float addition can drift.
    expect(sumPaise(lines)).toBe(33000);
    expect(Number.isInteger(sumPaise(lines))).toBe(true);
  });
});
