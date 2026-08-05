# Planet Blitz - apply 20260805010000_commission_grant_delivery.sql to the remote project.
#
# What it installs (ADR-0045 follow-up - the delivery half that was never wired):
#   1. commission_grants.applied_at (nullable) + a partial index on the undelivered rows
#   2. mark_commission_grant_applied(uuid) - authenticated, auth.uid()-pinned, own rows only
#   3. an AFTER INSERT trigger that lands kind='blueprint' rows into defense_blueprints
#      server-side (no client step), wrapped in a subtransaction
#
# Why this exists at all. settle_commission writes commission_grants rows for unique and
# blueprint payouts, and those rows were the ONLY record - nothing ever put the item in a
# player's hands. The unique axis needs a client step (items live in profiles.save, a
# client rw mirror, so the server has nowhere to put them), which is what applied_at and
# the mark RPC are for. The blueprint axis does not: defense_blueprints is already server
# authoritative, so the trigger finishes it without the client involved.
#
# LATENT, NOT LIVE. issue_commission_for_run currently writes only credits/minerals/items:[]
# into payload.rewards, so commission_grants gets zero rows today. This migration builds the
# rail; it starts carrying the day reward authoring fills those fields.
#
# Everything is additive and re-runnable (add column if not exists / create index if not
# exists / create or replace function / drop trigger if exists -> create).
#
# IMPORTANT: this script runs every statement as `postgres`, so it can only show the pieces
# EXIST. mark_commission_grant_applied pins auth.uid(), which is null for postgres - that
# path is exercised by the client, not here.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-commission-grant-delivery-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260805010000'
$name    = 'commission_grant_delivery'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260805010000_commission_grant_delivery.sql'

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
  # UTF-8 BYTES, not a string. Sending the string mangles the Korean comments and the
  # server answers 400 at a byte offset, which reads like a SQL error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- preconditions -----------------------------------------------------------
$pre = Invoke-Sql @"
select (select count(*) from pg_class where oid = to_regclass('public.commission_grants'))   as grants_tbl,
       (select count(*) from pg_class where oid = to_regclass('public.defense_blueprints'))  as bp_tbl,
       (select count(*) from public.commission_grants)                                       as grant_rows;
"@
Write-Host ("[OK] before: commission_grants={0} defense_blueprints={1} rows={2}" -f `
  $pre.grants_tbl, $pre.bp_tbl, $pre.grant_rows)
if ([int]$pre.grants_tbl -ne 1) { throw "refusing: commission_grants does not exist (apply 20260803000000 first)" }
if ([int]$pre.bp_tbl     -ne 1) { throw "refusing: defense_blueprints does not exist (apply 20260722000000 first)" }

# --- apply -------------------------------------------------------------------
$sql = Get-Content -Raw -Encoding UTF8 $file
Write-Host ("[..] applying {0}_{1}.sql ({2} bytes)" -f $version, $name, $utf8.GetByteCount($sql))
Invoke-Sql $sql | Out-Null
Write-Host "[OK] MIGRATION_APPLIED"

# --- post-checks -------------------------------------------------------------
$post = Invoke-Sql @"
select (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'commission_grants'
            and column_name = 'applied_at')                                      as applied_col,
       (select count(*) from pg_indexes
          where schemaname = 'public' and tablename = 'commission_grants'
            and indexdef ilike '%applied_at is null%')                           as partial_idx,
       (select count(*) from pg_proc
          where proname = 'mark_commission_grant_applied'
            and pronamespace = 'public'::regnamespace)                           as mark_fn,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = 'commission_grants' and not t.tgisinternal)           as triggers,
       (select count(*) from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'settle_commission'
            and pg_get_functiondef(p.oid) ilike '%commission_grants%')            as settle_intact;
"@
Write-Host ("[..] after: applied_at={0} partial_idx={1} mark_fn={2} triggers={3} settle_intact={4}" -f `
  $post.applied_col, $post.partial_idx, $post.mark_fn, $post.triggers, $post.settle_intact)

$bad = 0
if ([int]$post.applied_col   -ne 1) { Write-Host "[FAIL] commission_grants.applied_at missing"; $bad++ }
if ([int]$post.partial_idx   -lt 1) { Write-Host "[FAIL] partial index on applied_at is null missing"; $bad++ }
if ([int]$post.mark_fn       -ne 1) { Write-Host "[FAIL] mark_commission_grant_applied missing"; $bad++ }
if ([int]$post.triggers      -lt 1) { Write-Host "[FAIL] no trigger on commission_grants"; $bad++ }
if ([int]$post.settle_intact -ne 1) { Write-Host "[FAIL] settle_commission no longer references commission_grants"; $bad++ }

# The mark RPC must be reachable by the client - the unique axis has no other way to
# report delivery. (claim_daily_reward_for is the opposite case and is checked elsewhere.)
$acl = Invoke-Sql @"
select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text as auth_can
  from pg_proc p
 where p.proname = 'mark_commission_grant_applied' and p.pronamespace = 'public'::regnamespace
 limit 1;
"@
if ($null -eq $acl -or $acl.auth_can -ne 'true') {
  Write-Host "[FAIL] authenticated cannot execute mark_commission_grant_applied - delivery can never be marked"
  $bad++
} else {
  Write-Host "[OK] AUTHENTICATED_CAN_MARK"
}

if ($bad -eq 0) {
  Write-Host "[OK] DELIVERY_RAIL_INSTALLED"
  Write-Host "[..] note: commission_grants has $($pre.grant_rows) row(s). The reward generator does"
  Write-Host "[..]       not populate uniqueId/blueprints yet, so the rail is idle until it does."
  exit 0
}
Write-Host ("[FAIL] {0} check(s) failed" -f $bad)
exit 1
