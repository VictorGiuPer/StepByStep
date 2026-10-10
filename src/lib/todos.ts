import type { Todo, TodoCompletion } from '@/types'

export function activeTodoCompletion(todoId: string, userId: string, completions: TodoCompletion[]) {
  return completions.find((item) => item.todo_id === todoId && item.user_id === userId && !item.voided_at)
}

export function isTodoAvailableToUser(todo: Todo, userId: string) {
  return todo.scope === 'shared' || todo.owner_user_id === userId
}

export function isTodoVisibleToday(todo: Todo, userId: string, today: string, completions: TodoCompletion[]) {
  if (todo.deleted_at || !isTodoAvailableToUser(todo, userId)) return false
  const completion = activeTodoCompletion(todo.id, userId, completions)
  return completion ? completion.completion_date === today : Boolean(todo.planned_date && todo.planned_date <= today)
}

export function splitTodosForUser(todos: Todo[], userId: string, completions: TodoCompletion[]) {
  return todos.reduce<{ active: Todo[]; completed: Todo[] }>((result, todo) => {
    if (todo.deleted_at || !isTodoAvailableToUser(todo, userId)) return result
    if (activeTodoCompletion(todo.id, userId, completions)) result.completed.push(todo)
    else result.active.push(todo)
    return result
  }, { active: [], completed: [] })
}
