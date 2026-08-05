# Planet Blitz - prove that the daily reward is idempotent, bounded, and does not feed
# its own ceiling.
#
# Why a separate script: apply-daily-reward-migration.ps1 runs every statement as
# `postgres`, which can confirm the ceiling formula EXISTS in the function body but never
# that it BITES. This script exercises the real RPC and reads the resulting state.
#
# WHY THE CLAIM RUNS AS postgres AND NOT AS authenticated
#   claim_daily_reward_for is revoked from public/anon/authenticated on purpose - claiming
#   is Edge-Function-only (service_role). Calling it as `authenticated` here would only
#   ever produce "permission denied", which proves nothing about clamping. That refusal is
#   its own proof and lives in prove-daily-reward-seal.ps1
#   ([OK] RPC_DENIED_AUTHENTICATED). Here we stand in for the Edge Function.
#
# TWO TRAPS this script is shaped around (both cost real time in this repo):
#   1. An RPC call and a state read in the SAME select statement disagree: the subquery
#      sees the snapshot taken when the statement STARTED, so the RPC return value is
#      right while the state column reads the pre-call value.
#      => every call and every state read is its own statement, and RPC returns are parked
#         in a TEMP table so the final select can compare them without re-calling.
#   2. The Management API returns only the LAST statement's result set. So intermediate
#      calls return nothing useful and every assertion is read off one final select.
#
# Everything runs inside BEGIN ... ROLLBACK, so no ledger row, grant row, or profile
# change survives - safe to re-run against production.
#
# THE EIGHT TOKENS
#   IDEMPOTENT_1ROW        two calls on the same day -> one ledger row, already=true, same payload
#   CAP_LEDGER_ROW         the currency grant is recorded with source='daily_reward'
#   CAP_CLAMPED            an oversized claim is truncated to the budget and flagged clamped
#   ANCHOR_NO_SELF_FEED    the reward's own grant does NOT raise lifetime_granted
#                          (with a pve_run control row that DOES - an OK without a control
#                           is itself a defect)
#   FLOOR_BOUNDED          a zero-anchor account gets 0 < budget <= DAILY_BUDGET_DAY_1
#                          (BOTH ends - a lower-bound-only check passes for any FLOOR)
#   BACKFILL_LOWER_BOUND   existing rows satisfy lifetime_granted >= credits + minerals*8
#   STREAK_BREAK_ONE       a missed day resets the streak to 1 (not 0, not held)
#   STREAK_CYCLE_WRAP      day 30 + 1 wraps to 1
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\prove-daily-reward-cap.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref = 'qxgbxwyccbxokdgwxcuw'

# Expected constants - must match the DECLARE blocks in
# supabase/migrations/20260805000000_daily_reward.sql and the TS mirrors in
# data/dailyReward.ts (DAILY_BUDGET_DAY_1) / data/dailyRewardSelection.ts (MINERAL_TO_CREDIT).
$DAILY_BUDGET_DAY_1 = 2000
$MINERAL_TO_CREDIT  = 8
$STREAK_CYCLE       = 30

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
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

$who = Invoke-Sql "select id::text as id from public.profiles order by id limit 1;"
if ($null -eq $who) { throw "no profiles row to test against" }
$me = $who.id
Write-Host "[OK] acting as the Edge Function for profile $me (all writes rolled back)"

$bad = 0
function Check([string]$label, $actual, $expected) {
  if ("$actual" -ne "$expected") {
    Write-Host ("[FAIL] {0}: got '{1}', expected '{2}'" -f $label, $actual, $expected)
    $script:bad++
  } else {
    Write-Host ("[OK] {0} = {1}" -f $label, $actual)
  }
}

# Clean slate for today, inside the transaction. daily_last_claim_seed = 0 is the
# "never claimed" sentinel, so the next claim is day 1.
$reset = @"
begin;
create temp table probe(k text, v jsonb) on commit drop;
delete from public.daily_reward_claims where profile_id = '$me'::uuid;
delete from public.currency_grants where profile_id = '$me'::uuid;
update public.profiles
   set daily_last_claim_seed = 0, daily_streak = 0
 where id = '$me'::uuid;
"@

$CLAIM_1000 = "'currency', 1000, '{""credits"":1000,""minerals"":0}'::jsonb, '{}'::jsonb"

# --- C1 + C2: idempotence and the ledger --------------------------------------
$c1 = Invoke-Sql @"
$reset
insert into probe select 'c1', public.claim_daily_reward_for('$me'::uuid, $CLAIM_1000);
insert into probe select 'c2', public.claim_daily_reward_for('$me'::uuid, $CLAIM_1000);

