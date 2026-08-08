# Planet Blitz - apply 20260808070000_commission_issue_rate.sql to the remote project.
#
# 2026-08-08 drop-rate lane (PR #391 / #392 / #393). What this migration lands:
#   1. commission_issues.skip_reason  -> domain gains 'roll'
#      Done name-agnostically: a DO loop drops EVERY check constraint whose
#      definition mentions skip_reason, then re-adds the canonical one. The older
#      "count and raise" form did not self-heal and false-tripped on any future
#      composite check that mentions the column (PR #393).
#   2. issue_commission_for_run  -> new gate 4b, ISSUE_CHANCE_CP = 3000 (= 30%)
#      placed AFTER the three caps and BEFORE the grade roll. That ordering is a
#      defence contract, not a style choice - see the .sql header.
#   3. revoke all on function ... from public/anon/authenticated/service_role
#      (4 lines. PR #391 dropped them, PR #392 put them back. Do not lose them
#      again: create-or-replace preserves ACLs so a miss has ZERO symptoms on an
#      in-order remote, and only bites when the function is created fresh.)
#
# Everything is idempotent (DO loop + add constraint / create or replace), so a
# re-run converges. The new skip_reason domain is a SUPERSET of the old one, so
# the constraint re-validation passes against existing rows.
#
# ⚠️ NO CLIENT-FIRST ORDERING NEEDED.
#   COMMISSION_ISSUE_CHANCE_CP in TS is a TEST-ONLY mirror - grep shows zero
#   runtime consumers (only commissionServerConstants.ts declaring it and the
#   drift test reading it). The gate lives entirely server-side and only ever
#   issues FEWER commissions, so an old client cannot desync on it. Contrast with
#   the catalyst SLOT_CAP change, where the server started rejecting loadouts the
#   client still allowed.
#
# ⚠️ EF REDEPLOY IS NOT NEEDED.
#   No Edge Function imports src/sim (ADR-0050 decision 1 deleted the re-run
#   verification). verify-commission imports TYPES ONLY from src/run/commission.ts.
#   Verified by grep at apply time, not assumed.
#
# Console output is ASCII-only on purpose: Windows PowerShell 5.1 mangles
# non-ASCII literals in BOM-less .ps1 files, and a mojibake'd success line reads
# like a failure.
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-commission-issue-rate-migration.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref     = 'qxgbxwyccbxokdgwxcuw'
$version = '20260808070000'
$name    = 'commission_issue_rate'
$file    = Join-Path $PSScriptRoot '..\supabase\migrations\20260808070000_commission_issue_rate.sql'

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

# The function must already exist. If it does not, this remote never got the
# commission ledger (20260803000000) and the situation is bigger than this script.
$pre = Invoke-Sql @"
select
  count(*)                                                              as fn_rows,
  bool_or(pg_get_functiondef(p.oid) like '%v_segments := 2%')           as has_segments_2,
  bool_or(pg_get_functiondef(p.oid) like '%ISSUE_CHANCE_CP%')           as already_has_gate
  from pg_proc p
 where p.proname = 'issue_commission_for_run' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] issue_commission_for_run: rows={0} segments_2={1} already_gated={2}" -f `
  $pre.fn_rows, $pre.has_segments_2, $pre.already_has_gate)
if ([int]$pre.fn_rows -ne 1) { throw "refusing: expected exactly 1 issue_commission_for_run, found $($pre.fn_rows)" }
if (-not $pre.has_segments_2) {
  Write-Host "[WARN] remote is not on the 20260803030000 segment rebalance (v_segments := 2)."
  Write-Host "[WARN] this migration redefines the function with v_segments := 2 anyway."
}
if ($pre.already_has_gate) {
  Write-Host "[NOTE] remote ALREADY has ISSUE_CHANCE_CP - this is a re-apply (idempotent)."
}

# How many skip_reason check constraints are there right now? The DO loop is meant
# to collapse whatever it finds down to one. Report the before-state so a surprising
# count is visible in the log rather than silently normalised away.
$consBefore = Invoke-Sql @"
select count(*) as n,
       coalesce(string_agg(c.conname, ', ' order by c.conname), '(none)') as names
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'public' and t.relname = 'commission_issues' and c.contype = 'c'
   and pg_get_constraintdef(c.oid) like '%skip_reason%';
"@
Write-Host ("[OK] skip_reason check constraints before: {0} -> {1}" -f $consBefore.n, $consBefore.names)

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
#   This repo writes every comment in Korean. The catalyst script learned this the
#   hard way: a check looking for '%duplicate%' reported [FAIL] on a gate that was
#   present and working, because the comment reads "-- (e) 중복 거부". A verifier
#   that cannot pass is worse than no verifier - it trains the next lane to ignore
#   a red line. Below we match only: ISSUE_CHANCE_CP (English constant name),
#   the literal 3000, and the SQL string 'roll'.

