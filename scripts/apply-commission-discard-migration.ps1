# Planet Blitz - apply 20260803010000_commission_discard.sql to the remote project.
#
# Adds the commission_discards audit table (RLS: select-own only), the
# discard_commission(uuid) RPC, and a 90-day prune cron job.
#
# The postconditions below do NOT just diff the schema. The two properties this
# migration exists for stay silent at runtime when broken, so each is exercised as a
# REAL CALL while impersonating `authenticated`:
#   * ownership scope - one account must NOT be able to discard another account's row
#   * audit write     - the RPC must leave a row behind (the rate cap counts those rows,
#                       so a silently failing insert would uncap the endpoint)
#
# Guards cannot be proven while connected as postgres (auth.uid() is then null), so the
# checks below impersonate with `set local role authenticated` plus forged
# request.jwt.claims. Everything runs inside begin/rollback - no real row is destroyed.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-commission-discard-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260803010000'
$name    = 'commission_discard'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260803010000_commission_discard.sql'

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
select (select count(*) from pg_class where relname='commission_inventory'
          and relnamespace='public'::regnamespace)                        as inv_tbl,
       (select count(*) from pg_proc where proname='consume_commission'
          and pronamespace='public'::regnamespace)                        as consume_fn,
       (select count(*) from pg_class where relname='commission_discards'
          and relnamespace='public'::regnamespace)                        as discards_tbl;
"@
Write-Host ("[OK] before: commission_inventory={0} consume_commission={1} commission_discards={2}" -f `
  $pre.inv_tbl, $pre.consume_fn, $pre.discards_tbl)
if ([int]$pre.inv_tbl -ne 1)    { throw "refusing: commission_inventory missing (20260803000000 not applied?)" }
if ([int]$pre.consume_fn -ne 1) { throw "refusing: consume_commission missing (20260803000000 not applied?)" }

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

# --- postconditions: structure ------------------------------------------------
$post = Invoke-Sql @"
select (select count(*) from pg_class where relname='commission_discards'
          and relnamespace='public'::regnamespace)                        as tbl,
       (select count(*) from pg_proc where proname='discard_commission'
          and pronamespace='public'::regnamespace)                        as fn,
       (select count(*) from pg_policies where tablename='commission_discards')       as policies,
       (select count(*) from pg_policies where tablename='commission_discards'
          and cmd <> 'SELECT')                                            as write_policies,
       (select relrowsecurity::int from pg_class where relname='commission_discards'
          and relnamespace='public'::regnamespace)                        as rls,
       (select count(*) from cron.job where jobname='planet-blitz-gc-commission-discards') as prune,
       (select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid
          where c.relname='commission_discards_profile_time')             as idx;
"@
Write-Host ("[OK] after: table={0} fn={1} policies={2} (write={3}) rls={4} prune_cron={5} index={6}" -f `
  $post.tbl, $post.fn, $post.policies, $post.write_policies, $post.rls, $post.prune, $post.idx)
if ([int]$post.tbl -ne 1)            { throw "FAIL: commission_discards missing" }
if ([int]$post.fn  -ne 1)            { throw "FAIL: discard_commission missing" }
if ([int]$post.rls -ne 1)            { throw "FAIL: RLS not enabled on commission_discards" }
if ([int]$post.policies -ne 1)       { throw "FAIL: expected exactly 1 policy (select-own)" }
if ([int]$post.write_policies -ne 0) { throw "FAIL: a write policy exists - RPC must be the only writer" }
if ([int]$post.prune -ne 1)          { throw "FAIL: prune cron missing" }
if ([int]$post.idx -ne 1)            { throw "FAIL: rate-cap index missing" }

# anon must not be able to call it.
$acl = Invoke-Sql @"
select coalesce(has_function_privilege('anon', 'public.discard_commission(uuid)', 'execute'), false)::int as anon_exec,
       coalesce(has_function_privilege('authenticated', 'public.discard_commission(uuid)', 'execute'), false)::int as auth_exec;
"@
Write-Host ("[OK] execute: anon={0} authenticated={1}" -f $acl.anon_exec, $acl.auth_exec)
if ([int]$acl.anon_exec -ne 0) { throw "FAIL: anon can execute discard_commission" }
if ([int]$acl.auth_exec -ne 1) { throw "FAIL: authenticated cannot execute discard_commission" }

# --- postconditions: REAL CALLS (guards) --------------------------------------
# A schema diff cannot see either of these. Both run as `authenticated` in a rolled-back tx.
Write-Host "[..] guard probes (impersonating authenticated, all rolled back)"

$probe = Invoke-Sql @"
begin;
create temp table probe_out(k text, v text) on commit drop;
do `$`$
declare
  v_a uuid; v_b uuid; v_cid uuid := gen_random_uuid(); acc text[] := '{}';
  r jsonb; n int;
begin
  select id into v_a from public.profiles order by id limit 1;
  select id into v_b from public.profiles order by id desc limit 1;
  if v_a is null or v_a = v_b then
    acc := array_append(acc, 'skip=need two profiles');
  else
    -- Seed one inventory row owned by A.
    insert into public.commission_inventory(commission_id, profile_id, grade, payload)
    values (v_cid, v_a, 1, '{"version":1}'::jsonb);

    -- (1) ownership scope: B must NOT be able to discard A's row.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      r := public.discard_commission(v_cid);
      acc := array_append(acc, 'cross_account=LEAKED');
    exception when others then
      acc := array_append(acc, 'cross_account=refused');
    end;
    reset role;

    -- The row must still be there after the refused call.
    select count(*) into n from public.commission_inventory where commission_id = v_cid;
    acc := array_append(acc, 'row_after_refusal=' || n::text);

    -- (2) owner path + audit write.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      r := public.discard_commission(v_cid);
      acc := array_append(acc, 'owner=ok');
    exception when others then
      acc := array_append(acc, 'owner=FAILED:' || sqlerrm);
    end;
    reset role;

    select count(*) into n from public.commission_inventory where commission_id = v_cid;
    acc := array_append(acc, 'inventory_after=' || n::text);
    select count(*) into n from public.commission_discards where commission_id = v_cid;
    acc := array_append(acc, 'audit_rows=' || n::text);
  end if;

  insert into probe_out(k, v) values ('acc', array_to_string(acc, ' | '));
end
`$`$;
select k, v from probe_out;
rollback;
"@
$line = ($probe | Where-Object { $_.k -eq 'acc' }).v
Write-Host ("[OK] probe: {0}" -f $line)
if ($line -match 'skip=') { Write-Host "[WARN] probes skipped (needs two profiles)" }
else {
  if ($line -match 'cross_account=LEAKED')  { throw "FAIL: another account could discard the row" }
  if ($line -notmatch 'row_after_refusal=1'){ throw "FAIL: refused call still removed the row" }
  if ($line -notmatch 'owner=ok')           { throw "FAIL: owner could not discard" }
  if ($line -notmatch 'inventory_after=0')  { throw "FAIL: owner call did not remove the row" }
  if ($line -notmatch 'audit_rows=1')       { throw "FAIL: audit row not written (rate cap would be uncapped)" }
}

Write-Host "[DONE] $version`_$name applied and verified"
