# Planet Blitz - roll back 20260805000000_daily_reward.sql on the remote project.
#
# WHAT THIS DOES NOT DO, AND WHY IT MATTERS MOST
#
# It does NOT retype the previous bodies of the three replaced functions. Hand-copying a
# `create or replace function` body is exactly the shape that took PvE settlement down
# 100% in production (20260802000000:4-15 replayed a stale body that referenced a dropped
# column). So this script READS the migration tree and SLICES the live-before-us
# definitions out of it:
#
#   guard_profiles_client_write   <- supabase/migrations/20260731000000_catalyst_shop.sql
#   guard_profiles_client_insert  <- supabase/migrations/20260731000000_catalyst_shop.sql
#   grant_currency_for            <- supabase/migrations/20260803000000_commission_ledger.sql
#
# If a later migration ever revises one of these again, this script must be pointed at
# that file instead - it prints which file each block came from so the operator can see it.
#
# WHY THE COLUMNS AND THE TABLE ARE LEFT IN PLACE
#
# Dropping them is the only irreversible step available here:
#   - profiles.lifetime_granted is a MONOTONIC accumulator whose backfill source has
#     already expired (currency_grants and pve_runs are both 7-day GC). Drop it and the
#     value can never be reconstructed - every player would restart at the FLOOR ceiling.
#   - daily_reward_claims doubles as the equipment mailbox. Rows with applied_at IS NULL
#     are items the player has not received yet; deleting them loses the item forever.
# Leaving them costs nothing once the trigger and the RPCs are gone: nothing writes them,
# the reverted seal simply stops mentioning them (a client UPDATE to a column no gate
# guards would land, but with no reader left the value is inert), and re-applying the
# migration converges because the backfill is guarded by `where lifetime_granted = 0`.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\rollback-daily-reward-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260805000000'

$utf8 = [Text.Encoding]::UTF8

$shopFile   = Join-Path $PSScriptRoot '..\supabase\migrations\20260731000000_catalyst_shop.sql'
$ledgerFile = Join-Path $PSScriptRoot '..\supabase\migrations\20260803000000_commission_ledger.sql'
foreach ($f in @($shopFile, $ledgerFile)) {
  if (-not (Test-Path $f)) { throw "source migration not found: $f" }
}

# Slice `create or replace function public.<name>(` ... `\n$$;` out of a migration file.
# The terminator is built from a char code so the literal dollar pair never meets the
# PowerShell parser.
function Get-FunctionBlock([string]$path, [string]$name) {
  $sql    = [IO.File]::ReadAllText((Resolve-Path $path), $utf8)
  $marker = "create or replace function public.$name("
  $at     = $sql.LastIndexOf($marker)
  if ($at -lt 0) { throw "$([IO.Path]::GetFileName($path)): no definition of $name" }
  $term = [string][char]10 + [string][char]36 + [string][char]36 + ';'
  $end  = $sql.IndexOf($term, $at)
  if ($end -lt $at) { throw "$([IO.Path]::GetFileName($path)): no terminator after $name" }
  return $sql.Substring($at, $end - $at + $term.Length)
}

$writeBlock  = Get-FunctionBlock $shopFile   'guard_profiles_client_write'
$insertBlock = Get-FunctionBlock $shopFile   'guard_profiles_client_insert'
$grantBlock  = Get-FunctionBlock $ledgerFile 'grant_currency_for'

# Sanity: the sliced blocks must be the PRE-daily-reward shape. If a slice accidentally
# grabbed the new bodies, the rollback would be a no-op that reports success.
if ($writeBlock  -match 'lifetime_granted') { throw "sliced guard_profiles_client_write already contains the new columns" }
if ($insertBlock -match 'daily_streak')     { throw "sliced guard_profiles_client_insert already contains the new columns" }
if ($grantBlock  -match 'CAP_DAILY_REWARD') { throw "sliced grant_currency_for already contains the daily_reward cap" }
if ($grantBlock  -notmatch 'CAP_COMMISSION_CREDITS') { throw "sliced grant_currency_for lost the commission cap - wrong slice" }

