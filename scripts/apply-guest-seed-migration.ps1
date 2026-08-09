# Planet Blitz - apply 20260809000000_guest_seed.sql to the remote project.
#
# 2026-08-09 guest-login lane. What this migration lands:
#   1. guest_seeds        -> once-per-account anchor + "what was granted" ledger.
#                            RLS on, ONE policy (select own). Writes: definer only.
#   2. seed_guest_account -> one-shot seed for ANONYMOUS accounts only:
#                            catalysts, blueprints, defense units, a filled 3-layer
#                            defense layout, a ladder row (placed), 2 commissions.
#
# Why: guest login drops a judge straight into the game with no account. A fresh
# profile hides everything past the first few minutes (control tower needs a planet
# clear; catalysts/lineage are much later). The client-side half of the preset lives
# in src/save/guestPreset.ts; this is the half the server owns.
#
# ⚠️ SERVER FIRST. Deploy this BEFORE merging the client. If the client ships first
#   the RPC 404s, seedGuestAccount() returns null, and the guest gets the save-side
#   preset with empty catalyst/commission screens. It self-heals on the next boot
#   (the call is idempotent and retried), but there is no reason to ship that window.
#
# ⚠️ THE CAP PATH IS DELIBERATELY UNTOUCHED. The seed does NOT write catalyst_grants.
#   Writing there would make the seed the denominator of the hourly/daily cap, and a
#   judge would hit "no more drops" immediately. Excluding it via a redefinition of
#   grant_catalyst was the alternative and it is worse: redefining functions in this
#   repo has dropped GRANTs before. Verification #6 below asserts the untouched-ness.
#
# ⚠️ ANONYMOUS-ONLY IS THE WHOLE SECURITY STORY. If the is_anonymous guard is missing
#   or inverted, this becomes a cheat RPC for real accounts. #4 checks it structurally
#   and #8 proves it by executing against a real (temporary) Google-shaped account.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-guest-seed-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260809000000'
$name    = 'guest_seed'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260809000000_guest_seed.sql'

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
  # UTF-8 BYTES, not a string - the string form mangles the Korean comments and the
  # server answers 400 at a byte offset, which reads like a SQL error but is not.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- preconditions -----------------------------------------------------------
Write-Host ""
Write-Host "--- preconditions ---"

$deps = Invoke-Sql @"
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='profiles')             as t_profiles,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='catalyst_defs')        as t_cat_defs,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='catalyst_inventory')   as t_cat_inv,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='defense_blueprints')   as t_bp,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='defense_units')        as t_units,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='defenses')             as t_def,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='ladder')               as t_ladder,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='commission_inventory') as t_com,
  (select count(*) from pg_proc where proname='empty_invasion_layers'
     and pronamespace='public'::regnamespace)                       as f_empty,
  (select count(*) from pg_proc where proname='invasion_layers_valid'
     and pronamespace='public'::regnamespace)                       as f_valid;
"@
Write-Host ("[OK] tables: profiles={0} catalyst_defs={1} catalyst_inventory={2} blueprints={3}" -f `
  $deps.t_profiles, $deps.t_cat_defs, $deps.t_cat_inv, $deps.t_bp)
Write-Host ("[OK] tables: defense_units={0} defenses={1} ladder={2} commission_inventory={3}" -f `
  $deps.t_units, $deps.t_def, $deps.t_ladder, $deps.t_com)
Write-Host ("[OK] layout fns: empty_invasion_layers={0} invasion_layers_valid={1}" -f $deps.f_empty, $deps.f_valid)
foreach ($k in 't_profiles','t_cat_defs','t_cat_inv','t_bp','t_units','t_def','t_ladder','t_com','f_empty','f_valid') {
  if ([int]$deps.$k -lt 1) { throw "refusing: dependency '$k' missing on remote" }
}

# catalyst_defs must actually be seeded - the seed skips unknown ids silently, so an
# empty table would produce a "successful" seed that grants zero catalysts.
$catn = Invoke-Sql "select count(*) as n from public.catalyst_defs;"
Write-Host ("[OK] catalyst_defs rows: {0} (expected 48)" -f $catn.n)
if ([int]$catn.n -lt 15) { throw "refusing: catalyst_defs has only $($catn.n) rows - the seed would grant almost nothing" }

