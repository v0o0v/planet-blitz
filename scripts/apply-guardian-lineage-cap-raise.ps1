# Planet Blitz - apply 20260810000000_guardian_lineage_cap_raise.sql to the remote project.
#
# WHAT WAS BROKEN: the guardian-lineage curve was DUPLICATED on the server.
#
#   data/lineage.ts raised the guardian branch cap 5000 -> 37000 (2026-08-10) so that the
#   defender side could answer the attacker's pilot-level growth (x4.69 at Lv100), which
#   was unsealed in the same lane. But inject_guardian_authority(SQL) computes the curve
#   ITSELF:
#       v_bonus_bp := floor(5000.0 * v_level / (v_level + 20))::integer;
#       if v_bonus_bp > 5000 then v_bonus_bp := 5000; end if;
#   so real PvP guardians stayed capped at +50%. The TS constant moved, the actual stat
#   did not - the repo's recurring "silent no-op" shape.
#
# ROOT CAUSE IS THE DUPLICATION, NOT THE NUMBER. Fixing only the literal would leave the
#   same trap for the next curve change. This migration adds ONE server-side source
#   (public.lineage_guardian_bonus_bp) and makes the caller use it.
#
# SCOPE: inject_guardian_authority was created by M5 (20260718110000) and REDEFINED by
#   M7a (20260721000000) under the SAME NAME. Only the M7a definition is live, so there is
#   exactly one call site to fix. The body below is the M7a body with the two bonus lines
#   replaced. Milestone thresholds (10/25/50) and the slot cap (2) are untouched.
#
# DRIFT GUARD: tests/guardianLineageSqlDrift.test.ts compares the SQL constants AND the
#   numeric output against data/lineage.ts. It fails loudly if the two ever diverge again.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-guardian-lineage-cap-raise.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260810000000'
$name    = 'guardian_lineage_cap_raise'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260810000000_guardian_lineage_cap_raise.sql'

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
  # UTF-8 BYTES, not a string. Sending the string mangles Korean comments and the server
  # answers 400 at a byte offset, which looks like a SQL error but is an encoding error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- BEFORE evidence --------------------------------------------------------
Write-Host ""
Write-Host "--- before ---"

$before = Invoke-Sql @'
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'lineage_guardian_bonus_bp')  as helper_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inject_guardian_authority'
       and pg_get_functiondef(p.oid) like '%5000.0%')                          as caller_has_old_curve
'@
$b = $before[0]
Write-Host ("helper_exists         = {0}  (expect 0)" -f $b.helper_exists)
Write-Host ("caller_has_old_curve  = {0}  (expect 1)" -f $b.caller_has_old_curve)

# --- apply ------------------------------------------------------------------
Write-Host ""
Write-Host "--- applying ---"
$sql = Get-Content -Raw -Encoding UTF8 $file
Invoke-Sql $sql | Out-Null
Write-Host "[OK] migration executed"

# Record it in the migration ledger so `supabase db push` does not replay it.
$esc = $name.Replace("'", "''")
Invoke-Sql "insert into supabase_migrations.schema_migrations(version, name) values ('$version','$esc') on conflict (version) do nothing;" | Out-Null
Write-Host "[OK] ledger row recorded ($version)"

# --- AFTER evidence ---------------------------------------------------------
# The point is not "the function exists" but "the curve actually returns the new values
# AND the caller stopped computing its own". Both are measured.
Write-Host ""
Write-Host "--- after ---"

$after = Invoke-Sql @'
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'lineage_guardian_bonus_bp')  as helper_exists,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inject_guardian_authority'
       and pg_get_functiondef(p.oid) like '%5000.0%')                          as caller_has_old_curve,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'inject_guardian_authority'
       and pg_get_functiondef(p.oid) like '%lineage_guardian_bonus_bp%')       as caller_calls_helper,
  public.lineage_guardian_bonus_bp(0)     as bp_lv0,
  public.lineage_guardian_bonus_bp(20)    as bp_lv20,
  public.lineage_guardian_bonus_bp(100)   as bp_lv100,
  public.lineage_guardian_bonus_bp(-5)    as bp_neg
'@
$a = $after[0]
Write-Host ("helper_exists         = {0}  (expect 1)" -f $a.helper_exists)
Write-Host ("caller_has_old_curve  = {0}  (expect 0)" -f $a.caller_has_old_curve)
Write-Host ("caller_calls_helper   = {0}  (expect 1)" -f $a.caller_calls_helper)
Write-Host ("bp(0)                 = {0}  (expect 0)"     -f $a.bp_lv0)
Write-Host ("bp(20)                = {0}  (expect 18500)" -f $a.bp_lv20)
Write-Host ("bp(100)               = {0}  (expect 30833)" -f $a.bp_lv100)
Write-Host ("bp(-5)                = {0}  (expect 0)"     -f $a.bp_neg)

$ok = ($a.helper_exists -eq 1) -and ($a.caller_has_old_curve -eq 0) -and ($a.caller_calls_helper -eq 1) `
      -and ($a.bp_lv0 -eq 0) -and ($a.bp_lv20 -eq 18500) -and ($a.bp_lv100 -eq 30833) -and ($a.bp_neg -eq 0)

Write-Host ""
if ($ok) { Write-Host "GUARDIAN_LINEAGE_CAP_RAISE_OK" } else { Write-Host "GUARDIAN_LINEAGE_CAP_RAISE_FAIL"; exit 1 }
