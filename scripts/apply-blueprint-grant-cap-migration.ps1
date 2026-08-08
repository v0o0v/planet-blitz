# Planet Blitz - apply 20260808080000_blueprint_grant_cap.sql to the remote project.
#
# 2026-08-08 drop-rate lane follow-up. What this migration lands:
#   1. blueprint_grant_log  -> the cap's denominator. RLS on, ZERO policies.
#   2. grant_blueprints redefined -> hourly (12) + daily (60) cap on TOTAL GRANTED
#      COUNT, profile row lock, all-or-nothing rejection, ledger write in the same
#      transaction as the grant.
#   3. pg_cron 30-day GC on the log.
#
# Why: grant_blueprints had NO frequency cap - an authenticated user could bank 32
# blueprints per call, unlimited. That was ADR-0026/0027's accepted trade-off, but
# ADR-0026's criterion is RELATIVE ("cheater gain bounded by top honest farm rate")
# and PR#391 dropped the honest rate ~7-14% -> exactly 3%, widening the ratio ~5x.
# The security review flagged it as a risk THIS lane created.
#
# ⚠️ NO CLIENT-FIRST ORDERING NEEDED, and the input/return shape is UNCHANGED.
#   Only two new rejection codes appear ('rate', 'rate-day'). The client calls this
#   RPC fire-and-forget (src/net/blueprints.ts) and already swallows failures, so a
#   capped call is a silent no-op - which is the intended behaviour for a 5-sigma
#   event. Cached OLD clients (pre-#391, multi-row payloads) keep working: the
#   structural limits (rows<=8, count<=4) were deliberately NOT tightened.
#
# ⚠️ THE CAP IS ON SUMMED COUNT, NOT CALL COUNT.
#   Counting calls would let one call carry 32 blueprints and breach the cap 32x.
#   tests/blueprintGrantCap.test.ts locks this (and 3 other structural properties
#   that a value-only check cannot see). Run it before applying.
#
# ⚠️ pg_cron MAY BE OFF on this project. If the cron.schedule line fails, the
#   function and both caps are already live and only the log grows unbounded
#   (~10k rows/year at honest volume - safe to leave). Re-run after enabling
#   pg_cron in Dashboard > Database > Extensions.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles
# non-ASCII literals in BOM-less .ps1 files, and a mojibake'd success line reads
# like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-blueprint-grant-cap-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260808080000'
$name    = 'blueprint_grant_cap'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260808080000_blueprint_grant_cap.sql'

if (-not (Test-Path $file)) { throw "migration file not found: $file" }

# PAT from the DPAPI-protected token file (same source the `spb` wrapper uses).
$tokenFile = Join-Path $env:USERPROFILE '.supabase-pb.token'
if (-not (Test-Path $tokenFile)) { throw "token file not found: $tokenFile" }
$sec  = Get-Content $tokenFile | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$pat  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$hdr  = @{ Authorization = "Bearer $pat" }
$utf8 = [Text.Encoding]::UTF8

# Guard against deploying to the wrong project.
$proj = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref" -Headers $hdr -Method Get
if ($proj.name -notmatch 'planet') { throw "refusing: project name '$($proj.name)' does not look like Planet Blitz" }
Write-Host "[OK] target project: $($proj.name) ($ref)"

function Invoke-Sql([string]$sql) {
  # UTF-8 BYTES, not a string. Sending the string mangles Korean comments and the
  # server answers 400 "Expected ',' or '}' after property value" at a byte offset,
  # which looks like a SQL error but is a request-encoding error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- preconditions -----------------------------------------------------------
Write-Host ""
Write-Host "--- preconditions ---"

# grant_blueprints must exist (20260722020000). It is redefined, not created.
$pre = Invoke-Sql @"
select count(*) as fn_rows,
       bool_or(pg_get_functiondef(p.oid) like '%CAP_BLUEPRINTS_PER_HOUR%') as already_capped
  from pg_proc p
 where p.proname = 'grant_blueprints' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] grant_blueprints: rows={0} already_capped={1}" -f $pre.fn_rows, $pre.already_capped)
if ([int]$pre.fn_rows -ne 1) { throw "refusing: expected exactly 1 grant_blueprints, found $($pre.fn_rows)" }
if ($pre.already_capped) { Write-Host "[NOTE] remote ALREADY capped - this is a re-apply (idempotent)." }

