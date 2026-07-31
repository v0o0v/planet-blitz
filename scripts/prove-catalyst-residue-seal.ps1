# Planet Blitz - prove that a client CANNOT write profiles.catalyst_residue.
#
# Why a separate script: apply-catalyst-shop-migration.ps1 runs every statement as
# `postgres`, and guard_profiles_client_write() short-circuits on is_service_role()
# by design. So that script can confirm the guard EXISTS but never that it BITES.
# A seal you only read the source of is not a seal you have tested.
#
# What this does instead: inside a transaction it drops to the `authenticated` role
# and forges the JWT claims PostgREST would set, so the request is indistinguishable
# from a real client `PATCH /rest/v1/profiles`. Then it tries to write residue and
# reads the value back. Everything runs inside BEGIN ... ROLLBACK, so no row is
# modified even if the guard were broken.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\prove-catalyst-residue-seal.ps1

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
$who = Invoke-Sql "select id::text as id, catalyst_residue::text as residue from public.profiles order by id limit 1;"
if ($null -eq $who) { throw "no profiles row to test against" }
Write-Host ("[OK] impersonating profile {0} (residue now = {1})" -f $who.id, $who.residue)

$bad = 0

# --- 1. UPDATE seal ----------------------------------------------------------
# A real client PATCH would land exactly here: role=authenticated, jwt sub = own id.
$upd = Invoke-Sql @"
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$($who.id)","role":"authenticated"}';

update public.profiles
   set catalyst_residue = 999999, credits = 999999, minerals = 999999
 where id = '$($who.id)'::uuid;

select catalyst_residue::text as residue,
       credits::text          as credits,
       minerals::text         as minerals
  from public.profiles where id = '$($who.id)'::uuid;
rollback;
"@
Write-Host ("[..] after forged UPDATE: residue={0} credits={1} minerals={2}" -f `
  $upd.residue, $upd.credits, $upd.minerals)
if ("$($upd.residue)" -eq '999999') { Write-Host "[FAIL] catalyst_residue was client-writable"; $bad++ }
else { Write-Host "[OK] catalyst_residue unchanged - UPDATE seal holds" }
if ("$($upd.credits)"  -eq '999999') { Write-Host "[FAIL] credits was client-writable";  $bad++ }
if ("$($upd.minerals)" -eq '999999') { Write-Host "[FAIL] minerals was client-writable"; $bad++ }

# --- 2. INSERT seal ----------------------------------------------------------
# A brand new client row must start at 0 no matter what it asks for.
# profiles.id is FK -> auth.users, so a made-up uuid cannot be inserted at all.
# Instead: delete the real row as postgres, then re-insert it as the client would
# on first sign-in. ROLLBACK undoes both.
$ins = Invoke-Sql @"
begin;
delete from public.profiles where id = '$($who.id)'::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"$($who.id)","role":"authenticated"}';

insert into public.profiles (id, catalyst_residue, credits, minerals)
values ('$($who.id)'::uuid, 999999, 999999, 999999);

select catalyst_residue::text as residue,
       credits::text          as credits,
       minerals::text         as minerals
  from public.profiles where id = '$($who.id)'::uuid;
rollback;
"@
Write-Host ("[..] after forged INSERT: residue={0} credits={1} minerals={2}" -f `
  $ins.residue, $ins.credits, $ins.minerals)
if ("$($ins.residue)" -ne '0') { Write-Host "[FAIL] new profile kept a client-supplied catalyst_residue"; $bad++ }
else { Write-Host "[OK] catalyst_residue forced to 0 - INSERT seal holds" }
if ("$($ins.credits)"  -ne '0') { Write-Host "[FAIL] new profile kept client credits";  $bad++ }
if ("$($ins.minerals)" -ne '0') { Write-Host "[FAIL] new profile kept client minerals"; $bad++ }

# --- 3. nothing leaked -------------------------------------------------------
$after = Invoke-Sql @"
select catalyst_residue::text as residue, credits::text as credits, minerals::text as minerals,
       (select count(*) from public.profiles where id = '$($who.id)'::uuid) as row_count
  from public.profiles where id = '$($who.id)'::uuid;
"@
Write-Host ("[OK] post-rollback: residue={0} (was {1}) row_exists={2}" -f `
  $after.residue, $who.residue, $after.row_count)
if ("$($after.residue)" -ne "$($who.residue)") { Write-Host "[FAIL] residue changed after rollback"; $bad++ }
if ([int]$after.row_count -ne 1)               { Write-Host "[FAIL] profile row did not survive rollback"; $bad++ }

if ($bad -gt 0) { throw "seal proof FAILED with $bad problems" }
Write-Host ""
Write-Host "[DONE] catalyst_residue is server-authoritative: forged client writes do not land."
