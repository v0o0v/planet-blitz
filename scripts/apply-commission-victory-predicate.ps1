# Planet Blitz - apply 20260808100000_commission_victory_predicate.sql to the remote project.
#
# WHAT WAS BROKEN: commission issuance was at 0%, silently, since 2026-08-03.
#
#   issue_commission_for_run step 2 read  p_summary->>'bossKilled'  but the client
#   (PveSettleSummary) NEVER SENT that key. So the value was NULL and, by SQL
#   three-valued logic:
#     defeat run : false and NULL = false  -> anchor inserted, skip_reason='not-victory'
#     victory run: true  and NULL = NULL   -> violates claimed_victory (boolean NOT NULL)
#                  -> subtransaction rollback -> THE ANCHOR ROW ITSELF DISAPPEARS
#                  -> one raise warning, nothing on screen
#
#   Measured on the remote 2026-08-08:
#     pve_runs verified            48   = defeat 33 (all have anchors) + victory 15 (NONE do)
#     commission_issues rows       33   (48 - 33 = 15, exact match)
#     claimed_victory = true        0
#     claimed_victory is null       0   <- NOT NULL made storage impossible, so the row died
#     granted = true                0
#     summary ? 'bossKilled'        0   <- the key was never sent, ever
#
# ⚠️ THE REPORTED HYPOTHESIS ("NULL gets stored, so the rate cap's numerator is empty")
#   WAS WRONG. NOT NULL prevented storage entirely and took the whole row with it. The
#   symptom is not a leaky cap - it is a 0% issue rate.
#
# WHAT THIS LANDS (three changes, all in one redefinition):
#   1. coalesce on both claims -> the predicate can no longer be NULL for any payload.
#   2. jsonb_exists branch -> a MISSING key falls back to victory-only. This is a
#      FALLBACK, NOT A REJECTION: rejecting would keep cached old clients at 0%, which
#      is the very thing being fixed.
#   3. coalesce at the INSERT too. Redundant on purpose - the lethal part of this bug
#      was not the wrong predicate but that a wrong predicate ERASED THE ANCHOR and
#      became invisible. This line keeps that failure mode structurally impossible.
#
#   Client side (separate, same PR): PveSettleSummary.bossKilled is now REQUIRED and is
#   filled from the sim reader bossKilledOf(w) = bossSpawned && victory. Not a restatement
#   of victory - PvE can also win by core destruction, which bossSpawned excludes.
#
# ⚠️ DEPLOY ORDER DOES NOT MATTER. Old clients (no key) hit the fallback and start
#   issuing immediately; new clients send both claims. Neither ordering regresses.
#
# ⚠️ REVOKES ARE PART OF THE FUNCTION BODY (AC-I6). create-or-replace preserves ACLs so
#   a dropped revoke has zero symptoms on an in-order remote; verification below measures
#   has_function_privilege directly.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# ⚠️ CONSTANT REGEXES ARE ANCHORED ON `constant ... :=`. The loose form NAME[^0-9]*([0-9]+)
#   reads Korean prose above the declaration and returns the wrong number - that bug cost
#   a full false [FAIL] on the previous lane. Do not loosen these.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-commission-victory-predicate.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260808100000'
$name    = 'commission_victory_predicate'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260808100000_commission_victory_predicate.sql'

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
  # UTF-8 BYTES, not a string. Sending the string mangles Korean comments and the server
  # answers 400 at a byte offset, which looks like a SQL error but is an encoding error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- preconditions + BEFORE evidence ----------------------------------------
Write-Host ""
Write-Host "--- preconditions ---"

