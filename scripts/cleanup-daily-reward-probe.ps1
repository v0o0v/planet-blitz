# Planet Blitz - undo ONE manual daily-reward claim made against the live project.
#
# Why this script exists at all.
#   The daily-reward completion gate has three tiers and only the third one writes
#   for real. Tiers 1-2 (vitest, prove-daily-reward-*.ps1) are safe: the pure
#   functions touch nothing and the prove scripts wrap every statement in
#   BEGIN ... ROLLBACK. Tier 3 is different - it asks a human to claim once on the
#   live project through the Edge Function, because a harness mock never writes a
#   currency_grants row and therefore cannot prove the ledger path at all.
#   That single claim leaves three durable marks:
#     1. a daily_reward_claims row (that table is deliberately NOT GC'd - deleting
#        it in production would strand undelivered items forever)
#     2. profiles.daily_last_claim_seed / daily_streak moved forward
#     3. profiles.lifetime_granted bumped, plus a currency_grants row
#   Leaving them behind means the probe account can no longer claim that day, and
#   the streak/anchor readings from later probes are polluted by the earlier one.
#
# What it does NOT do.
#   It does not touch the currency_grants row. That row is the evidence the ledger
#   path worked ([OK] CAP_LEDGER_ROW is about exactly this), it self-expires under
#   the existing 7-day GC, and the anchor trigger skips source='daily_reward'
#   anyway - so it never inflated lifetime_granted in the first place. Deleting
#   ledger rows by hand is a habit worth not forming.
#
# Safety rails.
#   - Refuses unless -ProfileId is given explicitly. There is no "clean everything".
#   - Refuses unless the target profile's email matches -ExpectTestAccount, so a
#     typo cannot rewind a real player's streak.
#   - Prints the before/after rows and requires -Confirm to actually write.
#   - Restores credits/minerals/lifetime_granted to the values captured BEFORE the
#     claim, which the operator must pass in (this script cannot know them after
#     the fact - capture them with the same query it prints in dry-run mode).
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Usage - dry run first, ALWAYS:
#   powershell -ExecutionPolicy Bypass -File scripts\cleanup-daily-reward-probe.ps1 `
#     -ProfileId <uuid> -ExpectTestAccount 'probe@' -DateSeed <n>
# then re-run with -Confirm and the captured pre-claim values:
#   ... -Confirm -PrevSeed <n> -PrevStreak <n> -PrevLifetime <numeric>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProfileId,
  [Parameter(Mandatory = $true)][string]$ExpectTestAccount,
  [Parameter(Mandatory = $true)][long]$DateSeed,
  [long]$PrevSeed = -1,
  [int]$PrevStreak = -1,
  [string]$PrevLifetime = '',
  [switch]$Confirm
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref = 'qxgbxwyccbxokdgwxcuw'

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
  # UTF-8 BYTES, not a string. Sending the string mangles any non-ASCII and the
  # server answers 400 at a byte offset, which reads like a SQL error.
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

# --- 1. Identify the account and refuse anything that is not the probe account ---
$who = Invoke-Sql @"
select p.id::text                     as id,
       coalesce(u.email, '')          as email,
       p.daily_last_claim_seed::text  as seed,
       p.daily_streak::text           as streak,
       p.lifetime_granted::text       as lifetime,
       p.credits::text                as credits,
       p.minerals::text               as minerals
  from public.profiles p
  left join auth.users u on u.id = p.id
 where p.id = '$ProfileId'::uuid;
"@
if ($null -eq $who -or [string]::IsNullOrEmpty($who.id)) { throw "no profiles row for $ProfileId" }

if ($who.email -notmatch [regex]::Escape($ExpectTestAccount)) {
  throw ("refusing: profile email '{0}' does not match -ExpectTestAccount '{1}'. " +
         "This guard exists so a typo cannot rewind a real player's streak." -f $who.email, $ExpectTestAccount)
}
Write-Host ("[OK] probe account confirmed: {0}" -f $who.email)
Write-Host ("[..] now: seed={0} streak={1} lifetime={2} credits={3} minerals={4}" -f `
  $who.seed, $who.streak, $who.lifetime, $who.credits, $who.minerals)

$claim = Invoke-Sql @"
select date_seed::text                                as date_seed,
       clamped::text                                  as clamped,
       coalesce(applied_at::text, '')                 as applied_at,
       coalesce(hold_reason, '')                      as hold_reason,
       result_payload::text                           as result_payload
  from public.daily_reward_claims
 where profile_id = '$ProfileId'::uuid and date_seed = $DateSeed;
"@
if ($null -eq $claim -or [string]::IsNullOrEmpty($claim.date_seed)) {
  Write-Host "[..] no daily_reward_claims row for that date_seed - nothing to undo"
} else {
  Write-Host ("[..] claim row: seed={0} clamped={1} applied_at='{2}' hold='{3}'" -f `
    $claim.date_seed, $claim.clamped, $claim.applied_at, $claim.hold_reason)
  Write-Host ("[..] result: {0}" -f $claim.result_payload)
}

if (-not $Confirm) {
  Write-Host ""
  Write-Host "[DRY] nothing written. Capture the pre-claim values above, then re-run with:"
  Write-Host ("[DRY]   -Confirm -PrevSeed <n> -PrevStreak <n> -PrevLifetime <numeric>")
  Write-Host "[DRY] (currency_grants is left alone on purpose - see the header.)"
  exit 0
}

if ($PrevSeed -lt 0 -or $PrevStreak -lt 0 -or [string]::IsNullOrEmpty($PrevLifetime)) {
  throw "-Confirm requires -PrevSeed, -PrevStreak and -PrevLifetime (the values captured before the claim)"
}

# --- 2. Undo. One transaction so a partial rewind cannot happen. -----------------
# postgres role: guard_profiles_client_write short-circuits on is_service_role(),
# so these writes go through the seal by design (that is what the seal is for).
$after = Invoke-Sql @"
begin;

delete from public.daily_reward_claims
 where profile_id = '$ProfileId'::uuid and date_seed = $DateSeed;

update public.profiles
   set daily_last_claim_seed = $PrevSeed,
       daily_streak          = $PrevStreak,
       lifetime_granted      = $PrevLifetime::numeric
 where id = '$ProfileId'::uuid;

commit;

select daily_last_claim_seed::text as seed,
       daily_streak::text          as streak,
       lifetime_granted::text      as lifetime
  from public.profiles where id = '$ProfileId'::uuid;
"@

Write-Host ("[..] after: seed={0} streak={1} lifetime={2}" -f $after.seed, $after.streak, $after.lifetime)

$bad = 0
if ($after.seed     -ne "$PrevSeed")    { Write-Host "[FAIL] daily_last_claim_seed not restored"; $bad++ }
if ($after.streak   -ne "$PrevStreak")  { Write-Host "[FAIL] daily_streak not restored"; $bad++ }
if ([decimal]$after.lifetime -ne [decimal]$PrevLifetime) { Write-Host "[FAIL] lifetime_granted not restored"; $bad++ }

$still = Invoke-Sql @"
select count(*)::text as n from public.daily_reward_claims
 where profile_id = '$ProfileId'::uuid and date_seed = $DateSeed;
"@
if ($still.n -ne '0') { Write-Host "[FAIL] claim row still present"; $bad++ }

if ($bad -eq 0) {
  Write-Host "[OK] PROBE_CLEANED"
  exit 0
}
Write-Host ("[FAIL] {0} check(s) failed" -f $bad)
exit 1
