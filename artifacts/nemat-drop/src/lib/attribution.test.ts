import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureAttribution, getAttribution } from "./attribution";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(() => {
  localStorage.clear();
  clearCookies();
});

afterEach(() => {
  localStorage.clear();
  clearCookies();
});

describe("captureAttribution", () => {
  it("stores fbclid and UTM params and derives fbc", () => {
    captureAttribution("?fbclid=ABC123&utm_source=meta&utm_content=copy_a_price&qty=2", NOW);
    expect(getAttribution(NOW)).toEqual({
      fbclid: "ABC123",
      fbc: `fb.1.${NOW.getTime()}.ABC123`,
      utm_source: "meta",
      utm_content: "copy_a_price",
      landed_at: NOW.toISOString(),
    });
  });

  it("does not overwrite a stored landing when the URL has no attribution", () => {
    captureAttribution("?utm_source=meta", NOW);
    captureAttribution("?qty=1", new Date(NOW.getTime() + 1000));
    expect(getAttribution(NOW).utm_source).toBe("meta");
  });

  it("lets a newer tagged landing replace the old one", () => {
    captureAttribution("?utm_source=meta&utm_content=old", NOW);
    captureAttribution("?utm_source=google", new Date(NOW.getTime() + 1000));
    const a = getAttribution(NOW);
    expect(a.utm_source).toBe("google");
    expect(a.utm_content).toBeUndefined();
  });
});

describe("getAttribution", () => {
  it("returns nothing for a visitor who never landed from an ad", () => {
    expect(getAttribution(NOW)).toEqual({});
  });

  it("drops a landing older than 28 days", () => {
    captureAttribution("?fbclid=OLD", NOW);
    expect(getAttribution(new Date(NOW.getTime() + 29 * DAY))).toEqual({});
  });

  it("prefers the pixel's live cookies", () => {
    captureAttribution("?fbclid=ABC123", NOW);
    document.cookie = "_fbc=fb.1.111.FROMCOOKIE; path=/";
    document.cookie = "_fbp=fb.1.222.333; path=/";
    const a = getAttribution(NOW);
    expect(a.fbc).toBe("fb.1.111.FROMCOOKIE");
    expect(a.fbp).toBe("fb.1.222.333");
    expect(a.fbclid).toBe("ABC123");
  });
});