$pre = Invoke-Sql @"
select
  (select count(*) from pg_proc p where p.proname='issue_commission_for_run'
     and p.pronamespace='public'::regnamespace)                                   as fn_rows,
  (select bool_or(pg_get_functiondef(p.oid) like '%v_claimed_victory%') from pg_proc p
     where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace) as already_fixed,
  (select count(*) from public.pve_runs where verified_status='verified')          as verified_runs,
  (select count(*) from public.pve_runs where verified_status='verified'
     and summary->>'victory'='true')                                               as verified_wins,
  (select count(*) from public.commission_issues)                                  as issues_rows,
  (select count(*) from public.commission_issues where claimed_victory)            as issues_wins,
  (select count(*) from public.commission_issues where granted)                    as issues_granted;
"@
Write-Host ("[OK] issue_commission_for_run rows={0} already_fixed={1}" -f $pre.fn_rows, $pre.already_fixed)
if ([int]$pre.fn_rows -ne 1) { throw "refusing: expected exactly 1 issue_commission_for_run" }
if ($pre.already_fixed) { Write-Host "[NOTE] remote ALREADY fixed - this is a re-apply (idempotent)." }

Write-Host ""
Write-Host "--- BEFORE: the damage, measured ---"
Write-Host ("      verified runs      : {0}" -f $pre.verified_runs)
Write-Host ("      of which victories : {0}" -f $pre.verified_wins)
Write-Host ("      commission_issues  : {0}   (missing = {1})" -f `
  $pre.issues_rows, ([int]$pre.verified_runs - [int]$pre.issues_rows))
Write-Host ("      claimed_victory=t  : {0}" -f $pre.issues_wins)
Write-Host ("      granted=t          : {0}" -f $pre.issues_granted)
if (-not $pre.already_fixed) {
  $missing = [int]$pre.verified_runs - [int]$pre.issues_rows
  if ($missing -eq [int]$pre.verified_wins) {
    Write-Host "[OK] missing anchors == victory runs exactly -> diagnosis confirmed on this remote"
  } else {
    Write-Host "[WARN] missing anchors ($missing) != victory runs ($($pre.verified_wins))."
    Write-Host "[WARN] The diagnosis may be incomplete here - inspect before trusting the fix."
  }
}

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

# --- verification: structure -------------------------------------------------
Write-Host ""
Write-Host "--- verification: structure ---"
$bad = 0

$shape = Invoke-Sql @"
select
  (pg_get_functiondef(p.oid) like '%coalesce(p_summary->>''victory'' = ''true'', false)%')    as coalesce_victory,
  (pg_get_functiondef(p.oid) like '%coalesce(p_summary->>''bossKilled'' = ''true'', false)%') as coalesce_boss,
  (pg_get_functiondef(p.oid) like '%jsonb_exists(p_summary, ''bossKilled'')%')                as explicit_absence,
  (pg_get_functiondef(p.oid) like '%coalesce(v_victory, false)%')                             as insert_guard,
  (pg_get_functiondef(p.oid) like '%and p_summary->>''bossKilled'' = ''true'')%')             as old_null_form
  from pg_proc p
 where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] coalesce: victory={0} boss={1} | absence_branch={2} insert_guard={3} | old_form={4}" -f `
  $shape.coalesce_victory, $shape.coalesce_boss, $shape.explicit_absence, $shape.insert_guard, $shape.old_null_form)
if (-not $shape.coalesce_victory) { Write-Host "[FAIL] victory claim not coalesced"; $bad++ }
if (-not $shape.coalesce_boss)    { Write-Host "[FAIL] bossKilled claim not coalesced"; $bad++ }
if (-not $shape.explicit_absence) { Write-Host "[FAIL] missing key is not handled explicitly"; $bad++ }
if (-not $shape.insert_guard)     { Write-Host "[FAIL] insert has no last-resort coalesce"; $bad++ }
if ($shape.old_null_form)         { Write-Host "[FAIL] the OLD null-producing predicate is still present"; $bad++ }

