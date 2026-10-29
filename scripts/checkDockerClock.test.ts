import { describe, expect, it } from "vitest";
import { judgeClocks } from "./check-docker-clock";

// KB-360 (owner, 29 Oct 2026): the e2e suite failed twice with "JWT issued at future" - the local auth container's clock was ahead of the one
// that checks the token. It is not a code bug, so it must not look like one: the suite is not started until the clocks agree, and the failure
// says what to do.

const at = 1_800_000_000; // host epoch seconds, taken just before and just after the containers were asked

describe("judgeClocks", () => {
  it("clocks within one second of the PC's (the jitter of asking) -> ok", () => {
    for (const c of [at - 1, at, at + 1]) expect(judgeClocks({ before: at, after: at }, [{ name: "supabase_auth_x", epochS: c }]).ok).toBe(true);
  });
  it("a container 2 s or more AHEAD fails - the 'JWT issued at future' case - and says how to fix it", () => {
    const r = judgeClocks({ before: at, after: at }, [{ name: "supabase_db_x", epochS: at }, { name: "supabase_auth_x", epochS: at + 5 }]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("supabase_auth_x");
    expect(r.message).toContain("+5 s");
    expect(r.message).toMatch(/resync the Docker clock/i);
    expect(r.message).toContain("wsl --shutdown");
    expect(r.message).not.toContain("supabase_db_x"); // only the guilty one is named
  });
  it("a container BEHIND by 2 s or more fails too (a token would look expired)", () => {
    const r = judgeClocks({ before: at, after: at }, [{ name: "supabase_rest_x", epochS: at - 3 }]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("-3 s");
  });
  it("the time the question itself took is allowed for: a slow docker exec is not a skew", () => {
    expect(judgeClocks({ before: at, after: at + 2 }, [{ name: "supabase_auth_x", epochS: at + 3 }]).ok).toBe(true);
    expect(judgeClocks({ before: at, after: at + 2 }, [{ name: "supabase_auth_x", epochS: at + 4 }]).ok).toBe(false);
  });
  it("no containers found: not a clock problem - the stack is simply not up, and that is said plainly", () => {
    const r = judgeClocks({ before: at, after: at }, []);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/no local supabase containers/i);
  });
});
