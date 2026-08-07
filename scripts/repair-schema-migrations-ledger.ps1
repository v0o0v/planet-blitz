# Planet Blitz - record migrations that are already applied but missing from the ledger.
#
# WHAT THIS FIXES
# ---------------
# `supabase_migrations.schema_migrations` is a LEDGER, not the truth. A 2026-08-08 audit (repo
# migration filenames vs. that table) found two entries missing:
#
#   20260805010000_commission_grant_delivery   - schema: column, index, trigger fn, trigger,
#                                                RPC + its grant to `authenticated`
#   20260727011000_invasion_boss_ramp_order    - DATA ONLY: a DO block that reseeds the 20 NPC
#                                                defense layouts. Installs no objects at all.
#
# ⚠️ WHY THE LEDGER DRIFTS AT ALL, AND WHY A FILENAME AUDIT IS NOT PROOF
#    Earlier lanes applied migrations through the supabase MCP `apply_migration` tool, and that
#    tool stamps its OWN version (the application timestamp), not the filename's. The header of
#    20260727011000 says so outright. So "filename version is absent from schema_migrations"
#    means "possibly unapplied", never "unapplied" - the same migration may already be recorded
#    under a wall-clock version. Always confirm against the DATABASE, not the ledger.
#
# ⭐ THE ORDER HERE IS THE WHOLE POINT: prove each migration's effect is ALREADY PRESENT first,
#    and only then write the ledger row. Recording a partially-applied migration as applied is
#    strictly worse than the hole - it makes the missing half invisible forever.
#
# ⭐ A DATA-ONLY MIGRATION CANNOT BE CHECKED BY OBJECT EXISTENCE. For 20260727011000 the proof is
#    a FINGERPRINT of the data it writes: NPC nn must carry l3.boss.affixSeed = nn*4000 and
#    level = 1 + (3*(nn-1))/2, with budget_spent reset to 0. The lowest few NPCs intentionally
#    get `boss: null` (the migration leaves them unplaced), so the check counts matches +
#    intentional nulls and requires the two to cover all 20 rows.
#
# These are bookkeeping holes, not functional ones. They still matter: anyone who later runs
# `supabase db push` sees an unrecorded migration and tries to re-apply it - and re-running the
# boss-ramp reseed would silently overwrite live NPC defense layouts.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII literals in
# BOM-less .ps1 files, and mojibake reads like a failure).
#
#   powershell -ExecutionPolicy Bypass -File scripts\repair-schema-migrations-ledger.ps1

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

$bad = 0
function Record([string]$version, [string]$name) {
  Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$version', '$name') on conflict (version) do nothing;
"@ | Out-Null
  $after = Invoke-Sql "select count(*) as n from supabase_migrations.schema_migrations where version = '$version';"
  Write-Host ("[OK] recorded {0}_{1} (ledger rows: {2})" -f $version, $name, $after.n)
  if ([int]$after.n -ne 1) { Write-Host "[FAIL] ledger row for $version did not land"; $script:bad++ }
}

# =============================================================================
# 20260805010000_commission_grant_delivery - schema. Object existence is the proof.
# =============================================================================
$o = Invoke-Sql @"
select (select count(*) from pg_attribute
          where attrelid = to_regclass('public.commission_grants')
            and attname = 'applied_at' and not attisdropped)                       as col_applied_at,
       (select count(*) from pg_class where relname = 'commission_grants_pending_idx') as idx_pending,
       (select count(*) from pg_proc where proname = 'trg_commission_grant_blueprint'
          and pronamespace = 'public'::regnamespace)                               as fn_blueprint,
       (select count(*) from pg_trigger where tgname = 'trg_commission_grants_blueprint'
          and not tgisinternal)                                                    as trg_blueprint,
       (select count(*) from pg_proc where proname = 'mark_commission_grant_applied'
          and pronamespace = 'public'::regnamespace)                               as fn_mark,
       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
          where p.proname = 'mark_commission_grant_applied'
            and p.pronamespace = 'public'::regnamespace)                           as grant_auth;
