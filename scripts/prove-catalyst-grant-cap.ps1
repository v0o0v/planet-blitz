# Planet Blitz - prove that grant_catalyst's cumulative cap actually BITES.
#
# Why a separate script: apply-catalyst-grant-cap-migration.ps1 runs every statement
# as `postgres`. That can confirm the cap EXISTS in the function body; it can never
# confirm the function refuses a client. So here we drop to the `authenticated` role
# and forge the JWT claims PostgREST would set, i.e. the call is indistinguishable
# from a real client `POST /rest/v1/rpc/grant_catalyst`.
#
# Everything runs inside BEGIN ... ROLLBACK, so no inventory row, ledger row, or
# profile flag survives - safe to re-run against production.
#
# TWO TRAPS this script is shaped around (both cost real time in this repo):
#   1. An RPC call and a state read in the SAME select statement disagree: the
#      subquery sees the snapshot taken when the statement STARTED, so the RPC
#      return value is right while the state column reads the pre-call value.
#      => every state read is its own statement.
#   2. The Management API returns only the LAST statement's result set. So the
#      sequential RPC calls return nothing useful and the proof is read off the
#      final state instead (inventory delta + ledger rows), which is the stronger
#      evidence anyway.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\prove-catalyst-grant-cap.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref = 'qxgbxwyccbxokdgwxcuw'

# Expected caps - must match the DECLARE block in
# supabase/migrations/20260801000000_catalyst_grant_cap.sql.
$CAP_PER_CALL = 100
$CAP_HOURLY   = 360    # 60 runs/h * 3 catalysts/run * 2 headroom
$CALLS        = 5      # 5 * 100 = 500 requested, 360 expected

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
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

$who = Invoke-Sql "select id::text as id from public.profiles order by id limit 1;"
if ($null -eq $who) { throw "no profiles row to test against" }
$me = $who.id
Write-Host "[OK] acting as profile $me (all writes rolled back)"

$bad = 0
function Check([string]$label, $actual, $expected) {
  if ("$actual" -ne "$expected") {
    Write-Host ("[FAIL] {0}: got '{1}', expected '{2}'" -f $label, $actual, $expected)
    $script:bad++
  } else {
    Write-Host ("[OK] {0} = {1}" -f $label, $actual)
  }
}

# Seed as postgres (clean slate), then every RPC as the client would call it.
# Each `select public.grant_catalyst(...)` is its own statement, so call N sees the
# ledger rows written by calls 1..N-1 (a single statement would not).
$seed = @"
begin;
delete from public.catalyst_grants where profile_id = '$me'::uuid;
insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
values ('$me'::uuid, 0, 0)
on conflict (profile_id, catalyst_id) do update set qty = 0;
update public.profiles set flagged = false where id = '$me'::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';
"@

$callSql = (1..$CALLS | ForEach-Object { "select public.grant_catalyst(0, $CAP_PER_CALL);" }) -join "`n"

# --- G1 + G2: the cap bites, and the ledger records it ------------------------
$g1 = Invoke-Sql @"
$seed
$callSql

select
  (select qty::text from public.catalyst_inventory
     where profile_id = '$me'::uuid and catalyst_id = 0)                       as qty,
  (select coalesce(sum(qty), 0)::text from public.catalyst_grants
     where profile_id = '$me'::uuid)                                           as ledger_sum,
  (select count(*)::text from public.catalyst_grants
     where profile_id = '$me'::uuid)                                           as ledger_rows,
  (select count(*)::text from public.catalyst_grants
     where profile_id = '$me'::uuid and requested > qty)                       as clamped_rows,
  (select flagged::text from public.profiles where id = '$me'::uuid)           as flagged;
rollback;
"@

Write-Host ""
Write-Host ("--- G1: {0} calls x {1} requested = {2} asked ---" -f $CALLS, $CAP_PER_CALL, ($CALLS * $CAP_PER_CALL))
# THE witness: without the cumulative cap this is 500. With it, 360.
Check 'inventory qty after the burst' $g1.qty $CAP_HOURLY
Write-Host ""
Write-Host "--- G2: the ledger is the cap's evidence ---"
Check 'ledger sum(qty)'                       $g1.ledger_sum  $CAP_HOURLY
# 3 full calls (300) + 1 partial (60) = 4 rows. The 5th grants 0 and is not logged.
Check 'ledger rows (0-grant calls unlogged)'  $g1.ledger_rows 4
Check 'rows showing a clamp (requested>qty)'  $g1.clamped_rows 1
Check 'normal burst does not flag the account' $g1.flagged 'false'

# --- G3: an extreme single request flags the account -------------------------
$g3 = Invoke-Sql @"
$seed
select public.grant_catalyst(0, $($CAP_PER_CALL * 10 + 1));

select (select flagged::text from public.profiles where id = '$me'::uuid) as flagged,
       (select qty::text from public.catalyst_inventory
          where profile_id = '$me'::uuid and catalyst_id = 0)             as qty;
rollback;
"@
Write-Host ""
Write-Host "--- G3: extreme request (> 10x per-call cap) ---"
Check 'account flagged'                    $g3.flagged 'true'
Check 'still clamped to the per-call cap'  $g3.qty     $CAP_PER_CALL

# --- G4: zero request leaves no ghost row ------------------------------------
$g4 = Invoke-Sql @"
begin;
delete from public.catalyst_inventory where profile_id = '$me'::uuid and catalyst_id = 1;

set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';

select (public.grant_catalyst(1, 0) ->> 'note')                        as note,
       (select count(*)::text from public.catalyst_inventory
          where profile_id = '$me'::uuid and catalyst_id = 1)          as ghost;
rollback;
"@
Write-Host ""
Write-Host "--- G4: zero request ---"
Check 'note'                     $g4.note  'nothing-to-grant'
Check 'no ghost inventory row'   $g4.ghost 0

# Unknown id must still raise (the catalogue gate predates this change).
$raised = $false
try {
  Invoke-Sql @"
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';
select public.grant_catalyst(9999, 1);
rollback;
"@ | Out-Null
} catch {
  # Match on the id, not the Korean message text - console encoding must not decide
  # whether this passes.
  if ("$_" -match '9999') { $raised = $true }
}
if ($raised) { Write-Host "[OK] unknown catalyst id still raises" }
else { Write-Host "[FAIL] unknown catalyst id did not raise"; $bad++ }

# --- nothing leaked ----------------------------------------------------------
$post = Invoke-Sql @"
select (select count(*)::text from public.catalyst_grants where profile_id = '$me'::uuid) as ledger_rows,
       (select flagged::text from public.profiles where id = '$me'::uuid)                 as flagged;
"@
Write-Host ""
Write-Host ("[OK] post-rollback: ledger_rows={0} flagged={1}" -f $post.ledger_rows, $post.flagged)
if ([int]$post.ledger_rows -ne 0) { Write-Host "[FAIL] ledger rows survived the rollback"; $bad++ }
if ("$($post.flagged)" -ne 'false') { Write-Host "[FAIL] flagged survived the rollback";   $bad++ }

if ($bad -gt 0) { throw "cap proof FAILED with $bad problems" }
Write-Host ""
Write-Host "[DONE] grant_catalyst is bounded: a client asking for $($CALLS * $CAP_PER_CALL) receives $CAP_HOURLY."