# The drop-axis lane's contract must survive this redefinition (it was copied wholesale).
$carry = Invoke-Sql @"
select
  (substring(pg_get_functiondef(p.oid) from 'ISSUE_CHANCE_CP[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)'))         as issue_cp,
  (substring(pg_get_functiondef(p.oid) from 'MAX_LOOT_MULT_CENTI[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)'))     as max_mult,
  (substring(pg_get_functiondef(p.oid) from 'CAP_COMMISSIONS_PER_DAY[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)')) as day_cap,
  strpos(pg_get_functiondef(p.oid), 'skip_reason = ''roll''')     as at_roll,
  strpos(pg_get_functiondef(p.oid), 'skip_reason = ''rate-day''') as at_day,
  strpos(pg_get_functiondef(p.oid), 'insert into public.commission_inventory') as at_insert
  from pg_proc p
 where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] carried over: ISSUE_CHANCE_CP={0} MAX_LOOT_MULT_CENTI={1} CAP_COMMISSIONS_PER_DAY={2}" -f `
  $carry.issue_cp, $carry.max_mult, $carry.day_cap)
if ($carry.issue_cp -ne '3000') { Write-Host "[FAIL] ISSUE_CHANCE_CP drifted"; $bad++ }
if ($carry.max_mult -ne '300')  { Write-Host "[FAIL] MAX_LOOT_MULT_CENTI drifted"; $bad++ }
if ($carry.day_cap  -ne '360')  { Write-Host "[FAIL] CAP_COMMISSIONS_PER_DAY drifted"; $bad++ }
if ([int]$carry.at_day -le [int]$carry.at_roll)    { Write-Host "[FAIL] daily cap no longer follows the roll gate"; $bad++ }
if ([int]$carry.at_insert -le [int]$carry.at_day)  { Write-Host "[FAIL] inventory insert precedes the daily cap";   $bad++ }

# --- verification: BEHAVIOUR (rolled back - nothing persists) ----------------
#
# ⚠️ STRUCTURE CHECKS CANNOT SHOW "IT WORKS NOW". The whole bug was that a structurally
#   plausible predicate produced NULL at runtime. So we actually CALL the function with
#   four payload shapes inside an explicit transaction and ROLL BACK.
#
#   The function swallows its own exceptions, so a surviving anchor row with the right
#   claimed_victory is the only positive evidence available.

Write-Host ""
Write-Host "--- verification: behaviour (executed, then rolled back) ---"
$probe = Invoke-Sql @"
begin;
do \$probe\$
declare
  v_me uuid;
begin
  select id into v_me from public.profiles limit 1;
  if v_me is null then
    raise exception 'no profile rows - cannot run the behavioural probe';
  end if;
  -- A: new client, both claims true                -> eligible
  perform public.issue_commission_for_run('aaaaaaaa-0000-4000-8000-000000000001'::uuid, v_me,
    '{"victory":true,"bossKilled":true,"finalTick":1000}'::jsonb);
  -- B: OLD client, key absent                      -> fallback, eligible (this is the fix)
  perform public.issue_commission_for_run('aaaaaaaa-0000-4000-8000-000000000002'::uuid, v_me,
    '{"victory":true,"finalTick":1000}'::jsonb);
  -- C: new client, boss NOT killed                 -> rejected (the gate still bites)
  perform public.issue_commission_for_run('aaaaaaaa-0000-4000-8000-000000000003'::uuid, v_me,
    '{"victory":true,"bossKilled":false,"finalTick":1000}'::jsonb);
  -- D: defeat                                      -> rejected
  perform public.issue_commission_for_run('aaaaaaaa-0000-4000-8000-000000000004'::uuid, v_me,
    '{"victory":false,"finalTick":1000}'::jsonb);
end
\$probe\$;
select
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000001')                        as a_anchor,
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000001' and claimed_victory)    as a_win,
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000002')                        as b_anchor,
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000002' and claimed_victory)    as b_win,
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000003')                        as c_anchor,
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000003' and claimed_victory)    as c_win,
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000004')                        as d_anchor,
  count(*) filter (where pve_run_id = 'aaaaaaaa-0000-4000-8000-000000000004' and claimed_victory)    as d_win
  from public.commission_issues
 where pve_run_id in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002',
                      'aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000004');
