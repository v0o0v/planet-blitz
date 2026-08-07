# Planet Blitz - apply 20260808060000_catalyst_axis_mirror_resonance.sql to the remote project.
#
# ADR-0052: catalyst rebuild. 48 unique double-edged rules, unique injection, 3 slots.
# What this migration lands:
#   1. catalyst_defs.cap_axis / cap_mult / tags  (+ 48-row seed refresh)
#   2. catalyst_defs.resource_mult re-seeded with its NEW meaning
#      (was: per-stack additive share. now: resource-axis per-card cap, 1 when off-axis)
#   3. catalyst_resonances  -> new table, 12 rows, mirrored from TS
#   4. catalyst_cap_resource_mult_max()  -> clamp moved out of a derived expression
#   5. consume_catalysts  -> gates (e) no duplicates + (f) at most 2 signatures,
#      receipt formula switched to  1 + SUM(resource-axis cap - 1) * 0.5
#      with the run's resonance folded into the same axis sum
#
# Everything is additive (add column if not exists / create or replace), so a
# re-run converges.
#
# ⚠️ DO NOT RUN THIS BEFORE THE CLIENT SHIPS.
#   consume_catalysts starts rejecting duplicate catalysts and 3-signature loadouts.
#   A client that still lets players build those loadouts will have sorties fail at
#   the server. Client first, SQL second - the same order the SLOT_CAP 8->3 change used.
#
# ⚠️ THE 48-ROW SEED IS DERIVED FROM src/data/catalysts.ts.
#   If the catalogue is re-tagged or a cap is retuned, regenerate the seed block in
#   the .sql BEFORE applying. tests/catalystAxisMirrorContract.test.ts locks the
#   TS <-> SQL agreement, so run `npx vitest run tests/catalystAxisMirrorContract.test.ts`
#   first - if it is green, the seed in the file matches TS.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles
# non-ASCII literals in BOM-less .ps1 files, and a mojibake'd success line reads
# like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-catalyst-axis-mirror-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260808060000'
$name    = 'catalyst_axis_mirror_resonance'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260808060000_catalyst_axis_mirror_resonance.sql'

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
# The seed only ever takes the `on conflict do update` branch. If rows were missing,
# the insert would create rows the TS mirror does not know about.
$pre = Invoke-Sql "select count(*) as n from public.catalyst_defs;"
Write-Host ("[OK] catalyst_defs rows before: {0}/48" -f $pre.n)
if ([int]$pre.n -ne 48) { throw "refusing: expected exactly 48 catalyst_defs rows" }

# SLOT_CAP must already be 3 on the remote (20260807000000). Applying the new
# consume_catalysts on top of a SLOT_CAP-8 remote is fine functionally, but if that
# earlier migration was never applied then the client/server contract is further out
# of sync than this script assumes and someone should look before proceeding.
$slot = Invoke-Sql @"
select (pg_get_functiondef(p.oid) like '%SLOT_CAP%constant%int%:= 3%') as slot_cap_3
  from pg_proc p
 where p.proname = 'consume_catalysts' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] remote consume_catalysts has SLOT_CAP 3: {0}" -f $slot.slot_cap_3)
if (-not $slot.slot_cap_3) {
  Write-Host "[WARN] remote is not on SLOT_CAP 3 yet (20260807000000 unapplied?)."
  Write-Host "[WARN] this migration redefines consume_catalysts with SLOT_CAP 3 anyway."
}

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
#
# NOTE: these checks are deliberately STRUCTURAL, not value-exact.
# The exact per-card cap/tag values are already locked by
# tests/catalystAxisMirrorContract.test.ts against the TS mirror, and hardcoding
# them here would make this script go stale the moment the catalogue is retuned -
# which is exactly what happened to several older seeds in this repo.
# What this script proves is that the migration LANDED and left nothing unseeded.

Write-Host ""
Write-Host "--- verification ---"
$bad = 0

# 1. new columns exist, and every one of the 48 rows is actually populated.
$cols = Invoke-Sql @"
select
  count(*)                                                as rows_total,
  count(*) filter (where cap_axis is null)                as null_axis,
  count(*) filter (where cap_mult is null)                as null_mult,
  count(*) filter (where tags is null or array_length(tags, 1) is null) as empty_tags,
  count(*) filter (where array_length(tags, 1) > 2)       as too_many_tags,
  count(*) filter (where cap_mult > 2.6)                  as cap_over_max,
  count(*) filter (where resource_mult is null)           as null_resource
  from public.catalyst_defs;
