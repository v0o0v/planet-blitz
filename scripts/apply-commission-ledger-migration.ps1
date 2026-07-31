# Planet Blitz - apply 20260803000000_commission_ledger.sql to the remote project.
#
# Creates the commission ledger (4 tables), reworks the currency gate
# (grant_currency_for + grant_currency allowlist), attaches the issue trigger to
# pve_runs, adds the 5 run RPCs and 4 cron jobs.
#
# The postconditions below do NOT just diff the schema. Three of the properties this
# migration exists for are invisible to a schema diff and stay silent at runtime when
# broken, so each is exercised as a REAL CALL:
#   * allowlist          - an authenticated role must be refused a bogus p_source
#   * column privileges  - an authenticated role must be refused loadout_sealed
#   * subtransaction     - a failing issue path must NOT roll back PvE settlement
#
# Guards cannot be proven while connected as postgres (is_service_role() is then always
# true), so the checks below impersonate with `set local role authenticated` plus forged
# request.jwt.claims. Everything runs inside begin/rollback.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-commission-ledger-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260803000000'
$name    = 'commission_ledger'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260803000000_commission_ledger.sql'

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
select (select count(*) from pg_proc where proname='grant_currency'
          and pronamespace='public'::regnamespace)                       as grant_fn,
       (select count(*) from pg_proc where proname='settle_pve_run'
          and pronamespace='public'::regnamespace)                       as settle_fn,
       (select count(*) from pg_class where relname like 'commission%'
          and relnamespace='public'::regnamespace)                       as commission_rels;
"@
Write-Host ("[OK] before: grant_currency={0} settle_pve_run={1} commission_rels={2}" -f `
  $pre.grant_fn, $pre.settle_fn, $pre.commission_rels)
if ([int]$pre.grant_fn -ne 1)   { throw "refusing: grant_currency missing (20260727000000 not applied?)" }
if ([int]$pre.settle_fn -ne 1)  { throw "refusing: settle_pve_run missing (20260802000000 not applied?)" }

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
select (select count(*) from pg_class where relname in
          ('commission_inventory','commission_issues','commission_runs','commission_grants')
          and relnamespace='public'::regnamespace)                        as tables4,
       (select count(*) from pg_proc where proname in
          ('grant_currency_for','consume_commission','mark_commission_active',
           'settle_commission','store_commission_replay_gz',
           'bump_commission_verify_attempts','issue_commission_for_run')
          and pronamespace='public'::regnamespace)                        as fns7,
       (select count(*) from pg_trigger where tgname='pve_runs_issue_commission') as trg,
       (select count(*) from cron.job where jobname like '%commission%')   as crons,
       (select count(*) from pg_views where viewname='commission_runs_public') as vw;
"@
Write-Host ("[OK] after: tables={0}/4 fns={1}/7 trigger={2} crons={3}/4 view={4}" -f `
  $post.tables4, $post.fns7, $post.trg, $post.crons, $post.vw)
if ([int]$post.tables4 -ne 4) { throw "FAIL: expected 4 commission tables" }
if ([int]$post.fns7    -ne 7) { throw "FAIL: expected 7 commission functions" }
if ([int]$post.trg     -ne 1) { throw "FAIL: issue trigger missing" }
if ([int]$post.crons   -ne 4) { throw "FAIL: expected 4 commission cron jobs" }
if ([int]$post.vw      -ne 1) { throw "FAIL: commission_runs_public view missing" }

# issue_commission_for_run must have EXECUTE for nobody at all.
$acl = Invoke-Sql @"
select coalesce(array_length(proacl,1),0) as n_acl
  from pg_proc where proname='issue_commission_for_run' and pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] issue_commission_for_run acl entries: {0}" -f $acl.n_acl)

# --- postconditions: REAL CALLS (guards) --------------------------------------
# A schema diff cannot see any of these. Each runs as `authenticated` in a rolled-back tx.
Write-Host "[..] guard probes (impersonating authenticated, all rolled back)"

