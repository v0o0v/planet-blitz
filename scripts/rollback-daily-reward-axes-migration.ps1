# Planet Blitz - roll back 20260805020000_daily_reward_axes.sql on the remote project.
#
# WHAT THIS DOES NOT DO, AND WHY IT MATTERS MOST
#
# It does NOT retype the previous bodies of the two replaced functions. Hand-copying a
# `create or replace function` body is exactly the shape that took PvE settlement down
# 100% in production (20260802000000:4-15 replayed a stale body that referenced a dropped
# column). So this script READS the migration tree and SLICES the pre-slice-2 definitions
# out of it:
#
#   grant_catalyst          <- supabase/migrations/20260801000000_catalyst_grant_cap.sql
#   claim_daily_reward_for  <- supabase/migrations/20260805000000_daily_reward.sql
#
# If a later migration revises either of these again, point this script at that file
# instead - it prints which file each block came from so the operator can see it.
#
# ORDER MATTERS: STOP THE EDGE FUNCTION FIRST
#
# The deployed daily-reward EF grants five axes. Reverting the claim RPC while that EF is
# live means the five non-currency axes hit a body that no longer knows them: the claim row
# still lands (so the day is consumed and the streak advances) but nothing is granted. That
# is a silently lost day per player per rollback minute. Undeploy or disable the EF first,
# then run this. The script asks for confirmation because it cannot check that for you.
#
# WHAT IS LEFT IN PLACE
#
#   - grant_catalyst_for / grant_commission_for are NOT dropped. Reverting grant_catalyst to
#     its own body makes them unreferenced, and an unreferenced service_role-only function
#     with no authenticated grant is inert. Dropping them would fail anyway while any other
#     migration or function still names them, and a failed rollback halfway through is worse
#     than two idle functions.
#   - Rows already written by the five axes (catalysts, blueprints, modules, commissions)
#     stay. They were legitimately granted; clawing them back would take items off players
#     for a server-side decision they had no part in.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\rollback-daily-reward-axes-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260805020000'

$utf8 = [Text.Encoding]::UTF8

$catFile   = Join-Path $PSScriptRoot '..\supabase\migrations\20260801000000_catalyst_grant_cap.sql'
$claimFile = Join-Path $PSScriptRoot '..\supabase\migrations\20260805000000_daily_reward.sql'
foreach ($f in @($catFile, $claimFile)) {
  if (-not (Test-Path $f)) { throw "source migration not found: $f" }
}

# Slice `create or replace function public.<name>(` ... `\n$$;` out of a migration file.
# The terminator is built from char codes so the literal dollar pair never meets the
# PowerShell parser. Same helper as rollback-daily-reward-migration.ps1.
function Get-FunctionBlock([string]$path, [string]$name) {
  $sql    = [IO.File]::ReadAllText((Resolve-Path $path), $utf8)
  $marker = "create or replace function public.$name("
  $at     = $sql.LastIndexOf($marker)
  if ($at -lt 0) { throw "$([IO.Path]::GetFileName($path)): no definition of $name" }
  $term = [string][char]10 + [string][char]36 + [string][char]36 + ';'
  $end  = $sql.IndexOf($term, $at)
  if ($end -lt $at) { throw "$([IO.Path]::GetFileName($path)): no terminator after $name" }
  return $sql.Substring($at, $end - $at + $term.Length)
}

$catBlock   = Get-FunctionBlock $catFile   'grant_catalyst'
$claimBlock = Get-FunctionBlock $claimFile 'claim_daily_reward_for'

# Sanity: the sliced blocks must be the PRE-slice-2 shape. If a slice accidentally grabbed
# the new bodies, the rollback would be a no-op that reports success.
if ($catBlock   -match 'grant_catalyst_for') { throw "sliced grant_catalyst already delegates - wrong slice" }
if ($catBlock   -notmatch 'CAP_HOURLY_CATALYSTS') { throw "sliced grant_catalyst lost the cumulative cap - wrong slice" }
if ($claimBlock -match 'grant_commission_for')    { throw "sliced claim_daily_reward_for already has the axis dispatch" }
if ($claimBlock -notmatch 'DAILY_SIDE_CREDITS')   { throw "sliced claim_daily_reward_for lost the side credits - wrong slice" }

