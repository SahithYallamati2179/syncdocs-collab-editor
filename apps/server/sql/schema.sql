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
  -- Display name of whoever edited last before this snapshot was taken. A
  -- label for the history view, not an authorisation fact.
  author        text not null default '',
  created_at    timestamptz not null default now()
);

-- Upgrade path for a database created before author tracking. Safe to re-run.
alter table document_snapshots
  add column if not exists author text not null default '';

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
  -- What the bare URL grants on its own: 'restricted' (nothing -- owner and
  -- invited members only), 'view', or 'edit'. Defaulting to 'restricted'
  -- matters on upgrade: a document that predates link sharing was shared with
  -- nobody and must not become link-readable just because the column appeared.
  link_access   text not null default 'restricted'
                check (link_access in ('restricted', 'view', 'edit')),
  created_at    timestamptz not null default now()
);

-- Upgrade path for a database created before link sharing. Safe to re-run.
alter table document_access
  add column if not exists link_access text not null default 'restricted';

do $$
begin
  alter table document_access
    add constraint document_access_link_access_check
    check (link_access in ('restricted', 'view', 'edit'));
exception
  when duplicate_object then null;
end $$;

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
