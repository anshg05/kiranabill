import { describe, expect, it } from "vitest";
import { serverTimingHeaders } from "./timing";

// KB-352 (owner, 28 Oct 2026): stop -> transcript was 3.1 s median / 7.5 s p95 (budget 1.5 s). /voice answers with where ITS time went (a
// standard Server-Timing header) and which region it ran in, so the phone can split the wait into network and server. Numbers and a
// region name only - never a transcript, a key or a URL.

describe("serverTimingHeaders", () => {
  it("auth, rate limit, reading the upload, Groq and the total - whole milliseconds, in the Server-Timing format", () => {
    const h = serverTimingHeaders({ auth: 212.6, limit: 4.2, form: 9.5, groq: 431.4 }, 1000, 1700, { AWS_REGION: "us-east-2" }, "us-east-1");
    expect(h["Server-Timing"]).toBe("auth;dur=213, limit;dur=4, form;dur=10, groq;dur=431, total;dur=700");
    expect(h["X-Kb-Region"]).toBe("us-east-2");
    expect(h["X-Kb-Groq-Region"]).toBe("us-east-1");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("a part that did not run (no Groq on a parse-only call) is simply absent - nothing is invented", () => {
    const h = serverTimingHeaders({ auth: 10, limit: 2, form: 1 }, 0, 50, {});
    expect(h["Server-Timing"]).toBe("auth;dur=10, limit;dur=2, form;dur=1, total;dur=50");
    expect(h["X-Kb-Region"]).toBe("unknown");
    expect(h).not.toHaveProperty("X-Kb-Groq-Region");
  });

  it("a region value that is not a plain name is not echoed (it is a header)", () => {
    expect(serverTimingHeaders({ auth: 1, limit: 1, form: 1 }, 0, 1, { AWS_REGION: "us-east-2\r\nSet-Cookie: x=1" })["X-Kb-Region"]).toBe("unknown");
  });

  it("NaN and negative parts are dropped", () => {
    const h = serverTimingHeaders({ auth: Number.NaN, limit: -3, form: 5 }, 0, 9, {});
    expect(h["Server-Timing"]).toBe("form;dur=5, total;dur=9");
  });
});
