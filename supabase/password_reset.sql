-- Every password-reset request, whether or not a link went out.
-- Applied Sep 2026 as migration `password_reset_requests`.
--
-- WHY A TABLE AT ALL. Two reasons, and the second is the one that made it
-- worth a migration rather than a counter in memory:
--
-- 1. A COOLDOWN NEEDS SOMEWHERE TO LIVE. Without one, anybody who knows a
--    skipper's email can post the endpoint in a loop and bury his inbox.
--    `auth.users.recovery_sent_at` looks like the obvious place -- but this
--    project sends its OWN mail (CloudMailin, the same path as the alert
--    digest) rather than Supabase's built-in mailer, so whether generateLink
--    moves that column is behaviour nobody here has watched. This repo has
--    been caught twice believing an unobserved thing worked; a column we write
--    ourselves is a fact we can check.
--
-- 2. NOTHING ELSE RECORDS THIS. `auth.audit_log_entries` is EMPTY on this
--    project (0 rows, checked Sep 2026), and the log service is not always
--    reachable -- it errored on every query the day this was written. So when
--    a skipper says "I asked for a reset and nothing came", there was no way
--    on earth to tell whether he had. There is now.
--
-- SERVICE ROLE ONLY. RLS on and NOT ONE POLICY, plus the grants revoked --
-- Supabase's default ACL hands `arwdDxtm` to `authenticated` on every new
-- table, so an absent policy is not on its own a lock. Nobody signed in can
-- read this: it would otherwise say which addresses have accounts, which is
-- exactly what the endpoint itself refuses to tell anyone.
create table if not exists public.password_reset_requests (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  requested_at timestamptz not null default now(),
  -- Did a link actually go? A request that was refused, or that failed to
  -- send, must not read like one that arrived.
  sent         boolean not null default false,
  -- 'sent' | 'no account' | 'demo' | 'cooldown' | 'send failed'
  outcome      text not null,
  ip           text
);

create index if not exists prr_email_idx
  on public.password_reset_requests (lower(email), requested_at desc);

alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from authenticated, anon;

-- No entry is needed in officer_role.sql or cook_role.sql. Those files deny
-- every table outside their allow-lists with a restrictive policy, which is
-- the right answer here -- this table is denied to everyone but the service
-- key, and a redundant denial costs nothing.
