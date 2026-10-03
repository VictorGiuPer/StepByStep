import { describe, expect, it } from 'vitest'
import type { Todo, TodoCompletion } from '@/types'
import { activeTodoCompletion, isTodoVisibleToday, splitTodosForUser } from './todos'

const todo = (value: Partial<Todo> = {}): Todo => ({
  id: 'todo-1', name: 'Book dentist', icon: 'ListTodo', category_id: 'category-1', scope: 'shared',
  owner_user_id: null, size: 'small', base_points: 1, archived: false, completed_at: null,
  created_at: '2026-10-01T10:00:00Z', ...value,
})
const completion = (value: Partial<TodoCompletion> = {}): TodoCompletion => ({
  todo_id: 'todo-1', user_id: 'user-1', completion_date: '2026-10-03',
  completed_at: '2026-10-03T10:00:00Z', voided_at: null, voided_by: null, ...value,
})

describe('to-do lifecycle views', () => {
  it('keeps a completed to-do on Today only for its completion date', () => {
    expect(isTodoVisibleToday(todo(), 'user-1', '2026-10-03', [completion()])).toBe(true)
    expect(isTodoVisibleToday(todo(), 'user-1', '2026-10-04', [completion()])).toBe(false)
  })

  it('keeps shared completion state independent per partner', () => {
    expect(activeTodoCompletion('todo-1', 'user-1', [completion()])).toBeTruthy()
    expect(activeTodoCompletion('todo-1', 'user-2', [completion()])).toBeUndefined()
    expect(splitTodosForUser([todo()], 'user-1', [completion()]).completed).toHaveLength(1)
    expect(splitTodosForUser([todo()], 'user-2', [completion()]).active).toHaveLength(1)
  })

  it('ignores voided and inaccessible personal completions', () => {
    const personal = todo({ scope: 'personal', owner_user_id: 'user-1' })
    const voided = completion({ voided_at: '2026-10-03T11:00:00Z', voided_by: 'user-1' })
    expect(activeTodoCompletion(personal.id, 'user-1', [voided])).toBeUndefined()
    expect(isTodoVisibleToday(personal, 'user-2', '2026-10-03', [])).toBe(false)
  })
})
