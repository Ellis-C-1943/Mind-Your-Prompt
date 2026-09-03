param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $LauncherDir
$SourcePath = Join-Path $LauncherDir 'StartMYP.cs'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $ProjectRoot 'Start MYP.exe'
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$tempOutput = Join-Path ([System.IO.Path]::GetDirectoryName($OutputPath)) ('.StartMYP.{0}.exe' -f [guid]::NewGuid().ToString('N'))

try {
    $windowsDirectory = [Environment]::ExpandEnvironmentVariables('%SystemRoot%')
    $compilerCandidates = @(
        (Join-Path $windowsDirectory 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $windowsDirectory 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
    )
    $compilerPath = $compilerCandidates | Where-Object {
        Test-Path -LiteralPath $_ -PathType Leaf
    } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($compilerPath)) {
        throw 'The .NET Framework C# compiler (csc.exe) was not found.'
    }

    $compilerArguments = @(
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        '/reference:System.dll',
        '/reference:System.Windows.Forms.dll',
        ('/out:{0}' -f $tempOutput),
        $SourcePath
    )
    & $compilerPath @compilerArguments
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempOutput -PathType Leaf)) {
        throw "Launcher compilation failed with exit code $LASTEXITCODE."
    }

    if (Test-Path -LiteralPath $OutputPath -PathType Leaf) {
        [System.IO.File]::Replace($tempOutput, $OutputPath, $null, $true)
    } else {
        [System.IO.File]::Move($tempOutput, $OutputPath)
    }

    Write-Host "Built launcher: $OutputPath"
}
finally {
    Remove-Item -LiteralPath $tempOutput -Force -ErrorAction SilentlyContinue
}
