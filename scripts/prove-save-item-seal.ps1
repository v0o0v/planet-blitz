# Planet Blitz - prove the profiles.save item seal actually BITES (ADR-0050 3-1, PR #371).
#
# WHY THIS EXISTS
# ---------------
# scripts\apply-item-ledger-migrations.ps1 verifies the seal as `postgres`. That role satisfies
# public.is_service_role(), so the seal branch is SKIPPED for every statement it runs - it can
# only ever show that the objects EXIST, are WIRED into both guards, and carry the right ACLs.
# It cannot show that a forged save is actually reverted. This script closes that gap by
# impersonating the `authenticated` role, which is the role a real client holds.
#
# THE VACUITY TRAP THIS SCRIPT IS BUILT AGAINST
# ---------------------------------------------
# A seal proof is trivially easy to write so that it passes no matter what the seal does:
#   - if RLS silently blocked every UPDATE, "the forged item is gone" would be true because
#     NOTHING landed. P0 is the positive control against exactly that, and every later proof
#     also asserts the legitimate parts of the same write survived.
#   - if the proof only ever used ids the allowlist rejects, it would never show the allowlist
#     opens for anything. P3/P4 assert the allowed prefixes pass.
#   - if the proof only used its OWN ledger rows, it would never show the profile_id pinning
#     works. P5 forges with ANOTHER profile's real grant id - the single most important proof
#     here, because dropping `profile_id = p_profile` from the allowlist would let one player's
#     unique be planted by everyone.
#
# ISOLATION
# ---------
# Throwaway profiles (display_name `zz-seal-proof-*`) plus a pve_runs row and an item_grants row
# each. Everything is deleted in the `finally` block, and setup deletes first so a crashed run
# cannot poison the next one. No existing row is read or written.
#
# POWERSHELL QUOTING (this bit a first draft)
# -------------------------------------------
# The escape character is the BACKTICK, not the backslash. Writing \" inside a double-quoted
# PowerShell string sends a literal backslash-quote to Postgres and the JSON literal is invalid.
# So every SQL fragment below is a SINGLE-quoted string (which passes " through untouched) and
# uuids are concatenated in, never interpolated.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII literals in
# BOM-less .ps1 files, and mojibake reads like a failure).
#
#   powershell -ExecutionPolicy Bypass -File scripts\prove-save-item-seal.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ref = 'qxgbxwyccbxokdgwxcuw'

$A    = 'aaaaaaaa-0000-4000-8000-00000000000a'   # actor (the forger)
$B    = 'bbbbbbbb-0000-4000-8000-00000000000b'   # other player (P5 cross-profile ledger)
$RUNA = 'aaaaaaaa-0000-4000-8000-0000000000ca'
$RUNB = 'bbbbbbbb-0000-4000-8000-0000000000cb'
$GA   = 'aaaaaaaa-0000-4000-8000-00000000ffff'   # item_grants row owned by A
$GB   = 'bbbbbbbb-0000-4000-8000-00000000ffff'   # item_grants row owned by B
$NEW  = 'cccccccc-0000-4000-8000-00000000000c'   # P10 fresh INSERT

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
  # UTF-8 BYTES, not a string (deploy skill: sending the string mangles non-ASCII and the server
  # answers 400 at a byte offset, which reads like a SQL error).
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

$script:bad = 0
function Check([string]$label, [bool]$ok, [string]$detail) {
  if ($ok) { Write-Host "[PASS] $label" }
  else     { Write-Host "[FAIL] $label -- $detail"; $script:bad++ }
}

# The baseline save. Only inventory / stash / ships[].equipped / guardians[].build.equipped are
# read by the seal; the rest is here so the "no collateral damage" proof has something to watch.
$BASE = '{"tutorialDone":false,"inventory":[{"id":"it-100","slot":"main"},{"id":"it-200","slot":"armor"}],"stash":[],"ships":[{"typeId":0,"level":7,"xp":42,"equipped":{"main":{"id":"it-300","slot":"main"}}}],"guardians":[]}'

function Reset-Save {
  # As postgres, so the seal is skipped and the baseline lands verbatim no matter what the
  # previous proof did.
  Invoke-Sql ("update public.profiles set save = '" + $BASE + "'::jsonb where id = '" + $A + "';") | Out-Null
}