Write-Host ("[OK] sliced grant_catalyst         ({0} chars) from {1}" -f $catBlock.Length,   [IO.Path]::GetFileName($catFile))
Write-Host ("[OK] sliced claim_daily_reward_for ({0} chars) from {1}" -f $claimBlock.Length, [IO.Path]::GetFileName($claimFile))

Write-Host ""
Write-Host "[WARN] Undeploy or disable the daily-reward Edge Function BEFORE continuing."
Write-Host "       While it is live and this RPC is reverted, the five non-currency axes"
Write-Host "       consume the day (claim row + streak) and grant nothing."
$answer = Read-Host "Type ROLLBACK to continue"
if ($answer -ne 'ROLLBACK') { throw "aborted by operator" }

$tokenFile = Join-Path $env:USERPROFILE '.supabase-pb.token'
if (-not (Test-Path $tokenFile)) { throw "token file not found: $tokenFile" }
$sec  = Get-Content $tokenFile | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$pat  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$hdr = @{ Authorization = "Bearer $pat" }

$proj = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref" -Headers $hdr -Method Get
if ($proj.name -notmatch 'planet') { throw "refusing: project name '$($proj.name)' does not look like Planet Blitz" }
Write-Host "[OK] target project: $($proj.name) ($ref)"

function Invoke-Sql([string]$sql) {
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# `create or replace` preserves grants, but re-apply them so a partially reverted state
# cannot leave the claim RPC reachable from authenticated.
$revoke = @"
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from public;
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from anon;
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.grant_catalyst(int, int) from public;
revoke all on function public.grant_catalyst(int, int) from anon;
grant execute on function public.grant_catalyst(int, int) to authenticated, service_role;
"@

Write-Host "[..] restoring claim_daily_reward_for"
Invoke-Sql $claimBlock | Out-Null
Write-Host "[..] restoring grant_catalyst"
Invoke-Sql $catBlock | Out-Null
Invoke-Sql $revoke | Out-Null
Write-Host "[OK] bodies restored"

Invoke-Sql "delete from supabase_migrations.schema_migrations where version = '$version';" | Out-Null
Write-Host "[OK] schema_migrations entry removed"

# --- verification ------------------------------------------------------------
Write-Host ""
Write-Host "--- verification ---"
$bad = 0
$chk = Invoke-Sql @"
select (select bool_or(pg_get_functiondef(p.oid) like '%grant_commission_for%')
          from pg_proc p where p.proname = 'claim_daily_reward_for'
           and p.pronamespace = 'public'::regnamespace)       as claim_still_dispatches,
       (select bool_or(pg_get_functiondef(p.oid) like '%grant_catalyst_for%')
          from pg_proc p where p.proname = 'grant_catalyst'
           and p.pronamespace = 'public'::regnamespace)       as catalyst_still_delegates,
       (select bool_or(pg_get_functiondef(p.oid) like '%CAP_HOURLY_CATALYSTS%')
          from pg_proc p where p.proname = 'grant_catalyst'
           and p.pronamespace = 'public'::regnamespace)       as catalyst_cap_back,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
         where p.proname = 'claim_daily_reward_for'
           and p.pronamespace = 'public'::regnamespace)       as claim_auth;
"@
Write-Host ("[OK] after: claim_dispatches={0} catalyst_delegates={1} catalyst_cap_back={2} claim_auth={3}" -f `
  $chk.claim_still_dispatches, $chk.catalyst_still_delegates, $chk.catalyst_cap_back, $chk.claim_auth)
if ($chk.claim_still_dispatches)   { Write-Host "[FAIL] the axis dispatch is still live";                 $bad++ }
if ($chk.catalyst_still_delegates) { Write-Host "[FAIL] grant_catalyst still delegates";                  $bad++ }
if (-not $chk.catalyst_cap_back)   { Write-Host "[FAIL] grant_catalyst has no cumulative cap - DO NOT LEAVE THIS"; $bad++ }
if ($chk.claim_auth)               { Write-Host "[FAIL] authenticated CAN execute claim_daily_reward_for"; $bad++ }

if ($bad -gt 0) { throw "rollback verification FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] slice 2 reverted. The daily reward is back to the currency axis only."
Write-Host "[NEXT] redeploy the slice-1 Edge Function, or leave it undeployed - the reverted"
Write-Host "       RPC has no branch for the other five axes."
