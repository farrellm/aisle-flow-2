import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { Item, ListInfo } from '../api/types'

// The list resetDb seeds by default; tests address it the way ListScreen
// does (via the /l/{listId} route).
export const DEFAULT_LIST_ID = '11111111-1111-4111-8111-111111111111'

// In-memory backend double. Tests seed `db.items`/`db.lists` and can
// inspect `db.requests` to assert which mutations were sent.
export const db = {
  lists: [] as ListInfo[],
  items: [] as Item[],
  requests: [] as string[],
}

let nextId = 1

export function makeItem(overrides: Partial<Item> & { name: string }): Item {
  const n = nextId++
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    listId: DEFAULT_LIST_ID,
    checked: false,
    position: n * 1024,
    createdAt: new Date(2026, 0, n).toISOString(),
    updatedAt: new Date(2026, 0, n).toISOString(),
    ...overrides,
  }
}

export function makeList(overrides: Partial<ListInfo> & { name: string }): ListInfo {
  const n = nextId++
  return {
    id: `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`,
    createdAt: new Date(2026, 0, n).toISOString(),
    updatedAt: new Date(2026, 0, n).toISOString(),
    ...overrides,
  }
}

export function resetDb(items: Item[], lists?: ListInfo[]) {
  db.lists = lists ?? [makeList({ id: DEFAULT_LIST_ID, name: 'Groceries' })]
  db.items = items
  db.requests = []
}

const notFound = (what: string) =>
  HttpResponse.json(
    { error: { code: 'not_found', message: `${what} not found` } },
    { status: 404 },
  )

const listOr404 = (listId: string | readonly string[] | undefined) =>
  db.lists.find((l) => l.id === listId)

export const server = setupServer(
  http.get('/api/lists', () => {
    db.requests.push('GET /api/lists')
    return HttpResponse.json({ lists: db.lists })
  }),
  http.post('/api/lists', async ({ request }) => {
    const { id, name } = (await request.json()) as { id?: string; name: string }
    db.requests.push(`POST list ${name}`)
    if (db.lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      return HttpResponse.json(
        { error: { code: 'conflict', message: 'that name already exists' } },
        { status: 409 },
      )
    }
    const list = makeList({ name, ...(id && { id }) })
    db.lists = [...db.lists, list]
    return HttpResponse.json({ list }, { status: 201 })
  }),
  http.patch('/api/lists/:listId', async ({ params, request }) => {
    const { name } = (await request.json()) as { name: string }
    db.requests.push(`PATCH list ${params.listId} ${name}`)
    const list = listOr404(params.listId)
    if (!list) return notFound('list')
    list.name = name
    return HttpResponse.json({ list })
  }),
  http.delete('/api/lists/:listId', ({ params }) => {
    db.requests.push(`DELETE list ${params.listId}`)
    if (!listOr404(params.listId)) return notFound('list')
    if (db.lists.length <= 1) {
      return HttpResponse.json(
        { error: { code: 'last_list', message: 'cannot delete the only list' } },
        { status: 409 },
      )
    }
    db.lists = db.lists.filter((l) => l.id !== params.listId)
    db.items = db.items.filter((i) => i.listId !== params.listId)
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/lists/:listId/items', ({ params }) => {
    db.requests.push(`GET items ${params.listId}`)
    if (!listOr404(params.listId)) return notFound('list')
    return HttpResponse.json({
      items: db.items.filter((i) => i.listId === params.listId),
    })
  }),
  http.post('/api/lists/:listId/items', async ({ params, request }) => {
    const { id, name } = (await request.json()) as { id?: string; name: string }
    db.requests.push(`POST ${params.listId} ${name}`)
    if (!listOr404(params.listId)) return notFound('list')
    const item = makeItem({
      name,
      listId: params.listId as string,
      ...(id && { id }),
    })
    db.items = [...db.items, item]
    return HttpResponse.json({ item, revived: false }, { status: 201 })
  }),
  http.patch('/api/lists/:listId/items/:id', async ({ params, request }) => {
    const patch = (await request.json()) as Record<string, unknown>
    db.requests.push(`PATCH ${params.id} ${JSON.stringify(patch)}`)
    const item = db.items.find(
      (i) => i.id === params.id && i.listId === params.listId,
    )
    if (!item) return notFound('item')
    if (typeof patch.checked === 'boolean') item.checked = patch.checked
    if (typeof patch.name === 'string') item.name = patch.name
    return HttpResponse.json({ item })
  }),
  http.delete('/api/lists/:listId/items/:id', ({ params }) => {
    db.requests.push(`DELETE ${params.id}`)
    db.items = db.items.filter(
      (i) => !(i.id === params.id && i.listId === params.listId),
    )
    return new HttpResponse(null, { status: 204 })
  }),
)
