# Planet Blitz - apply 20260802000000_settle_pve_run_column_restore.sql to the remote project.
#
# 20260726000300 dropped pve_runs.replay / pve_runs.client_result. The next-but-one
# redefinition of settle_pve_run (20260727010000_planet_popularity) was cloned from
# the PRE-drop body and INSERTs those columns again, so every online PvE settlement
# fails with 42703 and the catalyst receipt passthrough was lost along the way.
# This migration re-defines settle_pve_run merging both multiplier axes without the
# dropped columns. It is create-or-replace only, so a re-run converges.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-settle-pve-run-restore-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260802000000'
$name    = 'settle_pve_run_column_restore'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260802000000_settle_pve_run_column_restore.sql'

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
  # UTF-8 BYTES, not a string. Sending the string mangles the Korean comments and
  # the server answers 400 at a byte offset, which reads like a SQL error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# Calls settle_pve_run as a real profile inside a transaction that is rolled back,
# and reports the sqlstate/sqlerrm. This is the only check that proves the RPC works
# end to end - a schema diff cannot, because the function body is what is broken.
function Test-Settle {
  $probe = @"
begin;
create temp table probe_out(val text) on commit drop;
do `$`$
declare v_uid uuid; r jsonb;
begin
  select profile_id into v_uid from public.pve_runs order by created_at desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  begin
    r := public.settle_pve_run('{"resources":0,"minerals":0,"finalTick":100,"stage":1}'::jsonb);
    insert into probe_out values ('OK ' || r::text);
  exception when others then
    insert into probe_out values ('ERROR ' || sqlstate || ' ' || sqlerrm);
  end;
end
`$`$;
select val from probe_out;
rollback;
"@
  (Invoke-Sql $probe).val
}

# --- preconditions -----------------------------------------------------------
$pre = Invoke-Sql @"
select (select count(*) from information_schema.columns
          where table_schema='public' and table_name='pve_runs'
            and column_name in ('replay','client_result'))                     as dropped_cols_present,
       (select count(*) from pg_proc p where p.proname='grant_currency'
          and p.pronamespace='public'::regnamespace)                           as grant_fn,
       (select count(*) from pg_class c where c.relname='planet_popularity'
          and c.relnamespace='public'::regnamespace)                           as popularity_tbl;
"@
Write-Host ("[OK] before: dropped_cols_present={0} grant_currency={1} planet_popularity={2}" -f `
  $pre.dropped_cols_present, $pre.grant_fn, $pre.popularity_tbl)
if ([int]$pre.grant_fn -ne 1)       { throw "refusing: grant_currency does not exist (20260727000000 not applied?)" }
if ([int]$pre.popularity_tbl -ne 1) { throw "refusing: planet_popularity does not exist (20260727010000 not applied?)" }
Write-Host ("[..] before: settle probe -> {0}" -f (Test-Settle))

# NOT Get-Content -Raw (mangles the Korean comments).
$sql = [IO.File]::ReadAllText((Resolve-Path $file), $utf8)
Write-Host "[..] applying $version`_$name ($($sql.Length) chars)"
Invoke-Sql $sql | Out-Null
Write-Host "[OK] migration applied"

Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$version', '$name') on conflict (version) do nothing;
"@ | Out-Null
Write-Host "[OK] recorded in schema_migrations"

# --- postconditions ----------------------------------------------------------
# The dropped-column check runs on a COMMENT-STRIPPED body. This function body
# documents "do not reference the dropped columns" in a comment that names them,
# so a naive LIKE over the raw definition reports a false failure.
$post = Invoke-Sql @"
with d as (
  select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') as code
    from pg_proc p
   where p.proname='settle_pve_run' and p.pronamespace='public'::regnamespace
)
select (d.code like '%client_result%' or d.code like '%replay%') as has_dropped_ref,
       (d.code like '%catalyst_receipt%') as has_receipt,
       (d.code like '%planet_popularity%') as has_popularity,
       (d.code like '%app.in_settle%') as has_settle_flag
  from d;
"@
Write-Host ("[OK] after: dropped_ref={0} receipt={1} popularity={2} in_settle={3}" -f `
  $post.has_dropped_ref, $post.has_receipt, $post.has_popularity, $post.has_settle_flag)
if ($post.has_dropped_ref -eq $true) { throw "FAIL: settle_pve_run still references a dropped column" }
if ($post.has_receipt    -ne $true)  { throw "FAIL: catalyst receipt passthrough missing" }
if ($post.has_popularity -ne $true)  { throw "FAIL: planet popularity multiplier missing" }
if ($post.has_settle_flag -ne $true) { throw "FAIL: app.in_settle flag missing" }

$probe = Test-Settle
Write-Host ("[OK] after: settle probe -> {0}" -f $probe)
if ($probe -notlike 'OK *') { throw "FAIL: settle_pve_run still errors" }

Write-Host "[DONE] settle_pve_run restored"
