# Planet Blitz - apply 20260808090000_drop_axis_scales_issue_and_caps.sql to the remote project.
#
# 2026-08-08 (2nd) user directive: "blueprints and commissions are items too - make the
# catalyst drop-rate axis affect them as well". What this migration lands:
#
#   1. issue_commission_for_run gate 4b now scales ISSUE_CHANCE_CP (3000) by the
#      client-claimed drop-axis multiplier, CLAMPED to [100, 300] centi. 30% -> max 90%.
#   2. NEW gate 4c: daily granted cap (360) with a profiles row lock. The hourly axis
#      is deliberately NOT capped - see the .sql header for the derivation showing that
#      the forged and honest ceilings are the SAME number there (18/h), so any hourly
#      cap punishes honest max-catalyst players by exactly as much as it constrains an
#      attacker. The daily axis was genuinely unprocured and is what this closes.
#   3. skip_reason domain += 'rate-day' (self-healing constraint swap, name-agnostic).
#   4. grant_blueprints caps re-derived 12/60 -> 20/140. The honest hourly expectation
#      rose 1.8 -> 5.4 (3% -> 9% per clear), and Poisson(5.4) P(X>=12) ~ 1e-2 means the
#      OLD cap would silently reject 1 hour in 100 for a max-catalyst player. The RPC is
#      fire-and-forget so that rejection is invisible - the feature would read as
#      "pouring catalysts does nothing".
#
# ⚠️ THE CAPS WENT UP BUT THE RATIO WENT DOWN.
#   ADR-0026's criterion is relative, not absolute. hour 12/1.8 = 6.7x -> 20/5.4 = 3.7x,
#   day 60/28.8 = 2.1x -> 140/86.4 = 1.6x. Reading "cap raised => weaker" is the mirror
#   image of the mistake documented in .omc/skills/relative-security-bound-expertise.md.
#
# ⚠️ x3.0 IS A SWEEP RESULT, NOT A HAND CALCULATION.
#   scripts/catalystCapSweep.ts over 48C3 (12,430 valid combos, resonance included):
#     [drop] x3.0000  = #15 extraction + #20 resonance + #34 berdan-royal-jelly
#                       with resonance harvest:weak (snare)
#   axisCapMult alone (no resonance) says x2.9 - using that would clip the honest max.
#
# ⚠️ NO CLIENT-FIRST ORDERING NEEDED. The new summary key (catalystLootMultCenti) is
#   OPTIONAL and absent -> 100 -> exactly the previous 30%. Cached old clients are
#   byte-identical in behaviour. Deploy order does not matter.
#
# ⚠️ REVOKES ARE PART OF THE FUNCTION BODY. create-or-replace preserves ACLs so a
#   missing revoke has ZERO symptoms on an in-order remote; the risk is baseline
#   squash / drop-then-reapply, where the definer function would be born EXECUTE to
#   PUBLIC and any authenticated user could issue commissions into someone else's
#   profile. Verification below measures has_function_privilege('public', ...).
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and a mojibake'd success line reads like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-drop-axis-issue-caps-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260808090000'
$name    = 'drop_axis_scales_issue_and_caps'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260808090000_drop_axis_scales_issue_and_caps.sql'

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
Write-Host ""
Write-Host "--- preconditions ---"

# Both functions are REDEFINED, not created. If either is absent the redefinition
# would create it fresh - and then the revoke/grant lines are the only thing standing
# between a definer function and EXECUTE to PUBLIC.
$pre = Invoke-Sql @"
select
  (select count(*) from pg_proc p where p.proname='issue_commission_for_run'
     and p.pronamespace='public'::regnamespace) as issue_rows,
  (select count(*) from pg_proc p where p.proname='grant_blueprints'
     and p.pronamespace='public'::regnamespace) as grant_rows,
  (select bool_or(pg_get_functiondef(p.oid) like '%MAX_LOOT_MULT_CENTI%') from pg_proc p
     where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace) as already_scaled,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='commission_issues') as has_issues,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='blueprint_grant_log') as has_bp_log,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='profiles') as has_profiles;
"@
Write-Host ("[OK] functions: issue={0} grant_blueprints={1} already_scaled={2}" -f `
  $pre.issue_rows, $pre.grant_rows, $pre.already_scaled)
Write-Host ("[OK] deps: commission_issues={0} blueprint_grant_log={1} profiles={2}" -f `
  $pre.has_issues, $pre.has_bp_log, $pre.has_profiles)