select (select count(*)::text from public.daily_reward_claims
          where profile_id = '$me'::uuid)                                     as ledger_rows,
       (select (v->>'already') from probe where k = 'c1')                     as first_already,
       (select (v->>'already') from probe where k = 'c2')                     as second_already,
       (select ((select v->'result_payload' from probe where k = 'c1')
              = (select v->'result_payload' from probe where k = 'c2'))::text) as same_payload,
       (select count(*)::text from public.currency_grants
          where profile_id = '$me'::uuid and source = 'daily_reward')         as grant_rows;
rollback;
"@
Write-Host ""
Write-Host "--- C1: two claims on the same day ---"
# THE witness: without the composite PK this is 2, and the second call rolls a new item.
Check 'IDEMPOTENT_1ROW (ledger rows)'   $c1.ledger_rows    1
Check 'IDEMPOTENT_1ROW (first already)' $c1.first_already  'false'
Check 'IDEMPOTENT_1ROW (second already)' $c1.second_already 'true'
Check 'IDEMPOTENT_1ROW (same payload)'  $c1.same_payload   'true'
Write-Host ""
Write-Host "--- C2: the currency grant is on the ledger ---"
Check 'CAP_LEDGER_ROW' $c1.grant_rows 1

# --- C3: the ceiling truncates -------------------------------------------------
# lifetime_granted = 0 -> ceiling = max(DAILY_BUDGET_DAY_1, 0) = DAILY_BUDGET_DAY_1, and
# streak 1 -> ramp = DAILY_BUDGET_DAY_1. Asking for 10^7 must come back as DAILY_BUDGET_DAY_1.
$c3 = Invoke-Sql @"
$reset
update public.profiles set lifetime_granted = 0 where id = '$me'::uuid;
insert into probe select 'c3', public.claim_daily_reward_for(
  '$me'::uuid, 'currency', 10000000, '{"credits":10000000,"minerals":0}'::jsonb, '{}'::jsonb);

select (select (v->>'clamped') from probe where k = 'c3')                    as clamped,
       (select (v->'result_payload'->>'value') from probe where k = 'c3')    as value,
       (select (v->>'budget') from probe where k = 'c3')                     as budget,
       (select clamped::text from public.daily_reward_claims
          where profile_id = '$me'::uuid)                                    as ledger_clamped;
rollback;
"@
Write-Host ""
Write-Host "--- C3: an oversized claim ---"
Check 'CAP_CLAMPED (flag)'          $c3.clamped        'true'
Check 'CAP_CLAMPED (paid value)'    $c3.value          $DAILY_BUDGET_DAY_1
Check 'CAP_CLAMPED (budget)'        $c3.budget         $DAILY_BUDGET_DAY_1
# The observability column feeding metric (3) - without it the clamp rate has nowhere to live.
Check 'CAP_CLAMPED (ledger column)' $c3.ledger_clamped 'true'

# --- C4: the anchor does not feed itself ---------------------------------------
# WITH A CONTROL. An OK with no control is itself a defect: if the trigger were simply
# broken, "the reward did not raise the anchor" would pass for the wrong reason.
$c4 = Invoke-Sql @"
$reset
update public.profiles set lifetime_granted = 100000 where id = '$me'::uuid;
create temp table anchor(k text, v numeric) on commit drop;

insert into anchor select 'before', lifetime_granted from public.profiles where id = '$me'::uuid;
select public.claim_daily_reward_for('$me'::uuid, $CLAIM_1000);
insert into anchor select 'after_reward', lifetime_granted from public.profiles where id = '$me'::uuid;

insert into public.currency_grants (profile_id, source, credits, minerals)
values ('$me'::uuid, 'pve_run', 100, 0);
insert into anchor select 'after_control', lifetime_granted from public.profiles where id = '$me'::uuid;

select (select v::text from anchor where k = 'before')                            as before,
       (select v::text from anchor where k = 'after_reward')                      as after_reward,
       (select v::text from anchor where k = 'after_control')                     as after_control,
       (select count(*)::text from public.currency_grants
          where profile_id = '$me'::uuid and source = 'daily_reward')             as reward_grants;
rollback;
"@
Write-Host ""
Write-Host "--- C4: the reward must not push its own ceiling ---"
# Preceding witness: the reward really did write a currency_grants row. Without this the
# next check passes trivially when nothing was granted at all.
Check 'ANCHOR_NO_SELF_FEED (reward grant exists)' $c4.reward_grants 1
Check 'ANCHOR_NO_SELF_FEED (anchor unchanged)'    $c4.after_reward  $c4.before
# The control: an ordinary pve_run grant DOES move the anchor, so the WHEN filter is the
# reason for the line above - not a dead trigger.
Check 'ANCHOR_NO_SELF_FEED (control moves it)'    $c4.after_control ([string]([decimal]$c4.before + 100))

