# Planet Blitz - apply 20260731000000_catalyst_shop.sql to the remote project.
#
# ADR-0042: catalyst shop paid for with catalyst residue, a closed currency.
# What this migration lands:
#   1. profiles.catalyst_residue (numeric, >= 0)
#   2. guard_profiles_client_write  8 -> 9 assignments (client UPDATE seal)
#   3. guard_profiles_client_insert 2 -> 3 assignments (client INSERT forces 0)
#   4. catalyst_defs.buy_price + 48-row price seed mirrored from TS
#   5. salvage_catalyst  -> pays residue, no longer calls grant_currency
#   6. buy_catalyst      -> new RPC, spends residue
#
# Everything is additive (add column if not exists / create or replace), so a
# re-run converges. To roll back, re-apply the original function bodies from
# 20260727000000_catalyst_ledger.sql - they are still in the tree.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles
# non-ASCII literals in BOM-less .ps1 files, and a mojibake'd success line reads
# like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-catalyst-shop-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260731000000'
$name    = 'catalyst_shop'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260731000000_catalyst_shop.sql'

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
# catalyst_defs must already hold all 48 rows: the new 2-column seed only ever
# takes the `on conflict do update` branch. If rows were missing, the insert
# would create planet-NULL rows and signature catalysts would go on sale.
$pre = Invoke-Sql "select count(*) as n from public.catalyst_defs;"
Write-Host ("[OK] catalyst_defs rows before: {0}/48" -f $pre.n)
if ([int]$pre.n -ne 48) { throw "refusing: expected exactly 48 catalyst_defs rows" }

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
Write-Host "--- verification ---"
$bad = 0

# 1. residue column: exists, numeric, not null, default 0, and has a >= 0 check.
$col = Invoke-Sql @"
select c.data_type, c.is_nullable, c.column_default,
       (select count(*) from pg_constraint k
         where k.conrelid = 'public.profiles'::regclass
           and k.contype = 'c'
           and pg_get_constraintdef(k.oid) ilike '%catalyst_residue%'
           and pg_get_constraintdef(k.oid) like '%>=%') as check_count
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'profiles'
   and c.column_name = 'catalyst_residue';