if ([int]$pre.issue_rows   -ne 1) { throw "refusing: expected exactly 1 issue_commission_for_run" }
if ([int]$pre.grant_rows   -ne 1) { throw "refusing: expected exactly 1 grant_blueprints (apply 20260808080000 first)" }
if ([int]$pre.has_issues   -ne 1) { throw "refusing: commission_issues missing" }
if ([int]$pre.has_bp_log   -ne 1) { throw "refusing: blueprint_grant_log missing (apply 20260808080000 first)" }
if ([int]$pre.has_profiles -ne 1) { throw "refusing: profiles missing" }
if ($pre.already_scaled) { Write-Host "[NOTE] remote ALREADY scaled - this is a re-apply (idempotent)." }

# The honest denominators this lane's caps are derived from. Report what is ACTUALLY
# enforced rather than trusting the .sql header's arithmetic.
$denom = Invoke-Sql @"
select
  coalesce((select substring(pg_get_functiondef(p.oid) from 'CAP_RUNS_PER_HOUR[^0-9]*([0-9]+)')
     from pg_proc p where p.proname='begin_pve_run' and p.pronamespace='public'::regnamespace), '(absent)')
    as cap_runs_per_hour,
  coalesce((select substring(pg_get_functiondef(p.oid) from 'CAP_ISSUE_ATTEMPTS_PER_HOUR[^0-9]*([0-9]+)')
     from pg_proc p where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace), '(absent)')
    as cap_issue_attempts;
"@
Write-Host ("[OK] denominators on remote: axis-D runs/h={0}  issue attempts/h={1}" -f `
  $denom.cap_runs_per_hour, $denom.cap_issue_attempts)
Write-Host "[OK]   blueprint honest expectation = runs/h x 9%  (3% base x drop-axis cap 3.0)"
Write-Host "[OK]   commission honest ceiling    = attempts/h x 90%"
if ($denom.cap_runs_per_hour -eq '(absent)') {
  Write-Host "[WARN] begin_pve_run missing - the 20/140 blueprint derivation rests on an"
  Write-Host "[WARN] unenforced assumption on this remote."
}

# --- apply -------------------------------------------------------------------
# NOT Get-Content -Raw (mangles the Korean comments).
$sql = [IO.File]::ReadAllText((Resolve-Path $file), $utf8)
Write-Host ""
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
#
# ⚠️ MATCH ON IDENTIFIERS THE SQL ACTUALLY CONTAINS, NEVER ON ENGLISH PROSE.
#   This repo writes every comment in Korean. The catalyst script reported [FAIL] on a
#   working gate because it grepped for '%duplicate%' while the comment read "중복 거부".
#   Below we match only SQL identifiers and literals.
#
# ⚠️ CONSTANT REGEXES ARE ANCHORED ON `constant ... :=`, NOT `NAME[^0-9]*([0-9]+)`.
#   The loose form was WRONG and the first run of this script proved it: it read
#   ISSUE_CHANCE_CP as 30. pg_get_functiondef keeps the Korean comments, the comment
#   above the declaration mentions "COMMISSION_ISSUE_CHANCE_CP" and later "30%", and
#   [^0-9]* happily walked across the whole sentence to the first digits it found.
#   The migration was already correct - the VERIFIER was broken, which is the exact
#   trap the blueprint-cap lane hit from the other side (a probe that inserted NULL).
#   Anchor on the declaration syntax so a mention inside prose can never match.

Write-Host ""
Write-Host "--- verification ---"
$bad = 0

# 1. mirrored constants landed.
$consts = Invoke-Sql @"
select
  (select substring(pg_get_functiondef(p.oid) from 'MAX_LOOT_MULT_CENTI[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)')
     from pg_proc p where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace) as max_mult,
  (select substring(pg_get_functiondef(p.oid) from 'CAP_COMMISSIONS_PER_DAY[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)')
     from pg_proc p where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace) as day_cap,
  (select substring(pg_get_functiondef(p.oid) from 'ISSUE_CHANCE_CP[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)')
     from pg_proc p where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace) as issue_cp,
  (select substring(pg_get_functiondef(p.oid) from 'CAP_BLUEPRINTS_PER_HOUR[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)')
     from pg_proc p where p.proname='grant_blueprints' and p.pronamespace='public'::regnamespace) as bp_hour,
  (select substring(pg_get_functiondef(p.oid) from 'CAP_BLUEPRINTS_PER_DAY[[:space:]]+constant[^:]*:=[[:space:]]*([0-9]+)')
     from pg_proc p where p.proname='grant_blueprints' and p.pronamespace='public'::regnamespace) as bp_day;
"@
Write-Host ("[OK] issue: MAX_LOOT_MULT_CENTI={0} CAP_COMMISSIONS_PER_DAY={1} ISSUE_CHANCE_CP={2}" -f `
  $consts.max_mult, $consts.day_cap, $consts.issue_cp)
