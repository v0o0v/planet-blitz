# Planet Blitz - apply 20260810010000_invasion_ramp_reanchor.sql to the remote project.
#
# WHAT WAS BROKEN: the 20 NPC seed bases were EASIER than an unplaced defense.
#
#   The 2026-08-10 density lane moved the invasion baseline wholesale (garrison Lv75,
#   defense HP x201, defense damage x2, core HP x3, density defaults). Re-measuring the
#   seed ramp on that baseline showed its difficulty staircase was not merely buried -
#   its SIGN was flipped. 13 of 20 bases (the whole LOW and MID- bands) survived LONGER
#   under the reference bot than an EMPTY defense.
#
#   Two structural causes, neither reachable by nudging numbers:
#     (1) empty wave slots are backfilled by the garrison at Lv75, so `waves` (which left
#         slots empty) was a difficulty SUBTRACTOR, not a knob;
#     (2) the ramp level range (1..29) sat entirely BELOW the garrison level (75).
#
#   Fix is three ramp lines: waves = 6, level = 20 + 17(nn-1)/4 (20..100, anchored so
#   #14 == garrison level 75 and #20 == the measured Lv100 saturation point), and the
#   rarity onset moved nn5 -> nn8 so the LOW band is a pure level ramp.
#
# SCOPE: NPC fixed-UUID rows only ('000000de-f000-4000-8000-' || lpad(NN,12,'0'), NN=1..20).
#   Real player defenses use auth-issued UUIDs and cannot collide with this scheme.
#   Idempotent: the UPDATE converges to the same layout on re-run.
#
# DRIFT GUARD: tests/invasionBalance.test.ts string-compares the '-- RAMP:' header block
#   in this migration against the RAMP mirror in src/bench/invasionBands.ts.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-invasion-ramp-reanchor.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260810010000'
$name    = 'invasion_ramp_reanchor'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260810010000_invasion_ramp_reanchor.sql'

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

# The evidence query is the SAME before and after. What it reads is the actual stored
# layout of the NPC rows, not "did the statement run" - a migration that executes and
# changes nothing is the failure mode this repo keeps hitting.
$probe = @'
select
  count(*)                            as npc_rows,
  count(*) filter (where s.nulls > 0) as rows_with_empty_wave_slot,
  min(s.lv0)                          as min_wave_level,
  max(s.lv0)                          as max_wave_level,
  max(s.r0)  filter (where d.id = '000000de-f000-4000-8000-000000000005'::uuid) as rarity_at_nn5,
  max(s.lv0) filter (where d.id = '000000de-f000-4000-8000-000000000014'::uuid) as level_at_nn14
from public.defenses d
cross join lateral (
  select
    (select count(*) from jsonb_array_elements(d.layout->'l1'->'waveSlots') e
       where e = 'null'::jsonb)                        as nulls,
    (d.layout->'l1'->'waveSlots'->0->>'level')::int    as lv0,
    (d.layout->'l1'->'waveSlots'->0->>'rarity')::int   as r0
) s
where d.id::text like '000000de-f000-4000-8000-%'
'@

# --- BEFORE evidence --------------------------------------------------------
Write-Host ""
Write-Host "--- before ---"
$b = (Invoke-Sql $probe)[0]
Write-Host ("npc_rows                  = {0}  (expect 20)" -f $b.npc_rows)
Write-Host ("rows_with_empty_waveslot  = {0}  (old ramp leaves slots empty)" -f $b.rows_with_empty_wave_slot)
Write-Host ("wave level range          = {0}..{1}  (old ramp: 1..29)" -f $b.min_wave_level, $b.max_wave_level)
Write-Host ("rarity at #05             = {0}  (old ramp: 1)" -f $b.rarity_at_nn5)
Write-Host ("level  at #14             = {0}  (old ramp: 20)" -f $b.level_at_nn14)

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
Write-Host ""
Write-Host "--- after ---"
$a = (Invoke-Sql $probe)[0]
Write-Host ("npc_rows                  = {0}  (expect 20)" -f $a.npc_rows)
Write-Host ("rows_with_empty_waveslot  = {0}  (expect 0)" -f $a.rows_with_empty_wave_slot)
Write-Host ("wave level range          = {0}..{1}  (expect 20..100)" -f $a.min_wave_level, $a.max_wave_level)
Write-Host ("rarity at #05             = {0}  (expect 0)" -f $a.rarity_at_nn5)
Write-Host ("level  at #14             = {0}  (expect 75 = garrison level)" -f $a.level_at_nn14)

$ok = ($a.npc_rows -eq 20) -and ($a.rows_with_empty_wave_slot -eq 0) `
      -and ($a.min_wave_level -eq 20) -and ($a.max_wave_level -eq 100) `
      -and ($a.rarity_at_nn5 -eq 0) -and ($a.level_at_nn14 -eq 75)

Write-Host ""
if ($ok) { Write-Host "INVASION_RAMP_REANCHOR_OK" } else { Write-Host "INVASION_RAMP_REANCHOR_FAIL"; exit 1 }
