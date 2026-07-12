import { describe, expect, it } from 'vitest'
import { planReorder } from '../api/reorder'
import { makeItem } from './server'

describe('planReorder', () => {
  const a = makeItem({ name: 'A', position: 1024 })
  const b = makeItem({ name: 'B', position: 2048 })
  const c = makeItem({ name: 'C', position: 3072 })
  const items = [a, b, c]

  it('names both neighbors when dropped between rows', () => {
    const plan = planReorder(items, c.id, b.id)
    expect(plan).toEqual({
      patch: { after: a.id, before: b.id },
      position: (1024 + 2048) / 2,
    })
  })

  it('sends after=null when dropped at the top', () => {
    const plan = planReorder(items, c.id, a.id)
    expect(plan).toEqual({
      patch: { after: null, before: a.id },
      position: 1024 - 1024,
    })
  })

  it('sends before=null when dropped at the bottom', () => {
    const plan = planReorder(items, a.id, c.id)
    expect(plan).toEqual({
      patch: { after: c.id, before: null },
      position: 3072 + 1024,
    })
  })

  it('returns null for a no-op drop', () => {
    expect(planReorder(items, b.id, b.id)).toBeNull()
  })
})
