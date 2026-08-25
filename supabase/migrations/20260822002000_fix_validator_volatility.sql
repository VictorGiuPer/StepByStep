begin;

alter function private.validate_custom_days(text, jsonb) stable;

commit;
