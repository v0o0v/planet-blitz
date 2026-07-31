# Planet Blitz - apply 20260801000000_catalyst_grant_cap.sql to the remote project.
#
# ADR-0042 follow-up (a): grant_catalyst had a per-call cap of 100 and nothing else.
# PR#215 also took the catalyst axis out of currency_grants and the flagged sweep,
# so the axis was uncapped + unlogged + unflagged. This migration restores all three.
#   1. catalyst_grants ledger (RLS select-own, no write policy) + index
#   2. grant_catalyst -> 1h/24h cumulative caps, clamps instead of raising,
#      writes the ledger, flags extreme requests, locks inventory -> profiles
#   3. planet-blitz-gc-catalyst-grants cron (TTL 48h > the 24h window)
#
# Everything is additive (create table if not exists / create or replace), so a
# re-run converges. To roll back, re-apply the grant_catalyst body from
# 20260727000000_catalyst_ledger.sql - it is still in the tree.
#
# IMPORTANT: this script runs every statement as `postgres`, so it can only show
# that the cap EXISTS. Run scripts\prove-catalyst-grant-cap.ps1 afterwards to see
# it BITE from a real client context.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-catalyst-grant-cap-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260801000000'
$name    = 'catalyst_grant_cap'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260801000000_catalyst_grant_cap.sql'

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
# grant_catalyst and catalyst_defs must already exist (20260727000000 applied).
$pre = Invoke-Sql @"
select (select count(*) from pg_proc p where p.proname = 'grant_catalyst'
          and p.pronamespace = 'public'::regnamespace)              as grant_fn,
       (select count(*) from public.catalyst_defs)                  as defs_rows;
"@
Write-Host ("[OK] before: grant_catalyst={0} catalyst_defs={1}/48" -f $pre.grant_fn, $pre.defs_rows)
if ([int]$pre.grant_fn -ne 1)   { throw "refusing: grant_catalyst does not exist yet" }
if ([int]$pre.defs_rows -ne 48) { throw "refusing: expected exactly 48 catalyst_defs rows" }

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
Write-Host "--- verification ---"
$bad = 0

# 1. ledger table: exists, RLS on, exactly one policy and it is SELECT.
#    A write policy here would let a client forge the ledger, and the ledger is
#    the ONLY evidence the cumulative cap reads.
$tbl = Invoke-Sql @"
select c.relrowsecurity                                              as rls_on,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'catalyst_grants')       as policy_count,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'catalyst_grants'
           and cmd = 'SELECT')                                                as select_policies,
       (select count(*) from pg_indexes
         where schemaname = 'public' and tablename = 'catalyst_grants'
           and indexdef ilike '%profile_id%created_at%')                      as cap_index
  from pg_class c
 where c.oid = 'public.catalyst_grants'::regclass;
"@
if ($null -eq $tbl) { Write-Host "[FAIL] catalyst_grants table missing"; $bad++ }
else {
  Write-Host ("[OK] catalyst_grants: rls={0} policies={1} (select={2}) cap_index={3}" -f `
    $tbl.rls_on, $tbl.policy_count, $tbl.select_policies, $tbl.cap_index)
  if (-not $tbl.rls_on)                  { Write-Host "[FAIL] RLS is off";                    $bad++ }
  if ([int]$tbl.policy_count -ne 1)      { Write-Host "[FAIL] expected exactly 1 policy";     $bad++ }
  if ([int]$tbl.select_policies -ne 1)   { Write-Host "[FAIL] the policy is not SELECT-only"; $bad++ }
  if ([int]$tbl.cap_index -lt 1)         { Write-Host "[FAIL] cap query index missing";       $bad++ }
}

# 2. grant_catalyst body: the cumulative cap and the ledger write must be present
#    in the LIVE definition, not just in the file we uploaded.
$fn = Invoke-Sql @"
select (pg_get_functiondef(p.oid) like '%catalyst_grants%')            as reads_ledger,
       (pg_get_functiondef(p.oid) like '%interval ''1 hour''%')        as window_1h,
       (pg_get_functiondef(p.oid) like '%interval ''24 hours''%')      as window_24h,
       (pg_get_functiondef(p.oid) like '%CAP_HOURLY_CATALYSTS%')       as has_hourly_cap,
       (pg_get_functiondef(p.oid) like '%flagged = true%')             as flags
  from pg_proc p
 where p.proname = 'grant_catalyst' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] grant_catalyst: ledger={0} 1h={1} 24h={2} hourly_cap={3} flags={4}" -f `
  $fn.reads_ledger, $fn.window_1h, $fn.window_24h, $fn.has_hourly_cap, $fn.flags)
foreach ($p in @(
  @{ v = $fn.reads_ledger;   m = 'does not read catalyst_grants' },
  @{ v = $fn.window_1h;      m = 'has no 1 hour window' },
  @{ v = $fn.window_24h;     m = 'has no 24 hours window' },
  @{ v = $fn.has_hourly_cap; m = 'has no CAP_HOURLY_CATALYSTS constant' },
  @{ v = $fn.flags;          m = 'does not set flagged' })) {
  if (-not $p.v) { Write-Host ("[FAIL] grant_catalyst {0}" -f $p.m); $bad++ }
}

# 3. GC cron: the ledger must not grow forever, and its TTL must exceed the 24h window.
$cron = Invoke-Sql @"
select jobname, schedule, command
  from cron.job
 where jobname = 'planet-blitz-gc-catalyst-grants';
"@
if ($null -eq $cron) { Write-Host "[FAIL] GC cron not registered"; $bad++ }
else {
  Write-Host ("[OK] cron {0} @ {1}" -f $cron.jobname, $cron.schedule)
  if ("$($cron.command)" -notmatch "interval '48 hours'") {
    Write-Host "[FAIL] GC TTL is not 48 hours (must exceed the 24h cap window)"; $bad++
  }
}

# 4. execute grants: anon must NOT be able to call grant_catalyst.
$acl = Invoke-Sql @"
select has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('anon',          p.oid, 'execute') as anon_exec
  from pg_proc p
 where p.proname = 'grant_catalyst' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] grant_catalyst acl: authenticated={0} anon={1}" -f $acl.auth_exec, $acl.anon_exec)
if (-not $acl.auth_exec) { Write-Host "[FAIL] authenticated cannot execute grant_catalyst"; $bad++ }
if ($acl.anon_exec)      { Write-Host "[FAIL] anon CAN execute grant_catalyst";             $bad++ }

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] the catalyst grant cap is live on the remote project."
Write-Host "[NEXT] run scripts\prove-catalyst-grant-cap.ps1 - this script ran as postgres,"
Write-Host "       which proves the cap exists but never that it bites."