Write-Host ("[OK] blueprint caps: hour={0} day={1}   (expected 20 / 140)" -f $consts.bp_hour, $consts.bp_day)
if ($consts.max_mult -ne '300')  { Write-Host "[FAIL] MAX_LOOT_MULT_CENTI is not 300 (sweep max x3.0)"; $bad++ }
if ($consts.day_cap  -ne '360')  { Write-Host "[FAIL] CAP_COMMISSIONS_PER_DAY is not 360"; $bad++ }
if ($consts.issue_cp -ne '3000') { Write-Host "[FAIL] ISSUE_CHANCE_CP drifted from 3000"; $bad++ }
if ($consts.bp_hour  -ne '20')   { Write-Host "[FAIL] blueprint hourly cap is not 20"; $bad++ }
if ($consts.bp_day   -ne '140')  { Write-Host "[FAIL] blueprint daily cap is not 140"; $bad++ }

# 2. ORDER IS THE CONTRACT and value checks cannot see it.
#    stock < roll(4b) < day-cap(4c) < grade roll < inventory insert.
#    4b before 4c: the daily cap's numerator is GRANTED rows, so a failed roll must not
#    eat it. 4c before the insert: otherwise the cap becomes an after-the-fact notice.
$ord = Invoke-Sql @"
select
  strpos(pg_get_functiondef(p.oid), 'skip_reason = ''stock''')                       as at_stock,
  strpos(pg_get_functiondef(p.oid), 'skip_reason = ''roll''')                        as at_roll,
  strpos(pg_get_functiondef(p.oid), 'skip_reason = ''rate-day''')                    as at_day,
  strpos(pg_get_functiondef(p.oid), 'from public.profiles where id = p_profile_id for update') as at_lock,
  strpos(pg_get_functiondef(p.oid), 'v_roll := random()')                            as at_grade,
  strpos(pg_get_functiondef(p.oid), 'insert into public.commission_inventory')       as at_insert
  from pg_proc p
 where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] offsets: stock={0} roll={1} lock={2} day={3} grade={4} insert={5}" -f `
  $ord.at_stock, $ord.at_roll, $ord.at_lock, $ord.at_day, $ord.at_grade, $ord.at_insert)
if ([int]$ord.at_roll   -le [int]$ord.at_stock) { Write-Host "[FAIL] roll gate precedes the stock cap"; $bad++ }
if ([int]$ord.at_lock   -le [int]$ord.at_roll)  { Write-Host "[FAIL] row lock precedes the roll gate";  $bad++ }
if ([int]$ord.at_day    -le [int]$ord.at_lock)  { Write-Host "[FAIL] daily cap is checked before the row lock"; $bad++ }
if ([int]$ord.at_grade  -le [int]$ord.at_day)   { Write-Host "[FAIL] grade roll precedes the daily cap"; $bad++ }
if ([int]$ord.at_insert -le [int]$ord.at_day)   { Write-Host "[FAIL] inventory insert precedes the daily cap"; $bad++ }

# 3. the multiplier is CLAMPED, not rejected, and the daily numerator counts GRANTED.
$shape = Invoke-Sql @"
select
  (pg_get_functiondef(p.oid) like '%least(MAX_LOOT_MULT_CENTI, greatest(100,%')            as clamps_mult,
  (pg_get_functiondef(p.oid) like '%round(ISSUE_CHANCE_CP * v_mult_cp / 100.0)%')          as rounds_like_ts,
  (pg_get_functiondef(p.oid) like '%floor(random() * 10000)::int >= v_chance_cp%')         as uses_scaled_cp,
  (pg_get_functiondef(p.oid) like '%and granted%')                                         as day_counts_granted
  from pg_proc p
 where p.proname='issue_commission_for_run' and p.pronamespace='public'::regnamespace;
