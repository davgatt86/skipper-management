-- ============================================================
-- add_boat_owner.sql — Stage 2 prerequisite (run once)
--
-- Adds an `is_owner` flag to app_users and marks YOU as the
-- site owner. Only owners see the "Add boat" button and only
-- owners can call the create-fleet function. Every fleet's
-- skipper still has role='skipper', so this flag is what sets
-- you (the host) apart from the skippers of other boats.
-- ============================================================

alter table public.app_users
  add column if not exists is_owner boolean not null default false;

-- Flag yourself as owner. Change the email if you sign in with a
-- different one than the AUDACIOUS BF83 skipper login.
update public.app_users
   set is_owner = true
 where lower(email) = lower('davgatt86@gmail.com');

-- Check it took (should show your row with is_owner = true):
select email, display_name, role, is_owner
from public.app_users
where is_owner = true;
