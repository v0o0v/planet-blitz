# Planet Blitz - end-to-end smoke for the catalyst shop RPCs on the REMOTE project.
#
# salvage -> residue -> buy -> inventory, plus every rejection path, driven through
# the real `salvage_catalyst` / `buy_catalyst` functions as the `authenticated`
# role with forged JWT claims - i.e. exactly what a client call looks like.
#
# Everything runs inside BEGIN ... ROLLBACK: no inventory, residue, or profile row
# is left changed. That is also why this is safe to re-run.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII
# literals in BOM-less .ps1 files, and mojibake reads like a failure).
#
# Run from any directory:
#   powershell -ExecutionPolicy Bypass -File scripts\smoke-catalyst-shop.ps1

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
  $body  = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
  $bytes = $utf8.GetBytes($body)
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
}

$who = Invoke-Sql "select id::text as id from public.profiles order by id limit 1;"
if ($null -eq $who) { throw "no profiles row to test against" }
$me = $who.id
Write-Host "[OK] acting as profile $me (all writes rolled back)"

$bad = 0
function Check([string]$label, $actual, $expected) {
  if ("$actual" -ne "$expected") {
    Write-Host ("[FAIL] {0}: got '{1}', expected '{2}'" -f $label, $actual, $expected)
    $script:bad++
  } else {
    Write-Host ("[OK] {0} = {1}" -f $label, $actual)
  }
}

# One transaction, one session: seed inventory as postgres, then run every RPC as
# the client would. catalyst 0 is a common catalyst, buy_price 10, salvage 5.
# catalyst 32 is a boss signature, buy_price 25 - the 36-vs-37 associativity case.
$r = Invoke-Sql @"
begin;
insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
values ('$me'::uuid, 0, 3), ('$me'::uuid, 32, 3)
on conflict (profile_id, catalyst_id) do update set qty = 3;
update public.profiles set catalyst_residue = 0 where id = '$me'::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';

select
  -- S1: salvage 3 common (buy_price 10) -> floor(10*50/100)=5, x3 = 15
  (public.salvage_catalyst(0, 3)  ->> 'gained')            as s1_gained,
  (public.salvage_catalyst(32, 3) ->> 'gained')            as s2_gained,
  -- residue now 15 + 36 = 51. buy one common: cost 10 -> 41 left, qty 0 -> 1
  (public.buy_catalyst(0, 1)      ->> 'spent')             as s3_spent,
  (public.buy_catalyst(0, 1)      ->> 'residue')           as s3_residue,
  -- rejection paths (all must leave state untouched)
  (public.buy_catalyst(0, 99999)  ->> 'note')              as r_insufficient,
  (public.buy_catalyst(30, 1)     ->> 'note')              as r_signature,
  (public.buy_catalyst(9999, 1)   ->> 'note')              as r_unknown,
  (public.buy_catalyst(0, 0)      ->> 'note')              as r_nothing,
  (public.salvage_catalyst(1, 1)  ->> 'note')              as r_insuff_stock;
rollback;
"@

# Final state needs a SEPARATE statement: subqueries in the statement above see the
# snapshot taken when that statement STARTED, so they would report pre-RPC values
# no matter what the RPCs did. (This bit me once - the RPC return values were all
# correct while the state columns read 0/3/3.)
$s = Invoke-Sql @"
begin;
insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
values ('$me'::uuid, 0, 3), ('$me'::uuid, 32, 3)
on conflict (profile_id, catalyst_id) do update set qty = 3;
update public.profiles set catalyst_residue = 0 where id = '$me'::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"$me","role":"authenticated"}';

select public.salvage_catalyst(0, 3);
select public.salvage_catalyst(32, 3);
select public.buy_catalyst(0, 1);
select public.buy_catalyst(0, 1);
select public.buy_catalyst(0, 99999);
select public.buy_catalyst(30, 1);

select
  (select catalyst_residue::text from public.profiles where id = '$me'::uuid)   as residue,
  (select qty::text from public.catalyst_inventory
     where profile_id = '$me'::uuid and catalyst_id = 0)                        as qty0,
  (select qty::text from public.catalyst_inventory
     where profile_id = '$me'::uuid and catalyst_id = 32)                       as qty32,
  -- credits/minerals must be untouched: catalyst salvage no longer pays currency
  (select credits::text  from public.profiles where id = '$me'::uuid)           as credits,
  (select minerals::text from public.profiles where id = '$me'::uuid)           as minerals,
  -- rejected buys must not leave a qty=0 ghost row behind
  (select count(*) from public.catalyst_inventory
     where profile_id = '$me'::uuid and catalyst_id = 30)                       as ghost30;
rollback;
"@

Write-Host ""
Write-Host "--- salvage (S1/S2) ---"
Check 'salvage common x3 gained (10 -> 5 each)' $r.s1_gained 15
# The associativity contract: floor(25*50/100)=12, x3 = 36. A 37 here means SQL
# folded qty inside floor() and drifted from the TS source of truth.
Check 'salvage boss-signature x3 gained (36, NOT 37)' $r.s2_gained 36

Write-Host ""
Write-Host "--- buy (S3) ---"
Check 'buy 1 common spent'   $r.s3_spent   10
Check 'residue after 2 buys' $r.s3_residue 31   # 51 - 10 - 10

Write-Host ""
Write-Host "--- rejections ---"
Check 'buy more than affordable' $r.r_insufficient 'insufficient-residue'
Check 'buy a signature'          $r.r_signature    'signature-not-sold'
Check 'buy an unknown id'        $r.r_unknown      'unknown-catalyst'
Check 'buy zero'                 $r.r_nothing      'nothing-to-buy'
Check 'salvage without stock'    $r.r_insuff_stock 'insufficient'

Write-Host ""
Write-Host "--- final state (separate statement) ---"
Check 'residue (15 + 36 - 10 - 10)'   $s.residue  31
Check 'common qty (3 - 3 + 1 + 1)'    $s.qty0     2
Check 'signature qty (3 - 3)'         $s.qty32    0
Check 'credits untouched'             $s.credits  0
Check 'minerals untouched'            $s.minerals 0
Check 'no ghost row for rejected buy' $s.ghost30  0

# Confirm the rollback really rolled back.
$post = Invoke-Sql @"
select (select catalyst_residue::text from public.profiles where id = '$me'::uuid) as residue,
       (select count(*) from public.catalyst_inventory
          where profile_id = '$me'::uuid and catalyst_id in (0, 32))              as seeded_rows;
"@
Write-Host ""
Write-Host ("[OK] post-rollback: residue={0} seeded_rows={1}" -f $post.residue, $post.seeded_rows)

if ($bad -gt 0) { throw "smoke FAILED with $bad mismatches" }
Write-Host ""
Write-Host "[DONE] salvage -> residue -> buy -> inventory works end to end on the remote project."