Write-Host ("[OK] sliced guard_profiles_client_write  ({0} chars) from {1}" -f $writeBlock.Length,  [IO.Path]::GetFileName($shopFile))
Write-Host ("[OK] sliced guard_profiles_client_insert ({0} chars) from {1}" -f $insertBlock.Length, [IO.Path]::GetFileName($shopFile))
Write-Host ("[OK] sliced grant_currency_for           ({0} chars) from {1}" -f $grantBlock.Length,  [IO.Path]::GetFileName($ledgerFile))

$tokenFile = Join-Path $env:USERPROFILE '.supabase-pb.token'
if (-not (Test-Path $tokenFile)) { throw "token file not found: $tokenFile" }
$sec  = Get-Content $tokenFile | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$pat  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$hdr = @{ Authorization = "Bearer $pat" }

$proj = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref" -Headers $hdr -Method Get
if ($proj.name -notmatch 'planet') { throw "refusing: project name '$($proj.name)' does not look like Planet Blitz" }
Write-Host "[OK] target project: $($proj.name) ($ref)"

function Invoke-Sql([string]$sql) {
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- 1. detach the anchor ------------------------------------------------------
# Trigger first, then its function: the reverse of the install order, so no window
# exists where the trigger points at a missing function.
Write-Host ""
Write-Host "--- 1. anchor trigger ---"
Invoke-Sql @"
drop trigger if exists trg_currency_grants_anchor on public.currency_grants;
drop function if exists public.trg_daily_reward_anchor_bump();
"@ | Out-Null
Write-Host "[OK] trigger and trigger function dropped"

# --- 2. drop the new RPCs ------------------------------------------------------
# These are new surface, not data. Dropping them is what makes the rollback real:
# leaving them would keep a service_role entry point that writes columns nothing
# guards any more.
Write-Host ""
Write-Host "--- 2. daily reward RPCs ---"
Invoke-Sql @"
drop function if exists public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb);
drop function if exists public.daily_reward_preview_for(uuid);
drop function if exists public.mark_daily_reward_applied(bigint);
drop function if exists public.mark_daily_reward_hold(bigint, text);
"@ | Out-Null
Write-Host "[OK] claim / preview / mark_applied / mark_hold dropped"

# --- 3. restore the two seals from the tree ------------------------------------
Write-Host ""
Write-Host "--- 3. seals (sliced, not retyped) ---"
Invoke-Sql $writeBlock  | Out-Null
Invoke-Sql $insertBlock | Out-Null
Write-Host "[OK] guard_profiles_client_write / _insert restored to their 20260731000000 bodies"

# --- 4. restore grant_currency_for ---------------------------------------------
# `create or replace` preserves the existing ACL, but the revokes are idempotent and
# cheap - re-running them removes any doubt about the PUBLIC auto-grant.
Write-Host ""
Write-Host "--- 4. grant_currency_for ---"
Invoke-Sql $grantBlock | Out-Null
Invoke-Sql @"
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from public;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from anon;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from authenticated;
grant execute on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) to service_role;
"@ | Out-Null
Write-Host "[OK] grant_currency_for restored to its 20260803000000 body (acl re-asserted)"

# --- 5. unrecord the migration -------------------------------------------------
Invoke-Sql "delete from supabase_migrations.schema_migrations where version = '$version';" | Out-Null
Write-Host "[OK] removed $version from schema_migrations"

# --- verification --------------------------------------------------------------
Write-Host ""
Write-Host "--- verification ---"
$bad = 0