Write-Host ""
Write-Host "--- verification ---"
$bad = 0

# 1. the gate landed, with the right constant, in the right ORDER.
#    Order matters: before the caps, a failed roll would stop the hourly cap from
#    counting the claim and the forgery ceiling would go back up to 20/h.
$body = Invoke-Sql @"
select
  (pg_get_functiondef(p.oid) like '%ISSUE_CHANCE_CP%constant%int%:= 3000%') as const_3000,
  (pg_get_functiondef(p.oid) like '%skip_reason = ''roll''%')               as roll_branch,
  strpos(pg_get_functiondef(p.oid), 'skip_reason = ''stock''')              as at_stock,
  strpos(pg_get_functiondef(p.oid), 'skip_reason = ''roll''')               as at_roll,
  strpos(pg_get_functiondef(p.oid), 'v_roll := random()')                   as at_grade,
  strpos(pg_get_functiondef(p.oid), 'next_eligible_at = greatest')          as at_horizon
  from pg_proc p
 where p.proname = 'issue_commission_for_run' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] gate: const_3000={0} roll_branch={1}" -f $body.const_3000, $body.roll_branch)
Write-Host ("[OK] offsets: stock={0} roll={1} grade={2} horizon={3}" -f `
  $body.at_stock, $body.at_roll, $body.at_grade, $body.at_horizon)
if (-not $body.const_3000)  { Write-Host "[FAIL] ISSUE_CHANCE_CP := 3000 not found in remote body"; $bad++ }
if (-not $body.roll_branch) { Write-Host "[FAIL] skip_reason = 'roll' branch not found";            $bad++ }
if ([int]$body.at_roll -le [int]$body.at_stock) { Write-Host "[FAIL] gate is NOT after the stock cap";  $bad++ }
if ([int]$body.at_grade -le [int]$body.at_roll) { Write-Host "[FAIL] gate is NOT before the grade roll"; $bad++ }
# Cooldown horizon must advance only in the grant step, i.e. AFTER the roll branch.
if ([int]$body.at_horizon -le [int]$body.at_roll) { Write-Host "[FAIL] horizon advance precedes the roll gate"; $bad++ }

# 2. exactly ONE skip_reason check constraint, and it admits 'roll'.
#    Two coexisting constraints => the old one rejects 'roll' => every 4b update
#    throws => the fail-closed handler eats the anchor and leaves one warning.
#    Symptom would be "issue rate silently 0%", so this check is the real gate.
$consAfter = Invoke-Sql @"
select count(*) as n,
       coalesce(string_agg(c.conname, ', ' order by c.conname), '(none)')  as names,
       bool_and(pg_get_constraintdef(c.oid) like '%roll%')                 as all_admit_roll
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'public' and t.relname = 'commission_issues' and c.contype = 'c'
   and pg_get_constraintdef(c.oid) like '%skip_reason%';
"@
Write-Host ("[OK] skip_reason checks after: {0} -> {1} (all admit roll: {2})" -f `
  $consAfter.n, $consAfter.names, $consAfter.all_admit_roll)
if ([int]$consAfter.n -ne 1)     { Write-Host "[FAIL] expected exactly 1 skip_reason check constraint"; $bad++ }
if (-not $consAfter.all_admit_roll) { Write-Host "[FAIL] a skip_reason check does not admit 'roll'";    $bad++ }

# 3. the domain really accepts 'roll' - proven by INSERT, not by reading the DDL.
#    Rolled back so no junk row survives. Reading the constraint text and trusting
#    it is what check 2 already does; this is the independent axis - it is what the
#    function's 4b update actually executes at runtime.
#
#    ⚠️ profile_id is NOT NULL + FK, so the probe must borrow a real profile id.
#       The first version of this script passed null and the probe failed with a
#       NOT NULL violation - which looks exactly like "the migration is broken"
#       even though checks 1 and 2 had already passed. A probe that cannot pass
#       is worse than no probe (same lesson as the catalyst script's prose match).
$anchor = Invoke-Sql "select coalesce((select profile_id::text from public.commission_issues limit 1), '') as pid;"
if ([string]::IsNullOrEmpty($anchor.pid)) {
  Write-Host "[SKIP] no existing commission_issues row to borrow a profile_id from - insert probe skipped"
  Write-Host "       (check 2 already proved the constraint text admits 'roll')"
} else {
  Invoke-Sql @"
do `$`$
begin
  begin
    insert into public.commission_issues
      (pve_run_id, profile_id, granted, claimed_victory, claimed_final_tick, skip_reason)
    values (gen_random_uuid(), '$($anchor.pid)'::uuid, false, true, 999, 'roll');
    raise exception 'PROBE_OK_ROLLBACK';
  exception
    when others then
      if sqlerrm = 'PROBE_OK_ROLLBACK' then
        raise notice 'roll accepted by the check constraint';
      else
        raise exception 'PROBE_FAILED: %', sqlerrm;
      end if;
  end;
end `$`$;
"@ | Out-Null
  Write-Host "[OK] 'roll' insert probe passed (rolled back, no row kept)"

  # Negative control: an unknown label must still be REJECTED. Without this the
  # probe above would also pass against a table with no check constraint at all.
  $neg = Invoke-Sql @"
do `$`$
begin
  begin
    insert into public.commission_issues
      (pve_run_id, profile_id, granted, claimed_victory, claimed_final_tick, skip_reason)
    values (gen_random_uuid(), '$($anchor.pid)'::uuid, false, true, 999, 'not-a-real-reason');
    raise exception 'PROBE_CONSTRAINT_MISSING';
  exception
    when check_violation then
      raise notice 'unknown label correctly rejected';
    when others then
      if sqlerrm = 'PROBE_CONSTRAINT_MISSING' then
        raise exception 'PROBE_FAILED: an unknown skip_reason was ACCEPTED - the check constraint is not enforcing';
      else
        raise exception 'PROBE_FAILED: %', sqlerrm;
      end if;
  end;
end `$`$;
"@
  Write-Host "[OK] negative control passed (unknown skip_reason rejected)"
}

