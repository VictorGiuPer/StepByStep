import type { Category } from '@/types'

export function isCategoryAvailableToUser(category: Category, userId: string) {
  return category.scope === 'shared' || category.owner_user_id === userId
}

export function categoryLabel(category: Pick<Category, 'name' | 'scope'>) {
  return category.scope === 'shared' ? `${category.name} (S)` : category.name
}
