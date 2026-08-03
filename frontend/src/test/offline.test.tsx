import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { onlineManager } from '@tanstack/react-query'
import App from '../App'
import { db, DEFAULT_LIST_ID, makeItem, resetDb, server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => window.history.pushState(null, '', `/l/${DEFAULT_LIST_ID}`))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// Item adds only; a list POST would also start with "POST".
const posts = () => db.requests.filter((r) => r.startsWith(`POST ${DEFAULT_LIST_ID}`))

describe('offline mutation queue', () => {
  it('queues an add while offline and replays it on reconnect', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    render(<App />)
    await screen.findByText('Milk')

    act(() => onlineManager.setOnline(false))
    expect(await screen.findByText('Offline')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(
      screen.getByRole('textbox', { name: 'Add an item' }),
      'Bread{Enter}',
    )

    // Optimistic row renders, but nothing was sent.
    expect(await screen.findByText('Bread')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)

    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(posts()).toHaveLength(1))
    await waitFor(() =>
      expect(screen.queryByText('Offline')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Bread')).toBeInTheDocument()
  })

  it('replays dependent mutations in order using the client-generated id', async () => {
    resetDb([])
    render(<App />)
    // Let the initial fetch land before cutting the connection.
    await waitFor(() =>
      expect(db.requests).toContain(`GET items ${DEFAULT_LIST_ID}`),
    )

    act(() => onlineManager.setOnline(false))
    const user = userEvent.setup()
    await user.type(
      screen.getByRole('textbox', { name: 'Add an item' }),
      'Eggs{Enter}',
    )
    // Check the item that only exists optimistically.
    await user.click(await screen.findByRole('checkbox', { name: 'Eggs' }))
    expect(db.requests.filter((r) => !r.startsWith('GET'))).toHaveLength(0)

    act(() => onlineManager.setOnline(true))
    await waitFor(() => {
      const writes = db.requests.filter((r) => !r.startsWith('GET'))
      expect(writes).toHaveLength(2)
    })
    const writes = db.requests.filter((r) => !r.startsWith('GET'))
    expect(writes[0]).toBe(`POST ${DEFAULT_LIST_ID} Eggs`)
    // The PATCH targets the id the POST created, i.e. the client uuid.
    const eggs = db.items.find((i) => i.name === 'Eggs')!
    expect(writes[1]).toContain(`PATCH ${eggs.id}`)
    expect(eggs.checked).toBe(true)
  })

  // The failure mode that actually happens in a shop: one bar of signal, a
  // captive portal, a router that hands out DHCP and routes nothing. The
  // browser still reports online, so nothing pauses the mutation — it used to
  // fire, exhaust its retries, roll back and drop the edit on the floor.
  it('keeps an edit queued when requests fail but the browser still reports online', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    render(<App />)
    await screen.findByText('Milk')

    server.use(
      http.post('/api/lists/:listId/items', () => HttpResponse.error()),
    )
    expect(onlineManager.isOnline()).toBe(true)

    const user = userEvent.setup()
    await user.type(
      screen.getByRole('textbox', { name: 'Add an item' }),
      'Bread{Enter}',
    )

    // The app infers the network is gone and parks the write.
    expect(await screen.findByText('Offline')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)

    // The optimistic row survives — no rollback, no error snackbar.
    expect(screen.getByText('Bread')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Recovery: the e2e suite covers the /api/healthz probe against a real
    // service worker; here we just assert the queue drains once online again.
    server.resetHandlers()
    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(db.items.some((i) => i.name === 'Bread')).toBe(true)
  })
})
