import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import App from '../App'
import { db, DEFAULT_LIST_ID, makeItem, makeList, resetDb, server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
// Most tests open directly on the seeded list, skipping the root redirect.
beforeEach(() => window.history.pushState(null, '', `/l/${DEFAULT_LIST_ID}`))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// The shopping-list <ul>s, excluding any open MUI menu (role="menu").
function shoppingLists() {
  return screen.getAllByRole('list').filter((el) => el.getAttribute('role') !== 'menu')
}

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
    const lists = shoppingLists()
    expect(itemNames(lists[0])).toEqual(['Milk', 'Coffee'])
    expect(itemNames(lists[1])).toEqual(['Apples', 'banana'])
  })

  it('moves a checked item into the checked section optimistically', async () => {
    resetDb([makeItem({ name: 'Milk' }), makeItem({ name: 'Bread' })])
    // Never resolves: only the optimistic cache update can move the row.
    server.use(
      http.patch('/api/lists/:listId/items/:id', () => delay('infinite')),
    )
    render(<App />)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Milk' }))

    // The checked section only mounts once the optimistic update lands.
    await waitFor(() => expect(shoppingLists()).toHaveLength(2))
    const lists = shoppingLists()
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
      http.delete('/api/lists/:listId/items/:id', () =>
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

  it('does not delete or reveal when the swipe falls short of the snap threshold', async () => {
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
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 230, clientY: 20 })
    fireEvent.pointerUp(content, { pointerId: 1, clientX: 230, clientY: 20 })

    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(db.requests.some((r) => r.startsWith('DELETE'))).toBe(false)
    // Hidden from the accessibility tree while the row is closed.
    expect(screen.queryByRole('button', { name: 'Delete Milk' })).not.toBeInTheDocument()
  })

  it('snaps open to reveal a delete button on a short swipe', async () => {
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

    // Below the commit threshold: the row stays, the Delete button is exposed.
    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(db.requests.some((r) => r.startsWith('DELETE'))).toBe(false)
    const deleteButton = screen.getByRole('button', { name: 'Delete Milk' })
    expect(deleteButton).toBeVisible()

    fireEvent.click(deleteButton)
    await waitFor(() =>
      expect(db.requests.some((r) => r.startsWith('DELETE'))).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('Milk')).not.toBeInTheDocument())
  })

  it('closes a revealed row when the row content is tapped', async () => {
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
    expect(screen.getByRole('button', { name: 'Delete Milk' })).toBeVisible()

    // A plain tap on the content closes the row without toggling the checkbox.
    fireEvent.pointerDown(content, { pointerId: 2, clientX: 100, clientY: 20, button: 0 })
    fireEvent.pointerUp(content, { pointerId: 2, clientX: 100, clientY: 20 })
    fireEvent.click(content, { detail: 1 })

    expect(screen.queryByRole('button', { name: 'Delete Milk' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Milk' })).not.toBeChecked()
    expect(db.requests.some((r) => r.startsWith('DELETE'))).toBe(false)
  })
})

describe('multiple lists', () => {
  // Groceries (seeded) + Hardware, each with one item.
  function seedTwoLists() {
    const hardware = makeList({ name: 'Hardware' })
    resetDb(
      [
        makeItem({ name: 'Milk', listId: DEFAULT_LIST_ID }),
        makeItem({ name: 'Hammer', listId: hardware.id }),
      ],
      [makeList({ id: DEFAULT_LIST_ID, name: 'Groceries' }), hardware],
    )
    return hardware
  }

  it('switches lists from the AppBar dropdown', async () => {
    const hardware = seedTwoLists()
    render(<App />)
    await screen.findByText('Milk')

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Groceries/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Hardware' }))

    await screen.findByText('Hammer')
    expect(screen.queryByText('Milk')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe(`/l/${hardware.id}`)
    expect(await screen.findByRole('button', { name: /Hardware/ })).toBeInTheDocument()
  })

  it('creates a new list and navigates to it', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    render(<App />)
    await screen.findByText('Milk')

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Groceries/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'New list…' }))
    await user.type(screen.getByRole('textbox', { name: 'List name' }), 'Pharmacy')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    // Title reflects the new list; nothing from Groceries is shown.
    expect(await screen.findByRole('button', { name: /Pharmacy/ })).toBeInTheDocument()
    expect(screen.queryByText('Milk')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(db.requests.some((r) => r === 'POST list Pharmacy')).toBe(true),
    )
    expect(window.location.pathname).toMatch(/^\/l\//)
  })

  it('renames the current list', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    render(<App />)
    await screen.findByText('Milk')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename list…' }))
    const field = screen.getByRole('textbox', { name: 'List name' })
    await user.clear(field)
    await user.type(field, 'Weekly Shop')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByRole('button', { name: /Weekly Shop/ })).toBeInTheDocument()
  })

  it('deletes the current list and navigates to a surviving one', async () => {
    const hardware = seedTwoLists()
    render(<App />)
    await screen.findByText('Milk')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete list…' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByText('Hammer')
    expect(window.location.pathname).toBe(`/l/${hardware.id}`)
    await waitFor(() =>
      expect(db.requests.some((r) => r === `DELETE list ${DEFAULT_LIST_ID}`)).toBe(true),
    )
  })

  it('disables Delete list when only one list remains', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    render(<App />)
    await screen.findByText('Milk')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete list…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('redirects to a real list and warns when the list id is unknown', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    window.history.pushState(null, '', '/l/99999999-9999-4999-8999-999999999999')
    render(<App />)

    // Bounced to the seeded list, with a snackbar.
    expect(await screen.findByText('List not found')).toBeInTheDocument()
    await screen.findByText('Milk')
    expect(window.location.pathname).toBe(`/l/${DEFAULT_LIST_ID}`)
  })

  it('redirects from the root path to a list', async () => {
    resetDb([makeItem({ name: 'Milk' })])
    window.history.pushState(null, '', '/')
    render(<App />)

    await screen.findByText('Milk')
    expect(window.location.pathname).toBe(`/l/${DEFAULT_LIST_ID}`)
  })

  it('keeps the same item name independent across lists', async () => {
    const hardware = seedTwoLists()
    // Both lists legitimately hold a "Milk"; the server scopes uniqueness.
    db.items.push(makeItem({ name: 'Milk', listId: hardware.id }))
    render(<App />)
    await screen.findByText('Milk')

    const user = userEvent.setup()
    // Adding "Milk" again in Groceries is a duplicate → highlighted, no POST.
    await user.type(screen.getByRole('textbox', { name: 'Add an item' }), 'Milk{Enter}')
    expect(db.requests.some((r) => r.startsWith(`POST ${DEFAULT_LIST_ID}`))).toBe(false)

    // Switching to Hardware shows its own Milk.
    await user.click(await screen.findByRole('button', { name: /Groceries/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Hardware' }))
    await screen.findByText('Milk')
    expect(window.location.pathname).toBe(`/l/${hardware.id}`)
  })
})