# defense_blueprints (the target table) and profiles (the lock target) must exist.
$deps = Invoke-Sql @"
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='defense_blueprints') as has_blueprints,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='profiles')           as has_profiles;
"@
Write-Host ("[OK] deps: defense_blueprints={0} profiles={1}" -f $deps.has_blueprints, $deps.has_profiles)
if ([int]$deps.has_blueprints -ne 1) { throw "refusing: defense_blueprints missing" }
if ([int]$deps.has_profiles   -ne 1) { throw "refusing: profiles missing" }

# Axis D cap - the honest denominator this cap is derived from. Report it so the
# derivation in the .sql header can be checked against what is actually enforced.
$axisD = Invoke-Sql @"
select coalesce((
  select substring(pg_get_functiondef(p.oid) from 'CAP_RUNS_PER_HOUR[^0-9]*([0-9]+)')
    from pg_proc p
   where p.proname = 'begin_pve_run' and p.pronamespace = 'public'::regnamespace
), '(absent)') as cap_runs_per_hour;
"@
Write-Host ("[OK] axis D CAP_RUNS_PER_HOUR on remote: {0}   (honest expectation = that x 3%)" -f $axisD.cap_runs_per_hour)
if ($axisD.cap_runs_per_hour -eq '(absent)') {
  Write-Host "[WARN] begin_pve_run is missing - the honest denominator is NOT enforced on this"
  Write-Host "[WARN] remote, so the 12/h derivation rests on an unenforced assumption."
}

# --- apply -------------------------------------------------------------------
# NOT Get-Content -Raw (mangles the Korean comments).
$sql = [IO.File]::ReadAllText((Resolve-Path $file), $utf8)
Write-Host ""
Write-Host "[..] applying $version`_$name ($($sql.Length) chars)"
try {
  Invoke-Sql $sql | Out-Null
  Write-Host "[OK] migration applied (including the pg_cron GC schedule)"
} catch {
  # pg_cron may be disabled. Everything before cron.schedule is already committed
  # per-statement by the Management API, so retry WITHOUT the schedule rather than
  # leaving the caps unapplied.
  $msg = $_.Exception.Message
  if ($msg -match 'cron') {
    Write-Host "[WARN] cron.schedule failed (pg_cron off?). Retrying without the GC schedule."
    $trimmed = $sql -replace '(?s)select cron\.schedule\(.*?\);\s*$', ''
    Invoke-Sql $trimmed | Out-Null
    Write-Host "[OK] migration applied WITHOUT the GC schedule"
    Write-Host "[TODO] enable pg_cron, then re-run this script to install the 30-day GC."
  } else {
    throw
  }
}

# Record it so a future `supabase db push` does not re-apply.
Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$version', '$name') on conflict (version) do nothing;
"@ | Out-Null
Write-Host "[OK] recorded in schema_migrations"

# --- verification ------------------------------------------------------------
#
# ⚠️ MATCH ON IDENTIFIERS THE SQL ACTUALLY CONTAINS, NEVER ON ENGLISH PROSE.
#   This repo writes every comment in Korean. The catalyst script reported [FAIL]
#   on a working gate because it grepped for '%duplicate%' while the comment read
#   "중복 거부". Below we match only SQL identifiers and literals.

Write-Host ""
Write-Host "--- verification ---"
$bad = 0

# 1. both cap constants landed with the mirrored values.
$caps = Invoke-Sql @"
select
  substring(pg_get_functiondef(p.oid) from 'CAP_BLUEPRINTS_PER_HOUR[^0-9]*([0-9]+)') as hour_cap,
  substring(pg_get_functiondef(p.oid) from 'CAP_BLUEPRINTS_PER_DAY[^0-9]*([0-9]+)')  as day_cap
  from pg_proc p
 where p.proname = 'grant_blueprints' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] caps on remote: hour={0} day={1}   (expected 12 / 60)" -f $caps.hour_cap, $caps.day_cap)
if ($caps.hour_cap -ne '12') { Write-Host "[FAIL] hourly cap is not 12"; $bad++ }
if ($caps.day_cap  -ne '60') { Write-Host "[FAIL] daily cap is not 60";  $bad++ }

