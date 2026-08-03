import { expect, type BrowserContext, type Page } from '@playwright/test'

export const CACHE_KEY = 'aisleflow-cache'

declare global {
  interface Window {
    __E2E_OFFLINE__?: boolean
  }
}

/**
 * Playwright's `context.setOffline` drives Chromium's network emulation, but it
 * does **not** set `navigator.onLine` on a *freshly loaded* document. `main.tsx`
 * seeds `onlineManager` from `navigator.onLine` at startup, so without this shim
 * a page loaded while "offline" believes it is online and fires mutations
 * instead of queuing them — the reload-while-offline test would silently
 * exercise the online path and pass for the wrong reason.
 *
 * Install once per context, before the first navigation.
 */
export async function installOnlineShim(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => !window.__E2E_OFFLINE__,
    })
  })
}

/**
 * Flip the whole context online/offline: the emulated network, the
 * `navigator.onLine` shim for future loads, and the `online`/`offline` window
 * events for pages already open.
 */
export async function setOffline(context: BrowserContext, offline: boolean) {
  await context.setOffline(offline)
  // Init scripts accumulate and run in insertion order, so the most recently
  // added value wins on the next load.
  await context.addInitScript((v) => {
    window.__E2E_OFFLINE__ = v
  }, offline)
  for (const page of context.pages()) {
    await page.evaluate((v) => {
      window.__E2E_OFFLINE__ = v
      window.dispatchEvent(new Event(v ? 'offline' : 'online'))
    }, offline)
  }
}

/**
 * Load the app online and return with the service worker *controlling* the
 * page. In prompt mode the worker does not call `clientsClaim()`, so the very
 * first visit installs it but stays uncontrolled — exactly like a real first
 * visit. One reload puts us in the "user has been here before" state that the
 * offline scenarios assume.
 */
export async function bootstrapServiceWorker(page: Page, url = '/') {
  await page.goto(url)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await waitForPrecache(page)
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload()
    await page.evaluate(() => navigator.serviceWorker.ready)
  }
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
}

/** Precaching happens during `install`; going offline mid-install looks like a product bug. */
export async function waitForPrecache(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const name = (await caches.keys()).find((n) => n.includes('precache'))
          if (!name) return 0
          return (await (await caches.open(name)).keys()).length
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0)
}

/** Entries the service worker's `api-items` NetworkFirst cache is holding. */
export function apiCacheUrls(page: Page) {
  return page.evaluate(async () => {
    if (!(await caches.keys()).some((n) => n === 'api-items')) return []
    const cache = await caches.open('api-items')
    return (await cache.keys()).map((r) => new URL(r.url).pathname)
  })
}

/**
 * The persister throttles writes by 250ms (`App.tsx`), so a reload fired
 * immediately after a tap can beat the write. Wait for the state to land.
 */
export async function waitForPersistedCache(page: Page, contains: string) {
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key) ?? '', CACHE_KEY),
    )
    .toContain(contains)
}

/** Paused mutations dehydrated into the persisted cache, by mutation key. */
export function persistedMutationKeys(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const client = JSON.parse(raw).clientState
    return (client?.mutations ?? []).map(
      (m: { mutationKey?: string[] }) => m.mutationKey?.[0] ?? '?',
    ) as string[]
  }, CACHE_KEY)
}

export function row(page: Page, name: string) {
  return page.getByTestId(`item-row-${name}`)
}

export function checkbox(page: Page, name: string) {
  return page.getByRole('checkbox', { name })
}

/** Names of the rendered rows, top to bottom (unchecked section then checked). */
export function visibleItemNames(page: Page) {
  return page
    .locator('[data-testid^="item-row-"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-testid')!.replace('item-row-', '')),
    )
}

export async function addItem(page: Page, name: string) {
  await page.getByLabel('Add an item').fill(name)
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(row(page, name)).toBeVisible()
}