"@
if ($null -eq $col) { Write-Host "[FAIL] profiles.catalyst_residue column missing"; $bad++ }
else {
  Write-Host ("[OK] catalyst_residue: type={0} nullable={1} default={2} check={3}" -f `
    $col.data_type, $col.is_nullable, $col.column_default, $col.check_count)
  if ($col.data_type -ne 'numeric')  { Write-Host "[FAIL] expected numeric";      $bad++ }
  if ($col.is_nullable -ne 'NO')     { Write-Host "[FAIL] expected NOT NULL";     $bad++ }
  if ([int]$col.check_count -lt 1)   { Write-Host "[FAIL] missing >= 0 check";    $bad++ }
}

# 2. price seed: the remote table must match the TS mirror exactly.
#    Expected distribution: 10 x25 (id 0-24) / 50 x4 (25-28) / 100 x1 (29) /
#    12 x12 and 25 x6 (signatures) = 48 rows, none left at the default 0.
$prices = Invoke-Sql @"
select buy_price, count(*) as n
  from public.catalyst_defs
 group by buy_price order by buy_price;
"@
$prices | Format-Table -AutoSize | Out-String | Write-Host
$expected = @{ 10 = 25; 12 = 12; 25 = 6; 50 = 4; 100 = 1 }
$seen = @{}
foreach ($p in $prices) { $seen[[int]$p.buy_price] = [int]$p.n }
foreach ($k in $expected.Keys) {
  if ($seen[$k] -ne $expected[$k]) {
    Write-Host ("[FAIL] buy_price {0}: {1} rows, expected {2}" -f $k, $seen[$k], $expected[$k]); $bad++
  }
}
if ($seen.ContainsKey(0)) { Write-Host ("[FAIL] {0} rows still at buy_price 0 (price-unset)" -f $seen[0]); $bad++ }

# 3. purchasable predicate agreement: planet IS NULL must be exactly id < 30.
$pred = Invoke-Sql @"
select count(*) filter (where planet is null)                    as common_rows,
       count(*) filter (where planet is null and catalyst_id >= 30) as leaked_signature,
       count(*) filter (where planet is not null and catalyst_id < 30) as leaked_common
  from public.catalyst_defs;
"@
Write-Host ("[OK] planet IS NULL rows: {0} (leaks: sig={1} common={2})" -f `
  $pred.common_rows, $pred.leaked_signature, $pred.leaked_common)
if ([int]$pred.common_rows -ne 30 -or [int]$pred.leaked_signature -ne 0 -or [int]$pred.leaked_common -ne 0) {
  Write-Host "[FAIL] purchasable predicate mismatch (expected exactly 30 common, id < 30)"; $bad++
}

# 4. guard functions: the column-enumerating trigger IS the currency seal, so a
#    missing assignment means that column is client-forgeable.
$guards = Invoke-Sql @"
select
  (select count(*) from pg_proc p,
          lateral regexp_matches(pg_get_functiondef(p.oid), 'new\.\w+ := old\.\w+', 'g')
    where p.proname = 'guard_profiles_client_write'
      and p.pronamespace = 'public'::regnamespace)                              as write_assigns,
  (select (pg_get_functiondef(p.oid) like '%catalyst_residue := old.catalyst_residue%')
     from pg_proc p where p.proname = 'guard_profiles_client_write'
      and p.pronamespace = 'public'::regnamespace)                              as write_has_residue,
  (select count(*) from pg_proc p,
          lateral regexp_matches(pg_get_functiondef(p.oid), 'new\.\w+ := 0', 'g')
    where p.proname = 'guard_profiles_client_insert'
      and p.pronamespace = 'public'::regnamespace)                              as insert_assigns,
  (select (pg_get_functiondef(p.oid) like '%catalyst_residue := 0%')
     from pg_proc p where p.proname = 'guard_profiles_client_insert'
      and p.pronamespace = 'public'::regnamespace)                              as insert_has_residue;
"@
Write-Host ("[OK] guards: write={0} assigns (residue={1}) / insert={2} assigns (residue={3})" -f `
  $guards.write_assigns, $guards.write_has_residue, $guards.insert_assigns, $guards.insert_has_residue)
if ([int]$guards.write_assigns  -ne 9)     { Write-Host "[FAIL] write guard expected 9 assignments";  $bad++ }
if ([int]$guards.insert_assigns -ne 3)     { Write-Host "[FAIL] insert guard expected 3 assignments"; $bad++ }
if (-not $guards.write_has_residue)        { Write-Host "[FAIL] write guard missing catalyst_residue";  $bad++ }
if (-not $guards.insert_has_residue)       { Write-Host "[FAIL] insert guard missing catalyst_residue"; $bad++ }

# 5. RPC surface: buy_catalyst exists, salvage_catalyst no longer grants currency.
$rpc = Invoke-Sql @"
select
  (select count(*) from pg_proc p where p.proname = 'buy_catalyst'
     and p.pronamespace = 'public'::regnamespace)                      as buy_exists,
  (select (pg_get_functiondef(p.oid) like '%grant_currency%')
     from pg_proc p where p.proname = 'salvage_catalyst'
      and p.pronamespace = 'public'::regnamespace)                     as salvage_calls_grant_currency,
  (select (pg_get_functiondef(p.oid) like '%catalyst_residue%')
     from pg_proc p where p.proname = 'salvage_catalyst'
      and p.pronamespace = 'public'::regnamespace)                     as salvage_pays_residue;
"@
Write-Host ("[OK] rpc: buy_catalyst={0} salvage_grant_currency={1} salvage_residue={2}" -f `
  $rpc.buy_exists, $rpc.salvage_calls_grant_currency, $rpc.salvage_pays_residue)
if ([int]$rpc.buy_exists -ne 1)             { Write-Host "[FAIL] buy_catalyst not created";            $bad++ }
if ($rpc.salvage_calls_grant_currency)      { Write-Host "[FAIL] salvage_catalyst still calls grant_currency"; $bad++ }
if (-not $rpc.salvage_pays_residue)         { Write-Host "[FAIL] salvage_catalyst does not pay residue"; $bad++ }

# 6. execute grants: anon must NOT be able to call either RPC.
$acl = Invoke-Sql @"
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('anon',          p.oid, 'execute') as anon_exec
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('buy_catalyst', 'salvage_catalyst')
 order by p.proname;
"@
$acl | Format-Table -AutoSize | Out-String | Write-Host
foreach ($a in $acl) {
  if (-not $a.auth_exec) { Write-Host ("[FAIL] {0}: authenticated cannot execute" -f $a.proname); $bad++ }
  if ($a.anon_exec)      { Write-Host ("[FAIL] {0}: anon CAN execute" -f $a.proname);             $bad++ }
}

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] catalyst shop is live on the remote project."
Write-Host "[NOTE] the client-write seal still needs a live PATCH /profiles proof -"
Write-Host "       this script runs as postgres, which is_service_role() lets through by design."