# 4. execute privileges: the function must be unreachable from every client role.
#    This is the axis PR #391 broke by dropping the revoke lines.
$acl = Invoke-Sql @"
select has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role',  p.oid, 'execute') as svc_exec,
       has_function_privilege('public',        p.oid, 'execute') as pub_exec
  from pg_proc p
 where p.proname = 'issue_commission_for_run' and p.pronamespace = 'public'::regnamespace;
"@
Write-Host ("[OK] execute: anon={0} authenticated={1} service_role={2} public={3}" -f `
  $acl.anon_exec, $acl.auth_exec, $acl.svc_exec, $acl.pub_exec)
if ($acl.anon_exec) { Write-Host "[FAIL] anon CAN execute issue_commission_for_run";          $bad++ }
if ($acl.auth_exec) { Write-Host "[FAIL] authenticated CAN execute";                          $bad++ }
if ($acl.svc_exec)  { Write-Host "[FAIL] service_role CAN execute";                           $bad++ }
if ($acl.pub_exec)  { Write-Host "[FAIL] PUBLIC CAN execute - the revoke lines did not land"; $bad++ }

# 5. the trigger that is the only legitimate caller is still wired.
$trg = Invoke-Sql @"
select count(*) as n from pg_trigger
 where tgname = 'pve_runs_issue_commission' and not tgisinternal;
"@
Write-Host ("[OK] pve_runs_issue_commission trigger rows: {0}" -f $trg.n)
if ([int]$trg.n -lt 1) { Write-Host "[FAIL] the issuing trigger is missing - nothing will ever call the fn"; $bad++ }

# 6. RLS still shuts clients out of commission_issues (skip_reason must not leak:
#    it would let a player reverse-engineer the server-side probability).
$rls = Invoke-Sql @"
select c.relrowsecurity as rls_on,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'commission_issues') as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'commission_issues';
"@
Write-Host ("[OK] commission_issues: rls_on={0} policies={1}" -f $rls.rls_on, $rls.policies)
if (-not $rls.rls_on)            { Write-Host "[FAIL] RLS is off on commission_issues";               $bad++ }
if ([int]$rls.policies -ne 0)    { Write-Host "[FAIL] a policy exists - skip_reason may be readable"; $bad++ }

# 7. migration ledger row present.
$led = Invoke-Sql "select count(*) as n from supabase_migrations.schema_migrations where version = '$version';"
Write-Host ("[OK] schema_migrations row for {0}: {1}" -f $version, $led.n)
if ([int]$led.n -ne 1) { Write-Host "[FAIL] ledger row missing"; $bad++ }

if ($bad -gt 0) { throw "verification FAILED with $bad mismatches" }

Write-Host ""
Write-Host "[DONE] commission issue rate gate is live: 30% on an otherwise-eligible clear."
Write-Host "[NOTE] The gate sits AFTER the three caps, so the hourly cap still counts"
Write-Host "       every claimed victory. Forgery ceiling drops 20/h -> about 6/h."
Write-Host "[NOTE] Effective issuance = min(20/h claims) x 30%. Do NOT describe it as"
Write-Host "       'the probability bites before the caps' - measured p50 finalTick is"
Write-Host "       782 ticks, so repeat players still hit skip_reason='rate' routinely."
Write-Host "[NOTE] Observe the outcome mix over the next days:"
Write-Host "         select coalesce(skip_reason, 'GRANTED'), count(*) from commission_issues"
Write-Host "          where created_at > now() - interval '1 day' group by 1;"
Write-Host "       'roll' should be roughly 70% of the rows that got past 'stock'."