"@
Write-Host ("[OK] defs: rows={0} null_axis={1} null_mult={2} empty_tags={3} tags>2={4} cap>2.6={5} null_resource={6}" -f `
  $cols.rows_total, $cols.null_axis, $cols.null_mult, $cols.empty_tags, $cols.too_many_tags, $cols.cap_over_max, $cols.null_resource)
if ([int]$cols.rows_total    -ne 48) { Write-Host "[FAIL] expected 48 rows";                    $bad++ }
if ([int]$cols.null_axis     -ne 0)  { Write-Host "[FAIL] some rows have no cap_axis";          $bad++ }
if ([int]$cols.null_mult     -ne 0)  { Write-Host "[FAIL] some rows have no cap_mult";          $bad++ }
if ([int]$cols.empty_tags    -ne 0)  { Write-Host "[FAIL] some rows have no tags";              $bad++ }
if ([int]$cols.too_many_tags -ne 0)  { Write-Host "[FAIL] some rows carry more than 2 tags";    $bad++ }
if ([int]$cols.cap_over_max  -ne 0)  { Write-Host "[FAIL] some cap_mult exceeds the 2.6 ceiling"; $bad++ }
if ([int]$cols.null_resource -ne 0)  { Write-Host "[FAIL] some rows have no resource_mult";     $bad++ }

# 2. cap_axis vocabulary is exactly the five the TS type allows.
$axes = Invoke-Sql "select cap_axis, count(*) as n from public.catalyst_defs group by cap_axis order by cap_axis;"
$axes | Format-Table -AutoSize | Out-String | Write-Host
$allowed = @('catalystDrop','drop','rarity','resource','xp')
foreach ($a in $axes) {
  if ($allowed -notcontains $a.cap_axis) { Write-Host ("[FAIL] unknown cap_axis '{0}'" -f $a.cap_axis); $bad++ }
}

# 3. resource_mult semantics flipped: off-axis rows must be exactly 1, NOT 0.
#    (0 was the OLD meaning. The composition formula is 1 + SUM(cap - 1) * k, so the
#     identity element is 1 - leaving 0 there would subtract from every receipt.)
$res = Invoke-Sql @"
select count(*) filter (where cap_axis <> 'resource' and resource_mult <> 1) as offaxis_not_one,
       count(*) filter (where cap_axis =  'resource' and resource_mult <= 1) as onaxis_not_gt_one
  from public.catalyst_defs;
"@
Write-Host ("[OK] resource_mult: offaxis_not_1={0} onaxis_not_gt_1={1}" -f $res.offaxis_not_one, $res.onaxis_not_gt_one)
if ([int]$res.offaxis_not_one   -ne 0) { Write-Host "[FAIL] off-axis rows must be resource_mult = 1 (old seed left behind?)"; $bad++ }
if ([int]$res.onaxis_not_gt_one -ne 0) { Write-Host "[FAIL] resource-axis rows must be resource_mult > 1"; $bad++ }

# 4. resonance table: 12 rows = 6 tags x 2 tiers, no gaps.
$reso = Invoke-Sql @"
select count(*) as n,
       count(distinct tag) as tags,
       count(*) filter (where tier not in ('weak','strong')) as bad_tier
  from public.catalyst_resonances;
"@
Write-Host ("[OK] resonances: rows={0} tags={1} bad_tier={2}" -f $reso.n, $reso.tags, $reso.bad_tier)
if ([int]$reso.n        -ne 12) { Write-Host "[FAIL] expected 12 resonance rows"; $bad++ }
if ([int]$reso.tags     -ne 6)  { Write-Host "[FAIL] expected 6 distinct tags";   $bad++ }
if ([int]$reso.bad_tier -ne 0)  { Write-Host "[FAIL] tier must be weak|strong";   $bad++ }

# 5. clamp function exists and is callable.
$clamp = Invoke-Sql "select public.catalyst_cap_resource_mult_max() as v;"
Write-Host ("[OK] catalyst_cap_resource_mult_max() = {0}" -f $clamp.v)
if ($null -eq $clamp.v) { Write-Host "[FAIL] clamp function missing"; $bad++ }

# 6. consume_catalysts really grew the two new gates. Body-text checks, same
#    technique the guard-function checks in the shop migration use.
$gates = Invoke-Sql @"
select
  (pg_get_functiondef(p.oid) ilike '%duplicate%')  as has_duplicate_gate,
  (pg_get_functiondef(p.oid) ilike '%signature%')  as has_signature_gate,
  (pg_get_functiondef(p.oid) ilike '%0.5%')        as has_compose_factor
  from pg_proc p
 where p.proname = 'consume_catalysts' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] consume gates: duplicate={0} signature={1} compose_0.5={2}" -f `
  $gates.has_duplicate_gate, $gates.has_signature_gate, $gates.has_compose_factor)
if (-not $gates.has_duplicate_gate) { Write-Host "[FAIL] (e) duplicate gate not found in body";  $bad++ }
if (-not $gates.has_signature_gate) { Write-Host "[FAIL] (f) signature cap gate not found";      $bad++ }
if (-not $gates.has_compose_factor) { Write-Host "[FAIL] composition factor 0.5 not found";      $bad++ }

# 7. execute grants: anon must NOT be able to consume catalysts.
$acl = Invoke-Sql @"
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('anon',          p.oid, 'execute') as anon_exec
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('consume_catalysts', 'catalyst_cap_resource_mult_max')
 order by p.proname;
"@
$acl | Format-Table -AutoSize | Out-String | Write-Host
foreach ($a in $acl) {
  if ($a.proname -eq 'consume_catalysts') {
    if (-not $a.auth_exec) { Write-Host "[FAIL] consume_catalysts: authenticated cannot execute"; $bad++ }
    if ($a.anon_exec)      { Write-Host "[FAIL] consume_catalysts: anon CAN execute";             $bad++ }
  }
}

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] catalyst axis mirror + resonance table are live."
Write-Host "[NOTE] CAP_RESOURCE_MULT_MAX now has ONE declaration site:"
Write-Host "       catalyst_cap_resource_mult_max() in 20260808060000 = 3.2"
Write-Host "       (48C3 sweep, resource-axis max 3.20, 2026-08-08 re-tagged run)."
Write-Host "       Both consume_catalysts and grant_currency_for call that fn."
Write-Host "       The 2.2 literal left in 20260807000000 is history - do NOT raise it."
Write-Host "       Re-run pnpm cap:sweep AFTER any catalogue re-tagging or resonance change."
