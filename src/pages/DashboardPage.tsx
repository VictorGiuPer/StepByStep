import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  Gift,
  ListTodo,
  Minus,
  Plus,
} from "lucide-react";
import clsx from "clsx";
import {
  addDays,
  completionForInterval,
  dateKeyInTimeZone,
  formatDate,
  formatFullDate,
  isHabitDue,
  weeklyProgressCount,
} from "@/lib/date";
import {
  adjustWeeklyHabit,
  decideRedemption,
  toggleHabitCompletion,
  toggleTodo,
} from "@/lib/points";
import { supabase } from "@/lib/supabase";
import { activeTodoCompletion, isTodoVisibleToday } from "@/lib/todos";
import { categoryLabel } from "@/lib/categories";
import type { AppSnapshot, Habit, Redemption } from "@/types";
import { AppIcon } from "@/components/AppIcon";
import { HabitCard } from "@/components/HabitCard";
import { Button, EmptyState, Notice } from "@/components/ui";

type PreviewComplete = (habitId: string) => {
  base_points_awarded: number;
  streak_bonus_awarded: number;
};
type PreviewUndo = (habitId: string) => void;
type PreviewDecision = (
  redemptionId: string,
  decision: "confirmed" | "declined",
  reason?: string,
) => void;

function RhythmStrip({
  snapshot,
  userId,
  start,
  onPrevious,
  onNext,
}: {
  snapshot: AppSnapshot;
  userId: string;
  start: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <section className="rounded-[26px] bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-ink/40">
            Your rhythm
          </p>
          <h2 className="mt-0.5 font-black">This week</h2>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous week"
            onClick={onPrevious}
          >
            <ChevronLeft size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next week"
            onClick={onNext}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {dates.map((date) => {
          const due = snapshot.habits.filter((habit) =>
            !habit.weekly_target && isHabitDue(habit, date, userId, snapshot.schedules),
          );
          const complete = due.filter((habit) =>
            completionForInterval(
              habit.id,
              userId,
              date,
              snapshot.schedules,
              snapshot.completions,
            ),
          ).length;
          return (
            <div
              key={date}
              className="min-w-0 rounded-xl bg-app-bg px-1 py-2 text-center"
            >
              <p className="text-[10px] font-black text-ink/45">
                {formatDate(date, { weekday: "narrow" })}
              </p>
              <p className="mt-1 text-sm font-black">
                {formatDate(date, { day: "numeric" })}
              </p>
              <div
                className={clsx(
                  "mx-auto mt-1 h-1.5 w-7 rounded-full",
                  due.length && complete === due.length
                    ? "bg-emerald-500"
                    : complete
                      ? "bg-accent"
                      : due.length
                        ? "bg-surface"
                        : "bg-ink/10",
                )}
              />
              <p className="mt-1 text-[9px] font-bold text-ink/40">
                {due.length ? `${complete}/${due.length}` : "—"}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs font-bold text-ink/50">
        <Flame size={15} className="text-accent" fill="currentColor" />{" "}
        {
          snapshot.streaks.filter(
            (item) => item.user_id === userId && item.current_streak > 0,
          ).length
        }{" "}
        habits currently in rhythm
      </div>
    </section>
  );
}

function ApprovalAlert({
  redemption,
  snapshot,
  userId,
  onPreviewDecision,
}: {
  redemption: Redemption;
  snapshot: AppSnapshot;
  userId: string;
  onPreviewDecision?: PreviewDecision;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (decision: "confirmed" | "declined") =>
      onPreviewDecision
        ? Promise.resolve(onPreviewDecision(redemption.id, decision)).then(
            () => redemption,
          )
        : decideRedemption(supabase, redemption.id, decision),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["snapshot", userId] }),
    onError: (value) => setError((value as Error).message),
  });
  const requester =
    snapshot.profiles.find((profile) => profile.id === redemption.redeemed_by)
      ?.display_name ?? "Your partner";
  return (
    <div className="rounded-2xl bg-surface/50 p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-accent text-white">
          <Gift size={17} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-black">
          <span className="text-action">{requester}</span> wants{" "}
          {redemption.reward_name_snapshot}
        </p>
        <Button
          size="sm"
          onClick={() => mutation.mutate("confirmed")}
          disabled={mutation.isPending}
        >
          Confirm
        </Button>
      </div>
      {error && (
        <div className="mt-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  );
}

export function DashboardPage({
  snapshot,
  userId,
  onPreviewComplete,
  onPreviewDecision,
}: {
  snapshot: AppSnapshot;
  userId: string;
  onPreviewComplete?: PreviewComplete;
  onPreviewUndo?: PreviewUndo;
  onPreviewDecision?: PreviewDecision;
}) {
  const queryClient = useQueryClient();
  const today = dateKeyInTimeZone(snapshot.settings.timezone);
  const [rhythmStart, setRhythmStart] = useState(today);
  const [completeError, setCompleteError] = useState("");
  const complete = useMutation({
    mutationFn: (habitId: string) =>
      onPreviewComplete
        ? Promise.resolve(onPreviewComplete(habitId)).then(() => undefined)
        : toggleHabitCompletion(supabase, habitId, today),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["snapshot", userId] }),
    onError: (error) => setCompleteError((error as Error).message),
  });
  const todoToggle = useMutation({
    mutationFn: (todoId: string) => toggleTodo(supabase, todoId),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["snapshot", userId] }),
    onError: (error) => setCompleteError((error as Error).message),
  });
  const weeklyAdjust = useMutation({ mutationFn: ({ habitId, delta }: { habitId: string; delta: number }) => adjustWeeklyHabit(supabase, habitId, delta), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["snapshot", userId] }), onError: (error) => setCompleteError((error as Error).message) });
  const undo = complete;
  const dueHabits = useMemo(
    () =>
      snapshot.habits.filter(
        (habit) =>
          !habit.weekly_target &&
          isHabitDue(habit, today, userId, snapshot.schedules),
      ),
    [snapshot.habits, snapshot.schedules, today, userId],
  );
  const pendingIncoming = snapshot.redemptions.filter(
    (item) =>
      item.status === "pending_confirmation" && item.redeemed_by !== userId,
  );
  const remaining = dueHabits.filter(
    (habit) =>
      !completionForInterval(
        habit.id,
        userId,
        today,
        snapshot.schedules,
        snapshot.completions,
      ),
  ).length;
  const todos = snapshot.todos.filter((todo) =>
    isTodoVisibleToday(todo, userId, today, snapshot.todoCompletions),
  );
  const flexibleHabits = snapshot.habits.filter((habit) => !habit.archived && habit.weekly_target && (habit.scope === "shared" || habit.owner_user_id === userId));
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-extrabold text-action">
          {formatFullDate(today)}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
          Today
        </h1>
        <p className="mt-1 text-sm text-ink/55">
          {remaining
            ? `${remaining} small step${remaining === 1 ? "" : "s"} left.`
            : "Everything is complete. Lovely work."}
        </p>
      </div>
      {completeError && <Notice>{completeError}</Notice>}
      <section className="min-h-[18rem]">
        {dueHabits.length ? (
          <div className="space-y-2">
            {dueHabits.map((habit: Habit) => {
              const completed = Boolean(
                completionForInterval(
                  habit.id,
                  userId,
                  today,
                  snapshot.schedules,
                  snapshot.completions,
                ),
              );
              return (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  category={snapshot.categories.find(
                    (item) => item.id === habit.category_id,
                  )}
                  streak={
                    snapshot.streaks.find(
                      (item) =>
                        item.habit_id === habit.id && item.user_id === userId,
                    )?.current_streak ?? 0
                  }
                  completed={completed}
                  busy={complete.isPending || undo.isPending}
                  onComplete={() => {
                    setCompleteError("");
                    complete.mutate(habit.id);
                  }}
                  onUndo={
                    completed
                      ? () => {
                          setCompleteError("");
                          undo.mutate(habit.id);
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Flame />}
            title="Nothing due here"
            body="Try another category, or enjoy the breathing room."
          />
        )}
      </section>
      {flexibleHabits.length > 0 && <section><div className="mb-3 flex items-center gap-2"><Flame className="text-accent" size={18} /><h2 className="font-black">This week</h2></div><div className="space-y-2">{flexibleHabits.map((habit) => { const count = weeklyProgressCount(snapshot.weeklyProgress, habit.id, userId, today); const category = snapshot.categories.find((item) => item.id === habit.category_id); return <article key={habit.id} className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 shadow-soft"><span className="grid size-10 place-items-center rounded-xl text-white" style={{ backgroundColor: category?.color ?? "#758BFD" }}><AppIcon name={habit.icon} size={19} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{habit.name}</p><p className="text-xs font-bold text-action">{count} / {habit.weekly_target} this week</p></div><Button size="icon" variant="ghost" aria-label={`Decrease ${habit.name}`} onClick={() => weeklyAdjust.mutate({ habitId: habit.id, delta: -1 })} disabled={count === 0 || weeklyAdjust.isPending}><Minus size={17} /></Button><Button size="icon" aria-label={`Increase ${habit.name}`} onClick={() => weeklyAdjust.mutate({ habitId: habit.id, delta: 1 })} disabled={weeklyAdjust.isPending}><Plus size={18} /></Button></article> })}</div></section>}
      {todos.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <ListTodo size={18} className="text-action" />
            <h2 className="font-black">To-dos</h2>
          </div>
          <div className="space-y-2">
            {todos.map((todo) => {
              const completion = activeTodoCompletion(todo.id, userId, snapshot.todoCompletions);
              const complete = Boolean(completion);
              const category = snapshot.categories.find((item) => item.id === todo.category_id);
              return (
                <article
                  key={todo.id}
                  className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 shadow-soft"
                >
                  <Button
                    size="icon"
                    variant={complete ? "secondary" : "primary"}
                    onClick={() => todoToggle.mutate(todo.id)}
                    disabled={todoToggle.isPending}
                    aria-label={complete ? `Undo ${todo.name}` : `Complete ${todo.name}`}
                  >
                    <Check size={18} />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        complete
                          ? "truncate font-black text-ink/45 line-through"
                          : "truncate font-black"
                      }
                    >
                      {todo.name}
                    </p>
                    <p className="text-xs font-bold text-accent">
                      {category ? categoryLabel(category) : "Uncategorised"} · {todo.scope === "shared" ? "Shared" : "Personal"} · +{todo.base_points}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {pendingIncoming.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <BellRing size={16} className="text-accent" />
            <h2 className="font-black">One small thing</h2>
          </div>
          <div className="space-y-2">
            {pendingIncoming.map((item) => (
              <ApprovalAlert
                key={item.id}
                redemption={item}
                snapshot={snapshot}
                userId={userId}
                onPreviewDecision={onPreviewDecision}
              />
            ))}
          </div>
        </section>
      )}
      <RhythmStrip
        snapshot={snapshot}
        userId={userId}
        start={rhythmStart}
        onPrevious={() => setRhythmStart((value) => addDays(value, -7))}
        onNext={() => setRhythmStart((value) => addDays(value, 7))}
      />
    </div>
  );
}
