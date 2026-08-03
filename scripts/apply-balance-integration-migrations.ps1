# Planet Blitz - apply the two balance-integration migrations to the remote project.
#
#   20260803020000_invasion_band_restore_2.sql       (invasion seed ramp: rarity/ascension)
#   20260803030000_commission_segment_rebalance.sql  (issue_commission_for_run: segment count)
#
# Both are idempotent. They are applied in timestamp order; the two are independent
# (different tables / different functions) so a failure in one does not corrupt the other.
#
# NOTE the commission file was renamed from 20260803020000 to 20260803030000 during the
# 5-lane integration: the invasion migration had claimed the same version string, and
# supabase_migrations.schema_migrations keys on version (primary key), so one of the two
# would have been silently rejected on the remote.
#
# WARNING this migration pair MUST ship together with an Edge Function redeploy:
#   verify-commission  -- COMMISSION_WAVE_SEGMENTS_PER_SEGMENT lives inside its bundle.
#                         Without it, every honest commission run is rejected
#                         (outcome-mismatch).
#   verify-invasion    -- src/sim changed (fixed-point fire cadence); invasion per-tick
#                         hashes actually diverged, so a stale server rejects every replay.
# See .omc/skills/planet-blitz-supabase-deploy-workflow.md for the EF procedure.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-balance-integration-migrations.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref = 'qxgbxwyccbxokdgwxcuw'

$migrations = @(
  @{ version = '20260803020000'; name = 'invasion_band_restore_2';      file = '20260803020000_invasion_band_restore_2.sql' },
  @{ version = '20260803030000'; name = 'commission_segment_rebalance'; file = '20260803030000_commission_segment_rebalance.sql' }
)

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

foreach ($m in $migrations) {
  $file = Join-Path $PSScriptRoot ('..\supabase\migrations\' + $m.file)
  if (-not (Test-Path $file)) { throw "migration file not found: $file" }

  # NOT Get-Content -Raw (mangles the Korean comments).
  $sql = [IO.File]::ReadAllText((Resolve-Path $file), $utf8)
  Write-Host ""
  Write-Host ("[..] applying {0}_{1} ({2} chars)" -f $m.version, $m.name, $sql.Length)
  Invoke-Sql $sql | Out-Null
  Write-Host "[OK] applied"

  # Record it so a future `supabase db push` does not re-apply.
  Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$($m.version)', '$($m.name)') on conflict (version) do nothing;
"@ | Out-Null
  Write-Host "[OK] recorded in schema_migrations"
}

# --- verification: invasion ramp ---------------------------------------------
Write-Host ""
Write-Host "--- verification 1/2: invasion ramp on all 20 NPC rows ---"

# Expected per nn (mirrors the RAMP block in 20260803020000's header):
#   rarity     nn<=4 ->0  nn<=8 ->1  nn<=14 ->2  else 3   (grade 3 starts at nn15)
#   ascension  nn<=7 ->0  else 1                          (ascension 2/3 retired)
$rows = Invoke-Sql @"
with s as (
  select g as nn,
         (select layout from public.defenses
           where id = ('000000de-f000-4000-8000-' || lpad(g::text,12,'0'))::uuid) as l
    from generate_series(1,20) g
)
select nn,
       (l->'l2'->'sockets'->0->>'rarity')    as rarity,
       (l->'l2'->'sockets'->0->>'ascension') as asc_
  from s order by nn;
"@

$bad = 0
foreach ($r in $rows) {
  $nn = [int]$r.nn
  $expRarity = if ($nn -le 4) { '0' } elseif ($nn -le 8) { '1' } elseif ($nn -le 14) { '2' } else { '3' }
  $expAsc    = if ($nn -le 7) { '0' } else { '1' }
  if ("$($r.rarity)" -ne "$expRarity") { Write-Host ("[FAIL] nn={0} rarity={1} expected={2}" -f $nn, $r.rarity, $expRarity); $bad++ }
  if ("$($r.asc_)"   -ne "$expAsc")    { Write-Host ("[FAIL] nn={0} asc={1} expected={2}"    -f $nn, $r.asc_,   $expAsc);    $bad++ }
}
if ($bad -gt 0) { throw "invasion ramp verification FAILED with $bad mismatches" }
Write-Host "[OK] all 20 rows match the expected rarity/ascension ramp"

# --- verification: commission function ----------------------------------------
Write-Host ""
Write-Host "--- verification 2/2: issue_commission_for_run was replaced ---"
$fn = Invoke-Sql @"
select p.proname,
       (pg_get_functiondef(p.oid) like '%COMMISSION_SEGMENT_COUNT%') as has_marker
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'issue_commission_for_run';
"@
if (-not $fn) { throw "issue_commission_for_run not found" }
if (-not $fn.has_marker) { throw "issue_commission_for_run does not carry the new segment-count block" }
Write-Host "[OK] issue_commission_for_run carries the new segment-count block"

Write-Host ""
Write-Host "[DONE] both migrations are live."
Write-Host "       NEXT (REQUIRED): redeploy BOTH Edge Functions from origin/main --"
Write-Host "         verify-commission  (segment constant lives in its bundle)"
Write-Host "         verify-invasion    (src/sim fire-cadence change moved invasion hashes)"
Write-Host "       Procedure: .omc/skills/planet-blitz-supabase-deploy-workflow.md"
