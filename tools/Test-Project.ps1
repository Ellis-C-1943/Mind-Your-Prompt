param(
    [string]$ProjectRoot,
    [switch]$RunServerSmoke,
    [switch]$RunBrowserSmoke
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$Failures = New-Object 'System.Collections.Generic.List[string]'

function Add-Failure {
    param([string]$Message)
    $script:Failures.Add($Message)
}

$requiredFiles = @(
    '.editorconfig',
    '.gitattributes',
    '.github/workflows/ci.yml',
    'VERSION',
    'index.html',
    'assets/css/tokens.css',
    'assets/css/sidebar.css',
    'assets/css/stage-base.css',
    'assets/css/editor.css',
    'assets/css/preferences.css',
    'assets/css/stage.css',
    'assets/css/scrollbars.css',
    'assets/css/project-list.css',
    'assets/js/canvas-freeze.js',
    'assets/js/storage.js',
    'assets/js/i18n.js',
    'assets/js/overlay-scrollbar.js',
    'assets/js/app/core.js',
    'assets/js/app/prompt-model.js',
    'assets/js/app/persistence.js',
    'assets/js/app/project-list.js',
    'assets/js/app/stage-layout.js',
    'assets/js/app/stage-transition.js',
    'assets/js/app/stage-grid.js',
    'assets/js/app/editor.js',
    'assets/js/app/preferences.js',
    'assets/js/app/bootstrap.js',
    'MYP.ps1',
    'server/MYP.ps1',
    'launch/Start_MYP.bat',
    'launch/start_silent.vbs',
    'launcher/StartMYP.cs',
    'launcher/Build-Launcher.ps1',
    'tools/Test-Project.ps1',
    'tools/Test-Server.ps1',
    'tools/Test-Browser.mjs',
    'tools/Build-Release.ps1',
    'README.md',
    'README.zh-CN.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/ARCHITECTURE.md',
    'DATA/.gitkeep',
    'DATA/images/.gitkeep'
)
foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $ProjectRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { Add-Failure "Missing required file: $relativePath" }
}

$versionPath = Join-Path $ProjectRoot 'VERSION'
if (Test-Path -LiteralPath $versionPath -PathType Leaf) {
    $projectVersion = (Get-Content -LiteralPath $versionPath -Raw -Encoding UTF8).Trim()
    if ($projectVersion -notmatch '^\d+\.\d+\.\d+$') { Add-Failure "Invalid VERSION value: $projectVersion" }
    $launcherPath = Join-Path $ProjectRoot 'Start MYP.exe'
    if (Test-Path -LiteralPath $launcherPath -PathType Leaf) {
        try {
            $launcherVersion = [System.Reflection.AssemblyName]::GetAssemblyName($launcherPath).Version.ToString()
            if ($launcherVersion -ne "$projectVersion.0") { Add-Failure "Launcher version $launcherVersion does not match VERSION $projectVersion." }
        }
        catch { Add-Failure "Unable to read launcher assembly metadata: $($_.Exception.Message)" }
    }
}

foreach ($legacyPath in @('assets/css/style.css', 'assets/js/app.js')) {
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot $legacyPath)) { Add-Failure "Legacy monolith must not exist: $legacyPath" }
}

$runtimeDir = Join-Path $ProjectRoot 'RUNTIME'
if (Test-Path -LiteralPath $runtimeDir) {
    $runtimeFiles = @(Get-ChildItem -LiteralPath $runtimeDir -File -Recurse -Force)
    if ($runtimeFiles.Count -gt 0) { Add-Failure 'RUNTIME contains generated files.' }
}

$dbPath = Join-Path $ProjectRoot 'DATA/prompts.json'
if (Test-Path -LiteralPath $dbPath -PathType Leaf) { Add-Failure 'DATA/prompts.json must not be included in source or release output.' }
$backupPath = Join-Path $ProjectRoot 'DATA/prompts.json.bak'
if (Test-Path -LiteralPath $backupPath -PathType Leaf) { Add-Failure 'DATA/prompts.json.bak must not be included in source or release output.' }

$imageDir = Join-Path $ProjectRoot 'DATA/images'
if (Test-Path -LiteralPath $imageDir) {
    $unexpectedImages = @(
        Get-ChildItem -LiteralPath $imageDir -File -Force |
            Where-Object { $_.Name -ne '.gitkeep' }
    )
    if ($unexpectedImages.Count -gt 0) { Add-Failure 'DATA/images contains user or test files.' }
}

