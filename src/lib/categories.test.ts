import { describe, expect, it } from 'vitest'
import { categoryLabel, isCategoryAvailableToUser } from './categories'

describe('categoryLabel', () => {
  it('marks shared categories with the shared suffix', () => {
    expect(categoryLabel({ name: 'Health', scope: 'shared' })).toBe('Health (S)')
  })

  it('leaves personal and legacy categories unmarked', () => {
    expect(categoryLabel({ name: 'Health', scope: 'personal' })).toBe('Health')
    expect(categoryLabel({ name: 'Health' })).toBe('Health')
  })

  it('makes personal categories available only to their owner', () => {
    expect(isCategoryAvailableToUser({ id: 'a', name: 'A', icon: 'Shapes', color: '#758BFD', sort_order: 0, created_by: 'user-1', scope: 'personal', owner_user_id: 'user-1' }, 'user-1')).toBe(true)
    expect(isCategoryAvailableToUser({ id: 'a', name: 'A', icon: 'Shapes', color: '#758BFD', sort_order: 0, created_by: 'user-1', scope: 'personal', owner_user_id: 'user-1' }, 'user-2')).toBe(false)
    expect(isCategoryAvailableToUser({ id: 'b', name: 'B', icon: 'Shapes', color: '#758BFD', sort_order: 0, created_by: null, scope: 'shared', owner_user_id: null }, 'user-2')).toBe(true)
  })
})
