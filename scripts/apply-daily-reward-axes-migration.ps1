# Planet Blitz - apply 20260805020000_daily_reward_axes.sql to the remote project.
#
# ADR-0048 slice 2 (plan C7). What the migration installs:
#   1. grant_catalyst_for(uuid,int,int) - the catalyst grant BODY, moved behind an explicit
#      recipient so a service_role caller can use it. grant_catalyst(int,int) becomes a thin
#      wrapper that passes auth.uid(). The per-call cap, the 1h/24h ledger caps, the grant
#      ledger row and the flagging all stay in that one body - no second path around the cap.
#   2. grant_commission_for(uuid,int) - issue one commission at a GIVEN grade, honouring the
#      12-slot stock cap. It deliberately does NOT touch issue_commission_for_run's rate limit
#      or cooldown horizon: a daily login must not eat the settlement issue budget.
#   3. claim_daily_reward_for revision - the six-way axis dispatch.
#
# Everything is create-or-replace, so the script is re-runnable. No new tables or columns.
#
# LOCK ORDER (the one thing here that no test and no play-through can catch): the catalyst
# branch calls grant_catalyst_for BEFORE the side-credit grant_currency_for, which keeps
# catalyst_inventory -> profiles. Flipping those two lines makes it profiles ->
# catalyst_inventory, the exact inverse of buy_catalyst / salvage_catalyst, and opens a real
# ABBA deadlock. tests\dailyRewardContract.test.ts compares the two call sites by character
# position so the ordering cannot drift silently.
#
# IMPORTANT: every statement runs as `postgres`. That shows the functions EXIST with the
# right ACLs - never that the guards BITE. Run scripts\prove-daily-reward-cap.ps1 afterwards
# for the per-axis grant proofs.
#
# To roll back: scripts\rollback-daily-reward-axes-migration.ps1 (it slices the previous
# bodies out of the migration tree instead of retyping them by hand).
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII literals
# in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-daily-reward-axes-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260805020000'
$name    = 'daily_reward_axes'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260805020000_daily_reward_axes.sql'

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
  # UTF-8 BYTES, not a string. Sending the string mangles the Korean comments and the
  # server answers 400 at a byte offset, which reads like a SQL error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- preconditions -----------------------------------------------------------
# Slice 1 must be live (claim_daily_reward_for exists) and the tables the new branches
# write to must exist. Applying this on top of a missing slice 1 would create a
# claim function whose preview helper does not exist - it would compile and fail on first call.
$pre = Invoke-Sql @"
select (select count(*) from pg_proc p where p.proname = 'claim_daily_reward_for'
          and p.pronamespace = 'public'::regnamespace)                              as claim_fn,
       (select count(*) from pg_proc p where p.proname = 'grant_catalyst'
          and p.pronamespace = 'public'::regnamespace)                              as catalyst_fn,
       (select count(*) from pg_class where oid = to_regclass('public.defense_blueprints'))   as bp_tbl,
       (select count(*) from pg_class where oid = to_regclass('public.core_modules'))         as mod_tbl,
       (select count(*) from pg_class where oid = to_regclass('public.commission_inventory')) as com_tbl;
"@
Write-Host ("[OK] before: claim_fn={0} grant_catalyst={1} blueprints={2} modules={3} commissions={4}" -f `
  $pre.claim_fn, $pre.catalyst_fn, $pre.bp_tbl, $pre.mod_tbl, $pre.com_tbl)
if ([int]$pre.claim_fn    -ne 1) { throw "refusing: claim_daily_reward_for missing (apply 20260805000000 first)" }
if ([int]$pre.catalyst_fn -ne 1) { throw "refusing: grant_catalyst missing (apply 20260801000000 first)" }
if ([int]$pre.bp_tbl  -ne 1) { throw "refusing: defense_blueprints does not exist" }
if ([int]$pre.mod_tbl -ne 1) { throw "refusing: core_modules does not exist" }
if ([int]$pre.com_tbl -ne 1) { throw "refusing: commission_inventory does not exist" }

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

# 1. The two new functions exist with the right ACLs. Both are service_role only:
#    grant_catalyst_for takes a recipient, so an authenticated grant would be a way to
#    top up someone else's catalysts (or your own, past the client entry point).
$acl = Invoke-Sql @"
select (select has_function_privilege('service_role', p.oid, 'execute') from pg_proc p
         where p.proname = 'grant_catalyst_for' and p.pronamespace = 'public'::regnamespace)   as cat_svc,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'grant_catalyst_for' and p.pronamespace = 'public'::regnamespace)   as cat_auth,
       (select has_function_privilege('service_role', p.oid, 'execute') from pg_proc p
         where p.proname = 'grant_commission_for' and p.pronamespace = 'public'::regnamespace) as com_svc,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'grant_commission_for' and p.pronamespace = 'public'::regnamespace) as com_auth,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'grant_catalyst' and p.pronamespace = 'public'::regnamespace)       as wrapper_auth,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'claim_daily_reward_for' and p.pronamespace = 'public'::regnamespace) as claim_auth;
"@
Write-Host ("[OK] acl: catalyst_for(svc={0} auth={1}) commission_for(svc={2} auth={3}) wrapper_auth={4} claim_auth={5}" -f `
  $acl.cat_svc, $acl.cat_auth, $acl.com_svc, $acl.com_auth, $acl.wrapper_auth, $acl.claim_auth)