rollback;
"@
$p = $probe
if ($p -is [Array]) { $p = $p[-1] }
Write-Host ("[OK] A both-true    : anchor={0} claimed_victory={1}  (expect 1 / 1)" -f $p.a_anchor, $p.a_win)
Write-Host ("[OK] B key-absent   : anchor={0} claimed_victory={1}  (expect 1 / 1  <- THE FIX)" -f $p.b_anchor, $p.b_win)
Write-Host ("[OK] C boss-false   : anchor={0} claimed_victory={1}  (expect 1 / 0)" -f $p.c_anchor, $p.c_win)
Write-Host ("[OK] D defeat       : anchor={0} claimed_victory={1}  (expect 1 / 0)" -f $p.d_anchor, $p.d_win)
if ([int]$p.a_anchor -ne 1 -or [int]$p.a_win -ne 1) { Write-Host "[FAIL] A: victory+bossKilled did not become an eligible anchor"; $bad++ }
if ([int]$p.b_anchor -ne 1 -or [int]$p.b_win -ne 1) { Write-Host "[FAIL] B: OLD-CLIENT FALLBACK BROKEN - this is the 0% bug, unfixed"; $bad++ }
if ([int]$p.c_anchor -ne 1 -or [int]$p.c_win -ne 0) { Write-Host "[FAIL] C: bossKilled=false was not rejected - the gate is a no-op"; $bad++ }
if ([int]$p.d_anchor -ne 1 -or [int]$p.d_win -ne 0) { Write-Host "[FAIL] D: defeat was not rejected"; $bad++ }

# The probe must not have persisted. If the API ignored our transaction control, clean up
# LOUDLY rather than leaving synthetic rows in the issue ledger.
$leak = Invoke-Sql @"
select count(*) as n from public.commission_issues
 where pve_run_id in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002',
                      'aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000004');
"@
if ([int]$leak.n -ne 0) {
  Write-Host "[WARN] probe rows survived the rollback ($($leak.n)) - deleting them explicitly."
  Invoke-Sql @"
delete from public.commission_inventory where commission_id in (
  select commission_id from public.commission_issues
   where pve_run_id in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002',
                        'aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000004')
     and commission_id is not null);
delete from public.commission_issues
 where pve_run_id in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002',
                      'aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000004');
"@ | Out-Null
  Write-Host "[OK] probe rows removed"
} else {
  Write-Host "[OK] probe left no rows behind (rollback honoured)"
}

# --- verification: permissions ----------------------------------------------
$perm = Invoke-Sql @"
select
  has_function_privilege('public','public.issue_commission_for_run(uuid,uuid,jsonb)','execute')        as p_public,
  has_function_privilege('anon','public.issue_commission_for_run(uuid,uuid,jsonb)','execute')          as p_anon,
  has_function_privilege('authenticated','public.issue_commission_for_run(uuid,uuid,jsonb)','execute') as p_auth,
  has_function_privilege('service_role','public.issue_commission_for_run(uuid,uuid,jsonb)','execute')  as p_svc;
"@
Write-Host ""
Write-Host ("[OK] EXECUTE: public={0} anon={1} auth={2} service={3}  (all must be False)" -f `
  $perm.p_public, $perm.p_anon, $perm.p_auth, $perm.p_svc)
if ($perm.p_public) { Write-Host "[FAIL] EXECUTE to PUBLIC - anyone could issue into another profile"; $bad++ }
if ($perm.p_anon)   { Write-Host "[FAIL] executable by anon";          $bad++ }
if ($perm.p_auth)   { Write-Host "[FAIL] executable by authenticated"; $bad++ }
if ($perm.p_svc)    { Write-Host "[FAIL] executable by service_role";  $bad++ }

Write-Host ""
if ($bad -gt 0) { throw "VERIFICATION FAILED: $bad check(s) failed" }
Write-Host "[DONE] eligibility predicate repaired. Victory runs will now anchor and issue."
