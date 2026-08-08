# Planet Blitz - reset ONE account to a first-login state on the live project.
#
# What "first login" means here.
#   Every user-scoped table hangs off public.profiles(id) with ON DELETE CASCADE,
#   and profiles.id itself references auth.users(id) ON DELETE CASCADE. So deleting
#   the profiles row removes the whole account state in one statement, and the
#   client re-creates an empty row on next sign-in via the profiles_insert_own
#   policy. The auth.users row is NOT touched - the login itself keeps working.
#
#   The tutorial / intro / story flags all live inside profiles.save (jsonb), not
#   in a separate table, so wiping the row is what actually makes the game replay
#   from the top. The browser also caches account-scoped keys in localStorage;
#   clearing planet-blitz:net:last-uid makes reconcileAccountScope() drop the rest
#   on the next boot (see src/net/accountScope.ts).
#
# What this DESTROYS and cannot restore.
#   - Undelivered mailboxes: daily_reward_claims / commission_grants / item_grants.
#     Those rows are deliberately excluded from GC because deleting them strands
#     items forever. Here that is the point, but it is still one-way.
#   - Invasion history where this account was the DEFENDER. invasions and
#     invasion_snapshots cascade on defender_id too, so the record disappears from
#     the ATTACKER's side as well. This is the only damage visible to other players.
#   - profiles.flagged (anti-cheat mark) and profiles.is_npc. Refuses to run when
#     either is set unless the operator opts in explicitly - see the rails below.
#   - profiles.lifetime_granted. Its backfill source (currency_grants) is GC'd
#     after 7 days, so the anchor cannot be reconstructed.
#   - planet_popularity is NOT deleted (it has no uid column) but it reads
#     pve_runs over a trailing 1-hour window, so removing runs nudges the next
#     epoch's multipliers. Past epochs are never recomputed. Prefer a quiet hour.
#
# Safety rails.
#   - Takes an EMAIL, not a uuid, and resolves it itself. A mistyped uuid could
#     name a real player; a mistyped email simply finds nothing.
#   - Refuses on anything other than exactly one match.
#   - Refuses when profiles.flagged or is_npc is set, unless -AllowSpecialAccount.
#   - Dry run by default: prints per-table row counts, derived from the LIVE
#     information_schema rather than a hand-written table list, so a schema that
#     drifted from the migration tree cannot hide rows from the preview.
#   - The delete runs inside one transaction. A missing CASCADE anywhere aborts
#     the whole thing instead of half-wiping the account.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Usage - dry run first, ALWAYS:
#   powershell -ExecutionPolicy Bypass -File scripts\reset-account.ps1 -Email 'someone@example.com'
# then, after reading the preview:
#   powershell -ExecutionPolicy Bypass -File scripts\reset-account.ps1 -Email 'someone@example.com' -Confirm

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Email,
  [switch]$AllowSpecialAccount,
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

function Invoke-SqlRows([string]$sql) {
  # Invoke-Sql hands back the whole result set as ONE object, so @(Invoke-Sql ...)
  # yields a single nested Object[] rather than N rows. That matters beyond
  # cosmetics: `$rows.Count` would read 1 no matter how many rows came back, which
  # silently defeats the "exactly one account matched" guard below. Enumerate it.
  $r = Invoke-Sql $sql
  if ($null -eq $r) { return @() }
  return @($r | ForEach-Object { $_ })
}

$emailSql = $Email.Replace("'", "''")

# --- 1. Resolve the account. Exactly one match, or stop. -------------------------
$who = Invoke-SqlRows @"
select p.id::text                                as id,
       coalesce(u.email, '')                     as email,
       coalesce(p.display_name, '')              as display_name,
       p.flagged::text                           as flagged,
       p.is_npc::text                            as is_npc,
       p.save_version::text                      as save_version,
       length(p.save::text)::text                as save_bytes,
       p.credits::text                           as credits,
       p.minerals::text                          as minerals,
       p.lifetime_granted::text                  as lifetime_granted,
       coalesce(u.created_at::text, '')          as created_at,
       coalesce(u.last_sign_in_at::text, '')     as last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
 where lower(u.email) = lower('$emailSql');
"@

if ($who.Count -eq 0) { throw "no profiles row joined to an auth.users row with email '$Email'" }
if ($who.Count -gt 1) { throw ("refusing: {0} accounts matched '{1}'" -f $who.Count, $Email) }

