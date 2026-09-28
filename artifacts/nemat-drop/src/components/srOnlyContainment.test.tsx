import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import EmailSignup from "./EmailSignup";
import { MiniEmailSignup } from "./LeftShowcasePanel";

// The #88 regression. Tailwind's sr-only is position:absolute, so an sr-only
// element with no positioned ancestor resolves against the initial containing
// block. overflow:hidden on the viewport-locked wrapper does not clip it, and
// its static position (thousands of px down the right column) props the whole
// document open. jsdom does no layout, so this checks the structural cause: the
// nearest positioned ancestor must exist and sit inside the component.
const POSITIONED = ["relative", "absolute", "fixed", "sticky"];

function positionedAncestor(el: Element, root: Element): Element | null {
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
    if (POSITIONED.some((c) => node.classList.contains(c))) return node;
  }
  return null;
}

const CASES: Array<[name: string, ui: ReactElement]> = [
  ["EmailSignup", <EmailSignup />],
  ["MiniEmailSignup", <MiniEmailSignup />],
];

afterEach(cleanup);

describe("sr-only elements stay inside their component", () => {
  it.each(CASES)("%s anchors every sr-only element", (_name, ui) => {
    const { container } = render(ui);
    const hidden = container.querySelectorAll(".sr-only");
    expect(hidden.length).toBeGreaterThan(0);
    for (const el of hidden) {
      expect(positionedAncestor(el, container), el.outerHTML).not.toBeNull();
    }
  });
});