# --- apply -------------------------------------------------------------------
$sql = [IO.File]::ReadAllText((Resolve-Path $file), $utf8)
Write-Host ""
Write-Host "[..] applying $version`_$name ($($sql.Length) chars)"
Invoke-Sql $sql | Out-Null
Write-Host "[OK] migration applied"

Invoke-Sql @"
insert into supabase_migrations.schema_migrations(version, name)
values ('$version', '$name') on conflict (version) do nothing;
"@ | Out-Null
Write-Host "[OK] recorded in schema_migrations"

# --- verification ------------------------------------------------------------
#
# ⚠️ MATCH ON IDENTIFIERS THE SQL ACTUALLY CONTAINS, NEVER ON ENGLISH PROSE.
#   Every comment in this repo is Korean. A previous script reported [FAIL] on a
#   working gate because it grepped for '%duplicate%' while the comment said the
#   same thing in Korean.

Write-Host ""
Write-Host "--- verification ---"
$bad = 0

# 1. guest_seeds shape: RLS on, exactly one policy, PK on profile_id (the anchor).
$tbl = Invoke-Sql @"
select
  c.relrowsecurity as rls_on,
  (select count(*) from pg_policies where schemaname='public' and tablename='guest_seeds') as policies,
  (select count(*) from pg_index i join pg_class ic on ic.oid=i.indexrelid
     where i.indrelid=c.oid and i.indisprimary)                                            as pk_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='guest_seeds';
"@
Write-Host ("[OK] guest_seeds: rls_on={0} policies={1} pk={2}" -f $tbl.rls_on, $tbl.policies, $tbl.pk_count)
if (-not $tbl.rls_on)         { Write-Host "[FAIL] RLS is off on guest_seeds";                  $bad++ }
if ([int]$tbl.policies -ne 1) { Write-Host "[FAIL] expected exactly 1 policy (select own)";     $bad++ }
if ([int]$tbl.pk_count -ne 1) { Write-Host "[FAIL] no primary key - once-per-account is gone";  $bad++ }

# 2. no write policy on guest_seeds (only the definer may write the anchor).
$wpol = Invoke-Sql @"
select count(*) as n from pg_policies
 where schemaname='public' and tablename='guest_seeds' and cmd <> 'SELECT';
"@
Write-Host ("[OK] guest_seeds write policies: {0} (must be 0)" -f $wpol.n)
if ([int]$wpol.n -ne 0) { Write-Host "[FAIL] a write policy exists - clients could forge the anchor"; $bad++ }

# 3. execute privileges: authenticated yes, anon no, PUBLIC no.
$acl = Invoke-Sql @"
select has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('public',        p.oid, 'execute') as pub_exec,
       p.prosecdef                                               as is_definer
  from pg_proc p
 where p.proname='seed_guest_account' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] execute: anon={0} authenticated={1} public={2} definer={3}" -f `
  $acl.anon_exec, $acl.auth_exec, $acl.pub_exec, $acl.is_definer)
if ($acl.anon_exec)       { Write-Host "[FAIL] anon CAN execute seed_guest_account"; $bad++ }
if (-not $acl.auth_exec)  { Write-Host "[FAIL] authenticated CANNOT execute - guests get nothing"; $bad++ }
if ($acl.pub_exec)        { Write-Host "[FAIL] PUBLIC CAN execute"; $bad++ }
if (-not $acl.is_definer) { Write-Host "[FAIL] not security definer - the writes will hit RLS"; $bad++ }

# 4. the two guards are present AND ordered before any grant.
$struct = Invoke-Sql @"
select
  (pg_get_functiondef(p.oid) like '%is_anonymous%')                            as has_anon_guard,
  strpos(pg_get_functiondef(p.oid), 'is_anonymous')                            as at_anon,
  strpos(pg_get_functiondef(p.oid), 'from public.guest_seeds g where g.profile_id = v_me') as at_once,
  strpos(pg_get_functiondef(p.oid), 'insert into public.catalyst_inventory')   as at_grant,
  strpos(pg_get_functiondef(p.oid), 'insert into public.guest_seeds')          as at_anchor
  from pg_proc p
 where p.proname='seed_guest_account' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] guard offsets: anon={0} once={1} first_grant={2} anchor={3}" -f `
  $struct.at_anon, $struct.at_once, $struct.at_grant, $struct.at_anchor)
