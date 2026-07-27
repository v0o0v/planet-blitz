# Planet Blitz - apply 20260727010000_planet_popularity.sql to the remote project (ADR-0038)
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-planet-popularity-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260727010000'
$name    = 'planet_popularity'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260727010000_planet_popularity.sql'

if (-not (Test-Path $file)) { throw "migration file not found: $file" }

# PAT from the DPAPI-protected token file (same source the `spb` wrapper uses).
$tokenFile = Join-Path $env:USERPROFILE '.supabase-pb.token'
if (-not (Test-Path $tokenFile)) { throw "token file not found: $tokenFile" }
$sec = Get-Content $tokenFile | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$pat  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$hdr = @{ Authorization = "Bearer $pat" }
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

# --- verification -----------------------------------------------------------
Write-Host ""
Write-Host "--- verification ---"

$objs = Invoke-Sql @"
select
  (select count(*) from pg_tables  where schemaname='public' and tablename='planet_popularity')          as tbl,
  (select count(*) from pg_views   where schemaname='public' and viewname='planet_popularity_current')   as vw,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='refresh_planet_popularity')                                  as fn,
  (select count(*) from cron.job where jobname like 'planet-blitz-%planet-popularity')                    as jobs;
"@
Write-Host ("[OK] table={0} view={1} function={2} cron_jobs={3}" -f $objs.tbl, $objs.vw, $objs.fn, $objs.jobs)

# Seed the first snapshot immediately so the client stops falling back to 1.0.
# Safe to run more than once: the function is a no-op if this epoch already exists.
Invoke-Sql "select public.refresh_planet_popularity();" | Out-Null
# Read run_count/contributors from the BASE TABLE, not the view. The view deliberately
# exposes only what the client polls (planet, mult_centi, epoch) -- selecting run_count
# from it fails with 42703. Keep the view minimal; widen the query instead.
$rows = Invoke-Sql @"
select p.planet, p.mult_centi, p.epoch, p.run_count, p.contributors
  from public.planet_popularity p
  where p.epoch = (select max(epoch) from public.planet_popularity)
  order by p.planet;
"@
Write-Host "[OK] first snapshot:"
$rows | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "[DONE] planet popularity is live. Expect mult_centi=100 across the board until"
Write-Host "       real PvE settlements accumulate in the 1-hour window."
