import '@testing-library/jest-dom';

/**
 * Browser APIs jsdom does not implement.
 *
 * Without these the popover primitives throw while mounting, and a test that opens a menu then
 * asserts against it quietly checks an empty document instead. Every test that opens one asserts
 * the panel is really there before looking at it, so a regression here fails loudly rather than
 * turning into a pass that means nothing.
 */
class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom implements no media queries. `useMediaQuery` asks for one on mount, so without this the
// whole shell throws before it renders anything. Nothing matches, which is the desktop layout.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/**
 * jsdom has no layout engine, so `getBoundingClientRect` returns zeroes for everything.
 *
 * That is not a neutral default here. `FloatingPanel` dismisses itself when its anchor measures as
 * scrolled out of view — correct in a browser, but in jsdom every anchor looks that way, so a menu
 * or option list closes in the same tick it opens. A test that then asserted against it would be
 * inspecting an empty document and reporting a pass.
 *
 * So anchors are given a plausible rect. The numbers are arbitrary; only their being non-zero
 * matters. Tests that care about real measurements stub the specific properties they need.
 */
const ANCHOR_RECT = { x: 20, y: 100, width: 240, height: 36 };

Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  const { x, y, width, height } = ANCHOR_RECT;
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
};
