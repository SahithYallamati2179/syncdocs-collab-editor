-- Run once against your Postgres (the Supabase SQL editor works) before
-- setting STORAGE_DRIVER=postgres.

create table if not exists documents (
  name        text primary key,
  title       text not null default 'Untitled document',
  state       bytea not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Version history. Written on a slow interval (SNAPSHOT_INTERVAL_MS), not on
-- every edit, so this table stays small and can be pruned by age.
create table if not exists document_snapshots (
  id            bigserial primary key,
  document_name text not null references documents(name) on delete cascade,
  state         bytea not null,
  created_at    timestamptz not null default now()
);

create index if not exists document_snapshots_by_doc
  on document_snapshots (document_name, created_at desc);

-- Per-document access control, used when AUTH_MODE=supabase.
--
-- There is deliberately no foreign key to `documents`: the access record is
-- written the first time someone opens a document, which is before any content
-- has been persisted. Members are stored as lowercased emails because that is
-- the only identifier an owner knows about an invitee who has never signed in.
create table if not exists document_access (
  document_name text primary key,
  owner_id      text not null,
  owner_email   text not null default '',
  members       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists document_access_by_owner
  on document_access (owner_id);

-- Optional retention: keep the 20 most recent snapshots per document.
-- delete from document_snapshots s
--  where s.id not in (
--    select id from (
--      select id, row_number() over (partition by document_name order by created_at desc) rn
--        from document_snapshots
--    ) ranked where rn <= 20
--  );
