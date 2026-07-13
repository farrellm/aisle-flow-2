import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import App from '../App'
import { db, makeItem, resetDb, server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function itemNames(list: HTMLElement) {
  return within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent)
}

describe('AisleFlow', () => {
  it('splits and sorts: unchecked by position, checked alphabetically', async () => {
    resetDb([
      makeItem({ name: 'Coffee', position: 2048 }),
      makeItem({ name: 'Milk', position: 1024 }),
      makeItem({ name: 'banana', checked: true }),
      makeItem({ name: 'Apples', checked: true }),
    ])
    render(<App />)

    await screen.findByText('Milk')
    const lists = screen.getAllByRole('list')
    expect(itemNames(lists[0])).toEqual(['Milk', 'Coffee'])
    expect(itemNames(lists[1])).toEqual(['Apples', 'banana'])
  })

  it('moves a checked item into the checked section optimistically', async () => {
    resetDb([makeItem({ name: 'Milk' }), makeItem({ name: 'Bread' })])
    // Never resolves: only the optimistic cache update can move the row.
    server.use(http.patch('/api/items/:id', () => delay('infinite')))
    render(<App />)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Milk' }))

    // The checked section only mounts once the optimistic update lands.
    await waitFor(() => expect(screen.getAllByRole('list')).toHaveLength(2))
    const lists = screen.getAllByRole('list')
    expect(itemNames(lists[0])).toEqual(['Bread'])
    expect(itemNames(lists[1])).toEqual(['Milk'])
  })

  it('highlights an existing unchecked item instead of duplicating it', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    render(<App />)
    await screen.findByText('Milk')

    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Add an item' }), 'milk{Enter}')

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(db.requests.filter((r) => r.startsWith('POST'))).toHaveLength(0)
  })

  it('rolls back a failed delete and shows the error snackbar', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    server.use(
      http.delete('/api/items/:id', () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'boom from server' } },
          { status: 500 },
        ),
      ),
    )
    render(<App />)
    const row = await screen.findByTestId('item-row-Milk')

    // Keyboard fallback for swipe-to-delete.
    row.focus()
    const user = userEvent.setup()
    await user.keyboard('{Delete}')

    expect(await screen.findByText('boom from server')).toBeInTheDocument()
    expect(screen.getByText('Milk')).toBeInTheDocument() // rolled back
  })

  it('deletes on a committed right-to-left swipe', async () => {
    resetDb([makeItem({ name: 'Milk' }), makeItem({ name: 'Bread' })])
    render(<App />)
    const row = await screen.findByTestId('item-row-Milk')
    const content = within(row).getByText('Milk').closest('div')!.parentElement!

    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      width: 300, height: 48, top: 0, left: 0, right: 300, bottom: 48, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const { fireEvent } = await import('@testing-library/react')
    fireEvent.pointerDown(content, { pointerId: 1, clientX: 250, clientY: 20, button: 0 })
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 180, clientY: 22 })
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 90, clientY: 24 })
    fireEvent.pointerUp(content, { pointerId: 1, clientX: 90, clientY: 24 })

    await waitFor(() =>
      expect(db.requests.some((r) => r.startsWith('DELETE'))).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('Milk')).not.toBeInTheDocument())
    expect(screen.getByText('Bread')).toBeInTheDocument()
  })

  it('does not delete when the swipe falls short of the threshold', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    render(<App />)
    const row = await screen.findByTestId('item-row-Milk')
    const content = within(row).getByText('Milk').closest('div')!.parentElement!

    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
      width: 300, height: 48, top: 0, left: 0, right: 300, bottom: 48, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const { fireEvent } = await import('@testing-library/react')
    fireEvent.pointerDown(content, { pointerId: 1, clientX: 250, clientY: 20, button: 0 })
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 200, clientY: 20 })
    fireEvent.pointerUp(content, { pointerId: 1, clientX: 200, clientY: 20 })

    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(db.requests.some((r) => r.startsWith('DELETE'))).toBe(false)
  })
})
