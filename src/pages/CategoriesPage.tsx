import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  ChevronRight,
  Edit3,
  ListTodo,
  Plus,
  Shapes,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { friendlyError, toggleTodo } from "@/lib/points";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/demo";
import type { AppSnapshot, Category, Habit, Todo } from "@/types";
import { AppIcon, iconNames } from "@/components/AppIcon";
import { HabitModal } from "@/components/HabitModal";
import {
  Button,
  EmptyState,
  inputClass,
  Label,
  Modal,
  Notice,
} from "@/components/ui";

interface CategoryModalProps {
  open: boolean;
  onClose: () => void;
  category: Category | null;
  snapshot: AppSnapshot;
  userId: string;
}

function CategoryModalContent({
  open,
  onClose,
  category,
  snapshot,
  userId,
}: CategoryModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "Shapes");
  const [color, setColor] = useState(category?.color ?? "#758BFD");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        icon,
        color,
        sort_order:
          category?.sort_order ??
          Math.max(0, ...snapshot.categories.map((item) => item.sort_order)) +
            1,
        ...(category ? {} : { created_by: userId }),
      };
      if (isDemoMode) return;
      const result = category
        ? await supabase
            .from("categories")
            .update(payload)
            .eq("id", category.id)
        : await supabase.from("categories").insert(payload);
      if (result.error) throw friendlyError(result.error);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["snapshot", userId] });
      onClose();
    },
    onError: (reason) => setError((reason as Error).message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (isDemoMode) return;
      const { error: removeError } = await supabase
        .from("categories")
        .delete()
        .eq("id", category!.id);
      if (removeError) throw friendlyError(removeError);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["snapshot", userId] });
      onClose();
    },
    onError: (reason) => setError((reason as Error).message),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? "Edit category" : "Add category"}
      description="A simple label for the habits you want to manage together."
      size="sm"
    >
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setError("");
          mutation.mutate();
        }}
      >
        <div>
          <Label htmlFor="category-name">Name</Label>
          <input
            id="category-name"
            className={inputClass}
            required
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="category-icon">Icon</Label>
          <div className="flex gap-2">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-2xl text-white"
              style={{ backgroundColor: color }}
            >
              <AppIcon name={icon} />
            </span>
            <select
              id="category-icon"
              className={inputClass}
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
            >
              {iconNames.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="category-color">Colour</Label>
          <div className="flex gap-2">
            <input
              id="category-color"
              type="color"
              className="h-11 w-14 rounded-2xl border-0 bg-white p-1"
              value={color}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
            <input
              className={inputClass}
              pattern="^#[0-9A-Fa-f]{6}$"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </div>
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2 pt-2">
          {category && (
            <Button
              type="button"
              variant="danger"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              <Trash2 size={16} /> Delete
            </Button>
          )}
          <Button
            type="submit"
            className="ml-auto"
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save category"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryModal(props: CategoryModalProps) {
  return props.open ? (
    <CategoryModalContent key={props.category?.id ?? "new"} {...props} />
  ) : null;
}
function TodoModal({
  todo,
  snapshot,
  userId,
  onClose,
}: {
  todo: Todo | null;
  snapshot: AppSnapshot;
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const sharedArea = snapshot.categories.find(
    (category) => category.scope === "shared",
  );
  const [name, setName] = useState(todo?.name ?? "");
  const [size, setSize] = useState(todo?.size ?? "small");
  const [icon, setIcon] = useState(todo?.icon ?? "ListTodo");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (!sharedArea)
        throw new Error("Connect accounts to create shared to-dos.");
      const { error: rpcError } = await supabase.rpc("save_todo", {
        p_todo_id: todo?.id ?? null,
        p_name: name.trim(),
        p_icon: icon,
        p_category_id: sharedArea.id,
        p_scope: "shared",
        p_size: size,
      });
      if (rpcError) throw friendlyError(rpcError);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["snapshot", userId] });
      onClose();
    },
    onError: (reason) => setError((reason as Error).message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={todo ? "Edit to-do" : "Add a to-do"}
      description="One-off tasks earn points once when you finish them."
      size="sm"
    >
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setError("");
          save.mutate();
        }}
      >
        <div>
          <Label htmlFor="todo-name">To-do</Label>
          <input
            id="todo-name"
            className={inputClass}
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Book the dentist"
          />
        </div>
        <div>
          <Label htmlFor="todo-size">Size</Label>
          <select
            id="todo-size"
            className={inputClass}
            value={size}
            onChange={(event) => setSize(event.target.value as Todo["size"])}
          >
            <option value="small">Small · 1 point</option>
            <option value="medium">Medium · 2 points</option>
            <option value="large">Large · 3 points</option>
          </select>
        </div>
        <div>
          <Label htmlFor="todo-icon">Icon</Label>
          <select
            id="todo-icon"
            className={inputClass}
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
          >
            {iconNames.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        {error && <Notice>{error}</Notice>}
        <Button
          type="submit"
          className="w-full"
          disabled={!name.trim() || !sharedArea || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save to-do"}
        </Button>
      </form>
    </Modal>
  );
}

