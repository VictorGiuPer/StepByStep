import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@1'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1'
import { z } from 'npm:zod@^4.3.6'

// This edge function uses dynamic table names instead of generated database
// types; the shared frontend schema is maintained separately in migrations.
/* eslint-disable @typescript-eslint/no-explicit-any */

// This client is always user-scoped by withSupabase({ auth: 'user' }). All
// reads therefore remain subject to couple RLS, and all writes use the same
// authenticated identity as the human-facing app.
type ScopedSupabase = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }> }
  from: (table: string) => any
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>
}

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

async function runQuery(query: PromiseLike<{ data: any; error: { message: string } | null }>) {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

async function runRpc(supabase: ScopedSupabase, name: string, args: Record<string, unknown> = {}) {
  return runQuery(supabase.rpc(name, args))
}

async function actorId(supabase: ScopedSupabase) {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error(error?.message ?? 'Sign in is required.')
  return data.user.id
}

async function householdDate(supabase: ScopedSupabase) {
  const row = await runQuery(supabase.from('app_settings').select('timezone').eq('id', 1).single())
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: row.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item: { type: string }) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function currentWeekStart(today: string) {
  const date = new Date(`${today}T12:00:00Z`)
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday)
  return date.toISOString().slice(0, 10)
}

function firstRow(data: any) {
  return Array.isArray(data) ? data[0] : data
}

