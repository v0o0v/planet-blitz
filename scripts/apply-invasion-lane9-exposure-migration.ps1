# Planet Blitz - apply 20260728013000_invasion_lane9_exposure.sql to the remote project.
#
# This single migration is SELF-CONTAINED: it rewrites all 20 NPC defense layouts,
# including everything 20260727020000 landed (band restore + boss order). Applying
# this one file alone lands the final state.
#
# What changes: only the lower band (nn 1..7) formation/facility catalog window, so
# every Lane9 defender (formations 8..11, facilities 9..16) becomes visible on NPC
# seed bases. nn>=8 layouts are byte-identical to 20260727020000 on purpose.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-invasion-lane9-exposure-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260728013000'
$name    = 'invasion_lane9_exposure'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260728013000_invasion_lane9_exposure.sql'

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

# --- before ------------------------------------------------------------------
$before = Invoke-Sql @"
select count(*) as n
  from public.defenses
 where id in (select ('000000de-f000-4000-8000-' || lpad(g::text,12,'0'))::uuid
                from generate_series(1,20) g);
"@
Write-Host ("[OK] NPC seed rows found: {0}/20" -f $before.n)
if ([int]$before.n -ne 20) { throw "refusing: expected exactly 20 NPC seed rows" }

# NOT Get-Content -Raw (mangles the Korean comments).
$sql = [IO.File]::ReadAllText((Resolve-Path $file), $utf8)
Write-Host "[..] applying $version`_$name ($($sql.Length) chars)"
Invoke-Sql $sql | Out-Null
Write-Host "[OK] migration applied"

# Record it so a future `supabase db push` does not re-apply.
Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$version', '$name') on conflict (version) do nothing;
"@ | Out-Null
Write-Host "[OK] recorded in schema_migrations"

# --- verification ------------------------------------------------------------
Write-Host ""
Write-Host "--- verification: every catalog id is exposed across the 20 NPC rows ---"

# The whole point of this migration: the union of formation/facility catalog ids
# used by the 20 seed bases must cover the full catalogs (12 formations, 17
# facilities). A hole here means Lane9 content is still invisible in-game.
$cov = Invoke-Sql @"
with s as (
  select g as nn,
         (select layout from public.defenses
           where id = ('000000de-f000-4000-8000-' || lpad(g::text,12,'0'))::uuid) as l
    from generate_series(1,20) g
),
f as (select distinct (e->>'catalogId')::int as id
        from s, jsonb_array_elements(l->'l1'->'waveSlots') e where e <> 'null'::jsonb),
c as (select distinct (e->>'catalogId')::int as id
        from s, jsonb_array_elements(l->'l2'->'sockets') e where e <> 'null'::jsonb)
select (select count(*) from f)          as formations,
       (select max(id)   from f)         as formation_max,
       (select count(*) from c)          as facilities,
       (select max(id)   from c)         as facility_max;
"@
$cov | Format-Table -AutoSize | Out-String | Write-Host

$bad = 0
if ([int]$cov.formations -ne 12 -or [int]$cov.formation_max -ne 11) {
  Write-Host ("[FAIL] formations exposed={0} max={1} expected=12/11" -f $cov.formations, $cov.formation_max); $bad++
}
if ([int]$cov.facilities -ne 17 -or [int]$cov.facility_max -ne 16) {
  Write-Host ("[FAIL] facilities exposed={0} max={1} expected=17/16" -f $cov.facilities, $cov.facility_max); $bad++
}

# Difficulty neutrality: nn>=8 must be untouched by this migration. Re-check the
# same ramp columns the band-restore script verified.
$rows = Invoke-Sql @"
with s as (
  select g as nn,
         (select layout from public.defenses
           where id = ('000000de-f000-4000-8000-' || lpad(g::text,12,'0'))::uuid) as l
    from generate_series(1,20) g
)
select nn,
       (l->'l3'->'boss'->>'catalogId')                            as boss,
       (select count(*) from jsonb_array_elements(l->'l3'->'props') e
         where e <> 'null'::jsonb)                                as props,
       (l->'l2'->'sockets'->0->>'rarity')                         as rarity,
       (l->'l2'->'sockets'->0->>'ascension')                      as asc_,
       (l->'l2'->'sockets'->0->>'level')                          as lvl,
       (l->'l2'->'sockets'->0->>'catalogId')                      as fac0
  from s order by nn;
"@
$rows | Format-Table -AutoSize | Out-String | Write-Host

foreach ($r in $rows) {
  $nn = [int]$r.nn
  $expBoss   = if ($nn -le 4) { $null } elseif ($nn -le 10) { '2' } elseif ($nn -le 16) { '0' } else { '1' }
  $expProps  = if ($nn -le 4) { 0 } elseif ($nn -le 7) { 2 } else { 5 }
  $expRarity = if ($nn -le 4) { '0' } elseif ($nn -le 8) { '1' } elseif ($nn -le 11) { '2' } else { '3' }
  $expAsc    = if ($nn -le 7) { '0' } elseif ($nn -le 10) { '1' } elseif ($nn -le 16) { '2' } else { '3' }
  # socket 0 catalogId == facilityShift for the lower band, 0 for nn>=8.
  $shift     = @(0, 2, 4, 7, 10, 14, 1)
  $expFac0   = if ($nn -le 7) { "$($shift[$nn - 1])" } else { '0' }
  if ("$($r.boss)"   -ne "$expBoss")  { Write-Host ("[FAIL] nn={0} boss={1} expected={2}"   -f $nn, $r.boss,   $expBoss);   $bad++ }
  if ([int]$r.props  -ne $expProps)   { Write-Host ("[FAIL] nn={0} props={1} expected={2}"  -f $nn, $r.props,  $expProps);  $bad++ }
  if ("$($r.rarity)" -ne $expRarity)  { Write-Host ("[FAIL] nn={0} rarity={1} expected={2}" -f $nn, $r.rarity, $expRarity); $bad++ }
  if ("$($r.asc_)"   -ne $expAsc)     { Write-Host ("[FAIL] nn={0} asc={1} expected={2}"    -f $nn, $r.asc_,   $expAsc);    $bad++ }
  if ("$($r.fac0)"   -ne "$expFac0")  { Write-Host ("[FAIL] nn={0} socket0={1} expected={2}" -f $nn, $r.fac0,  $expFac0);   $bad++ }
}

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }
Write-Host "[OK] full catalog exposed (12 formations / 17 facilities) and ramp columns match"
Write-Host ""
Write-Host "[DONE] Lane9 defenders are now visible on the remote NPC seed bases."
