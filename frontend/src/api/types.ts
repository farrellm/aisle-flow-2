export interface Item {
  id: string // uuid
  listId: string // uuid
  name: string
  checked: boolean
  position: number
  createdAt: string // RFC 3339
  updatedAt: string // RFC 3339
}

// A shopping list (§5). Named ListInfo to avoid clashing with MUI's List.
export interface ListInfo {
  id: string // uuid
  name: string
  createdAt: string // RFC 3339
  updatedAt: string // RFC 3339
}

// PATCH /api/lists/{listId}/items/{id}. `after` names the unchecked item the moved row
// lands after (the row above it), `before` the one it lands before (below
// it); null = edge of the unchecked section. Omit both when not reordering.
export interface UpdatePatch {
  name?: string
  checked?: boolean
  before?: string | null
  after?: string | null
}
