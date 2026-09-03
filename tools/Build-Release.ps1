param(
    [string]$OutputPath,
    [switch]$SkipLauncherBuild,
    [switch]$SkipServerSmoke,
    [switch]$SkipBrowserSmoke
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'VERSION') -Raw -Encoding UTF8).Trim()
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path -Parent $ProjectRoot) ("Mind-Your-Prompt-v{0}-Windows.zip" -f $Version)
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$TempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$StagingRoot = Join-Path $TempBase ('MYP-release-{0}' -f [guid]::NewGuid().ToString('N'))
$ValidationRoot = Join-Path $StagingRoot 'source-validation'
$PackageRoot = Join-Path $StagingRoot 'Mind Your Prompt data'

$sourceTopLevelFiles = @(
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'LICENSE',
    'MYP.ps1',
    'README.md',
    'README.zh-CN.md',
    'SECURITY.md',
    'VERSION',
    'index.html'
)
$sourceDirectories = @('.github', 'assets', 'docs', 'launch', 'launcher', 'server', 'tools')

$releaseTopLevelFiles = @(
    'CHANGELOG.md',
    'LICENSE',
    'MYP.ps1',
    'README.md',
    'README.zh-CN.md',
    'SECURITY.md',
    'VERSION',
    'index.html'
)
$releaseDirectories = @('assets', 'launch', 'launcher', 'server')
$releaseDocumentation = @('docs/ARCHITECTURE.md')

function Copy-ProjectFile {
    param(
        [string]$RelativePath,
        [string]$DestinationRoot
    )

    $source = Join-Path $ProjectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required project file is missing: $RelativePath"
    }
    $destination = Join-Path $DestinationRoot $RelativePath
    $destinationDirectory = [System.IO.Path]::GetDirectoryName($destination)
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

function Copy-ProjectDirectory {
    param(
        [string]$RelativePath,
        [string]$DestinationRoot
    )

    $source = Join-Path $ProjectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "Required project directory is missing: $RelativePath"
    }
    $destination = Join-Path $DestinationRoot $RelativePath
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

function Add-EmptyDataDirectory {
    param([string]$DestinationRoot)

    New-Item -ItemType Directory -Force -Path (Join-Path $DestinationRoot 'DATA/images') | Out-Null
    Copy-ProjectFile 'DATA/.gitkeep' $DestinationRoot
    Copy-ProjectFile 'DATA/images/.gitkeep' $DestinationRoot
}

function Remove-GitHubScreenshotBlock {
    param([string]$DestinationRoot)

    $pattern = '(?ms)^<!-- github-screenshots:start -->\r?\n.*?^<!-- github-screenshots:end -->\r?\n?'
    foreach ($relativePath in @('README.md', 'README.zh-CN.md')) {
        $path = Join-Path $DestinationRoot $relativePath
        $text = Get-Content -LiteralPath $path -Raw -Encoding UTF8
        $matchCount = [regex]::Matches($text, $pattern).Count
        if ($matchCount -ne 1) {
            throw "Expected exactly one GitHub screenshot block in $relativePath; found $matchCount."
        }
        $releaseText = [regex]::Replace($text, $pattern, '')
        if ($releaseText.Contains('docs/screenshot')) {
            throw "Release README still references a screenshot: $relativePath"
        }
        [System.IO.File]::WriteAllText(
            $path,
            $releaseText,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
}

try {
    New-Item -ItemType Directory -Force -Path $ValidationRoot | Out-Null
    foreach ($relativePath in $sourceTopLevelFiles) {
        Copy-ProjectFile $relativePath $ValidationRoot
    }
    foreach ($relativePath in $sourceDirectories) {
        Copy-ProjectDirectory $relativePath $ValidationRoot
    }
    Add-EmptyDataDirectory $ValidationRoot

    $testArguments = @{ ProjectRoot = $ValidationRoot }
    if (-not $SkipServerSmoke) { $testArguments.RunServerSmoke = $true }
    if (-not $SkipBrowserSmoke) { $testArguments.RunBrowserSmoke = $true }
    & (Join-Path $ValidationRoot 'tools/Test-Project.ps1') @testArguments

    New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null
    foreach ($relativePath in $releaseTopLevelFiles) {
        Copy-ProjectFile $relativePath $PackageRoot
    }
    foreach ($relativePath in $releaseDirectories) {
        Copy-ProjectDirectory $relativePath $PackageRoot
    }
    foreach ($relativePath in $releaseDocumentation) {
        Copy-ProjectFile $relativePath $PackageRoot
    }
    Add-EmptyDataDirectory $PackageRoot
    Remove-GitHubScreenshotBlock $PackageRoot

    $launcherOutput = Join-Path $PackageRoot 'Start MYP.exe'
    if ($SkipLauncherBuild) {
        Copy-ProjectFile 'Start MYP.exe' $PackageRoot
    } else {
        & (Join-Path $ValidationRoot 'launcher/Build-Launcher.ps1') -OutputPath $launcherOutput
    }

    $launcherVersion = [System.Reflection.AssemblyName]::GetAssemblyName($launcherOutput).Version.ToString()
    if ($launcherVersion -ne "$Version.0") {
        throw "Launcher version $launcherVersion does not match VERSION $Version."
    }

    $forbiddenFiles = @(Get-ChildItem -LiteralPath $PackageRoot -File -Recurse -Force | Where-Object {
        $relative = $_.FullName.Substring($PackageRoot.Length).TrimStart('\', '/') -replace '\\', '/'
        $relative -in @('DATA/prompts.json', 'DATA/prompts.json.bak') -or
        $relative -like 'DATA/prompts.corrupt-*.json' -or
        ($relative.StartsWith('DATA/images/') -and $relative -ne 'DATA/images/.gitkeep') -or
        $relative.StartsWith('RUNTIME/') -or
        $relative.StartsWith('.github/') -or
        $relative.StartsWith('tools/') -or
        $relative -in @('docs/screenshot.jpg', 'docs/screenshot-light.png', 'docs/screenshot-dark.png') -or
        $_.Extension -in @('.log', '.tmp', '.temp', '.zip')
    })
    if ($forbiddenFiles.Count -gt 0) {
        throw ('Release staging contains forbidden files: {0}' -f (($forbiddenFiles.FullName) -join ', '))
    }

    $hashLines = Get-ChildItem -LiteralPath $PackageRoot -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($PackageRoot.Length).TrimStart('\', '/') -replace '\\', '/'
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relative"
    }
    [System.IO.File]::WriteAllLines(
        (Join-Path $PackageRoot 'SHA256SUMS.txt'),
        $hashLines,
        [System.Text.UTF8Encoding]::new($false)
    )

    $outputDirectory = [System.IO.Path]::GetDirectoryName($OutputPath)
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $PackageRoot,
        $OutputPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $true
    )
    Write-Host "Release created: $OutputPath"
}
finally {
    $resolvedStaging = [System.IO.Path]::GetFullPath($StagingRoot)
    if (
        $resolvedStaging.StartsWith($TempBase, [System.StringComparison]::OrdinalIgnoreCase) -and
        [System.IO.Path]::GetFileName($resolvedStaging).StartsWith('MYP-release-')
    ) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force -ErrorAction SilentlyContinue
    }
}