# 2. the four structural properties. A value-correct cap is still worthless if any
#    of these is wrong - see tests/blueprintGrantCap.test.ts for why each matters.
$struct = Invoke-Sql @"
select
  (pg_get_functiondef(p.oid) like '%coalesce(sum(granted), 0)%')                as numerator_is_sum,
  (pg_get_functiondef(p.oid) like '%from public.profiles where id = v_me for update%') as has_row_lock,
  strpos(pg_get_functiondef(p.oid), 'CAP_BLUEPRINTS_PER_HOUR then')             as at_hour_cap,
  strpos(pg_get_functiondef(p.oid), 'CAP_BLUEPRINTS_PER_DAY then')              as at_day_cap,
  strpos(pg_get_functiondef(p.oid), 'insert into public.defense_blueprints')    as at_grant,
  strpos(pg_get_functiondef(p.oid), 'insert into public.blueprint_grant_log')   as at_log
  from pg_proc p
 where p.proname = 'grant_blueprints' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] structure: sum_numerator={0} row_lock={1}" -f $struct.numerator_is_sum, $struct.has_row_lock)
Write-Host ("[OK] offsets: hour_cap={0} day_cap={1} grant={2} log={3}" -f `
  $struct.at_hour_cap, $struct.at_day_cap, $struct.at_grant, $struct.at_log)
if (-not $struct.numerator_is_sum) { Write-Host "[FAIL] numerator is not sum(granted) - a single call could carry 32"; $bad++ }
if (-not $struct.has_row_lock)     { Write-Host "[FAIL] no profile row lock - parallel calls breach the cap";          $bad++ }
if ([int]$struct.at_grant -le [int]$struct.at_hour_cap) { Write-Host "[FAIL] grant precedes the hourly cap"; $bad++ }
if ([int]$struct.at_grant -le [int]$struct.at_day_cap)  { Write-Host "[FAIL] grant precedes the daily cap";  $bad++ }
if ([int]$struct.at_log   -le [int]$struct.at_grant)    { Write-Host "[FAIL] ledger write precedes the grant"; $bad++ }

# 3. the log table exists, is indexed for the cap query, and is invisible to clients.
$tbl = Invoke-Sql @"
select
  c.relrowsecurity as rls_on,
  (select count(*) from pg_policies where schemaname='public' and tablename='blueprint_grant_log') as policies,
  (select count(*) from pg_indexes where schemaname='public' and tablename='blueprint_grant_log'
     and indexdef like '%profile_id%created_at%') as cap_index
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relname='blueprint_grant_log';
"@
Write-Host ("[OK] blueprint_grant_log: rls_on={0} policies={1} cap_index={2}" -f $tbl.rls_on, $tbl.policies, $tbl.cap_index)
if (-not $tbl.rls_on)            { Write-Host "[FAIL] RLS is off - clients could read the cap denominator"; $bad++ }
if ([int]$tbl.policies -ne 0)    { Write-Host "[FAIL] a policy exists on the log table";                    $bad++ }
if ([int]$tbl.cap_index -lt 1)   { Write-Host "[FAIL] the (profile_id, created_at) index is missing";        $bad++ }

# 4. execute privileges unchanged: authenticated yes, anon no.
$acl = Invoke-Sql @"
select has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('public',        p.oid, 'execute') as pub_exec
  from pg_proc p
 where p.proname = 'grant_blueprints' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] execute: anon={0} authenticated={1} public={2}" -f $acl.anon_exec, $acl.auth_exec, $acl.pub_exec)
if ($acl.anon_exec)      { Write-Host "[FAIL] anon CAN execute grant_blueprints";           $bad++ }
if (-not $acl.auth_exec) { Write-Host "[FAIL] authenticated CANNOT execute - clients break"; $bad++ }
if ($acl.pub_exec)       { Write-Host "[FAIL] PUBLIC CAN execute";                           $bad++ }

# 5. the OTHER blueprint inflow paths must be untouched (server-adjudicated, not capped).
$others = Invoke-Sql @"
select
  (select count(*) from pg_proc p where p.proname='loot_defense_blueprint'
     and p.pronamespace='public'::regnamespace) as raid_fn,
  (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
    where p.proname='loot_defense_blueprint' and p.pronamespace='public'::regnamespace) as raid_auth_exec;
"@
Write-Host ("[OK] raid path intact: fn={0} authenticated_exec={1} (must be False)" -f $others.raid_fn, $others.raid_auth_exec)
if ([int]$others.raid_fn -ne 1)  { Write-Host "[FAIL] loot_defense_blueprint vanished"; $bad++ }
if ($others.raid_auth_exec)      { Write-Host "[FAIL] raid path became client-callable"; $bad++ }

# 6. the cap actually BITES - proven by execution, not by reading the DDL.
#    Borrow a real profile id, stuff the log past the daily cap, confirm the function
#    would reject, then roll everything back. Rolled back inside a DO block so no
#    junk row survives even if a later step throws.
$anchor = Invoke-Sql "select coalesce((select id::text from public.profiles limit 1), '') as pid;"
if ([string]::IsNullOrEmpty($anchor.pid)) {
  Write-Host "[SKIP] no profiles row to borrow - live cap probe skipped (DDL checks above stand)"
} else {
  # ⚠️ grant_blueprints reads auth.uid(), which is null over the Management API, so we
  #    cannot call the function directly. Probe the CAP QUERY itself instead - the same
  #    predicate the function runs - and assert it crosses the threshold.
  $probe = Invoke-Sql @"
do `$`$
declare v_sum integer;
begin
  insert into public.blueprint_grant_log (profile_id, granted, rows_n)
    values ('$($anchor.pid)'::uuid, 61, 1);
  select coalesce(sum(granted), 0) into v_sum
    from public.blueprint_grant_log
   where profile_id = '$($anchor.pid)'::uuid and created_at > now() - interval '1 day';
  if v_sum < 60 then
    raise exception 'PROBE_FAILED: cap denominator did not see the row (sum=%)', v_sum;
  end if;
  raise exception 'PROBE_OK_ROLLBACK';
exception
  when others then
    if sqlerrm = 'PROBE_OK_ROLLBACK' then
      raise notice 'cap denominator works';
    else
      raise exception '%', sqlerrm;
    end if;
end `$`$;
"@
  Write-Host "[OK] cap denominator probe passed (rolled back)"

  # No leftovers.
  $left = Invoke-Sql "select count(*) as n from public.blueprint_grant_log where profile_id = '$($anchor.pid)'::uuid and granted = 61;"
  Write-Host ("[OK] probe leftovers: {0} (must be 0)" -f $left.n)
  if ([int]$left.n -ne 0) { Write-Host "[FAIL] probe row survived - clean it up manually"; $bad++ }
}

# 7. migration ledger row present.
$led = Invoke-Sql "select count(*) as n from supabase_migrations.schema_migrations where version = '$version';"
Write-Host ("[OK] schema_migrations row for {0}: {1}" -f $version, $led.n)
if ([int]$led.n -ne 1) { Write-Host "[FAIL] ledger row missing"; $bad++ }

# 8. GC schedule (informational - pg_cron may be off).
$cron = Invoke-Sql @"
select coalesce((select count(*) from cron.job where jobname = 'planet-blitz-gc-blueprint-grant-log'), 0) as n;
"@
Write-Host ("[OK] GC cron job rows: {0} (0 = pg_cron off, see [TODO] above)" -f $cron.n)

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }

Write-Host ""
Write-Host "[DONE] blueprint grant cap is live: 12/hour, 60/day, on SUMMED count."
Write-Host "[NOTE] Forgery ceiling: unlimited -> 12/h and 60/day."
Write-Host "       Honest expectation: about 1.8/h (axis D 60 runs/h x 3%)."
Write-Host "       ADR-0026's RELATIVE bound is restored (was widened 5x by PR#391)."
Write-Host "[NOTE] Watch for honest players hitting the cap - it should never happen"
Write-Host "       (5-sigma+). If it does, the derivation's denominator is wrong:"
Write-Host "         select profile_id, sum(granted) from public.blueprint_grant_log"
Write-Host "          where created_at > now() - interval '1 day'"
Write-Host "          group by 1 having sum(granted) > 40 order by 2 desc;"
Write-Host "[NOTE] Still client-authoritative on WHICH blueprint. Moving the roll"
Write-Host "       server-side (ADR-0050 stage 3 shape) is a separate decision -"
Write-Host "       it needs the per-planet specialty weight tables mirrored into SQL."