$probe = Invoke-Sql @"
begin;
create temp table probe_out(k text, v text) on commit drop;
do `$`$
declare v_uid uuid; r jsonb; acc text[] := '{}';
begin
  select id into v_uid from public.profiles limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  -- Results accumulate in a variable: once we are `authenticated` we cannot write to the
  -- temp table, and granting it would be noise. Flush after reset role.
  set local role authenticated;

  -- (1) allowlist: a bogus source must be refused. Before this migration it silently
  --     granted up to CAP_DEFAULT_* (1000/1000).
  begin
    r := public.grant_currency(1000, 1000, 'totally-made-up');
    acc := acc || ('allowlist_bogus' || ' => ' || 'LEAK granted=' || r::text);
  exception when others then
    acc := acc || ('allowlist_bogus' || ' => ' || 'REFUSED ' || sqlerrm);
  end;

  -- (2) allowlist: 'commission' must be refused at the client entrypoint.
  begin
    r := public.grant_currency(30000, 30000, 'commission');
    acc := acc || ('allowlist_commission' || ' => ' || 'LEAK granted=' || r::text);
  exception when others then
    acc := acc || ('allowlist_commission' || ' => ' || 'REFUSED ' || sqlerrm);
  end;

  -- (3) delegation target must be unreachable from authenticated.
  begin
    r := public.grant_currency_for(v_uid, 30000, 30000, 'commission', null);
    acc := acc || ('grant_currency_for' || ' => ' || 'LEAK granted=' || r::text);
  exception when others then
    acc := acc || ('grant_currency_for' || ' => ' || 'REFUSED ' || sqlerrm);
  end;

  -- (4) settle_commission is service_role only.
  begin
    r := public.settle_commission(gen_random_uuid(), 'accept', '{}'::jsonb, 0, 0);
    acc := acc || ('settle_commission' || ' => ' || 'LEAK ' || r::text);
  exception when others then
    acc := acc || ('settle_commission' || ' => ' || 'REFUSED ' || sqlerrm);
  end;

  -- (5) the internal issue function must be unreachable from every role.
  begin
    perform public.issue_commission_for_run(gen_random_uuid(), v_uid, '{}'::jsonb);
    acc := acc || ('issue_fn' || ' => ' || 'LEAK callable');
  exception when others then
    acc := acc || ('issue_fn' || ' => ' || 'REFUSED ' || sqlerrm);
  end;

  -- (6) column privilege: loadout_sealed / replay_gz must NOT be selectable.
  begin
    perform loadout_sealed from public.commission_runs limit 1;
    acc := acc || ('col_loadout_sealed' || ' => ' || 'LEAK readable');
  exception when others then
    acc := acc || ('col_loadout_sealed' || ' => ' || 'REFUSED ' || sqlerrm);
  end;
  begin
    perform replay_gz from public.commission_runs limit 1;
    acc := acc || ('col_replay_gz' || ' => ' || 'LEAK readable');
  exception when others then
    acc := acc || ('col_replay_gz' || ' => ' || 'REFUSED ' || sqlerrm);
  end;

  -- (6b) same two columns must be unreachable as `anon` too. RLS already blocks anon rows
  --      (no anon policy), but the banner claims rows AND columns are each fail-closed - for
  --      anon that was only one layer until the anon revoke was added. Probe the second layer.
  set local role anon;
  begin
    perform loadout_sealed from public.commission_runs limit 1;
    acc := acc || ('anon_col_loadout_sealed' || ' => ' || 'LEAK readable');
  exception when others then
    acc := acc || ('anon_col_loadout_sealed' || ' => ' || 'REFUSED ' || sqlerrm);
  end;
  set local role authenticated;

  -- (7) granted columns must still work (over-revoking would break the client).
  begin
    perform status from public.commission_runs limit 1;
    acc := acc || ('col_status' || ' => ' || 'OK readable');
  exception when others then
    acc := acc || ('col_status' || ' => ' || 'BROKEN ' || sqlerrm);
  end;

  -- (8) allowed sources must still work - the one real regression risk of the allowlist.
  begin
    r := public.grant_currency(0, 0, 'salvage');
    acc := acc || ('allowlist_salvage' || ' => ' || 'OK ' || coalesce(r->>'clamped','?'));
  exception when others then
    acc := acc || ('allowlist_salvage' || ' => ' || 'BROKEN ' || sqlerrm);
  end;
  begin
    r := public.grant_currency(0, 0, 'story');
    acc := acc || ('allowlist_story' || ' => ' || 'OK ' || coalesce(r->>'clamped','?'));
  exception when others then
    acc := acc || ('allowlist_story' || ' => ' || 'BROKEN ' || sqlerrm);
  end;

  reset role;
  insert into probe_out(k, v)
    select split_part(x, ' => ', 1), substr(x, strpos(x, ' => ') + 4) from unnest(acc) as x;
end
`$`$;
select k || ' => ' || v as line from probe_out order by k;
rollback;
"@

$fail = $false
foreach ($row in $probe) {
  $line = $row.line
  Write-Host ("    {0}" -f $line)
  if ($line -match 'LEAK' -or $line -match 'BROKEN') { $fail = $true }
}
if ($fail) { throw "FAIL: a guard probe leaked or a legitimate path broke (see above)" }
Write-Host "[OK] all guard probes behaved"

# --- postconditions: subtransaction does not roll back settlement --------------
# Forces the issue path to raise by poisoning the stock check, then confirms
# settle_pve_run still commits its grant. This is the PR#222 failure shape.
Write-Host "[..] subtransaction probe (issue path forced to fail)"
$sub = Invoke-Sql @"
begin;
create temp table sub_out(v text) on commit drop;
-- Poison: a CHECK that the issue path will violate when it inserts.
alter table public.commission_issues add constraint tmp_poison check (granted is null);
do `$`$
declare v_uid uuid; r jsonb; c0 numeric; c1 numeric;
begin
  select id, credits into v_uid, c0 from public.profiles limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  begin
    r := public.settle_pve_run(
      json_build_object('resources',10,'minerals',10,'finalTick',600,'stage',1,
                        'victory','true','bossKilled','true')::jsonb);
    select credits into c1 from public.profiles where id = v_uid;
    insert into sub_out values ('SETTLED ok, credits ' || c0 || ' -> ' || c1);
  exception when others then
    insert into sub_out values ('ROLLED-BACK ' || sqlstate || ' ' || sqlerrm);
  end;
end
`$`$;
select v as line from sub_out;
rollback;
"@
foreach ($row in $sub) { Write-Host ("    {0}" -f $row.line) }
if (($sub | ForEach-Object { $_.line }) -match 'ROLLED-BACK') {
  throw "FAIL: the issue path rolled back PvE settlement - subtransaction is not holding (PR#222 shape)"
}
Write-Host "[OK] settlement survived a failing issue path"

Write-Host "[DONE] commission ledger applied and verified"