"@
Write-Host ("[OK] objects: applied_at={0} pending_idx={1} blueprint_fn={2} blueprint_trg={3} mark_fn={4} grant_auth={5}" -f `
  $o.col_applied_at, $o.idx_pending, $o.fn_blueprint, $o.trg_blueprint, $o.fn_mark, $o.grant_auth)

$missing = 0
foreach ($k in @('col_applied_at','idx_pending','fn_blueprint','trg_blueprint','fn_mark')) {
  if ([int]$o.$k -lt 1) { Write-Host "[FAIL] missing object: $k"; $missing++ }
}
if ($o.grant_auth -ne 'True' -and $o.grant_auth -ne $true) { Write-Host "[FAIL] authenticated cannot execute mark_commission_grant_applied"; $missing++ }
if ($missing -gt 0) {
  throw "refusing to record 20260805010000: $missing object(s) missing. It is only PARTIALLY applied - apply it properly instead of recording it."
}
Record '20260805010000' 'commission_grant_delivery'

# =============================================================================
# 20260727011000_invasion_boss_ramp_order - DATA ONLY. The proof is a fingerprint
# of the rows the DO block writes; there are no objects to look for.
# =============================================================================
$f = Invoke-Sql @"
with npc as (select generate_series(1, 20) as nn)
select count(*) as rows_found,
       count(*) filter (where d.budget_spent = 0) as budget_zero,
       count(*) filter (where (d.layout->'l3'->'boss'->>'affixSeed')::bigint = npc.nn * 4000
                          and (d.layout->'l3'->'boss'->>'level')::int = 1 + ((3 * (npc.nn - 1)) / 2)) as ramp_match,
       count(*) filter (where d.layout->'l3'->'boss' = 'null'::jsonb) as boss_null
  from npc
  join public.defenses d
    on d.id = ('000000de-f000-4000-8000-' || lpad(npc.nn::text, 12, '0'))::uuid;
"@
Write-Host ("[OK] boss ramp fingerprint: rows={0} budget_zero={1} ramp_match={2} boss_null={3}" -f `
  $f.rows_found, $f.budget_zero, $f.ramp_match, $f.boss_null)

$missing = 0
if ([int]$f.rows_found -ne 20) { Write-Host "[FAIL] expected 20 NPC defense rows"; $missing++ }
if ([int]$f.budget_zero -ne 20) { Write-Host "[FAIL] budget_spent was not reset on every NPC"; $missing++ }
# Every row must be explained: either it matches the ramp formula, or the migration deliberately
# left it bossless. A row that is neither means the reseed never ran (or ran with other numbers).
if (([int]$f.ramp_match + [int]$f.boss_null) -ne 20) {
  Write-Host "[FAIL] $(20 - [int]$f.ramp_match - [int]$f.boss_null) NPC row(s) match neither the ramp formula nor the intentional null"
  $missing++
}
# Guard against the degenerate 'everything is null' reading, which would satisfy the sum above
# while proving nothing about the ramp.
if ([int]$f.ramp_match -lt 1) { Write-Host "[FAIL] no NPC matches the ramp formula - the reseed did not run"; $missing++ }
if ($missing -gt 0) {
  throw "refusing to record 20260727011000: the NPC defense data does not carry this migration's fingerprint. APPLY it instead of recording it."
}
Record '20260727011000' 'invasion_boss_ramp_order'

Write-Host ""
if ($bad -gt 0) { throw "ledger repair FAILED with $bad mismatches" }
Write-Host "[DONE] both migrations are recorded. 'supabase db push' will no longer try to re-apply"
Write-Host "       them - which matters most for the boss ramp, since re-running that DO block"
Write-Host "       would silently overwrite live NPC defense layouts."