const writeDescription = (description: string) => `${description} This changes StepByStep. Only call after the user explicitly approves this specific change; if Claude does not show a confirmation prompt, ask before calling.`

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (request, { supabase }: { supabase: ScopedSupabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'stepbystep', version: '1.1.0' })

        // READ: household context and focused lists. Every query is executed
        // with the signed-in user's OAuth token; no service-role key is used.
        server.registerTool(
          'get_tracker_overview',
          {
            title: 'Get StepByStep overview',
            description: 'Read the signed-in partner’s couple tracker at a glance: profiles, connection state, categories, active habits and to-dos, this week’s counters, both partners’ balances, recent point history, rewards, and pending requests.',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          async () => {
            const userId = await actorId(supabase)
            const today = await householdDate(supabase)
            const weekStart = currentWeekStart(today)
            const [profiles, connection, settings, categories, habits, todos, completions, weekly, balances, ledger, rewards, redemptions] = await Promise.all([
              runQuery(supabase.from('profiles').select('id,display_name,avatar_url').order('created_at')),
              runRpc(supabase, 'get_couple_link_state'),
              runQuery(supabase.from('app_settings').select('timezone').eq('id', 1).single()),
              runQuery(supabase.from('categories').select('id,name,icon,color,sort_order,scope,owner_user_id').order('sort_order').order('name')),
              runQuery(supabase.from('habits').select('id,name,icon,category_id,type,scope,owner_user_id,frequency,custom_days,weekly_target,size,base_points,archived,created_at').eq('archived', false).order('created_at')),
              runQuery(supabase.from('todos').select('id,name,icon,category_id,scope,owner_user_id,size,base_points,archived,created_at').eq('archived', false).order('created_at')),
              runQuery(supabase.from('todo_completions').select('todo_id,user_id,completion_date,completed_at,voided_at')),
              runQuery(supabase.from('habit_weekly_progress').select('habit_id,user_id,week_start,count').eq('week_start', weekStart)),
              runQuery(supabase.from('point_balances').select('user_id,balance')),
              runQuery(supabase.from('ledger_history').select('id,user_id,date,points,source,created_at,habit_id,habit_name,category_id,category_name,reward_name').order('created_at', { ascending: false }).limit(30)),
              runQuery(supabase.from('rewards').select('id,name,description,point_cost,icon,created_by,archived,created_at').order('created_at', { ascending: false })),
              runQuery(supabase.from('redemptions').select('id,reward_id,reward_name_snapshot,point_cost_snapshot,redeemed_by,date_requested,date_confirmed,date_decided,decided_by,decision_note,status,created_at').order('created_at', { ascending: false }).limit(50)),
            ])
            return result({ today, week_start: weekStart, signed_in_user_id: userId, profiles, connection: firstRow(connection), timezone: settings.timezone, categories, habits, todos, todo_completions: completions, current_week_progress: weekly, balances, recent_points: ledger, rewards, redemptions })
          },
        )

        server.registerTool(
          'list_task_categories',
          {
            title: 'List task categories',
            description: 'List the categories available in the signed-in user’s StepByStep couple account. Call this before saving a task or habit when you need a category ID.',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          async () => {
            const data = await runQuery(supabase.from('categories').select('id,name,icon,color,sort_order,scope,owner_user_id').order('sort_order', { ascending: true }).order('name', { ascending: true }))
            return result(data ?? [])
          },
        )

        server.registerTool(
          'list_tasks',
          {
            title: 'List one-off tasks',
            description: 'List active tasks or the signed-in user’s completed archive. Shared tasks show each partner’s independent completion status.',
            inputSchema: z.object({ view: z.enum(['active', 'completed', 'all']).default('active') }),
            annotations: { readOnlyHint: true },
          },
          async ({ view }) => {
            const userId = await actorId(supabase)
            const [todos, completions, categories, profiles] = await Promise.all([
              runQuery(supabase.from('todos').select('id,name,icon,category_id,scope,owner_user_id,size,base_points,archived,created_at').eq('archived', false).order('created_at')),
              runQuery(supabase.from('todo_completions').select('todo_id,user_id,completion_date,completed_at,voided_at')),
              runQuery(supabase.from('categories').select('id,name')),
              runQuery(supabase.from('profiles').select('id,display_name')),
            ])
            const active = (completions ?? []).filter((item: any) => !item.voided_at)
            const ownDone = new Set(active.filter((item: any) => item.user_id === userId).map((item: any) => item.todo_id))
            const filtered = (todos ?? []).filter((todo: any) => view === 'all' || (view === 'completed' ? ownDone.has(todo.id) : !ownDone.has(todo.id)))
            const output = filtered.map((todo: any) => ({ ...todo, category: (categories ?? []).find((item: any) => item.id === todo.category_id)?.name ?? null, owner: (profiles ?? []).find((item: any) => item.id === todo.owner_user_id)?.display_name ?? null, completed_by: active.filter((item: any) => item.todo_id === todo.id).map((item: any) => ({ user_id: item.user_id, name: (profiles ?? []).find((profile: any) => profile.id === item.user_id)?.display_name ?? null, completion_date: item.completion_date })) }))
            return result({ view, tasks: output })
          },
        )

        server.registerTool(
          'list_habits',
          {
            title: 'List habits and progress',
            description: 'Read active and archived routines, schedule rules, this week’s exact counters, recent completion history, and category/owner context.',
            inputSchema: z.object({ include_archived: z.boolean().default(false) }),
            annotations: { readOnlyHint: true },
          },
          async ({ include_archived }) => {
            const today = await householdDate(supabase)
            const weekStart = currentWeekStart(today)
            let habitsQuery = supabase.from('habits').select('id,name,icon,category_id,type,scope,owner_user_id,frequency,custom_days,weekly_target,size,base_points,archived,created_at').order('created_at')
            if (!include_archived) habitsQuery = habitsQuery.eq('archived', false)
            const [habits, schedules, completions, weekly, categories, profiles] = await Promise.all([
              runQuery(habitsQuery),
              runQuery(supabase.from('habit_schedule_versions').select('id,habit_id,frequency,custom_days,effective_from,effective_to').order('effective_from')),
              runQuery(supabase.from('habit_completions').select('id,habit_id,schedule_version_id,user_id,date,interval_start,note,voided_at,created_at').order('date', { ascending: false }).limit(200)),
              runQuery(supabase.from('habit_weekly_progress').select('habit_id,user_id,week_start,count').eq('week_start', weekStart)),
              runQuery(supabase.from('categories').select('id,name')),
              runQuery(supabase.from('profiles').select('id,display_name')),
            ])
            const streakGroups = await Promise.all((profiles ?? []).map((profile: any) => runRpc(supabase, 'get_habit_streaks', { p_user_id: profile.id })))
            return result({ today, week_start: weekStart, habits: (habits ?? []).map((habit: any) => ({ ...habit, category: (categories ?? []).find((item: any) => item.id === habit.category_id)?.name ?? null, owner: (profiles ?? []).find((item: any) => item.id === habit.owner_user_id)?.display_name ?? null })), schedules, recent_completions: completions, current_week_progress: weekly, streaks: streakGroups.flatMap((group: any) => group ?? []) })
          },
        )

        server.registerTool(
          'get_points_and_shop',
          {
            title: 'Get points and reward shop',
            description: 'Read both partners’ available balances, categorized net point history, rewards, and pending/completed/declined redemption history.',
            inputSchema: z.object({ history_limit: z.number().int().min(1).max(200).default(50) }),
            annotations: { readOnlyHint: true },
          },
          async ({ history_limit }) => {
            const [balances, ledger, rewards, redemptions, profiles] = await Promise.all([
              runQuery(supabase.from('point_balances').select('user_id,balance')),
              runQuery(supabase.from('ledger_history').select('id,user_id,date,points,source,created_at,habit_id,habit_name,category_id,category_name,reward_name').order('created_at', { ascending: false }).limit(history_limit)),
              runQuery(supabase.from('rewards').select('id,name,description,point_cost,icon,created_by,archived,created_at').order('created_at', { ascending: false })),
              runQuery(supabase.from('redemptions').select('id,reward_id,reward_name_snapshot,point_cost_snapshot,redeemed_by,date_requested,date_confirmed,date_decided,decided_by,decision_note,status,created_at').order('created_at', { ascending: false }).limit(history_limit)),
              runQuery(supabase.from('profiles').select('id,display_name')),
            ])
            return result({ profiles, balances, points: ledger, rewards, redemptions })
          },
        )

        // WRITE: tasks. The database RPCs enforce personal ownership, couple
        // membership, valid categories, same-day undo, and the points ledger.
        server.registerTool(
          'save_task',
          {
            title: 'Add or edit a one-off task',
            description: writeDescription('Create or edit a one-off task. Categories are labels and scope is personal or shared. Personal tasks can only be edited by their owner.'),
            inputSchema: z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(100).optional(), category_id: z.uuid().optional(), scope: z.enum(['personal', 'shared']).optional(), size: z.enum(['small', 'medium', 'large']).optional(), icon: z.string().trim().min(1).max(40).optional() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ id, name, category_id, scope, size, icon }) => {
            const existing = id ? await runQuery(supabase.from('todos').select('id,name,icon,category_id,scope,size').eq('id', id).single()) : null
            const values = { name: name ?? existing?.name, icon: icon ?? existing?.icon ?? 'ListTodo', category_id: category_id ?? existing?.category_id, scope: scope ?? existing?.scope ?? 'personal', size: size ?? existing?.size ?? 'small' }
            if (!values.name || !values.category_id) throw new Error('Provide at least name and category_id when creating a task.')
            return result(firstRow(await runRpc(supabase, 'save_todo', { p_todo_id: id ?? null, p_name: values.name, p_icon: values.icon, p_category_id: values.category_id, p_scope: values.scope, p_size: values.size })))
          },
        )

        server.registerTool(
          'set_task_completed',
          {
            title: 'Complete or undo a task',
            description: writeDescription('Set the signed-in user’s completion state for a one-off task. Shared task completion is independent per partner. Undo is only allowed on the completion day; point changes are recorded in the ledger.'),
            inputSchema: z.object({ task_id: z.uuid(), completed: z.boolean() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
          },
          async ({ task_id, completed }) => {
            const userId = await actorId(supabase)
            const existing = await runQuery(supabase.from('todo_completions').select('voided_at').eq('todo_id', task_id).eq('user_id', userId).maybeSingle())
            const isComplete = Boolean(existing && !existing.voided_at)
            if (isComplete !== completed) await runRpc(supabase, 'toggle_todo_completion', { p_todo_id: task_id })
            return result({ task_id, completed, changed: isComplete !== completed })
          },
        )

        server.registerTool(
          'delete_task',
          {
            title: 'Delete a one-off task',
            description: writeDescription('Permanently delete a one-off task. Only its owner may delete a personal task. This can remove its completion history; use only when the user explicitly asks to delete it.'),
            inputSchema: z.object({ task_id: z.uuid() }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
          },
          async ({ task_id }) => { await runRpc(supabase, 'delete_todo', { p_todo_id: task_id }); return result({ task_id, deleted: true }) },
        )

        // WRITE: habits, including flexible weekly counters.
        server.registerTool(
          'save_habit',
          {
            title: 'Add or edit a habit',
            description: writeDescription('Create or edit a habit routine. Personal routines belong to the signed-in user; shared routines are visible to both partners. Use flexible_weekly for a plus/minus weekly counter.'),
            inputSchema: z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(100).optional(), category_id: z.uuid().optional(), type: z.enum(['build', 'avoid']).optional(), scope: z.enum(['personal', 'shared']).optional(), frequency: z.enum(['daily', 'weekly', 'custom_days', 'flexible_weekly']).optional(), custom_days: z.array(z.number().int().min(1).max(7)).optional(), weekly_target: z.number().int().min(1).max(7).optional(), size: z.enum(['small', 'medium', 'large']).optional(), icon: z.string().trim().min(1).max(40).optional(), archived: z.boolean().optional() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ id, name, category_id, type, scope, frequency, custom_days, weekly_target, size, icon, archived }) => {
            const existing = id ? await runQuery(supabase.from('habits').select('id,name,icon,category_id,type,scope,frequency,custom_days,weekly_target,size,archived').eq('id', id).single()) : null
            const values = {
              name: name ?? existing?.name,
              category_id: category_id ?? existing?.category_id,
              type: type ?? existing?.type ?? 'build',
              scope: scope ?? existing?.scope ?? 'personal',
              frequency: frequency ?? (existing?.weekly_target ? 'flexible_weekly' : existing?.frequency) ?? 'daily',
              custom_days: custom_days ?? existing?.custom_days ?? undefined,
              weekly_target: weekly_target ?? existing?.weekly_target ?? undefined,
              size: size ?? existing?.size ?? 'small',
              icon: icon ?? existing?.icon ?? 'Circle',
              archived: archived ?? existing?.archived ?? false,
            }
            if (!values.name || !values.category_id) throw new Error('Provide at least name and category_id when creating a habit.')
            const flexible = values.frequency === 'flexible_weekly'
            if (values.frequency === 'custom_days' && (!values.custom_days || values.custom_days.length === 0)) throw new Error('Provide at least one custom weekday (1=Monday through 7=Sunday).')
            if (flexible && values.weekly_target === undefined) throw new Error('Provide weekly_target from 1 to 7 for a flexible weekly habit.')
            const habit = firstRow(await runRpc(supabase, 'save_habit', {
              p_habit_id: id ?? null, p_name: values.name, p_icon: values.icon, p_category_id: values.category_id, p_type: values.type, p_scope: values.scope,
              p_frequency: flexible ? 'custom_days' : values.frequency,
              p_custom_days: flexible ? [1, 2, 3, 4, 5, 6, 7] : values.frequency === 'custom_days' ? values.custom_days : null,
              p_size: values.size, p_archived: values.archived,
            }))
            await runRpc(supabase, 'set_habit_weekly_target', { p_habit_id: habit.id, p_target: flexible ? values.weekly_target : null })
            return result(habit)
          },
        )

        server.registerTool(
          'set_habit_completed',
          {
            title: 'Complete or undo a habit',
            description: writeDescription('Set the signed-in user’s completion for a scheduled habit. For a flexible weekly counter, use adjust_weekly_habit instead. Undoing a normal habit is limited to the current day by the app’s completion rules.'),
            inputSchema: z.object({ habit_id: z.uuid(), completed: z.boolean(), note: z.string().max(500).optional() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
          },
          async ({ habit_id, completed, note }) => {
            const userId = await actorId(supabase)
            const today = await householdDate(supabase)
            const habit = await runQuery(supabase.from('habits').select('id,frequency,weekly_target,archived').eq('id', habit_id).single())
            if (habit.archived) throw new Error('Archived habits cannot be completed.')
            if (habit.weekly_target) throw new Error('This is a flexible weekly counter. Use adjust_weekly_habit to change its count.')
            const schedules = await runQuery(supabase.from('habit_schedule_versions').select('id,frequency').eq('habit_id', habit_id).lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`).order('effective_from', { ascending: false }).limit(1))
            const schedule = schedules?.[0]
            if (!schedule) throw new Error('No habit schedule applies today.')
            const week = currentWeekStart(today)
            const intervalStart = schedule.frequency === 'weekly' ? week : today
            const existing = await runQuery(supabase.from('habit_completions').select('id,date,voided_at').eq('habit_id', habit_id).eq('user_id', userId).eq('schedule_version_id', schedule.id).eq('interval_start', intervalStart).maybeSingle())
            const isComplete = Boolean(existing && !existing.voided_at)
            if (isComplete !== completed) {
              if (completed) {
                if (existing) await runRpc(supabase, 'toggle_habit_completion', { p_habit_id: habit_id, p_completion_date: today })
                else await runRpc(supabase, 'log_or_restore_habit_completion', { p_habit_id: habit_id, p_completion_date: today, p_note: note ?? null })
              } else {
                await runRpc(supabase, 'toggle_habit_completion', { p_habit_id: habit_id, p_completion_date: today })
              }
            }
            return result({ habit_id, completed, changed: isComplete !== completed })
          },
        )

        server.registerTool(
          'adjust_weekly_habit',
          {
            title: 'Adjust a weekly habit counter',
            description: writeDescription('Increase or decrease a flexible weekly habit by one. This affects only the current Monday–Sunday counter and updates the point ledger. The count cannot go below zero.'),
            inputSchema: z.object({ habit_id: z.uuid(), delta: z.union([z.literal(-1), z.literal(1)]) }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ habit_id, delta }) => result({ habit_id, count: await runRpc(supabase, 'adjust_weekly_habit_progress', { p_habit_id: habit_id, p_delta: delta }) }),
        )

        server.registerTool(
          'archive_habit',
          {
            title: 'Archive a habit',
            description: writeDescription('Archive a habit so it no longer appears as active. This preserves its completion and points history. Personal habits may only be archived by their owner.'),
            inputSchema: z.object({ habit_id: z.uuid() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
          },
          async ({ habit_id }) => {
            const habit = await runQuery(supabase.from('habits').select('id,name,icon,category_id,type,scope,frequency,custom_days,size,archived,weekly_target').eq('id', habit_id).single())
            const data = firstRow(await runRpc(supabase, 'save_habit', { p_habit_id: habit.id, p_name: habit.name, p_icon: habit.icon, p_category_id: habit.category_id, p_type: habit.type, p_scope: habit.scope, p_frequency: habit.frequency, p_custom_days: habit.custom_days, p_size: habit.size, p_archived: true }))
            return result(data)
          },
        )

        // WRITE: category labels. Couple and FK integrity are enforced by RLS,
        // trigger guards, and the database's category foreign keys.
        server.registerTool(
          'save_category',
          {
            title: 'Add or edit a category',
            description: writeDescription('Create or edit a shared category label used to organize tasks and habits. Categories are labels; they do not change whether an item is personal or shared.'),
            inputSchema: z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(60).optional(), icon: z.string().trim().min(1).max(40).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), sort_order: z.number().int().min(0).optional() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ id, name, icon, color, sort_order }) => {
            if (id) {
              const patch = { ...(name === undefined ? {} : { name }), ...(icon === undefined ? {} : { icon }), ...(color === undefined ? {} : { color }), ...(sort_order === undefined ? {} : { sort_order }) }
              if (!Object.keys(patch).length) throw new Error('Provide at least one category field to change.')
              return result(await runQuery(supabase.from('categories').update(patch).eq('id', id).select('id,name,icon,color,sort_order').single()))
            }
            if (!name) throw new Error('Provide a category name when creating a category.')
            const userId = await actorId(supabase)
            const membership = await runQuery(supabase.from('couple_members').select('couple_id').eq('user_id', userId).single())
            const category = await runQuery(supabase.from('categories').insert({ couple_id: membership.couple_id, name, icon: icon ?? 'Shapes', color: color ?? '#758BFD', sort_order: sort_order ?? 0, scope: 'shared', owner_user_id: null, created_by: userId }).select('id,name,icon,color,sort_order').single())
            return result(category)
          },
        )

        server.registerTool(
          'delete_category',
          {
            title: 'Delete a category',
            description: writeDescription('Delete a category label. The database refuses deletion while a habit or task still uses it; reassign those items first.'),
            inputSchema: z.object({ category_id: z.uuid() }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
          },
          async ({ category_id }) => { await runQuery(supabase.from('categories').delete().eq('id', category_id)); return result({ category_id, deleted: true }) },
        )

        // WRITE: shop and mutual redemption approval.
        server.registerTool(
          'save_reward',
          {
            title: 'Add or edit a reward',
            description: writeDescription('Create or edit a reward in the couple shop. Saving a reward does not spend points.'),
            inputSchema: z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(100).optional(), point_cost: z.number().int().min(1).optional(), description: z.string().max(500).nullable().optional(), icon: z.string().trim().min(1).max(40).optional() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ id, name, point_cost, description, icon }) => {
            if (id) {
              const patch = { ...(name === undefined ? {} : { name }), ...(point_cost === undefined ? {} : { point_cost }), ...(description === undefined ? {} : { description }), ...(icon === undefined ? {} : { icon }) }
              if (!Object.keys(patch).length) throw new Error('Provide at least one reward field to change.')
              return result(await runQuery(supabase.from('rewards').update(patch).eq('id', id).select('id,name,description,point_cost,icon,archived').single()))
            }
            if (!name || point_cost === undefined) throw new Error('Provide name and point_cost when creating a reward.')
            const userId = await actorId(supabase)
            const membership = await runQuery(supabase.from('couple_members').select('couple_id').eq('user_id', userId).single())
            return result(await runQuery(supabase.from('rewards').insert({ name, point_cost, description: description ?? null, icon: icon ?? 'Gift', created_by: userId, couple_id: membership.couple_id }).select('id,name,description,point_cost,icon,archived').single()))
          },
        )

        server.registerTool(
          'archive_reward',
          {
            title: 'Archive a reward',
            description: writeDescription('Remove a reward from the active shop while preserving existing redemption history.'),
            inputSchema: z.object({ reward_id: z.uuid() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
          },
          async ({ reward_id }) => result(await runQuery(supabase.from('rewards').update({ archived: true }).eq('id', reward_id).select('id,name,archived').single())),
        )

        server.registerTool(
          'request_reward',
          {
            title: 'Request a reward',
            description: writeDescription('Request an active shop reward. This creates a pending request but does not spend points until the other partner confirms it.'),
            inputSchema: z.object({ reward_id: z.uuid() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ reward_id }) => result(await runRpc(supabase, 'request_redemption', { p_reward_id: reward_id })),
        )

        server.registerTool(
          'decide_reward_request',
          {
            title: 'Approve or decline a reward request',
            description: writeDescription('Approve or decline your partner’s pending reward request. Confirming it spends the requester’s points; declining it does not. The database prevents a user from deciding their own request.'),
            inputSchema: z.object({ redemption_id: z.uuid(), decision: z.enum(['confirmed', 'declined']), reason: z.string().max(500).optional() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ redemption_id, decision, reason }) => result(await runRpc(supabase, 'decide_redemption', { p_redemption_id: redemption_id, p_decision: decision, p_reason: reason ?? null })),
        )

        // WRITE: account preferences and couple invite flow, guarded by the
        // existing user-scoped RLS and authenticated RPCs.
        server.registerTool(
          'update_my_settings',
          {
            title: 'Update my profile or timezone',
            description: writeDescription('Update the signed-in user’s display name/avatar URL and/or the couple household timezone.'),
            inputSchema: z.object({ display_name: z.string().trim().min(1).max(60).optional(), avatar_url: z.string().trim().max(1000).nullable().optional(), timezone: z.string().trim().min(1).max(100).optional() }).refine((value) => Object.keys(value).length > 0, 'Provide at least one setting to update.'),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
          },
          async ({ display_name, avatar_url, timezone }) => {
            const userId = await actorId(supabase)
            const updates: unknown[] = []
            if (display_name !== undefined || avatar_url !== undefined) updates.push(runQuery(supabase.from('profiles').update({ ...(display_name === undefined ? {} : { display_name }), ...(avatar_url === undefined ? {} : { avatar_url }) }).eq('id', userId)))
            if (timezone !== undefined) updates.push(runQuery(supabase.from('app_settings').update({ timezone }).eq('id', 1)))
            await Promise.all(updates)
            return result({ updated: true })
          },
        )

        server.registerTool(
          'request_partner_connection',
          {
            title: 'Invite a partner account',
            description: writeDescription('Send a couple-connection request to the partner’s existing StepByStep account by email. This reveals no account identifiers; the partner must accept the request.'),
            inputSchema: z.object({ partner_email: z.email().max(254) }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ partner_email }) => result(await runRpc(supabase, 'request_couple_link', { p_email: partner_email })),
        )

        server.registerTool(
          'decide_partner_connection',
          {
            title: 'Accept or decline partner connection',
            description: writeDescription('Accept or decline a pending connection request addressed to the signed-in account. Accepting joins the two accounts into a couple and creates their shared categories.'),
            inputSchema: z.object({ request_id: z.uuid(), accept: z.boolean() }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          },
          async ({ request_id, accept }) => result(await runRpc(supabase, 'decide_couple_link', { p_request_id: request_id, p_accept: accept })),
        )

        return server
      })

      return handler.fetch(request)
    },
  ),
)