# `set local` needs a transaction block; the Management API wraps each request in one (probed:
# current_user came back `authenticated` and is_service_role() false).
function As-Actor([string]$act, [string]$observe) {
  Invoke-Sql (
    "set local role authenticated;`n" +
    "set local request.jwt.claims = '{""sub"":""" + $A + """,""role"":""authenticated""}';`n" +
    $act + "`n" +
    "reset role;`n" +
    $observe)
}

try {
  # --- setup -----------------------------------------------------------------
  # `public.profiles.id` is `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`, so a
  # profile cannot exist without an auth user. (A first draft trusted an information_schema query
  # that reported no auth-schema FK - it was wrong. pg_constraint is the reliable read.)
  # The cascade also means teardown only has to delete the auth.users rows.
  Invoke-Sql (
    "delete from auth.users where id in ('" + $A + "','" + $B + "','" + $NEW + "');`n" +
    "insert into auth.users (id) values ('" + $A + "'), ('" + $B + "'), ('" + $NEW + "');`n" +
    "insert into public.profiles (id, display_name, save) values" +
    " ('" + $A + "', 'zz-seal-proof-actor', '" + $BASE + "'::jsonb)," +
    " ('" + $B + "', 'zz-seal-proof-other', '{}'::jsonb);`n" +
    "insert into public.pve_runs (id, profile_id) values ('" + $RUNA + "','" + $A + "'), ('" + $RUNB + "','" + $B + "');`n" +
    "insert into public.item_grants (grant_id, profile_id, run_id, drop_index, drop_seed, rarity) values" +
    " ('" + $GA + "','" + $A + "','" + $RUNA + "',0,123,'rare')," +
    " ('" + $GB + "','" + $B + "','" + $RUNB + "',0,456,'rare');") | Out-Null
  Write-Host "[OK] fixture created (2 throwaway profiles, 2 runs, 2 grants)"
  Write-Host ""
  Write-Host "--- proofs (role: authenticated -- the seal is LIVE for these) ---"

  # --- P0  positive control: a legitimate write actually lands ---------------
  # Without this every later proof is vacuous.
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{tutorialDone}', 'true') where id = '" + $A + "';") `
    ("select (save->>'tutorialDone') as flag, jsonb_array_length(save->'inventory') as inv from public.profiles where id = '" + $A + "';")
  Check "P0 positive control -- a legitimate save write lands as authenticated" `
        ($r.flag -eq 'true' -and [int]$r.inv -eq 2) "flag=$($r.flag) inv=$($r.inv)"
  Reset-Save

  # --- P1  the seal itself: an unledgered it-{seed} is removed ---------------
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{inventory}', (save->'inventory') || '[{""id"":""it-999999"",""slot"":""engine""}]'::jsonb) where id = '" + $A + "';") `
    ("select jsonb_array_length(save->'inventory') as n, (save->'inventory') @> '[{""id"":""it-999999""}]'::jsonb as has_forged, (save->'inventory') @> '[{""id"":""it-100""}]'::jsonb as kept_100 from public.profiles where id = '" + $A + "';")
  Check "P1 unledgered it-{seed} is stripped from inventory" `
        ([int]$r.n -eq 2 -and $r.has_forged -eq $false -and $r.kept_100 -eq $true) "n=$($r.n) forged=$($r.has_forged) kept100=$($r.kept_100)"
  Reset-Save

  # --- P2  grandfather: ids already in OLD.save survive ---------------------
  # What makes the seal deployable at all - the ledger was created after every existing account
  # already owned items, so "must be in the ledger" would have wiped everyone.
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{tutorialDone}', 'true') where id = '" + $A + "';") `
    ("select (save->'inventory') @> '[{""id"":""it-100""}]'::jsonb as a, (save->'inventory') @> '[{""id"":""it-200""}]'::jsonb as b, (save->'ships'->0->'equipped'->'main'->>'id') as eq from public.profiles where id = '" + $A + "';")
  Check "P2 grandfather -- pre-existing it-{seed} items are untouched" `
        ($r.a -eq $true -and $r.b -eq $true -and $r.eq -eq 'it-300') "a=$($r.a) b=$($r.b) eq=$($r.eq)"
  Reset-Save

  # --- P3  allowlist: starter kit passes ------------------------------------
  # If this fails, every NEW ACCOUNT loses its first loadout.
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{inventory}', (save->'inventory') || '[{""id"":""it-starter-main"",""slot"":""main""}]'::jsonb) where id = '" + $A + "';") `
    ("select (save->'inventory') @> '[{""id"":""it-starter-main""}]'::jsonb as kept from public.profiles where id = '" + $A + "';")
  Check "P3 allowlist -- it-starter-* passes (new accounts keep their first loadout)" `
        ($r.kept -eq $true) "kept=$($r.kept)"
  Reset-Save

  # --- P4  allowlist: the actor's OWN ledger row passes ---------------------
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{inventory}', (save->'inventory') || '[{""id"":""drop:" + $GA + """,""slot"":""main""}]'::jsonb) where id = '" + $A + "';") `
    ("select (save->'inventory') @> '[{""id"":""drop:" + $GA + """}]'::jsonb as kept from public.profiles where id = '" + $A + "';")
  Check "P4 allowlist -- drop:{grant_id} from the actor's OWN ledger passes" `
        ($r.kept -eq $true) "kept=$($r.kept)"
  Reset-Save

  # --- P5  the important one: ANOTHER player's real grant id is rejected -----
  # $GB is a genuine, existing item_grants row - it just belongs to B. If the allowlist ever
  # loses `profile_id = p_profile`, one player's unique becomes plantable by everyone.
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{inventory}', (save->'inventory') || '[{""id"":""drop:" + $GB + """,""slot"":""main""}]'::jsonb) where id = '" + $A + "';") `
    ("select (save->'inventory') @> '[{""id"":""drop:" + $GB + """}]'::jsonb as has_forged, jsonb_array_length(save->'inventory') as n from public.profiles where id = '" + $A + "';")
  Check "P5 profile_id pinning -- ANOTHER player's real grant id is stripped" `
        ($r.has_forged -eq $false -and [int]$r.n -eq 2) "forged=$($r.has_forged) n=$($r.n)"
  Reset-Save

  # --- P6  the equipped slot is sealed too ----------------------------------
  # inventory is the obvious door; ships[].equipped is one of the four places items live and is
  # exactly where a forger would go if only the arrays were guarded.
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{ships,0,equipped,module}', '{""id"":""it-888888"",""slot"":""module""}'::jsonb) where id = '" + $A + "';") `
    ("select (save->'ships'->0->'equipped') ? 'module' as has_module, (save->'ships'->0->'equipped'->>'main') is not null as kept_main from public.profiles where id = '" + $A + "';")
  Check "P6 ships[].equipped is sealed -- forged slot emptied, legit slot survives" `
        ($r.has_module -eq $false -and $r.kept_main -eq $true) "module=$($r.has_module) main=$($r.kept_main)"
  Reset-Save

  # --- P7  no collateral damage ---------------------------------------------
  # The repo's other guards restore whole columns. Doing that to `save` would roll back XP,
  # level, resources and story progress every time one item tripped the seal.
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(jsonb_set(jsonb_set(save, '{inventory}', (save->'inventory') || '[{""id"":""it-777777""}]'::jsonb), '{ships,0,level}', '9'), '{tutorialDone}', 'true') where id = '" + $A + "';") `
    ("select (save->'ships'->0->>'level') as lvl, (save->>'tutorialDone') as flag, (save->'inventory') @> '[{""id"":""it-777777""}]'::jsonb as has_forged from public.profiles where id = '" + $A + "';")
  Check "P7 no collateral damage -- level/flag changes survive, only the forged item is removed" `
        ($r.lvl -eq '9' -and $r.flag -eq 'true' -and $r.has_forged -eq $false) "lvl=$($r.lvl) flag=$($r.flag) forged=$($r.has_forged)"
  Reset-Save

  # --- P8  array order is preserved -----------------------------------------
  # Inventory order is the on-screen layout. Rebuilding it unordered reads as "my bag got
  # shuffled" to players who forged nothing.
  $r = As-Actor `
    ("update public.profiles set save = jsonb_set(save, '{inventory}', '[{""id"":""it-100""},{""id"":""it-999999""},{""id"":""it-200""}]'::jsonb) where id = '" + $A + "';") `
    ("select (save->'inventory'->0->>'id') as first, (save->'inventory'->1->>'id') as second, jsonb_array_length(save->'inventory') as n from public.profiles where id = '" + $A + "';")
  Check "P8 array order preserved after removal (it-100 then it-200)" `
        ($r.first -eq 'it-100' -and $r.second -eq 'it-200' -and [int]$r.n -eq 2) "first=$($r.first) second=$($r.second) n=$($r.n)"
  Reset-Save

  # --- P9  service_role skips the seal --------------------------------------
  # Negative control in the other direction. The delivery RPCs write the ledger row and the save
  # in one transaction; if the seal applied to them too the server would revert its own grants.
  Invoke-Sql ("update public.profiles set save = jsonb_set(save, '{inventory}', (save->'inventory') || '[{""id"":""it-999999""}]'::jsonb) where id = '" + $A + "';") | Out-Null
  $r = Invoke-Sql ("select (save->'inventory') @> '[{""id"":""it-999999""}]'::jsonb as kept from public.profiles where id = '" + $A + "';")
  Check "P9 service_role path skips the seal (server delivery does not revert itself)" `
        ($r.kept -eq $true) "kept=$($r.kept)"
  Reset-Save

  # --- P10 the INSERT path is sealed too ------------------------------------
  # UPDATE-only sealing would leave "delete the profile, INSERT a forged one" wide open.
  $r = Invoke-Sql (
    "set local role authenticated;`n" +
    "set local request.jwt.claims = '{""sub"":""" + $NEW + """,""role"":""authenticated""}';`n" +
    "insert into public.profiles (id, display_name, save) values ('" + $NEW + "', 'zz-seal-proof-insert', " +
    "'{""inventory"":[{""id"":""it-654321""},{""id"":""it-starter-main""}],""stash"":[],""ships"":[],""guardians"":[]}'::jsonb);`n" +
    "reset role;`n" +
    "select jsonb_array_length(save->'inventory') as n, (save->'inventory') @> '[{""id"":""it-654321""}]'::jsonb as has_forged, (save->'inventory') @> '[{""id"":""it-starter-main""}]'::jsonb as kept_starter from public.profiles where id = '" + $NEW + "';")
  Check "P10 INSERT path is sealed (forged stripped, starter kept)" `
        ([int]$r.n -eq 1 -and $r.has_forged -eq $false -and $r.kept_starter -eq $true) "n=$($r.n) forged=$($r.has_forged) starter=$($r.kept_starter)"
}
finally {
  # Teardown runs even on a mid-run throw, so a crashed proof cannot leave fixtures behind.
  # Deleting the auth.users rows cascades: auth.users -> profiles -> pve_runs -> item_grants.
  # The leftover count reads `profiles`, i.e. the far end of that chain, so it fails loudly if
  # any link is not actually cascading.
  try {
    Invoke-Sql ("delete from auth.users where id in ('" + $A + "','" + $B + "','" + $NEW + "');") | Out-Null
    $left = Invoke-Sql "select count(*) as n from public.profiles where display_name like 'zz-seal-proof-%';"
    Write-Host ""
    Write-Host ("[OK] fixture removed (leftover zz-seal-proof rows: {0})" -f $left.n)
    if ([int]$left.n -ne 0) { Write-Host "[FAIL] fixture rows survived teardown"; $script:bad++ }
  } catch {
    Write-Host "[FAIL] teardown error -- REMOVE zz-seal-proof-* PROFILES BY HAND: $($_.Exception.Message)"
    $script:bad++
  }
}

Write-Host ""
if ($script:bad -gt 0) { throw "seal proof FAILED with $script:bad mismatches" }
Write-Host "[DONE] the save item seal BITES: unledgered ids (including another player's real"
Write-Host "       grant id) are removed for authenticated writers on both UPDATE and INSERT,"
Write-Host "       while grandfathered items, the starter kit, the owner's own ledger rows,"
Write-Host "       array order, unrelated save fields and the service_role path all survive."
