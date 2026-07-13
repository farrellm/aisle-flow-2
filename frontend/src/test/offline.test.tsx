import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import App from '../App'
import { db, makeItem, resetDb, server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const posts = () => db.requests.filter((r) => r.startsWith('POST'))

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
    await waitFor(() => expect(db.requests).toContain('GET /api/items'))

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
    expect(writes[0]).toBe('POST Eggs')
    // The PATCH targets the id the POST created, i.e. the client uuid.
    const eggs = db.items.find((i) => i.name === 'Eggs')!
    expect(writes[1]).toContain(`PATCH ${eggs.id}`)
    expect(eggs.checked).toBe(true)
  })
})