$indexPath = Join-Path $ProjectRoot 'index.html'
if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
    $indexText = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8
    $assetMatches = [regex]::Matches($indexText, '(?:src|href)=["''](?<path>assets/[^"''?#]+)')
    foreach ($match in $assetMatches) {
        $assetPath = $match.Groups['path'].Value.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $assetPath) -PathType Leaf)) {
            Add-Failure "index.html references a missing asset: $assetPath"
        }
    }

    $orderedScripts = @(
        'assets/js/app/core.js',
        'assets/js/app/prompt-model.js',
        'assets/js/app/persistence.js',
        'assets/js/app/project-list.js',
        'assets/js/app/stage-layout.js',
        'assets/js/app/stage-transition.js',
        'assets/js/app/stage-grid.js',
        'assets/js/app/editor.js',
        'assets/js/app/preferences.js',
        'assets/js/app/bootstrap.js'
    )
    $previousIndex = -1
    foreach ($scriptPath in $orderedScripts) {
        $scriptIndex = $indexText.IndexOf(('src="{0}"' -f $scriptPath), [System.StringComparison]::Ordinal)
        if ($scriptIndex -lt 0) { Add-Failure "index.html is missing application script: $scriptPath" }
        elseif ($scriptIndex -le $previousIndex) { Add-Failure "Application script order is invalid at: $scriptPath" }
        $previousIndex = $scriptIndex
    }
}

$powerShellFiles = @(
    'MYP.ps1',
    'server/MYP.ps1',
    'launcher/Build-Launcher.ps1',
    'tools/Test-Project.ps1',
    'tools/Test-Server.ps1',
    'tools/Build-Release.ps1'
)
foreach ($relativePath in $powerShellFiles) {
    $path = Join-Path $ProjectRoot $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $tokens = $null
    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
    foreach ($parseError in $parseErrors) { Add-Failure ("PowerShell syntax error in {0}: {1}" -f $relativePath, $parseError.Message) }
}

$javascriptFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'assets/js') -Filter '*.js' -File -Recurse
)
$browserTestPath = Join-Path $ProjectRoot 'tools/Test-Browser.mjs'
$nodeCheckFiles = @($javascriptFiles)
if (Test-Path -LiteralPath $browserTestPath -PathType Leaf) { $nodeCheckFiles += Get-Item -LiteralPath $browserTestPath }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $nodeCommand) {
    foreach ($javascriptFile in $nodeCheckFiles) {
        & $nodeCommand.Source --check $javascriptFile.FullName
        if ($LASTEXITCODE -ne 0) {
            Add-Failure "JavaScript syntax check failed: $($javascriptFile.FullName.Substring($ProjectRoot.Length + 1))"
        }
    }
}
elseif ($RunBrowserSmoke) {
    Add-Failure 'Node.js is required when -RunBrowserSmoke is requested.'
}

foreach ($javascriptFile in $nodeCheckFiles) {
    $relative = ($javascriptFile.FullName.Substring($ProjectRoot.Length + 1) -replace '\\', '/')
    $lineNumber = 0
    foreach ($line in Get-Content -LiteralPath $javascriptFile.FullName) {
        $lineNumber++
        if ($line.Length -gt 200) { Add-Failure "$relative has a line longer than 200 characters at line $lineNumber." }
    }
}

$functionOwners = @{}
foreach ($javascriptFile in @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'assets/js/app') -Filter '*.js' -File)) {
    $relative = $javascriptFile.FullName.Substring($ProjectRoot.Length + 1)
    $lineCount = @(Get-Content -LiteralPath $javascriptFile.FullName).Count
    if ($lineCount -gt 900) { Add-Failure "$relative exceeds the 900-line responsibility limit." }
    $text = Get-Content -LiteralPath $javascriptFile.FullName -Raw -Encoding UTF8
    foreach ($match in [regex]::Matches($text, '(?m)^(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\s*\(')) {
        $name = $match.Groups['name'].Value
        if ($functionOwners.ContainsKey($name)) { Add-Failure "Duplicate app function '$name' in $relative and $($functionOwners[$name])." }
        else { $functionOwners[$name] = $relative }
    }
}

