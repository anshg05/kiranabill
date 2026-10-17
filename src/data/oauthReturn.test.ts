import { describe, expect, it } from "vitest";
import { AUTH_OPTIONS, FAILED_TEXT, REFUSED_TEXT, readOAuthReturn, stripOAuthReturn } from "./oauthReturn";

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