$state = Invoke-Sql @"
select (select count(*) from pg_trigger
         where tgname = 'trg_currency_grants_anchor' and not tgisinternal)          as anchor_trigger,
       (select count(*) from pg_proc p where p.proname = 'claim_daily_reward_for'
          and p.pronamespace = 'public'::regnamespace)                              as claim_fn,
       (select bool_or(pg_get_functiondef(p.oid) like '%lifetime_granted%')
          from pg_proc p where p.proname = 'guard_profiles_client_write'
           and p.pronamespace = 'public'::regnamespace)                             as write_has_new,
       (select bool_or(pg_get_functiondef(p.oid) like '%catalyst_residue%')
          from pg_proc p where p.proname = 'guard_profiles_client_write'
           and p.pronamespace = 'public'::regnamespace)                             as write_has_residue,
       (select bool_or(pg_get_functiondef(p.oid) like '%daily_streak%')
          from pg_proc p where p.proname = 'guard_profiles_client_insert'
           and p.pronamespace = 'public'::regnamespace)                             as insert_has_new,
       (select bool_or(pg_get_functiondef(p.oid) like '%CAP_DAILY_REWARD_CREDITS%')
          from pg_proc p where p.proname = 'grant_currency_for'
           and p.pronamespace = 'public'::regnamespace)                             as grant_has_daily,
       (select bool_or(pg_get_functiondef(p.oid) like '%CAP_COMMISSION_CREDITS%')
          from pg_proc p where p.proname = 'grant_currency_for'
           and p.pronamespace = 'public'::regnamespace)                             as grant_has_commission;
"@
Write-Host ("[OK] anchor_trigger={0} claim_fn={1} write_new={2} write_residue={3} insert_new={4} grant_daily={5} grant_commission={6}" -f `
  $state.anchor_trigger, $state.claim_fn, $state.write_has_new, $state.write_has_residue, `
  $state.insert_has_new, $state.grant_has_daily, $state.grant_has_commission)

if ([int]$state.anchor_trigger -ne 0) { Write-Host "[FAIL] the anchor trigger is still installed"; $bad++ }
if ([int]$state.claim_fn -ne 0)       { Write-Host "[FAIL] claim_daily_reward_for still exists";   $bad++ }
if ($state.write_has_new)             { Write-Host "[FAIL] the UPDATE seal still mentions lifetime_granted"; $bad++ }
if ($state.insert_has_new)            { Write-Host "[FAIL] the INSERT seal still mentions daily_streak";     $bad++ }
if ($state.grant_has_daily)           { Write-Host "[FAIL] grant_currency_for still carries the daily cap";  $bad++ }
# The regression that matters more than the rollback itself: reverting the seal must not
# lose catalyst_residue (the 20260726000000 body predates it - slicing the wrong file
# reopens unlimited catalyst buying).
if (-not $state.write_has_residue)    { Write-Host "[FAIL] the restored UPDATE seal lost catalyst_residue - unlimited catalyst buying is open"; $bad++ }
if (-not $state.grant_has_commission) { Write-Host "[FAIL] the restored grant_currency_for lost the commission cap"; $bad++ }

# The columns and the ledger table are intentionally still here.
$kept = Invoke-Sql @"
select (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'
           and column_name in ('daily_last_claim_seed', 'daily_streak', 'lifetime_granted')) as cols,
       (select count(*)::text from pg_class where oid = to_regclass('public.daily_reward_claims')) as ledger,
       (select count(*)::text from public.daily_reward_claims where applied_at is null)      as undelivered;
"@
Write-Host ("[OK] kept on purpose: profiles columns={0}/3 ledger_table={1} undelivered_rows={2}" -f `
  $kept.cols, $kept.ledger, $kept.undelivered)
if ([int]$kept.cols -ne 3) { Write-Host "[FAIL] a profiles column was dropped - the anchor cannot be reconstructed"; $bad++ }

if ($bad -gt 0) { throw "rollback verification FAILED with $bad problems" }
Write-Host ""
Write-Host "[DONE] daily reward rolled back. Columns and the claim ledger were kept on purpose"
Write-Host "       (dropping them is the only irreversible step here). Re-applying the migration"
Write-Host "       converges: the backfill is guarded by 'where lifetime_granted = 0'."
