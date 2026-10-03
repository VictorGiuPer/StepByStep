begin;

create or replace function public.save_todo(p_todo_id uuid, p_name text, p_icon text, p_category_id uuid, p_scope text, p_size text)
returns public.todos language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  existing public.todos%rowtype;
  result public.todos%rowtype;
  couple uuid := private.current_couple_id(actor);
begin
  if couple is null then raise exception 'Connect with your partner before creating to-dos' using errcode = '42501'; end if;
  perform 1 from public.categories where id = p_category_id and couple_id = couple;
  if not found then raise exception 'Choose a category' using errcode = '22023'; end if;
  if p_scope not in ('personal','shared') or p_size not in ('small','medium','large') then raise exception 'Invalid to-do' using errcode = '22023'; end if;

  if p_todo_id is null then
    insert into public.todos(couple_id,name,icon,category_id,scope,owner_user_id,size,base_points)
    values (couple,trim(p_name),coalesce(nullif(trim(p_icon),''),'ListTodo'),p_category_id,p_scope,
      case when p_scope = 'personal' then actor else null end,p_size,
      case p_size when 'small' then 1 when 'medium' then 2 else 3 end)
    returning * into result;
  else
    select * into existing from public.todos where id = p_todo_id and couple_id = couple for update;
    if not found then raise exception 'To-do not found' using errcode = 'P0002'; end if;
    if existing.scope = 'personal' and existing.owner_user_id <> actor then
      raise exception 'Only the owner can edit this personal to-do' using errcode = '42501';
    end if;
    update public.todos set
      name = trim(p_name), icon = coalesce(nullif(trim(p_icon),''),'ListTodo'), category_id = p_category_id,
      scope = p_scope, owner_user_id = case when p_scope = 'personal' then actor else null end,
      size = p_size, base_points = case p_size when 'small' then 1 when 'medium' then 2 else 3 end
    where id = p_todo_id returning * into result;
  end if;
  return result;
end; $$;

commit;
