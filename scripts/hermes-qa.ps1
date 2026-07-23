[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Task,

    [string]$BaseRef = '',

    [string]$Provider = 'openai-codex',

    [string]$Model = 'gpt-5.6-sol',

    [string]$RunId = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hermes = 'C:\Users\alexv\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe'
$protocolPath = Join-Path $repoRoot 'plans\hermes_qa_protocol.md'
$captureScript = Join-Path $repoRoot 'scripts\capture-window.ps1'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $hermes)) {
    throw "Hermes executable not found: $hermes"
}
if (-not (Test-Path -LiteralPath $protocolPath)) {
    throw "Hermes QA protocol not found: $protocolPath"
}
if (-not (Test-Path -LiteralPath $captureScript)) {
    throw "Window capture helper not found: $captureScript"
}

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = Get-Date -Format 'yyyy-MM-dd_HHmmss'
}
if ($RunId -notmatch '^[A-Za-z0-9._-]+$') {
    throw 'RunId may contain only letters, digits, dot, underscore, and dash.'
}

$runRoot = Join-Path $repoRoot ".tmp\hermes-qa\$RunId"
$screenshotRoot = Join-Path $runRoot 'screenshots'
$requestPath = Join-Path $runRoot 'request.md'
$reportPath = Join-Path $runRoot 'report.md'
$resultPath = Join-Path $runRoot 'result.json'

[System.IO.Directory]::CreateDirectory($screenshotRoot) | Out-Null

$baseRefLine = if ([string]::IsNullOrWhiteSpace($BaseRef)) {
    'Infer the comparison base from git status/log and the task.'
}
else {
    "Compare against base ref: $BaseRef"
}

$requestText = @"
# Hermes QA request

- Run ID: $RunId
- Repository: $repoRoot
- Requested by: Claude
- $baseRefLine

## Task

$Task

## Required outputs

- Report: $reportPath
- Screenshots: $screenshotRoot
- Protocol: $protocolPath
"@
[System.IO.File]::WriteAllText($requestPath, $requestText, $utf8NoBom)

$prompt = @"
You are the independent Hermes QA worker for Lumina.

Repository: $repoRoot
Run ID: $RunId
Task request: $requestPath
Protocol: $protocolPath
Report output: $reportPath
Screenshot directory: $screenshotRoot
Window capture helper: $captureScript

Read the request and the FULL QA protocol first, then perform the requested verification.
$baseRefLine

Hard boundaries for this delegated QA run:
- Do not edit application source, CLAUDE.md, AGENTS.md, ROADMAP.md, STATUS.md, git config, or user data.
- Do not commit, push, release, install an update, or repair defects.
- You may write only inside the run directory: $runRoot
- Existing unrelated files and processes must be left untouched.
- Use the real Lumina-DIAG profile for manual UI checks when UI is in scope.
- Drive GUI through computer_use in background mode. Do not steal focus.
- For every important visual state, persist a CLEAN PNG by invoking capture-window.ps1 for the exact Lumina process. Prefer -ProcessId when known. The main app window may start hidden in the tray, and one diagnostics process owns BOTH the small "Lumina Diagnostics" panel and the "Lumina" app window: pass -WindowTitle "Lumina" -Show to reveal and target the app window in one step. Do NOT relaunch Electron with an inspector port just to expose the window, and do not use whole-desktop screenshots.
- Put every screenshot path and what it proves into report.md.
- Return one verdict: PASS, FAIL, or BLOCKED. A report without an explicit verdict is invalid.
- Before finishing, actually write the complete report to $reportPath.

This is an autonomous delegated run. Do not ask the caller questions; record missing context as BLOCKED with the exact missing prerequisite.
"@

$toolsets = 'terminal,file,vision,computer_use,skills,todo,session_search'
$arguments = @(
    '--profile', 'default',
    'chat',
    '-Q',
    '--provider', $Provider,
    '-m', $Model,
    '-t', $toolsets,
    '-q', $prompt
)

Push-Location $repoRoot
$previousErrorActionPreference = $ErrorActionPreference
try {
    # Windows PowerShell 5.1 promotes native stderr lines to ErrorRecord objects.
    # Keep them in captured output instead of aborting before LASTEXITCODE/report handling.
    $ErrorActionPreference = 'Continue'
    $rawOutput = @(& $hermes @arguments 2>&1)
    $hermesExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
}

$outputText = ($rawOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine

if (-not (Test-Path -LiteralPath $reportPath)) {
    $fallbackReport = @"
# Hermes QA report

VERDICT: BLOCKED

Hermes exited without creating the required report file.

- Hermes exit code: $hermesExitCode
- Request: $requestPath

## Raw Hermes output

---
$outputText
---
"@
    [System.IO.File]::WriteAllText($reportPath, $fallbackReport, $utf8NoBom)
}

$reportText = [System.IO.File]::ReadAllText($reportPath)
$verdictMatch = [regex]::Match(
    $reportText,
    '(?im)^\s*VERDICT\s*:\s*(PASS|FAIL|BLOCKED)\b'
)
$verdict = if ($verdictMatch.Success) {
    $verdictMatch.Groups[1].Value.ToUpperInvariant()
}
else {
    'BLOCKED'
}

$screenshots = @(
    Get-ChildItem -LiteralPath $screenshotRoot -Filter '*.png' -File -ErrorAction SilentlyContinue |
        Sort-Object Name |
        ForEach-Object { $_.FullName }
)

$result = [ordered]@{
    run_id = $RunId
    verdict = $verdict
    hermes_exit_code = $hermesExitCode
    report = $reportPath
    request = $requestPath
    screenshots = $screenshots
    provider = $Provider
    model = $Model
}
[System.IO.File]::WriteAllText(
    $resultPath,
    ($result | ConvertTo-Json -Depth 4),
    $utf8NoBom
)

Write-Output "HERMES_QA_RUN=$RunId"
Write-Output "HERMES_QA_VERDICT=$verdict"
Write-Output "HERMES_QA_REPORT=$reportPath"
Write-Output "HERMES_QA_RESULT=$resultPath"
foreach ($screenshot in $screenshots) {
    Write-Output "HERMES_QA_SCREENSHOT=$screenshot"
}
Write-Output ''
Write-Output $reportText

if ($hermesExitCode -ne 0) {
    exit 4
}

switch ($verdict) {
    'PASS' { exit 0 }
    'FAIL' { exit 2 }
    default { exit 3 }
}