function TodoSection({
  snapshot,
  userId,
  onEdit,
  onAdd,
}: {
  snapshot: AppSnapshot;
  userId: string;
  onEdit: (todo: Todo) => void;
  onAdd: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const toggle = useMutation({
    mutationFn: (todoId: string) => toggleTodo(supabase, todoId),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["snapshot", userId] }),
    onError: (reason) => setError((reason as Error).message),
  });
  const remove = useMutation({
    mutationFn: async (todoId: string) => {
      const { error: rpcError } = await supabase.rpc("delete_todo", {
        p_todo_id: todoId,
      });
      if (rpcError) throw friendlyError(rpcError);
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["snapshot", userId] }),
    onError: (reason) => setError((reason as Error).message),
  });
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-ink/40">
            To-dos
          </p>
          <h2 className="font-black">One-off tasks</h2>
        </div>
        <Button variant="accent" size="sm" onClick={onAdd}>
          <Plus size={15} /> Add to-do
        </Button>
      </div>
      {error && (
        <div className="mb-3">
          <Notice>{error}</Notice>
        </div>
      )}
      {snapshot.todos.length ? (
        <div className="space-y-2">
          {snapshot.todos.map((todo) => {
            const complete = snapshot.todoCompletions.some(
              (item) => item.todo_id === todo.id && item.user_id === userId,
            );
            return (
              <div
                key={todo.id}
                className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 shadow-soft"
              >
                <Button
                  size="icon"
                  variant={complete ? "secondary" : "primary"}
                  onClick={() => toggle.mutate(todo.id)}
                  disabled={toggle.isPending}
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
                    +{todo.base_points} points · Shared
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onEdit(todo)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove.mutate(todo.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<ListTodo />}
          title="No to-dos yet"
          body="Add the next one-off thing you want to get done."
        />
      )}
    </section>
  );
}

function scheduleLabel(habit: Habit) {
  return habit.frequency === "daily"
    ? "Daily"
    : habit.frequency === "weekly"
      ? "Weekly"
      : `${habit.custom_days?.length ?? 0} times/week`;
}

export function CategoriesPage({
  snapshot,
  userId,
}: {
  snapshot: AppSnapshot;
  userId: string;
}) {
  const [filter, setFilter] = useState("all");
  const [categoryModal, setCategoryModal] = useState<Category | null | "new">(
    null,
  );
  const [habitModal, setHabitModal] = useState<Habit | null | "new">(null);
  const [todoModal, setTodoModal] = useState<Todo | null | "new">(null);
  const [habitState, setHabitState] = useState<"active" | "archived">("active");
  const habits = snapshot.habits.filter(
    (habit) =>
      (habitState === "archived" ? habit.archived : !habit.archived) &&
      (filter === "all" || habit.category_id === filter),
  );
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-extrabold text-action">Keep it simple</p>
        <h1 className="mt-1 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
          Manage
        </h1>
        <p className="mt-1 text-sm leading-6 text-ink/55">
          Set up your categories and habits here. Today stays focused on doing
          them.
        </p>
      </div>
      <TodoSection
        snapshot={snapshot}
        userId={userId}
        onAdd={() => setTodoModal("new")}
        onEdit={(todo) => setTodoModal(todo)}
      />
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-ink/40">
              Categories
            </p>
            <h2 className="font-black">Your areas</h2>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCategoryModal("new")}
          >
            <Shapes size={15} /> Add category
          </Button>
        </div>
        {snapshot.categories.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.categories.map((category) => {
              const count = snapshot.habits.filter(
                (habit) => habit.category_id === category.id && !habit.archived,
              ).length;
              return (
                <div
                  key={category.id}
                  className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 shadow-soft"
                >
                  <span
                    className="grid size-10 place-items-center rounded-xl text-white"
                    style={{ backgroundColor: category.color }}
                  >
                    <AppIcon name={category.icon} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black">
                      {category.name}
                    </p>
                    <p className="text-xs font-bold text-ink/45">
                      {count} habit{count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${category.name}`}
                    onClick={() => setCategoryModal(category)}
                  >
                    <Edit3 size={17} />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Shapes />}
            title="Create your first category"
            body="Start with one useful area, then add habits underneath it."
            action={
              <Button onClick={() => setCategoryModal("new")}>
                Add category
              </Button>
            }
          />
        )}
      </section>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-ink/40">
              Habits
            </p>
            <h2 className="font-black">Edit your routines</h2>
          </div>
          <div className="flex gap-2">
            <Button
              variant={habitState === "archived" ? "secondary" : "ghost"}
              size="sm"
              onClick={() =>
                setHabitState((value) =>
                  value === "active" ? "archived" : "active",
                )
              }
            >
              <Archive size={15} />{" "}
              {habitState === "archived" ? "Active habits" : "Archived"}
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={() => setHabitModal("new")}
            >
              <Plus size={15} /> Add habit
            </Button>
          </div>
        </div>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilter("all")}
            className={clsx(
              "shrink-0 rounded-xl px-3 py-2 text-xs font-black",
              filter === "all"
                ? "bg-action text-white shadow-action"
                : "bg-white text-ink/50",
            )}
          >
            All habits
          </button>
          {snapshot.categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setFilter(category.id)}
              className={clsx(
                "shrink-0 rounded-xl px-3 py-2 text-xs font-black",
                filter === category.id
                  ? "text-white shadow-action"
                  : "bg-white text-ink/50",
              )}
              style={
                filter === category.id
                  ? { backgroundColor: category.color }
                  : undefined
              }
            >
              {category.name}
            </button>
          ))}
        </div>
        {habits.length ? (
          <div className="space-y-2">
            {habits.map((habit) => {
              const category = snapshot.categories.find(
                (item) => item.id === habit.category_id,
              );
              return (
                <button
                  key={habit.id}
                  onClick={() => setHabitModal(habit)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white px-3 py-2.5 text-left shadow-soft transition hover:-translate-y-0.5"
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-xl text-white"
                    style={{ backgroundColor: category?.color }}
                  >
                    <AppIcon name={habit.icon} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black">
                      {habit.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-bold text-ink/45">
                      {category?.name} · {scheduleLabel(habit)} · +
                      {habit.base_points}
                    </span>
                  </span>
                  {habit.archived && (
                    <span className="rounded-full bg-app-bg px-2 py-1 text-[10px] font-black text-ink/45">
                      Archived
                    </span>
                  )}
                  <ChevronRight size={18} className="text-ink/35" />
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Archive />}
            title={
              habitState === "archived"
                ? "No archived habits"
                : "No habits in this view"
            }
            body={
              habitState === "archived"
                ? "Archive a habit from its editor when you no longer want it on Today."
                : "Choose another filter or add the first habit when you’re ready."
            }
            action={
              habitState === "active" ? (
                <Button onClick={() => setHabitModal("new")}>Add habit</Button>
              ) : undefined
            }
          />
        )}
      </section>
      <CategoryModal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        category={categoryModal === "new" ? null : categoryModal}
        snapshot={snapshot}
        userId={userId}
      />
      {todoModal && (
        <TodoModal
          todo={todoModal === "new" ? null : todoModal}
          snapshot={snapshot}
          userId={userId}
          onClose={() => setTodoModal(null)}
        />
      )}
      <HabitModal
        open={habitModal !== null}
        onClose={() => setHabitModal(null)}
        habit={habitModal === "new" ? null : habitModal}
        snapshot={snapshot}
        userId={userId}
        initialCategoryId={
          filter === "all" ? snapshot.categories[0]?.id : filter
        }
      />
    </div>
  );
}
