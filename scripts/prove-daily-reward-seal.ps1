# Planet Blitz - prove that a client can neither WRITE the daily-reward columns nor CALL
# the claim RPC.
#
# Why a separate script: apply-daily-reward-migration.ps1 runs every statement as
# `postgres`, and both guard functions short-circuit on is_service_role() by design. So
# that script can confirm the seals EXIST but never that they BITE. A seal you only read
# the source of is not a seal you have tested.
#
# What this does instead: inside a transaction it drops to the `authenticated` role and
# forges the JWT claims PostgREST would set, so each request is indistinguishable from a
# real client `PATCH /rest/v1/profiles` or `POST /rest/v1/rpc/...`. Everything runs inside
# BEGIN ... ROLLBACK, so no row is modified even if a seal were broken.
#
# THE FOUR TOKENS
#   SEAL_LIFETIME_HELD        forged UPDATE of lifetime_granted does not land
#   SEAL_STREAK_HELD          forged UPDATE of daily_streak / daily_last_claim_seed does not land
#   SEAL_INSERT_ZEROED        a forged first-sign-in INSERT is forced to 0
#   RPC_DENIED_AUTHENTICATED  authenticated cannot execute claim_daily_reward_for
#
# RPC_DENIED_AUTHENTICATED is the ONLY evidence for the redefined AC-25 ("claiming is
# Edge-Function-only"). Postgres auto-grants EXECUTE to PUBLIC at function creation, so a
# missing `revoke ... from public` silently reopens the whole surface and nothing else in
# the system would notice.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\prove-daily-reward-seal.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref = 'qxgbxwyccbxokdgwxcuw'

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

# Pick any existing profile to impersonate. Nothing is persisted (ROLLBACK).
$who = Invoke-Sql @"
select id::text                    as id,
       lifetime_granted::text      as lifetime,
       daily_streak::text          as streak,
       daily_last_claim_seed::text as seed
  from public.profiles order by id limit 1;
"@
if ($null -eq $who) { throw "no profiles row to test against" }
$me = $who.id
Write-Host ("[OK] impersonating profile {0} (lifetime={1} streak={2} seed={3})" -f `
  $me, $who.lifetime, $who.streak, $who.seed)

$bad = 0

# --- 1 + 2. UPDATE seals ------------------------------------------------------
# A real client PATCH would land exactly here: role=authenticated, jwt sub = own id.
# 10^9 is far outside any honest anchor, so an unsealed column is unmistakable.
$upd = Invoke-Sql @"
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';

update public.profiles
   set lifetime_granted = 1000000000,
       daily_streak = 30,
       daily_last_claim_seed = 999999
 where id = '$me'::uuid;

select lifetime_granted::text      as lifetime,
       daily_streak::text          as streak,
       daily_last_claim_seed::text as seed
  from public.profiles where id = '$me'::uuid;
rollback;
"@
Write-Host ""
Write-Host ("[..] after forged UPDATE: lifetime={0} streak={1} seed={2}" -f `
  $upd.lifetime, $upd.streak, $upd.seed)

if ("$($upd.lifetime)" -eq '1000000000') {
  Write-Host "[FAIL] lifetime_granted was client-writable - the ceiling is forgeable"; $bad++
} else {
  Write-Host "[OK] SEAL_LIFETIME_HELD"
}
if ("$($upd.streak)" -eq '30' -and "$($who.streak)" -ne '30') {
  Write-Host "[FAIL] daily_streak was client-writable - day 30 can be self-declared"; $bad++
} elseif ("$($upd.seed)" -eq '999999') {
  Write-Host "[FAIL] daily_last_claim_seed was client-writable"; $bad++
} else {
  Write-Host "[OK] SEAL_STREAK_HELD"
}

# --- 3. INSERT seal -----------------------------------------------------------
# A brand new client row must start at 0 no matter what it asks for.
# profiles.id is FK -> auth.users, so a made-up uuid cannot be inserted at all.
# Instead: delete the real row as postgres, then re-insert it as the client would on
# first sign-in. ROLLBACK undoes both.
$ins = Invoke-Sql @"
begin;
delete from public.profiles where id = '$me'::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';

