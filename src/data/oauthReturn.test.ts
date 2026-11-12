import { describe, expect, it } from "vitest";
import { AUTH_OPTIONS, FAILED_TEXT, NATIVE_REDIRECT, REFUSED_TEXT, nativeReturnPath, readOAuthReturn, stripOAuthReturn } from "./oauthReturn";

// KB-335 (D82): the sign-in return. PKCE puts a one-time ?code= in the query string (the implicit flow used the #fragment);
// a refused sign-up or a failed exchange leaves its marks in the address bar and the sign-in screen must say so, in plain
// words - never echoing what the server wrote (it can hold an email address).

const H = "https://kiranabilling.netlify.app";

describe("the client uses PKCE", () => {
  it("flowType is 'pkce' (the shipped client passes AUTH_OPTIONS)", () => {
    expect(AUTH_OPTIONS.flowType).toBe("pkce");
  });
});

describe("readOAuthReturn", () => {
  it("a refused sign-up (sign-ups are off and this account was not created): the approved sentence - query or fragment", () => {
    expect(readOAuthReturn(`${H}/?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance`)).toBe("refused");
    expect(readOAuthReturn(`${H}/#error=access_denied&error_code=signup_disabled&error_description=x`)).toBe("refused");
    expect(readOAuthReturn(`${H}/?error=server_error&error_description=Signups%20not%20allowed%20for%20this%20provider`)).toBe("refused");
    expect(REFUSED_TEXT).toBe("This account isn't set up for the pilot");
  });
  it("any other error, or a ?code= still in the address bar on the sign-in screen (the exchange did not happen), is 'failed'", () => {
    expect(readOAuthReturn(`${H}/?error=server_error&error_code=unexpected_failure&error_description=boom`)).toBe("failed");
    expect(readOAuthReturn(`${H}/?code=abc123&sb_flow_id=f`)).toBe("failed");
    expect(readOAuthReturn(`${H}/#error_description=something`)).toBe("failed");
  });
  it("the shopkeeper pressing Cancel on Google's page (access_denied, no code) is not an error to announce", () => {
    expect(readOAuthReturn(`${H}/?error=access_denied&error_description=The+user+denied+access`)).toBeNull();
  });
  it("a normal address, or other parameters, is nothing", () => {
    expect(readOAuthReturn(`${H}/`)).toBeNull();
    expect(readOAuthReturn(`${H}/?nosw=1&try=2+kilo+chini#top`)).toBeNull();
  });
});

describe("stripOAuthReturn", () => {
  it("removes exactly the auth parameters from the query and the fragment, keeps the rest", () => {
    expect(stripOAuthReturn(`${H}/?code=abc&sb_flow_id=f&error=x&error_code=y&error_description=z&keep=1#error=a&error_description=b&frag=2`)).toBe("/?keep=1#frag=2");
    expect(stripOAuthReturn(`${H}/?code=abc`)).toBe("/");
    expect(stripOAuthReturn(`${H}/?nosw=1`)).toBe("/?nosw=1");
  });
});

describe("what is shown never carries the server's words", () => {
  it("the fixed sentences hold no placeholder", () => {
    expect(REFUSED_TEXT).not.toMatch(/[{}@]/);
    expect(FAILED_TEXT).not.toMatch(/[{}@]/);
  });
});

// KB-409 (D111): inside the Android app the sign-in returns as an app link. Anything on the phone can send one, so it is
// the trust boundary: only our scheme + host, only the auth parameters, always a path on the app's own origin.
describe("nativeReturnPath (KB-409)", () => {
  const L = "com.kiranavoicebill.app://auth-callback";

  it("the redirect we ask Supabase for is exactly the app link", () => {
    expect(NATIVE_REDIRECT).toBe(L);
  });

  it("a code becomes /?code= on the app's own origin - the web return, so auth-js exchanges it as today", () => {
    expect(nativeReturnPath(`${L}?code=abc-123`)).toBe("/?code=abc-123");
    expect(nativeReturnPath(`${L}/?code=abc-123`)).toBe("/?code=abc-123");
    expect(readOAuthReturn(`${H}${nativeReturnPath(`${L}?code=abc`)!}`)).toBe("failed"); // a leftover code auth-js could not use = the unfinished sentence
  });

  it("a refusal or an error keeps its marks (query or fragment), so the sign-in screen says the existing sentence", () => {
    const refused = nativeReturnPath(`${L}?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed`)!;
    expect(readOAuthReturn(`${H}${refused}`)).toBe("refused");
    const inFragment = nativeReturnPath(`${L}#error=server_error&error_description=boom`)!;
    expect(inFragment.startsWith("/?")).toBe(true);
    expect(readOAuthReturn(`${H}${inFragment}`)).toBe("failed");
  });

  it("only the auth parameters pass; anything else is dropped", () => {
    const path = nativeReturnPath(`${L}?code=abc&sb_flow_id=f1&nosw=1&next=https://evil.example&__proto__=x`)!;
    expect([...new URLSearchParams(path.slice(2)).keys()].sort()).toEqual(["code", "sb_flow_id"]);
  });

  it("values are encoded - a value cannot add a parameter or leave the origin", () => {
    const path = nativeReturnPath(`${L}?code=${encodeURIComponent("a&nosw=1#//evil.example")}`)!;
    expect(new URL(path, H).origin).toBe(H);
    expect([...new URL(path, H).searchParams.keys()]).toEqual(["code"]);
    expect(new URL(path, H).hash).toBe("");
  });

  it("another scheme, host, port, user or path is refused", () => {
    for (const bad of [
      "https://auth-callback/?code=abc",
      "http://com.kiranavoicebill.app/auth-callback?code=abc",
      "com.kiranavoicebill.app://evil.example?code=abc",
      "com.kiranavoicebill.app://auth-callback.evil.example?code=abc",
      "com.kiranavoicebill.app://auth-callback:8080?code=abc",
      "com.kiranavoicebill.app://user@auth-callback?code=abc",
      "com.kiranavoicebill.app://auth-callback//evil.example?code=abc",
      "com.kiranavoicebill.app://auth-callback/x?code=abc",
      "com.kiranavoicebill.application://auth-callback?code=abc",
      "com.kiranavoicebill.app:auth-callback?code=abc",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) expect(nativeReturnPath(bad), bad).toBeNull();
  });

  it("a link with nothing to act on is ignored (no reload for an empty link)", () => {
    expect(nativeReturnPath(L)).toBeNull();
    expect(nativeReturnPath(`${L}?foo=1`)).toBeNull();
    expect(nativeReturnPath(`${L}?code=`)).toBeNull();
    expect(nativeReturnPath(`${L}?sb_flow_id=f1`)).toBeNull();
  });
});
