import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { Item } from '../api/types'

// In-memory backend double. Tests seed `db.items` and can inspect
// `db.requests` to assert which mutations were sent.
export const db = {
  items: [] as Item[],
  requests: [] as string[],
}

let nextId = 1

export function makeItem(overrides: Partial<Item> & { name: string }): Item {
  const n = nextId++
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    checked: false,
    position: n * 1024,
    createdAt: new Date(2026, 0, n).toISOString(),
    updatedAt: new Date(2026, 0, n).toISOString(),
    ...overrides,
  }
}

export function resetDb(items: Item[]) {
  db.items = items
  db.requests = []
}

export const server = setupServer(
  http.get('/api/items', () => {
    db.requests.push('GET /api/items')
    return HttpResponse.json({ items: db.items })
  }),
  http.post('/api/items', async ({ request }) => {
    const { name } = (await request.json()) as { name: string }
    db.requests.push(`POST ${name}`)
    const item = makeItem({ name })
    db.items = [...db.items, item]
    return HttpResponse.json({ item, revived: false }, { status: 201 })
  }),
  http.patch('/api/items/:id', async ({ params, request }) => {
    const patch = (await request.json()) as Record<string, unknown>
    db.requests.push(`PATCH ${params.id} ${JSON.stringify(patch)}`)
    const item = db.items.find((i) => i.id === params.id)
    if (!item) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'item not found' } },
        { status: 404 },
      )
    }
    if (typeof patch.checked === 'boolean') item.checked = patch.checked
    if (typeof patch.name === 'string') item.name = patch.name
    return HttpResponse.json({ item })
  }),
  http.delete('/api/items/:id', ({ params }) => {
    db.requests.push(`DELETE ${params.id}`)
    db.items = db.items.filter((i) => i.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
)
