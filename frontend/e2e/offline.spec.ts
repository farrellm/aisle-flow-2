import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  addItem,
  apiCacheUrls,
  bootstrapServiceWorker,
  CACHE_KEY,
  checkbox,
  installOnlineShim,
  persistedMutationKeys,
  row,
  setOffline,
  visibleItemNames,
  waitForPersistedCache,
} from './helpers'

// Each test owns a freshly created list so they never contend over rows.
let seq = 0
async function makeList(request: APIRequestContext, names: string[] = []) {
  const id = crypto.randomUUID()
  const name = `E2E ${Date.now()}-${seq++}`
  await request.post('/api/lists', { data: { id, name } })
  for (const n of names) {
    await request.post(`/api/lists/${id}/items`, {
      data: { id: crypto.randomUUID(), name: n },
    })
  }
  return { id, name }
}

test.beforeEach(async ({ context }) => {
  await installOnlineShim(context)
})

test('renders the last-known list from the persisted cache while offline', async ({
  page,
  context,
  request,
}) => {
  const list = await makeList(request, ['Milk', 'Eggs'])
  await bootstrapServiceWorker(page, `/l/${list.id}`)
  await expect(row(page, 'Milk')).toBeVisible()
  await waitForPersistedCache(page, 'Milk')

  await setOffline(context, true)
  await page.reload()

  await expect(row(page, 'Milk')).toBeVisible()
  await expect(row(page, 'Eggs')).toBeVisible()
  await expect(page.getByText('Offline')).toBeVisible()
})

test('cold load with no persisted cache falls back to the service worker api cache', async ({
  page,
  context,
  request,
}) => {
  const list = await makeList(request, ['Bread'])
  await bootstrapServiceWorker(page, `/l/${list.id}`)
  await expect(row(page, 'Bread')).toBeVisible()

  // The runtime cache is Layer 1 of §13. It is only reachable if queries are
  // allowed to run while offline (networkMode: 'offlineFirst') — under the
  // default 'online' the query function never fires and this cache is dead.
  await expect
    .poll(() => apiCacheUrls(page))
    .toContain(`/api/lists/${list.id}/items`)

  // Drop Layer 2 entirely: the shell and data must come from the worker alone.
  await page.evaluate((key) => localStorage.removeItem(key), CACHE_KEY)
  await setOffline(context, true)
  await page.reload()

  await expect(row(page, 'Bread')).toBeVisible()
})

test('cold load with nothing cached shows the connection message, not a spinner', async ({
  page,
  context,
  request,
}) => {
  const list = await makeList(request, ['Jam'])
  await bootstrapServiceWorker(page, `/l/${list.id}`)
  await expect(row(page, 'Jam')).toBeVisible()

  // Wipe both layers: precached shell survives, data does not.
  await page.evaluate(async (key) => {
    localStorage.removeItem(key)
    await caches.delete('api-items')
  }, CACHE_KEY)
  await setOffline(context, true)
  await page.goto('/')

  await expect(
    page.getByText("Couldn't load your lists — check your connection and reload."),
  ).toBeVisible({ timeout: 15_000 })
})