$acct = $who[0]
$uid  = $acct.id
Write-Host ("[OK] account resolved: {0}  uid={1}" -f $acct.email, $uid)
Write-Host ("[..] display_name='{0}' created={1} last_sign_in={2}" -f `
  $acct.display_name, $acct.created_at, $acct.last_sign_in_at)
Write-Host ("[..] save_version={0} save_bytes={1} credits={2} minerals={3} lifetime_granted={4}" -f `
  $acct.save_version, $acct.save_bytes, $acct.credits, $acct.minerals, $acct.lifetime_granted)
Write-Host ("[..] flagged={0} is_npc={1}" -f $acct.flagged, $acct.is_npc)

if (($acct.flagged -eq 'true' -or $acct.is_npc -eq 'true') -and -not $AllowSpecialAccount) {
  throw ("refusing: flagged={0} is_npc={1}. Deleting the profiles row destroys those marks. " +
         "Pass -AllowSpecialAccount if that is intended." -f $acct.flagged, $acct.is_npc)
}

# --- 2. Preview. Counts come from the LIVE schema, not a hand-written list. ------
# query_to_xml lets one statement count every table that carries a user-scoped
# column, so a table added (or renamed) after this script was written still shows
# up in the preview instead of silently vanishing from it.
$counts = Invoke-SqlRows @"
select c.table_name || '.' || c.column_name as scope,
       (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from public.%I where %I = %L::uuid',
                                  c.table_name, c.column_name, '$uid'),
                           false, true, '')))[1]::text::bigint as cnt
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type = 'BASE TABLE'
   and c.data_type = 'uuid'
   and c.column_name in ('profile_id', 'attacker_id', 'defender_id', 'owner_id', 'user_id')
 order by 2 desc, 1;
"@

$total = 0
Write-Host ""
Write-Host "[..] rows owned by this account:"
foreach ($row in $counts) {
  $n = [long]$row.cnt
  $total += $n
  if ($n -gt 0) { Write-Host ("[..]   {0,-46} {1,8}" -f $row.scope, $n) }
}
Write-Host ("[..]   {0,-46} {1,8}" -f '(total child rows)', $total)
Write-Host ("[..]   {0,-46} {1,8}" -f 'profiles (the row itself)', 1)

if (-not $Confirm) {
  Write-Host ""
  Write-Host "[DRY] nothing written."
  Write-Host "[DRY] re-run with -Confirm to delete the profiles row (everything above cascades)."
  Write-Host "[DRY] auth.users is NOT touched - the login keeps working and the client"
  Write-Host "[DRY] re-creates an empty profile on next sign-in."
  Write-Host "[DRY] afterwards, clear localStorage key 'planet-blitz:net:last-uid' in the browser."
  exit 0
}

# --- 3. Delete. One transaction, so a missing CASCADE aborts everything. ---------
Invoke-Sql @"
begin;
delete from public.profiles where id = '$uid'::uuid;
commit;
"@

# --- 4. Verify: the profile is gone AND no orphan child rows survived. -----------
$left = Invoke-SqlRows @"
select (select count(*) from public.profiles where id = '$uid'::uuid)::text as profile_rows,
       (select coalesce(sum(v), 0) from (
          select (xpath('/row/n/text()',
                        query_to_xml(format('select count(*) as n from public.%I where %I = %L::uuid',
                                            c.table_name, c.column_name, '$uid'),
                                     false, true, '')))[1]::text::bigint as v
            from information_schema.columns c
            join information_schema.tables t
              on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = 'public'
             and t.table_type = 'BASE TABLE'
             and c.data_type = 'uuid'
             and c.column_name in ('profile_id', 'attacker_id', 'defender_id', 'owner_id', 'user_id')
       ) s)::text as child_rows,
       (select count(*) from auth.users where id = '$uid'::uuid)::text as auth_rows;
"@

$v = $left[0]
Write-Host ("[..] after: profiles={0} child_rows={1} auth_users={2}" -f $v.profile_rows, $v.child_rows, $v.auth_rows)

$bad = 0
if ($v.profile_rows -ne '0') { Write-Host '[FAIL] profiles row still present'; $bad++ }
if ($v.child_rows   -ne '0') { Write-Host '[FAIL] orphan child rows survived the cascade'; $bad++ }
if ($v.auth_rows    -ne '1') { Write-Host '[FAIL] auth.users row was affected - it must not be'; $bad++ }

if ($bad -eq 0) {
  Write-Host '[OK] ACCOUNT_RESET'
  Write-Host '[OK] next step is in the browser: remove localStorage key planet-blitz:net:last-uid'
  Write-Host '[OK] (reconcileAccountScope drops the other planet-blitz:* account keys on boot)'
  exit 0
}
Write-Host ("[FAIL] {0} check(s) failed" -f $bad)
exit 1
