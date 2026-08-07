# Planet Blitz - apply the six ADR-0050 item-ledger migrations to the remote project.
#
# Order is FILENAME order and it is a contract, not a preference:
#   1. 20260808000000_pve_run_registration  - pve_runs.started_at, begin_pve_run, axis D cap (60/h)
#   2. 20260808010000_item_grants_ledger    - server_secrets, item_grants, drop_odds_mirror,
#                                             grant_run_drops, mark_item_grant_applied
#                                             (DEPENDS on started_at from step 1 - flipping the
#                                              two makes grant_run_drops reference a missing column)
#   3. 20260808020000_invasion_rate_cap     - axis A invasion frequency cap (20/h)
#   4. 20260808030000_refine_server_roll    - roll_refine (spend + roll in one transaction)
#   5. 20260808040000_save_item_seal        - profiles.save item increment seal + items/ships RLS
#   6. 20260808050000_telemetry_rollup      - two marginalized daily cubes + cron
#
# WHY THIS IS URGENT (2026-08-08): the client auto-deploys on every push to main
# (.github/workflows/deploy-pages.yml). The live client already calls begin_pve_run /
# grant_run_drops / roll_refine, so until these land:
#   - refining is DEAD (roll_refine missing -> rollRefineOnServer returns failed and the client
#     deliberately does NOT roll, to keep free re-rolls closed), and
#   - configured accounts get ZERO run loot (begin_pve_run missing -> dropRunId null, and the
#     seal-aware client no longer degrades to a local roll for configured accounts).
# Both are restored the moment steps 1-4 are live.
#
# EF redeploy is NOT needed - all six are pure SQL.
#
# server_secrets seeds with `on conflict do nothing`, so re-running is safe. NEVER delete that
# seed row afterwards: changing the secret makes already-issued item_grants un-reconfirmable and
# every granted item becomes a different item.
#
# Every statement runs as `postgres`. That proves the objects EXIST with the right ACLs - never
# that the guards BITE. Guard proofs need an authenticated role and are out of scope here.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII literals in
# BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-item-ledger-migrations.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref = 'qxgbxwyccbxokdgwxcuw'

$steps = @(
  @{ version = '20260808000000'; name = 'pve_run_registration'; file = '20260808000000_pve_run_registration.sql' },
  @{ version = '20260808010000'; name = 'item_grants_ledger';   file = '20260808010000_item_grants_ledger.sql' },
  @{ version = '20260808020000'; name = 'invasion_rate_cap';    file = '20260808020000_invasion_rate_cap.sql' },
  @{ version = '20260808030000'; name = 'refine_server_roll';   file = '20260808030000_refine_server_roll.sql' },
  @{ version = '20260808040000'; name = 'save_item_seal';       file = '20260808040000_save_item_seal.sql' },
  @{ version = '20260808050000'; name = 'telemetry_rollup';     file = '20260808050000_telemetry_rollup.sql' }
)

$migDir = Join-Path $PSScriptRoot '..\supabase\migrations'
foreach ($s in $steps) {
  $p = Join-Path $migDir $s.file
  if (-not (Test-Path $p)) { throw "migration file not found: $p" }
}

$tokenFile = Join-Path $env:USERPROFILE '.supabase-pb.token'
if (-not (Test-Path $tokenFile)) { throw "token file not found: $tokenFile" }
$sec  = Get-Content $tokenFile | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$pat  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$hdr  = @{ Authorization = "Bearer $pat" }
$utf8 = [Text.Encoding]::UTF8

# Misdeploy guard - confirm the target project before writing anything.
$proj = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref" -Headers $hdr -Method Get
if ($proj.name -notmatch 'planet') { throw "refusing: project name '$($proj.name)' does not look like Planet Blitz" }
Write-Host "[OK] target project: $($proj.name) ($ref)"