if (-not $acl.cat_svc)     { Write-Host "[FAIL] service_role cannot execute grant_catalyst_for";      $bad++ }
if ($acl.cat_auth)         { Write-Host "[FAIL] authenticated CAN execute grant_catalyst_for";        $bad++ }
if (-not $acl.com_svc)     { Write-Host "[FAIL] service_role cannot execute grant_commission_for";    $bad++ }
if ($acl.com_auth)         { Write-Host "[FAIL] authenticated CAN execute grant_commission_for";      $bad++ }
if (-not $acl.wrapper_auth){ Write-Host "[FAIL] authenticated lost grant_catalyst - drops stop landing"; $bad++ }
if ($acl.claim_auth)       { Write-Host "[FAIL] the revision re-opened claim_daily_reward_for to authenticated"; $bad++ }

# 2. The catalyst cap survived the move. If the body had been retyped instead of sliced,
#    this is where a dropped constant would show up.
$caps = Invoke-Sql @"
select (select bool_or(pg_get_functiondef(p.oid) like '%CAP_HOURLY_CATALYSTS%')
          from pg_proc p where p.proname = 'grant_catalyst_for'
           and p.pronamespace = 'public'::regnamespace)  as hourly,
       (select bool_or(pg_get_functiondef(p.oid) like '%CAP_DAILY_CATALYSTS%')
          from pg_proc p where p.proname = 'grant_catalyst_for'
           and p.pronamespace = 'public'::regnamespace)  as daily,
       (select bool_or(pg_get_functiondef(p.oid) like '%catalyst_grants%')
          from pg_proc p where p.proname = 'grant_catalyst_for'
           and p.pronamespace = 'public'::regnamespace)  as ledger,
       (select bool_or(pg_get_functiondef(p.oid) like '%grant_catalyst_for%')
          from pg_proc p where p.proname = 'grant_catalyst'
           and p.pronamespace = 'public'::regnamespace)  as wrapper_delegates;
"@
Write-Host ("[OK] catalyst body: hourly_cap={0} daily_cap={1} ledger={2} wrapper_delegates={3}" -f `
  $caps.hourly, $caps.daily, $caps.ledger, $caps.wrapper_delegates)
if (-not $caps.hourly)  { Write-Host "[FAIL] CAP_HOURLY_CATALYSTS vanished in the move";     $bad++ }
if (-not $caps.daily)   { Write-Host "[FAIL] CAP_DAILY_CATALYSTS vanished in the move";      $bad++ }
if (-not $caps.ledger)  { Write-Host "[FAIL] the grant ledger write vanished in the move";   $bad++ }
if (-not $caps.wrapper_delegates) { Write-Host "[FAIL] grant_catalyst does not delegate - two bodies now"; $bad++ }

# 3. Lock order inside the live claim function: grant_catalyst_for must appear BEFORE
#    grant_currency_for. This is the assertion that no play-through can make.
#
#    ⚠️ STRIP THE `--` COMMENTS FIRST. This repo's SQL writes its contracts out at length in
#    comments, and those comments quote the very identifiers being searched for - the lock
#    order note inside this function names both call sites 24 characters apart. Matching the
#    raw definition therefore compares two COMMENT positions and passes no matter what the
#    code does. (catalystShopContract hit this exact trap; tests\dailyRewardContract.test.ts
#    strips comments for the same reason.)
$ord = Invoke-Sql @"
with d as (
  select regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') as src
    from pg_proc p
   where p.proname = 'claim_daily_reward_for' and p.pronamespace = 'public'::regnamespace
)
select position('grant_catalyst_for(' in src)        as cat_pos,
       position('grant_currency_for(' in src)        as cur_pos,
       position('grant_commission_for(' in src)      as com_pos,
       (src like '%core_modules%')::text             as touches_modules,
       (src like '%core_modules%for update%')::text  as locks_modules
  from d;
"@
Write-Host ("[OK] claim body: catalyst@{0} currency@{1} commission@{2} modules={3} locks_modules={4}" -f `
  $ord.cat_pos, $ord.cur_pos, $ord.com_pos, $ord.touches_modules, $ord.locks_modules)
if ([int]$ord.cat_pos -le 0) { Write-Host "[FAIL] the catalyst branch is missing";  $bad++ }
if ([int]$ord.com_pos -le 0) { Write-Host "[FAIL] the commission branch is missing"; $bad++ }
if ([int]$ord.cat_pos -gt 0 -and [int]$ord.cur_pos -gt 0 -and [int]$ord.cat_pos -ge [int]$ord.cur_pos) {
  Write-Host "[FAIL] LOCK ORDER: the side-credit grant runs before the catalyst grant - profiles before catalyst_inventory, the inverse of buy_catalyst"
  $bad++
}
if ($ord.locks_modules -eq 'true') {
  Write-Host "[FAIL] the core module branch locks existing rows - that axis has two conflicting conventions in this repo and must not lock"
  $bad++
}

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] the six-axis daily reward grant path is live."
Write-Host "[NEXT] deploy the daily-reward Edge Function (it still returns 501 for the five"
Write-Host "       new axes until redeployed), then run scripts\prove-daily-reward-cap.ps1."
