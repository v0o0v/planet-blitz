# Planet Blitz - apply 20260805000000_daily_reward.sql to the remote project.
#
# ADR-0048 slice 1. What the migration installs:
#   1. profiles columns x3 - daily_last_claim_seed / daily_streak / lifetime_granted
#      plus a ONE-SHOT backfill (current balance is a strict lower bound of lifetime grants)
#   2. seal revision - guard_profiles_client_write 9->12, guard_profiles_client_insert 3->6
#   3. daily_reward_claims - claim ledger + equipment mailbox, composite PK, select-only RLS
#   4. currency_grants AFTER INSERT trigger -> lifetime_granted bump (the ceiling anchor),
#      filtered by `when (new.source <> 'daily_reward')` so the reward cannot feed its own cap
#   5. daily_reward_preview_for / claim_daily_reward_for - service_role only
#   6. mark_daily_reward_applied / mark_daily_reward_hold - authenticated
#   7. grant_currency_for revision - registers the 'daily_reward' per-call cap
#
# Everything is additive and re-runnable (add column if not exists / create table if not
# exists / create or replace function / drop policy|trigger if exists -> create). The
# backfill is guarded by `where lifetime_granted = 0`, so a re-run never lowers an anchor
# that has already grown.
#
# IMPORTANT: this script runs every statement as `postgres`, and both guard functions
# short-circuit on is_service_role() by design. So it can only show that the guards
# EXIST - never that they BITE. Run scripts\prove-daily-reward-seal.ps1 afterwards to see
# a forged client write bounce, and scripts\prove-daily-reward-cap.ps1 to see the ceiling
# clamp and the anchor refuse to self-feed.
#
# To roll back: scripts\rollback-daily-reward-migration.ps1 (it slices the previous
# function bodies out of the migration tree instead of retyping them by hand).
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-daily-reward-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260805000000'
$name    = 'daily_reward'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260805000000_daily_reward.sql'

if (-not (Test-Path $file)) { throw "migration file not found: $file" }

$tokenFile = Join-Path $env:USERPROFILE '.supabase-pb.token'
if (-not (Test-Path $tokenFile)) { throw "token file not found: $tokenFile" }
$sec  = Get-Content $tokenFile | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$pat  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$hdr  = @{ Authorization = "Bearer $pat" }
$utf8 = [Text.Encoding]::UTF8

$proj = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref" -Headers $hdr -Method Get
if ($proj.name -notmatch 'planet') { throw "refusing: project name '$($proj.name)' does not look like Planet Blitz" }
Write-Host "[OK] target project: $($proj.name) ($ref)"

function Invoke-Sql([string]$sql) {
  # UTF-8 BYTES, not a string. Sending the string mangles the Korean comments and
  # the server answers 400 at a byte offset, which reads like a SQL error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- preconditions -----------------------------------------------------------
# The migration revises grant_currency_for and hangs a trigger on currency_grants.
# Both must already exist (20260803000000 applied).
$pre = Invoke-Sql @"
select (select count(*) from pg_proc p where p.proname = 'grant_currency_for'
          and p.pronamespace = 'public'::regnamespace)                    as grant_for_fn,
       (select count(*) from pg_class where oid = to_regclass('public.currency_grants')) as grants_tbl,
       (select count(*) from public.profiles)                             as profiles;
"@
Write-Host ("[OK] before: grant_currency_for={0} currency_grants={1} profiles={2}" -f `
  $pre.grant_for_fn, $pre.grants_tbl, $pre.profiles)
if ([int]$pre.grant_for_fn -ne 1) { throw "refusing: grant_currency_for does not exist yet (apply 20260803000000 first)" }
if ([int]$pre.grants_tbl  -ne 1)  { throw "refusing: currency_grants does not exist yet" }

# NOT Get-Content -Raw (mangles the Korean comments).
$sql = [IO.File]::ReadAllText((Resolve-Path $file), $utf8)
Write-Host "[..] applying $version`_$name ($($sql.Length) chars)"
Invoke-Sql $sql | Out-Null
Write-Host "[OK] migration applied"

Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$version', '$name') on conflict (version) do nothing;
"@ | Out-Null
Write-Host "[OK] recorded in schema_migrations"

# --- verification ------------------------------------------------------------
Write-Host ""
Write-Host "--- verification (postgres role: presence only, never bite) ---"
$bad = 0

# 1. the three profiles columns.
$cols = Invoke-Sql @"
select count(*)::text as n
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('daily_last_claim_seed', 'daily_streak', 'lifetime_granted');
"@
Write-Host ("[OK] profiles columns present: {0}/3" -f $cols.n)
if ([int]$cols.n -ne 3) { Write-Host "[FAIL] expected 3 new profiles columns"; $bad++ }

# 2. claim ledger: exists, RLS on, exactly one policy and it is SELECT.
#    A write policy here would let a client forge its own claim rows, and the composite
#    PK is the ONLY structural defence against claiming twice in a day.
$tbl = Invoke-Sql @"
select c.relrowsecurity                                                     as rls_on,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'daily_reward_claims')          as policy_count,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'daily_reward_claims'
           and cmd = 'SELECT')                                                       as select_policies,
       (select count(*) from pg_indexes
         where schemaname = 'public' and tablename = 'daily_reward_claims'
           and indexdef ilike '%applied_at is null%')                                as pending_idx,
       (select count(*) from pg_constraint
         where conrelid = 'public.daily_reward_claims'::regclass and contype = 'p')  as pk
  from pg_class c
 where c.oid = 'public.daily_reward_claims'::regclass;
