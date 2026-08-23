-- Identity inserts need sequence privileges in addition to table INSERT.
-- Keep the sequence private to service_role; this is not a read/write grant
-- for the analytics table itself.
grant usage, select on sequence public.extension_operational_events_id_seq to service_role;