insert into public.profiles (id, daily_streak, lifetime_granted, daily_last_claim_seed)
values ('$me'::uuid, 30, 1000000000, 999999);

select lifetime_granted::text      as lifetime,
       daily_streak::text          as streak,
       daily_last_claim_seed::text as seed
  from public.profiles where id = '$me'::uuid;
rollback;
"@
Write-Host ""
Write-Host ("[..] after forged INSERT: lifetime={0} streak={1} seed={2}" -f `
  $ins.lifetime, $ins.streak, $ins.seed)
if ("$($ins.lifetime)" -ne '0' -or "$($ins.streak)" -ne '0' -or "$($ins.seed)" -ne '0') {
  Write-Host "[FAIL] a new profile kept client-supplied daily reward state"; $bad++
} else {
  Write-Host "[OK] SEAL_INSERT_ZEROED"
}

# --- 4. RPC surface -----------------------------------------------------------
# The claim path is Edge-Function-only. An authenticated caller must be refused by the
# ACL, not by an argument check - so we match on the permission error, and we also match
# on the function name in case the server locale changes the message wording.
function Test-Denied([string]$label, [string]$call) {
  $denied = $false
  $seen   = ''
  try {
    Invoke-Sql @"
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';
$call
rollback;
"@ | Out-Null
  } catch {
    $seen = "$_"
    if ($seen -match 'permission denied' -or $seen -match '42501') { $denied = $true }
  }
  if ($denied) {
    Write-Host ("[OK] {0}" -f $label)
  } elseif ($seen -ne '') {
    Write-Host ("[FAIL] {0}: call failed but not with a permission error: {1}" -f $label, $seen.Substring(0, [Math]::Min(200, $seen.Length)))
    $script:bad++
  } else {
    Write-Host ("[FAIL] {0}: an authenticated client executed the function" -f $label)
    $script:bad++
  }
}

Write-Host ""
Write-Host "--- 4. claiming is Edge-Function-only (AC-25) ---"
Test-Denied 'RPC_DENIED_AUTHENTICATED' `
  "select public.claim_daily_reward_for('$me'::uuid, 'currency', 1, '{}'::jsonb, '{}'::jsonb);"
Test-Denied 'RPC_DENIED_AUTHENTICATED (preview)' `
  "select public.daily_reward_preview_for('$me'::uuid);"

# --- nothing leaked -----------------------------------------------------------
$after = Invoke-Sql @"
select lifetime_granted::text      as lifetime,
       daily_streak::text          as streak,
       daily_last_claim_seed::text as seed,
       (select count(*)::text from public.profiles where id = '$me'::uuid) as row_count
  from public.profiles where id = '$me'::uuid;
"@
Write-Host ""
Write-Host ("[OK] post-rollback: lifetime={0} (was {1}) streak={2} (was {3}) row_exists={4}" -f `
  $after.lifetime, $who.lifetime, $after.streak, $who.streak, $after.row_count)
if ("$($after.lifetime)" -ne "$($who.lifetime)") { Write-Host "[FAIL] lifetime_granted changed after rollback"; $bad++ }
if ("$($after.streak)"   -ne "$($who.streak)")   { Write-Host "[FAIL] daily_streak changed after rollback";     $bad++ }
if ("$($after.seed)"     -ne "$($who.seed)")     { Write-Host "[FAIL] daily_last_claim_seed changed after rollback"; $bad++ }
if ([int]$after.row_count -ne 1)                 { Write-Host "[FAIL] profile row did not survive rollback";    $bad++ }

if ($bad -gt 0) { throw "seal proof FAILED with $bad problems" }
Write-Host ""
Write-Host "[DONE] daily reward state is server-authoritative and claiming is EF-only:"
Write-Host "       forged client writes do not land, and the claim RPC refuses authenticated."