"@
if ($null -eq $tbl) { Write-Host "[FAIL] daily_reward_claims table missing"; $bad++ }
else {
  Write-Host ("[OK] daily_reward_claims: rls={0} policies={1} (select={2}) pending_idx={3} pk={4}" -f `
    $tbl.rls_on, $tbl.policy_count, $tbl.select_policies, $tbl.pending_idx, $tbl.pk)
  if (-not $tbl.rls_on)                { Write-Host "[FAIL] RLS is off";                     $bad++ }
  if ([int]$tbl.policy_count -ne 1)    { Write-Host "[FAIL] expected exactly 1 policy";      $bad++ }
  if ([int]$tbl.select_policies -ne 1) { Write-Host "[FAIL] the policy is not SELECT-only";  $bad++ }
  if ([int]$tbl.pending_idx -lt 1)     { Write-Host "[FAIL] partial pending index missing";  $bad++ }
  if ([int]$tbl.pk -ne 1)              { Write-Host "[FAIL] composite primary key missing";  $bad++ }
}

# 3. the anchor trigger AND its source filter. The filter is the load-bearing part:
#    without it the reward's own credits push the ceiling that bounds it.
$trg = Invoke-Sql @"
select (select count(*) from pg_trigger
         where tgname = 'trg_currency_grants_anchor' and not tgisinternal)      as trg,
       (select bool_or(pg_get_triggerdef(t.oid) like '%new.source <> ''daily_reward''%')
          from pg_trigger t where t.tgname = 'trg_currency_grants_anchor')      as has_filter,
       (select bool_or(pg_get_functiondef(p.oid) like '%exception when others%')
          from pg_proc p where p.proname = 'trg_daily_reward_anchor_bump'
           and p.pronamespace = 'public'::regnamespace)                         as subtransaction;
"@
Write-Host ("[OK] anchor trigger: present={0} source_filter={1} subtransaction={2}" -f `
  $trg.trg, $trg.has_filter, $trg.subtransaction)
if ([int]$trg.trg -ne 1)      { Write-Host "[FAIL] trg_currency_grants_anchor not installed"; $bad++ }
if (-not $trg.has_filter)     { Write-Host "[FAIL] the WHEN source filter is missing - the reward would feed its own ceiling"; $bad++ }
if (-not $trg.subtransaction) { Write-Host "[FAIL] the trigger body is not wrapped - one exception rolls back every settlement"; $bad++ }

# 4. RPC surface: claim/preview must be service_role only; mark_* stay authenticated.
$acl = Invoke-Sql @"
select (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'claim_daily_reward_for' and p.pronamespace = 'public'::regnamespace)  as claim_auth,
       (select has_function_privilege('service_role', p.oid, 'execute') from pg_proc p
         where p.proname = 'claim_daily_reward_for' and p.pronamespace = 'public'::regnamespace)  as claim_svc,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'daily_reward_preview_for' and p.pronamespace = 'public'::regnamespace) as prev_auth,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'mark_daily_reward_applied' and p.pronamespace = 'public'::regnamespace) as mark_auth,
       (select count(*) from pg_proc p
         where p.proname = 'claim_daily_reward' and p.pronamespace = 'public'::regnamespace)      as wrapper;
