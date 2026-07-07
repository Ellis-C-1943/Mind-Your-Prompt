param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerScript = Join-Path $RootDir 'server\MYP.ps1'

if (-not (Test-Path -LiteralPath $ServerScript -PathType Leaf)) {
    throw "MYP server script not found: $ServerScript"
}

Set-Location -LiteralPath $RootDir
$params = @{}
if ($NoBrowser) { $params.NoBrowser = $true }
& $ServerScript @params
if ($LASTEXITCODE -is [int]) { exit $LASTEXITCODE }
exit 0
