import type { Item } from './types'

// Client-side mirror of the server's display order (§7): unchecked by
// position/createdAt/id, checked alphabetically (case-insensitive) — so
// optimistic updates land rows in the right place without a round trip.

const byPosition = (a: Item, b: Item) =>
  a.position - b.position ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id)

const byName = (a: Item, b: Item) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id)

export function splitItems(items: Item[]) {
  return {
    unchecked: items.filter((i) => !i.checked).sort(byPosition),
    checked: items.filter((i) => i.checked).sort(byName),
  }
}

export const maxPosition = (items: Item[]) =>
  items.reduce((max, i) => Math.max(max, i.position), 0)

export const findByName = (items: Item[], name: string) =>
  items.find((i) => i.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)