if (-not $struct.has_anon_guard)                          { Write-Host "[FAIL] no is_anonymous guard - real accounts could seed"; $bad++ }
if ([int]$struct.at_anon  -ge [int]$struct.at_grant)      { Write-Host "[FAIL] anon guard runs AFTER the first grant";           $bad++ }
if ([int]$struct.at_once  -ge [int]$struct.at_grant)      { Write-Host "[FAIL] once-per-account check runs AFTER the grant";     $bad++ }
if ([int]$struct.at_anchor -le [int]$struct.at_grant)     { Write-Host "[FAIL] anchor is written BEFORE the grants";             $bad++ }

# 5. jsonb_agg ORDER BY - slot order is a 3-way contract (SQL/EF/client). Without it
#    the layout is "usually right", which is the worst kind of wrong.
$ord = Invoke-Sql @"
select (length(pg_get_functiondef(p.oid))
        - length(replace(pg_get_functiondef(p.oid), 'order by s)', ''))) / length('order by s)') as ordered_aggs
  from pg_proc p
 where p.proname='seed_guest_account' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] ordered jsonb_agg calls: {0} (expected 3 - l1/l2/l3)" -f $ord.ordered_aggs)
if ([int]$ord.ordered_aggs -ne 3) { Write-Host "[FAIL] a jsonb_agg is missing 'order by' - slot order is not guaranteed"; $bad++ }

# 6. the cap path is untouched: the seed must NOT write catalyst_grants, and
#    grant_catalyst/grant_catalyst_for must still be there with their caps.
$caps = Invoke-Sql @"
select
  (pg_get_functiondef(p.oid) like '%catalyst_grants%')                          as seed_touches_grants,
  (select count(*) from pg_proc q where q.proname='grant_catalyst'
     and q.pronamespace='public'::regnamespace)                                 as fn_grant_catalyst,
  (select count(*) from pg_proc q where q.proname='grant_catalyst_for'
     and q.pronamespace='public'::regnamespace)                                 as fn_grant_for,
  (select substring(pg_get_functiondef(q.oid) from 'CAP_HOURLY_CATALYSTS[^0-9]*([0-9]+)')
     from pg_proc q where q.proname='grant_catalyst_for'
      and q.pronamespace='public'::regnamespace)                                as hourly_expr
  from pg_proc p
 where p.proname='seed_guest_account' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] cap path: seed_writes_catalyst_grants={0} grant_catalyst={1} grant_catalyst_for={2}" -f `
  $caps.seed_touches_grants, $caps.fn_grant_catalyst, $caps.fn_grant_for)
if ($caps.seed_touches_grants)          { Write-Host "[FAIL] the seed writes catalyst_grants - it would eat the guest's cap"; $bad++ }
if ([int]$caps.fn_grant_catalyst -lt 1) { Write-Host "[FAIL] grant_catalyst vanished";     $bad++ }
if ([int]$caps.fn_grant_for      -lt 1) { Write-Host "[FAIL] grant_catalyst_for vanished"; $bad++ }

# 7. migration ledger row.
$led = Invoke-Sql "select count(*) as n from supabase_migrations.schema_migrations where version='$version';"
Write-Host ("[OK] schema_migrations row for {0}: {1}" -f $version, $led.n)
if ([int]$led.n -ne 1) { Write-Host "[FAIL] ledger row missing"; $bad++ }

