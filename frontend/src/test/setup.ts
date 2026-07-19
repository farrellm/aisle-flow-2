import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { onlineManager } from '@tanstack/react-query'

// Node's experimental localStorage global shadows jsdom's and is undefined
// without --localstorage-file; the persister needs a working Storage, so
// install an in-memory one.
if (!window.localStorage) {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size
      },
    } satisfies Storage,
  })
}

// The persister writes the query cache + mutation queue to localStorage;
// clear it (and any simulated offline state) so tests stay isolated. Reset
// the URL too, or a test that navigated leaks its path into the next render.
afterEach(() => {
  window.localStorage.clear()
  onlineManager.setOnline(true)
  window.history.replaceState(null, '', '/')
})

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
