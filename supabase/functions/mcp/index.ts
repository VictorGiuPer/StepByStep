import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@1'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1'
import { z } from 'npm:zod@^4.3.6'

type ScopedSupabase = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options?: { ascending?: boolean }) => {
        order: (column: string, options?: { ascending?: boolean }) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
      }
    }
  }
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (request, { supabase }: { supabase: ScopedSupabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'stepbystep', version: '1.0.0' })

        server.registerTool(
          'list_task_categories',
          {
            title: 'List task categories',
            description: 'List the categories available in the signed-in user’s StepByStep couple account. Call this before add_task when you need a category ID.',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          async () => {
            const { data, error } = await supabase
              .from('categories')
              .select('id,name,icon,color,sort_order')
              .order('sort_order', { ascending: true })
              .order('name', { ascending: true })
            if (error) throw new Error(error.message)
            return { content: [{ type: 'text', text: JSON.stringify(data ?? []) }] }
          },
        )

        server.registerTool(
          'add_task',
          {
            title: 'Add a StepByStep task',
            description: 'Create a one-off task in the signed-in user’s StepByStep tracker. Use list_task_categories to find the matching category ID. If the user did not specify personal or shared, create a personal task. Never imply it was added until this tool succeeds. This changes the user’s tracker; obtain the user’s approval before calling.',
            inputSchema: z.object({
              name: z.string().trim().min(1).max(100).describe('Short task name'),
              category_id: z.uuid().describe('ID of a category returned by list_task_categories'),
              scope: z.enum(['personal', 'shared']).default('personal').describe('Use personal unless the user explicitly asks to share the task with their partner'),
              size: z.enum(['small', 'medium', 'large']).default('small').describe('Points size: small, medium, or large'),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ name, category_id, scope, size }) => {
            const { data, error } = await supabase.rpc('save_todo', {
              p_todo_id: null,
              p_name: name,
              p_icon: 'ListTodo',
              p_category_id: category_id,
              p_scope: scope,
              p_size: size,
            })
            if (error) throw new Error(error.message)
            return { content: [{ type: 'text', text: JSON.stringify({ message: 'Task added to StepByStep.', task: data }) }] }
          },
        )

        return server
      })

      return handler.fetch(request)
    },
  ),
)