# 8. LIVE BEHAVIOUR PROOF - the DDL checks above cannot tell whether the thing works.
#
#    seed_guest_account() reads auth.uid(), which is null over the Management API.
#    We set request.jwt.claims ourselves (that is exactly what auth.uid() reads) and
#    call the function for real, against two temporary users:
#      (a) is_anonymous = true  -> must seed, and a second call must be a no-op.
#      (b) is_anonymous = false -> must RAISE (this is the security-critical case).
#    Everything is rolled back by raising at the end of the DO block.
Write-Host ""
Write-Host "--- live behaviour probe (rolled back) ---"
$probe = Invoke-Sql @"
do `$`$
declare
  v_anon uuid := gen_random_uuid();
  v_real uuid := gen_random_uuid();
  r1 jsonb; r2 jsonb;
  v_cat int; v_bp int; v_units int; v_com int; v_ladder int; v_def int;
  v_rejected boolean := false;
begin
  -- auth.users minimal insert (id/is_sso_user/is_anonymous) - the shape this repo's
  -- SQL verification fixtures already use.
  insert into auth.users(id, is_sso_user, is_anonymous) values (v_anon, false, true), (v_real, false, false);
  insert into public.profiles(id, save, save_version) values (v_anon, '{}'::jsonb, 11), (v_real, '{}'::jsonb, 11);

  -- (a) anonymous -> seeds.
  perform set_config('request.jwt.claims', json_build_object('sub', v_anon::text)::text, true);
  r1 := public.seed_guest_account();
  if (r1->>'seeded')::boolean is not true then
    raise exception 'PROBE_FAILED: anonymous account was not seeded (%)', r1;
  end if;

  select count(*) into v_cat    from public.catalyst_inventory where profile_id = v_anon;
  select count(*) into v_bp     from public.defense_blueprints where profile_id = v_anon;
  select count(*) into v_units  from public.defense_units      where profile_id = v_anon;
  select count(*) into v_com    from public.commission_inventory where profile_id = v_anon;
  select count(*) into v_ladder from public.ladder             where profile_id = v_anon and placed;
  select count(*) into v_def    from public.defenses           where profile_id = v_anon and active;
  if v_cat < 10 or v_bp < 12 or v_units <> 8 or v_com <> 2 or v_ladder <> 1 or v_def <> 1 then
    raise exception 'PROBE_FAILED: rows cat=% bp=% units=% com=% ladder=% def=%',
      v_cat, v_bp, v_units, v_com, v_ladder, v_def;
  end if;

  -- (b) second call is a silent no-op (once-per-account).
  r2 := public.seed_guest_account();
  if (r2->>'seeded')::boolean is not false or (r2->>'reason') <> 'already-seeded' then
    raise exception 'PROBE_FAILED: second call was not idempotent (%)', r2;
  end if;

  -- (c) NON-anonymous must be refused. This is the security-critical assertion.
  perform set_config('request.jwt.claims', json_build_object('sub', v_real::text)::text, true);
  begin
    perform public.seed_guest_account();
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'PROBE_FAILED: a NON-anonymous account was allowed to seed';
  end if;

  raise exception 'PROBE_OK_ROLLBACK cat=% bp=% units=% com=%', v_cat, v_bp, v_units, v_com;
exception
  when others then
    if sqlerrm like 'PROBE_OK_ROLLBACK%' then
      raise notice '%', sqlerrm;
    else
      raise exception '%', sqlerrm;
    end if;
end `$`$;
"@
Write-Host "[OK] live probe passed: anonymous seeds once, repeat is a no-op, real account refused"

# leftovers - the DO block raises to roll back, but assert it rather than assume.
$left = Invoke-Sql "select count(*) as n from public.guest_seeds;"
Write-Host ("[OK] guest_seeds rows after probe: {0} (0 unless real guests already played)" -f $left.n)

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }

Write-Host ""
Write-Host "[DONE] guest seed is live."
Write-Host "[NOTE] Anonymous sign-ins must ALSO be enabled in Dashboard > Authentication >"
Write-Host "       Sign In / Providers. Without it the title button fails before this RPC"
Write-Host "       is ever reached."
Write-Host "[NOTE] Deploy order: this migration FIRST, then merge the client."
Write-Host "[NOTE] Observe uptake with:"
Write-Host "         select date_trunc('hour', seeded_at) h, count(*)"
Write-Host "           from public.guest_seeds group by 1 order by 1 desc limit 24;"
