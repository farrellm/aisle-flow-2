import '@testing-library/jest-dom/vitest'

// jsdom gaps: pointer capture, scrollIntoView, PointerEvent, matchMedia.
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.scrollIntoView ??= () => {}

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }
  // @ts-expect-error assigning polyfill
  window.PointerEvent = PointerEventPolyfill
}

window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList

// Node's fetch needs absolute URLs; the app requests relative /api paths.
const originalFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/')) {
    input = 'http://localhost' + input
  }
  return originalFetch(input, init)
}) as typeof fetch