$cssFiles = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'assets/css') -Filter '*.css' -File)
$totalImportantCount = 0
foreach ($cssFile in $cssFiles) {
    $relative = ($cssFile.FullName.Substring($ProjectRoot.Length + 1) -replace '\\', '/')
    $lineCount = @(Get-Content -LiteralPath $cssFile.FullName).Count
    if ($lineCount -gt 1000) { Add-Failure "$relative exceeds the 1000-line stylesheet limit." }
    $css = Get-Content -LiteralPath $cssFile.FullName -Raw -Encoding UTF8
    $importantCount = [regex]::Matches($css, '!important').Count
    $totalImportantCount += $importantCount
    $allowedImportantCount = if ($relative -eq 'assets/css/stage.css') { 1 } else { 0 }
    if ($importantCount -ne $allowedImportantCount) {
        Add-Failure "$relative must contain exactly $allowedImportantCount intentional !important declaration(s); found $importantCount."
    }
    $withoutComments = [regex]::Replace(
        $css,
        '/\*.*?\*/',
        '',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if ([regex]::Matches($withoutComments, '\{').Count -ne [regex]::Matches($withoutComments, '\}').Count) {
        Add-Failure "Unbalanced CSS braces in $relative."
    }
}
if ($totalImportantCount -ne 1) { Add-Failure "The complete CSS tree must contain exactly one !important declaration; found $totalImportantCount." }
$stageCssPath = Join-Path $ProjectRoot 'assets/css/stage.css'
if (Test-Path -LiteralPath $stageCssPath -PathType Leaf) {
    $stageCss = Get-Content -LiteralPath $stageCssPath -Raw -Encoding UTF8
    if (-not $stageCss.Contains('opacity: 0 !important')) {
        Add-Failure 'The sole !important declaration must remain the single-mode selection-frame guard.'
    }
}

$allSourceText = ((
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'assets') -File -Recurse |
        Where-Object { $_.Extension -in @('.js', '.css', '.html') } |
        ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 }
) -join "`n")
foreach ($deadToken in @('stageModeScale(', 'holdGhostThenRemove(', 'themeEase(', 'stageBackdropBlur', '.itemDate', '.singleGuide', '#newBtn .plus')) {
    if ($allSourceText.Contains($deadToken)) { Add-Failure "Removed legacy token returned: $deadToken" }
}

$serverText = Get-Content -LiteralPath (Join-Path $ProjectRoot 'server/MYP.ps1') -Raw -Encoding UTF8
foreach ($requiredServerToken in @(
    'prompts.json.bak',
    '[System.IO.File]::Replace',
    'Test-PromptJsonText',
    'Normalize-JsonText',
    'Test-ImageSignature',
    '127.0.0.1',
    '/api/session',
    '/api/transaction',
    'X-MYP-Session',
    'X-MYP-Revision',
    'Assert-AuthorizedMutation',
    'Recover-PendingTransactions',
    'Content-Security-Policy',
    'expectedRevision',
    'Test-PromptReferencesImage',
    '$listener.GetContextAsync()',
    '/api/client/open',
    '/api/client/close',
    '$ClientCloseDelaySeconds = 10',
    '$ShutdownDeadline'
)) {
    if (-not $serverText.Contains($requiredServerToken)) { Add-Failure "Server reliability control is missing: $requiredServerToken" }
}


if ($serverText.Contains('$IdleTimeoutSeconds')) {
    Add-Failure 'The local server must not exit because a browser tab was background-throttled.'
}

if ($serverText.Contains('/api/shutdown')) {
    Add-Failure 'The legacy immediate shutdown endpoint must not bypass the browser lifecycle delay.'
}

$persistenceText = Get-Content -LiteralPath (Join-Path $ProjectRoot 'assets/js/app/persistence.js') -Raw -Encoding UTF8
foreach ($requiredPersistenceToken in @(
    'saveQueue',
    '/api/session',
    '/api/transaction',
    'X-MYP-Session',
    'X-MYP-Revision',
    'dbCommitTransaction',
    'expectedRevision: serverRevision',
    'refreshServerConnection',
    'response.status === 403',
    'registerServerClient',
    'closeServerClient',
    'navigator.sendBeacon',
    'serverClientClosing'
)) {
    if (-not $persistenceText.Contains($requiredPersistenceToken)) { Add-Failure "Persistence control is missing: $requiredPersistenceToken" }
}

$bootstrapText = Get-Content -LiteralPath (Join-Path $ProjectRoot 'assets/js/app/bootstrap.js') -Raw -Encoding UTF8
foreach ($requiredBootstrapToken in @('pagehide', 'resumeServerClient', 'refreshServerConnection')) {
    if (-not $bootstrapText.Contains($requiredBootstrapToken)) { Add-Failure "Browser lifecycle control is missing: $requiredBootstrapToken" }
}

$editorText = Get-Content -LiteralPath (Join-Path $ProjectRoot 'assets/js/app/editor.js') -Raw -Encoding UTF8
foreach ($requiredEditorToken in @(
    'renderFormVersion',
    'captureAppState',
    'saveAll({ deleteImages:',
    'Rendering is deliberately outside the persistence rollback boundary'
)) {
    if (-not $editorText.Contains($requiredEditorToken)) { Add-Failure "Editor reliability control is missing: $requiredEditorToken" }
}

if ($Failures.Count -gt 0) {
    $Failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    throw "Project validation failed with $($Failures.Count) error(s)."
}

if ($RunServerSmoke) { & (Join-Path $PSScriptRoot 'Test-Server.ps1') -ProjectRoot $ProjectRoot }
if ($RunBrowserSmoke) {
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'Test-Browser.mjs') $ProjectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Browser regression test failed.' }
}
Write-Host 'MYP project validation passed.'