"@
Write-Host ("[OK] rpc acl: claim(auth={0} svc={1}) preview(auth={2}) mark(auth={3}) wrapper={4}" -f `
  $acl.claim_auth, $acl.claim_svc, $acl.prev_auth, $acl.mark_auth, $acl.wrapper)
if ($acl.claim_auth)        { Write-Host "[FAIL] authenticated CAN execute claim_daily_reward_for";   $bad++ }
if (-not $acl.claim_svc)    { Write-Host "[FAIL] service_role cannot execute claim_daily_reward_for"; $bad++ }
if ($acl.prev_auth)         { Write-Host "[FAIL] authenticated CAN execute daily_reward_preview_for"; $bad++ }
if (-not $acl.mark_auth)    { Write-Host "[FAIL] authenticated cannot execute mark_daily_reward_applied"; $bad++ }
if ([int]$acl.wrapper -ne 0){ Write-Host "[FAIL] an authenticated claim_daily_reward wrapper exists";  $bad++ }

# 5. grant_currency_for: the daily_reward per-call cap is registered in the LIVE
#    definition, and the client allowlist was NOT widened.
$fn = Invoke-Sql @"
select (select bool_or(pg_get_functiondef(p.oid) like '%CAP_DAILY_REWARD_CREDITS%')
          from pg_proc p where p.proname = 'grant_currency_for'
           and p.pronamespace = 'public'::regnamespace)                       as has_daily_cap,
       (select bool_or(pg_get_functiondef(p.oid) like '%CAP_COMMISSION_CREDITS%')
          from pg_proc p where p.proname = 'grant_currency_for'
           and p.pronamespace = 'public'::regnamespace)                       as kept_commission_cap,
       (select bool_or(pg_get_functiondef(p.oid) like '%daily_reward%')
          from pg_proc p where p.proname = 'grant_currency'
           and p.pronamespace = 'public'::regnamespace)                       as client_allowlist_widened;
"@
Write-Host ("[OK] grant_currency_for: daily_cap={0} commission_cap_kept={1} client_allowlist_widened={2}" -f `
  $fn.has_daily_cap, $fn.kept_commission_cap, $fn.client_allowlist_widened)
if (-not $fn.has_daily_cap)       { Write-Host "[FAIL] no daily_reward per-call cap - grants clamp silently to 1000"; $bad++ }
if (-not $fn.kept_commission_cap) { Write-Host "[FAIL] the revision dropped an existing cap constant"; $bad++ }
if ($fn.client_allowlist_widened) { Write-Host "[FAIL] the client entry point now accepts daily_reward"; $bad++ }

# 6. backfill: how many anchors actually got a value.
#    A zero here on a non-empty table means every existing player starts at the FLOOR
#    ceiling, which is exactly what the backfill exists to prevent.
$bf = Invoke-Sql @"
select (select count(*)::text from public.profiles)                            as total,
       (select count(*)::text from public.profiles where lifetime_granted > 0) as backfilled,
       (select count(*)::text from public.profiles
         where lifetime_granted < coalesce(credits, 0) + coalesce(minerals, 0) * 8) as below_lower_bound,
       (select coalesce(max(lifetime_granted), 0)::text from public.profiles)  as max_anchor;
"@
Write-Host ("[OK] backfill: {0}/{1} profiles have lifetime_granted > 0 (max={2})" -f `
  $bf.backfilled, $bf.total, $bf.max_anchor)
if ([int]$bf.below_lower_bound -ne 0) {
  Write-Host ("[FAIL] {0} profiles sit below the balance lower bound - the backfill did not run" -f $bf.below_lower_bound)
  $bad++
}
if ([int]$bf.total -gt 0 -and [int]$bf.backfilled -eq 0) {
  Write-Host "[WARN] no profile got a positive anchor - expected only if every balance is 0"
}

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] the daily reward schema is live on the remote project."
Write-Host "[NEXT] run scripts\prove-daily-reward-seal.ps1 and scripts\prove-daily-reward-cap.ps1 -"
Write-Host "       this script ran every statement as postgres, which shows the guards exist"
Write-Host "       but never that they bite."
