# Planet Blitz - run one read-only SQL statement against the remote project.
#
# A diagnostic companion to the apply-* scripts. Same PAT + Management API path, same UTF-8
# byte transport, same misdeploy guard - but it takes the SQL as a parameter and prints the
# result, so a lane can answer "what does the remote actually look like" without writing a
# throwaway apply script.
#
# The token stays inside this file (decrypt + send both happen here, nothing secret reaches the
# command line) - the same shape as the apply-* scripts and the `spb` wrapper.
#
# Console output is ASCII-only on purpose (Windows PowerShell 5.1 mangles non-ASCII literals in
# BOM-less .ps1 files, and mojibake reads like a failure).
#
#   powershell -ExecutionPolicy Bypass -File scripts\query-remote.ps1 -Sql "select 1 as n;"

param(
  [Parameter(Mandatory = $true)][string]$Sql
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

$body  = @{ query = $Sql } | ConvertTo-Json -Depth 5 -Compress
$bytes = $utf8.GetBytes($body)
$res = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers $hdr -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
$res | Format-List