# --- C5: FLOOR is bounded on BOTH ends -----------------------------------------
# A lower-bound-only assertion passes no matter how large FLOOR grows, and a FLOOR above
# DAILY_BUDGET_DAY_1 is exactly what breaks the "bounded by what you were already given"
# argument (a zero-play account would receive mid-ramp rewards forever).
$c5 = Invoke-Sql @"
$reset
update public.profiles set lifetime_granted = 0 where id = '$me'::uuid;
select (public.daily_reward_preview_for('$me'::uuid) ->> 'budget')  as budget,
       (public.daily_reward_preview_for('$me'::uuid) ->> 'ceiling') as ceiling,
       (public.daily_reward_preview_for('$me'::uuid) ->> 'streak')  as streak;
rollback;
"@
Write-Host ""
Write-Host "--- C5: a zero-anchor account ---"
Write-Host ("[..] budget={0} ceiling={1} streak={2}" -f $c5.budget, $c5.ceiling, $c5.streak)
$budget = [decimal]$c5.budget
if ($budget -gt 0 -and $budget -le $DAILY_BUDGET_DAY_1) {
  Write-Host ("[OK] FLOOR_BOUNDED = {0} (0 < budget <= {1})" -f $budget, $DAILY_BUDGET_DAY_1)
} else {
  Write-Host ("[FAIL] FLOOR_BOUNDED: {0} is outside (0, {1}]" -f $budget, $DAILY_BUDGET_DAY_1)
  $bad++
}

# --- C6: the backfill lower bound holds ----------------------------------------
# Current balance is a strict lower bound of lifetime grants (credits/minerals only enter
# through server RPCs and only leave through spending). Any row below it means the
# backfill did not run, and that row's owner is stuck at the FLOOR ceiling.
$c6 = Invoke-Sql @"
select (select count(*)::text from public.profiles)                                   as total,
       (select count(*)::text from public.profiles
         where lifetime_granted < coalesce(credits, 0)
                                + coalesce(minerals, 0) * $MINERAL_TO_CREDIT)         as below,
       (select count(*)::text from public.profiles where lifetime_granted > 0)        as positive;
"@
Write-Host ""
Write-Host "--- C6: backfill ---"
Write-Host ("[..] profiles={0} with positive anchor={1}" -f $c6.total, $c6.positive)
Check 'BACKFILL_LOWER_BOUND (rows below the bound)' $c6.below 0
if ([int]$c6.total -eq 0) { Write-Host "[FAIL] no profiles at all - the bound check is vacuous"; $bad++ }

# --- C7: a missed day resets to 1 ----------------------------------------------
# Not 0 (today's claim is already day one), not halved, not held.
$c7 = Invoke-Sql @"
$reset
update public.profiles
   set daily_last_claim_seed = floor(extract(epoch from now()) / 86400)::bigint - 2,
       daily_streak = 5
 where id = '$me'::uuid;
select public.claim_daily_reward_for('$me'::uuid, $CLAIM_1000);
select daily_streak::text as streak from public.profiles where id = '$me'::uuid;
rollback;
"@
Write-Host ""
Write-Host "--- C7: claimed the day before yesterday, then today ---"
Check 'STREAK_BREAK_ONE' $c7.streak 1

# --- C8: day 30 wraps to 1 ------------------------------------------------------
$c8 = Invoke-Sql @"
$reset
update public.profiles
   set daily_last_claim_seed = floor(extract(epoch from now()) / 86400)::bigint - 1,
       daily_streak = $STREAK_CYCLE
 where id = '$me'::uuid;
select public.claim_daily_reward_for('$me'::uuid, $CLAIM_1000);
select daily_streak::text as streak from public.profiles where id = '$me'::uuid;
rollback;
"@
Write-Host ""
Write-Host "--- C8: day 30 yesterday, claim today ---"
Check 'STREAK_CYCLE_WRAP' $c8.streak 1

# --- nothing leaked -------------------------------------------------------------
$post = Invoke-Sql @"
select (select count(*)::text from public.daily_reward_claims where profile_id = '$me'::uuid) as ledger_rows,
       (select count(*)::text from public.currency_grants
          where profile_id = '$me'::uuid and source = 'daily_reward')                          as reward_grants;
"@
Write-Host ""
Write-Host ("[OK] post-rollback: ledger_rows={0} reward_grants={1}" -f $post.ledger_rows, $post.reward_grants)
if ([int]$post.ledger_rows -ne 0)   { Write-Host "[FAIL] claim rows survived the rollback";  $bad++ }
if ([int]$post.reward_grants -ne 0) { Write-Host "[FAIL] grant rows survived the rollback";  $bad++ }

if ($bad -gt 0) { throw "cap proof FAILED with $bad problems" }
Write-Host ""
Write-Host "[DONE] the daily reward is idempotent, clamped to a ceiling derived from what the"
Write-Host "       server already granted, and that ceiling does not grow by being claimed."