"@
Write-Host ("[OK] shape: clamp={0} round={1} scaled_gate={2} day_counts_granted={3}" -f `
  $shape.clamps_mult, $shape.rounds_like_ts, $shape.uses_scaled_cp, $shape.day_counts_granted)
if (-not $shape.clamps_mult)        { Write-Host "[FAIL] multiplier is not clamped - old clients may be rejected, forged values unbounded"; $bad++ }
if (-not $shape.rounds_like_ts)     { Write-Host "[FAIL] rounding differs from the TS mirror scaleGateChanceCp"; $bad++ }
if (-not $shape.uses_scaled_cp)     { Write-Host "[FAIL] gate still compares against the unscaled constant"; $bad++ }
if (-not $shape.day_counts_granted) { Write-Host "[FAIL] daily cap does not filter on granted"; $bad++ }

# 4. skip_reason domain accepts 'rate-day' - WITH A NEGATIVE CONTROL.
#    Checking only that 'rate-day' inserts would also pass on a table with NO constraint
#    at all. An unregistered label must be rejected for this probe to mean anything.
$dom = Invoke-Sql @"
select
  (select count(*) from pg_constraint c
     join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='commission_issues' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%skip_reason%')                as n_constraints,
  (select bool_and(pg_get_constraintdef(c.oid) like '%rate-day%') from pg_constraint c
     join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='commission_issues' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%skip_reason%')                as has_rate_day,
  (select bool_and(pg_get_constraintdef(c.oid) like '%zzz-not-a-label%') from pg_constraint c
     join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='commission_issues' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%skip_reason%')                as has_bogus;
"@
Write-Host ("[OK] skip_reason: constraints={0} has_rate_day={1} has_bogus={2} (bogus must be False)" -f `
  $dom.n_constraints, $dom.has_rate_day, $dom.has_bogus)
if ([int]$dom.n_constraints -ne 1) { Write-Host "[FAIL] expected exactly 1 skip_reason check constraint"; $bad++ }
if (-not $dom.has_rate_day)        { Write-Host "[FAIL] 'rate-day' missing - gate 4c will fail-closed and erase the anchor"; $bad++ }
if ($dom.has_bogus)                { Write-Host "[FAIL] negative control matched - the probe is meaningless"; $bad++ }

# 5. the cap query has an index, and REVOKES actually landed.
#    has_function_privilege is the ONLY evidence for the revokes: create-or-replace
#    preserves ACLs, so a dropped revoke has zero observable symptoms otherwise.
$perm = Invoke-Sql @"
select
  (select count(*) from pg_indexes where schemaname='public' and tablename='commission_issues'
     and indexdef like '%granted%')                                              as granted_index,
  has_function_privilege('public','public.issue_commission_for_run(uuid,uuid,jsonb)','execute')        as issue_public,
  has_function_privilege('anon','public.issue_commission_for_run(uuid,uuid,jsonb)','execute')          as issue_anon,
  has_function_privilege('authenticated','public.issue_commission_for_run(uuid,uuid,jsonb)','execute') as issue_auth,
  has_function_privilege('service_role','public.issue_commission_for_run(uuid,uuid,jsonb)','execute')  as issue_svc,
  has_function_privilege('public','public.grant_blueprints(jsonb)','execute')                          as grant_public,
  has_function_privilege('anon','public.grant_blueprints(jsonb)','execute')                            as grant_anon,
  has_function_privilege('authenticated','public.grant_blueprints(jsonb)','execute')                   as grant_auth;
"@
Write-Host ("[OK] granted-axis index rows: {0}" -f $perm.granted_index)
Write-Host ("[OK] issue_commission_for_run EXECUTE: public={0} anon={1} auth={2} service={3}  (all must be False)" -f `
  $perm.issue_public, $perm.issue_anon, $perm.issue_auth, $perm.issue_svc)
Write-Host ("[OK] grant_blueprints EXECUTE: public={0} anon={1} auth={2}  (auth must be True)" -f `
  $perm.grant_public, $perm.grant_anon, $perm.grant_auth)
if ([int]$perm.granted_index -lt 1) { Write-Host "[WARN] no index covering the granted axis - the daily cap query will seq-scan" }
if ($perm.issue_public) { Write-Host "[FAIL] issue_commission_for_run is EXECUTE to PUBLIC - anyone can issue into another profile"; $bad++ }
if ($perm.issue_anon)   { Write-Host "[FAIL] issue_commission_for_run executable by anon";          $bad++ }
if ($perm.issue_auth)   { Write-Host "[FAIL] issue_commission_for_run executable by authenticated"; $bad++ }
if ($perm.issue_svc)    { Write-Host "[FAIL] issue_commission_for_run executable by service_role";  $bad++ }
if ($perm.grant_public) { Write-Host "[FAIL] grant_blueprints is EXECUTE to PUBLIC"; $bad++ }
if ($perm.grant_anon)   { Write-Host "[FAIL] grant_blueprints executable by anon";   $bad++ }
if (-not $perm.grant_auth) { Write-Host "[FAIL] grant_blueprints NOT executable by authenticated - clients cannot bank drops"; $bad++ }

Write-Host ""
if ($bad -gt 0) { throw "VERIFICATION FAILED: $bad check(s) failed" }
Write-Host "[DONE] drop-axis scaling + re-derived caps are live and verified."