function Invoke-Sql([string]$sql) {
  # UTF-8 BYTES, not a string. Sending the string mangles the Korean comments and the server
  # answers 400 at a byte offset, which reads like a SQL error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- preconditions -----------------------------------------------------------
# The tables these six build on top of must already be live. Applying onto a missing base would
# create functions that compile and fail on first call.
$pre = Invoke-Sql @"
select (select count(*) from pg_class where oid = to_regclass('public.pve_runs'))          as pve_runs,
       (select count(*) from pg_class where oid = to_regclass('public.profiles'))          as profiles,
       (select count(*) from pg_class where oid = to_regclass('public.commission_grants')) as com_grants,
       (select count(*) from pg_class where oid = to_regclass('public.daily_reward_claims')) as daily_claims,
       (select count(*) from pg_proc where proname = 'is_service_role'
          and pronamespace = 'public'::regnamespace)                                       as svc_fn,
       (select count(*) from pg_extension where extname = 'pg_cron')                       as cron_ext;
"@
Write-Host ("[OK] before: pve_runs={0} profiles={1} commission_grants={2} daily_reward_claims={3} is_service_role={4} pg_cron={5}" -f `
  $pre.pve_runs, $pre.profiles, $pre.com_grants, $pre.daily_claims, $pre.svc_fn, $pre.cron_ext)
if ([int]$pre.pve_runs     -ne 1) { throw "refusing: public.pve_runs does not exist" }
if ([int]$pre.profiles     -ne 1) { throw "refusing: public.profiles does not exist" }
if ([int]$pre.com_grants   -ne 1) { throw "refusing: public.commission_grants missing (the seal allowlist reads it)" }
if ([int]$pre.daily_claims -ne 1) { throw "refusing: public.daily_reward_claims missing (the seal allowlist reads it)" }
if ([int]$pre.svc_fn       -ne 1) { throw "refusing: public.is_service_role missing" }
if ([int]$pre.cron_ext     -ne 1) { throw "refusing: pg_cron not installed (telemetry rollup schedules on it)" }

# --- apply, in filename order ------------------------------------------------
foreach ($s in $steps) {
  $path = Resolve-Path (Join-Path $migDir $s.file)
  # NOT Get-Content -Raw (mangles the Korean comments).
  $sql  = [IO.File]::ReadAllText($path, $utf8)
  Write-Host ("[..] applying {0}_{1} ({2} chars)" -f $s.version, $s.name, $sql.Length)
  Invoke-Sql $sql | Out-Null
  Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$($s.version)', '$($s.name)') on conflict (version) do nothing;
"@ | Out-Null
  Write-Host ("[OK] applied and recorded: {0}_{1}" -f $s.version, $s.name)
}

# --- verification ------------------------------------------------------------
Write-Host ""
Write-Host "--- verification (postgres role: presence only, never bite) ---"
$bad = 0

# 1. Objects exist.
$obj = Invoke-Sql @"
select (select count(*) from pg_attribute
          where attrelid = 'public.pve_runs'::regclass and attname = 'started_at' and not attisdropped) as started_at,
       (select count(*) from pg_proc where proname = 'begin_pve_run'        and pronamespace = 'public'::regnamespace) as begin_fn,
       (select count(*) from pg_class where oid = to_regclass('public.server_secrets'))    as secrets_tbl,
       (select count(*) from pg_class where oid = to_regclass('public.item_grants'))       as grants_tbl,
       (select count(*) from pg_class where oid = to_regclass('public.drop_odds_mirror'))  as odds_tbl,
       (select count(*) from pg_proc where proname = 'grant_run_drops'      and pronamespace = 'public'::regnamespace) as drops_fn,
       (select count(*) from pg_proc where proname = 'mark_item_grant_applied' and pronamespace = 'public'::regnamespace) as mark_fn,
       (select count(*) from pg_proc where proname = 'roll_refine'          and pronamespace = 'public'::regnamespace) as refine_fn,
       (select count(*) from pg_proc where proname = 'seal_save_items'      and pronamespace = 'public'::regnamespace) as seal_fn,
       (select count(*) from pg_proc where proname = 'save_item_ids'        and pronamespace = 'public'::regnamespace) as ids_fn,
       (select count(*) from pg_proc where proname = 'item_id_ledgered'     and pronamespace = 'public'::regnamespace) as allow_fn,
       (select count(*) from pg_class where oid = to_regclass('public.telemetry_daily_planet_stage')) as cube1,
       (select count(*) from pg_class where oid = to_regclass('public.telemetry_daily_ship_level'))   as cube2,
       (select count(*) from pg_proc where proname = 'rollup_telemetry_daily' and pronamespace = 'public'::regnamespace) as rollup_fn;
"@
Write-Host ("[OK] objects: started_at={0} begin={1} secrets={2} item_grants={3} odds={4} grant_run_drops={5} mark={6} roll_refine={7} seal={8} save_item_ids={9} allowlist={10} cube1={11} cube2={12} rollup={13}" -f `
  $obj.started_at, $obj.begin_fn, $obj.secrets_tbl, $obj.grants_tbl, $obj.odds_tbl, $obj.drops_fn, `
  $obj.mark_fn, $obj.refine_fn, $obj.seal_fn, $obj.ids_fn, $obj.allow_fn, $obj.cube1, $obj.cube2, $obj.rollup_fn)
foreach ($k in @('started_at','begin_fn','secrets_tbl','grants_tbl','odds_tbl','drops_fn','mark_fn','refine_fn','seal_fn','ids_fn','allow_fn','cube1','cube2','rollup_fn')) {
  if ([int]$obj.$k -lt 1) { Write-Host "[FAIL] missing object: $k"; $bad++ }
}

# 2. The seal is actually WIRED into both guards. The functions existing proves nothing -
#    if the guard bodies do not call seal_save_items, the seal is dead code and the save
#    forgery path stays wide open. Strip `--` comments first: this repo writes its contracts
#    out at length in comments and those comments quote the identifiers being searched for.
$wired = Invoke-Sql @"
with d as (
  select p.proname,
         regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') as src
    from pg_proc p
   where p.proname in ('guard_profiles_client_write', 'guard_profiles_client_insert')
     and p.pronamespace = 'public'::regnamespace
)
select (select (src like '%seal_save_items(old.id, old.save, new.save)%')::text from d where proname = 'guard_profiles_client_write')  as upd_seal,
       (select (src like '%seal_save_items(new.id%')::text                      from d where proname = 'guard_profiles_client_insert') as ins_seal,
       (select (src like '%is_service_role()%')::text                          from d where proname = 'guard_profiles_client_write')  as upd_svc,
       (select (src like '%is_service_role()%')::text                            from d where proname = 'guard_profiles_client_insert') as ins_svc;
"@
Write-Host ("[OK] seal wiring: update={0} insert={1} update_svc_branch={2} insert_svc_branch={3}" -f `
  $wired.upd_seal, $wired.ins_seal, $wired.upd_svc, $wired.ins_svc)
if ($wired.upd_seal -ne 'true') { Write-Host "[FAIL] guard_profiles_client_write does not call seal_save_items(old.id, old.save, new.save)"; $bad++ }
if ($wired.ins_seal -ne 'true') { Write-Host "[FAIL] guard_profiles_client_insert does not call seal_save_items - INSERT bypasses the seal entirely"; $bad++ }
if ($wired.upd_svc  -ne 'true') { Write-Host "[FAIL] guard_profiles_client_write lost its is_service_role branch"; $bad++ }
if ($wired.ins_svc  -ne 'true') { Write-Host "[FAIL] guard_profiles_client_insert lost its is_service_role branch"; $bad++ }

# 3. The triggers that carry those guards are still attached. A perfect function body attached
#    to nothing is the same as no seal.
$trg = Invoke-Sql @"
select count(*) filter (where tgname = 'trg_profiles_guard')        as upd_trg,
       count(*) filter (where tgname = 'trg_profiles_guard_insert') as ins_trg
  from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
"@
Write-Host ("[OK] triggers on profiles: update={0} insert={1}" -f $trg.upd_trg, $trg.ins_trg)
if ([int]$trg.upd_trg -ne 1) { Write-Host "[FAIL] trg_profiles_guard is not attached"; $bad++ }
if ([int]$trg.ins_trg -ne 1) { Write-Host "[FAIL] trg_profiles_guard_insert is not attached"; $bad++ }

# 4. items / ships client write policies are gone; select survives.
$pol = Invoke-Sql @"
select count(*) filter (where tablename in ('items','ships') and cmd = 'ALL')                          as for_all,
       count(*) filter (where tablename = 'items' and policyname = 'items_select_own')                 as items_sel,
       count(*) filter (where tablename = 'ships' and policyname = 'ships_select_own')                 as ships_sel,
       count(*) filter (where tablename in ('telemetry_daily_planet_stage','telemetry_daily_ship_level')) as telem_pol
  from pg_policies where schemaname = 'public';
"@
Write-Host ("[OK] policies: items/ships FOR ALL={0} items_select_own={1} ships_select_own={2} telemetry_policies={3}" -f `
  $pol.for_all, $pol.items_sel, $pol.ships_sel, $pol.telem_pol)
if ([int]$pol.for_all   -ne 0) { Write-Host "[FAIL] a FOR ALL client write policy survives on items/ships"; $bad++ }
if ([int]$pol.items_sel -ne 1) { Write-Host "[FAIL] items_select_own missing - reads are now blocked too"; $bad++ }
if ([int]$pol.ships_sel -ne 1) { Write-Host "[FAIL] ships_select_own missing - reads are now blocked too"; $bad++ }
if ([int]$pol.telem_pol -ne 0) { Write-Host "[FAIL] a client policy exists on a telemetry rollup table"; $bad++ }

# 5. The ledger has no client write policy either, and server_secrets is fully private.
$led = Invoke-Sql @"
select count(*) filter (where tablename = 'item_grants' and cmd <> 'SELECT')  as grants_write,
       count(*) filter (where tablename = 'item_grants')                      as grants_any,
       count(*) filter (where tablename = 'server_secrets')                   as secrets_any
  from pg_policies where schemaname = 'public';
"@
Write-Host ("[OK] ledger policies: item_grants write={0} any={1} server_secrets any={2}" -f `
  $led.grants_write, $led.grants_any, $led.secrets_any)
if ([int]$led.grants_write -ne 0) { Write-Host "[FAIL] item_grants has a client write policy - 'the client does not know what will drop' is now false"; $bad++ }
if ([int]$led.secrets_any  -ne 0) { Write-Host "[FAIL] server_secrets is reachable by a client policy - offline seed search reopens"; $bad++ }

# 6. The server secret seeded exactly once and is non-empty. Do NOT print it.
$sec2 = Invoke-Sql "select count(*) as n, coalesce(bool_and(length(value) > 0), false)::text as filled from public.server_secrets;"
Write-Host ("[OK] server_secrets: rows={0} all_non_empty={1}" -f $sec2.n, $sec2.filled)
if ([int]$sec2.n -lt 1)      { Write-Host "[FAIL] server_secrets is empty - grant_run_drops cannot derive seeds"; $bad++ }
if ($sec2.filled -ne 'true') { Write-Host "[FAIL] a server_secrets row has an empty value"; $bad++ }

# 7. cron jobs registered.
$cron = Invoke-Sql "select count(*) as n from cron.job where command like '%rollup_telemetry_daily%' or command like '%telemetry_daily_%';"
Write-Host ("[OK] telemetry cron jobs: {0}" -f $cron.n)
if ([int]$cron.n -lt 1) { Write-Host "[FAIL] no telemetry cron job registered - the rollup never runs"; $bad++ }

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] the ADR-0050 item ledger is live end to end: run registration + axis D cap,"
Write-Host "       server-rolled drops in item_grants, axis A invasion cap, server refine roll,"
Write-Host "       profiles.save increment seal, and the two telemetry cubes."
Write-Host "[NOTE] EF redeploy is NOT needed - all six are pure SQL."
Write-Host "[NEVER] delete the server_secrets seed row. Changing it makes every already-issued"
Write-Host "        item_grants row reconfirm as a DIFFERENT item."
