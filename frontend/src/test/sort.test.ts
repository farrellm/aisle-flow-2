import { describe, expect, it } from 'vitest'
import { splitItems } from '../api/sort'
import { makeItem } from './server'

// The client mirror of store.ListItems' ORDER BY (§3): notes first by
// position, then unchecked by position, then checked alphabetically.
describe('splitItems', () => {
  it('splits three ways and sorts each section', () => {
    const items = [
      makeItem({ name: 'Coffee', position: 3072 }),
      makeItem({ name: 'banana', checked: true, position: 5120 }),
      makeItem({ name: 'Coupon expires Sunday', note: true, position: 4096 }),
      makeItem({ name: 'Milk', position: 1024 }),
      makeItem({ name: 'Apples', checked: true, position: 6144 }),
      makeItem({ name: 'Skip the paprika', note: true, position: 2048 }),
    ]

    const { notes, unchecked, checked } = splitItems(items)

    expect(notes.map((i) => i.name)).toEqual([
      'Skip the paprika',
      'Coupon expires Sunday',
    ])
    expect(unchecked.map((i) => i.name)).toEqual(['Milk', 'Coffee'])
    expect(checked.map((i) => i.name)).toEqual(['Apples', 'banana'])
  })

  it('keeps notes out of the unchecked section even though they are unchecked', () => {
    const note = makeItem({ name: 'Skip the paprika', note: true })
    const { notes, unchecked } = splitItems([note])
    expect(notes).toHaveLength(1)
    expect(unchecked).toHaveLength(0)
  })
})
