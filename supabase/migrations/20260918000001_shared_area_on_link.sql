begin;

create or replace function public.decide_couple_link(p_request_id uuid, p_accept boolean)
returns public.couple_link_requests language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); request_row public.couple_link_requests%rowtype; new_couple uuid;
begin
  select * into request_row from public.couple_link_requests where id = p_request_id for update;
  if not found or request_row.requested_to <> actor then raise exception 'Connection request not found' using errcode = 'P0002'; end if;
  if request_row.status <> 'pending' then raise exception 'This connection request has already been decided' using errcode = '55000'; end if;
  if private.current_couple_id(actor) is not null or private.current_couple_id(request_row.requested_by) is not null then raise exception 'One of these accounts is already connected' using errcode = '55000'; end if;
  if p_accept then
    insert into public.couples default values returning id into new_couple;
    insert into public.couple_members (couple_id, user_id) values (new_couple, actor), (new_couple, request_row.requested_by);
    insert into public.categories (couple_id, name, icon, color, sort_order, scope, owner_user_id)
    values (new_couple, 'Shared', 'HeartHandshake', '#758BFD', 0, 'shared', null);
  end if;
  update public.couple_link_requests set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now() where id = p_request_id returning * into request_row;
  return request_row;
end;
$$;

commit;