test('mutations made offline render optimistically and send nothing', async ({
  page,
  context,
  request,
}) => {
  const list = await makeList(request, ['Milk'])
  await bootstrapServiceWorker(page, `/l/${list.id}`)
  await expect(row(page, 'Milk')).toBeVisible()

  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`)
    }
  })

  await setOffline(context, true)
  await expect(page.getByText('Offline')).toBeVisible()

  await addItem(page, 'ZZZ Offline Add')
  await checkbox(page, 'Milk').click()

  await expect(checkbox(page, 'Milk')).toBeChecked()
  await expect(row(page, 'ZZZ Offline Add')).toBeVisible()
  expect(writes).toEqual([])

  // Both are queued as paused mutations, which is what the persister keeps.
  await expect
    .poll(() => persistedMutationKeys(page))
    .toEqual(['addItem', 'updateItem'])
})

test('the offline queue survives a reload and replays in order on reconnect', async ({
  page,
  context,
  request,
}) => {
  const list = await makeList(request, ['Milk'])
  await bootstrapServiceWorker(page, `/l/${list.id}`)
  await expect(row(page, 'Milk')).toBeVisible()

  await setOffline(context, true)
  // add → check on the *same* new item: only works because the id is
  // client-generated, so the PATCH can name a row the server has never seen.
  await addItem(page, 'ZZZ Queued')
  await checkbox(page, 'ZZZ Queued').click()
  await expect
    .poll(() => persistedMutationKeys(page))
    .toEqual(['addItem', 'updateItem'])

  await page.reload()

  // Optimistic state survived: the row is still there, still checked.
  await expect(row(page, 'ZZZ Queued')).toBeVisible()
  await expect(checkbox(page, 'ZZZ Queued')).toBeChecked()
  await expect(page.getByText('Offline')).toBeVisible()
  expect(await persistedMutationKeys(page)).toEqual(['addItem', 'updateItem'])

  await setOffline(context, false)

  await expect.poll(() => persistedMutationKeys(page)).toEqual([])
  await expect(page.getByText('Offline')).toHaveCount(0)

  // Server truth, not just the DOM: the queue replayed FIFO against the
  // client-generated id, so the row exists *and* is checked.
  await expect
    .poll(async () => {
      const res = await request.get(`/api/lists/${list.id}/items`)
      const { items } = (await res.json()) as {
        items: { name: string; checked: boolean }[]
      }
      return items.find((i) => i.name === 'ZZZ Queued')?.checked ?? null
    })
    .toBe(true)
})

test('navigates between lists offline', async ({ page, context, request }) => {
  const a = await makeList(request, ['Apples'])
  const b = await makeList(request, ['Bananas'])

  await bootstrapServiceWorker(page, `/l/${a.id}`)
  await expect(row(page, 'Apples')).toBeVisible()
  // Wait for the write *before* leaving: the persister throttles by 250ms, so
  // navigating away sooner drops list A's items from the persisted cache.
  await waitForPersistedCache(page, 'Apples')

  await page.goto(`/l/${b.id}`)
  await expect(row(page, 'Bananas')).toBeVisible()
  await waitForPersistedCache(page, 'Bananas')

  await setOffline(context, true)

  // In-app navigation (client-side router).
  await page.getByRole('button', { name: b.name }).click()
  await page.getByRole('menuitem', { name: a.name }).click()
  await expect(row(page, 'Apples')).toBeVisible()

  // Hard navigation to a deep link: served by the worker's navigateFallback,
  // since the Go server is unreachable.
  await page.goto(`/l/${b.id}`)
  await expect(row(page, 'Bananas')).toBeVisible()
})

test('a dead uplink queues the edit instead of rolling it back', async ({
  page,
  context,
  request,
}) => {
  const list = await makeList(request, ['Milk'])
  await bootstrapServiceWorker(page, `/l/${list.id}`)
  await expect(row(page, 'Milk')).toBeVisible()

  // The browser still believes it is online (no setOffline, no shim flip) —
  // dead WiFi uplink, captive portal, one bar of cell. Every request fails at
  // the transport, which is precisely the case that used to roll the
  // optimistic write back and drop the user's edit on the floor.
  let aborted = 0
  await context.route('**/api/**', (route) => {
    aborted++
    return route.abort('connectionfailed')
  })

  await addItem(page, 'ZZZ Dead Uplink')

  // The app figures out it is offline from the failures alone.
  await expect(page.getByText('Offline')).toBeVisible({ timeout: 15_000 })
  await expect(row(page, 'ZZZ Dead Uplink')).toBeVisible()
  await expect(
    page.getByText('Failed to fetch', { exact: false }),
  ).toHaveCount(0)
  expect(aborted, 'route interception never fired').toBeGreaterThan(0)
  await expect.poll(() => persistedMutationKeys(page)).toEqual(['addItem'])

  await context.unroute('**/api/**')

  // The 4s poll doubles as the reconnect probe: the first success flips
  // onlineManager back and drains the queue. Nothing else would, since the
  // browser never fired an `online` event.
  await expect.poll(() => persistedMutationKeys(page), { timeout: 20_000 }).toEqual([])
  await expect
    .poll(async () => {
      const res = await request.get(`/api/lists/${list.id}/items`)
      const { items } = (await res.json()) as { items: { name: string }[] }
      return items.map((i) => i.name)
    })
    .toContain('ZZZ Dead Uplink')
  expect(await visibleItemNames(page)).toContain('ZZZ Dead Uplink')
})
