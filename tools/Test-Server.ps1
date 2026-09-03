param([string]$ProjectRoot)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$PowerShell = Get-Command powershell.exe -ErrorAction Stop
$StagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('MYP-smoke-{0}' -f [guid]::NewGuid().ToString('N'))
$PackageRoot = Join-Path $StagingRoot 'Mind Your Prompt data'
$Process = $null
$DatabaseLock = $null
$Origin = ''
$SessionToken = ''

function Get-HttpStatusFromError {
    param($ErrorRecord)
    try { return [int]$ErrorRecord.Exception.Response.StatusCode }
    catch { return 0 }
}

function Assert-HttpStatus {
    param([scriptblock]$Action, [int]$ExpectedStatus, [string]$Message)
    $actual = 0
    try {
        & $Action | Out-Null
        $actual = 200
    }
    catch { $actual = Get-HttpStatusFromError $_ }
    if ($actual -ne $ExpectedStatus) { throw "$Message Expected HTTP $ExpectedStatus, received $actual." }
}

function Get-MutationHeaders {
    param([string]$Revision)
    $headers = @{
        Origin = $script:Origin
        'X-MYP-Session' = $script:SessionToken
    }
    if (-not [string]::IsNullOrWhiteSpace($Revision)) { $headers['X-MYP-Revision'] = $Revision }
    return $headers
}

function Invoke-MypJson {
    param([string]$Path, [string]$Body, [string]$Revision)
    return Invoke-RestMethod -Uri "$script:Origin$Path" -Method Post -Headers (Get-MutationHeaders $Revision) -ContentType 'application/json' -Body $Body
}

function Read-PromptsResponse {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$script:Origin/api/prompts"
    return [pscustomobject]@{
        Response = $response
        Data = @($response.Content | ConvertFrom-Json)
        Revision = [string]$response.Headers['X-MYP-Revision']
    }
}

try {
    New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null
    foreach ($name in @('assets', 'server')) {
        Copy-Item -LiteralPath (Join-Path $ProjectRoot $name) -Destination (Join-Path $PackageRoot $name) -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'index.html') -Destination (Join-Path $PackageRoot 'index.html') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot 'DATA/images') | Out-Null

    $legacyBody = '[{"id":"legacy-a","title":"Legacy A","prompt":"Old format","model":"GPT Image2","image":"","images":[],"sourceImages":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]'
    $databaseFile = Join-Path $PackageRoot 'DATA/prompts.json'
    $legacyWithBom = [byte[]](0xEF, 0xBB, 0xBF) + [System.Text.Encoding]::UTF8.GetBytes($legacyBody)
    [System.IO.File]::WriteAllBytes($databaseFile, $legacyWithBom)

    $png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2mZ8AAAAASUVORK5CYII='
    $recoveryTransaction = Join-Path $PackageRoot 'RUNTIME/transactions/interrupted-smoke'
    $recoveryFile = Join-Path $recoveryTransaction 'files/nested/recovered.png'
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($recoveryFile)) | Out-Null
    [System.IO.File]::WriteAllBytes($recoveryFile, [Convert]::FromBase64String($png))
    [System.IO.File]::WriteAllText(
        (Join-Path $recoveryTransaction 'pending.marker'),
        (Get-Date).ToString('o'),
        [System.Text.UTF8Encoding]::new($false)
    )

    $serverPath = Join-Path $PackageRoot 'server/MYP.ps1'
    $arguments = @('-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', ('"{0}"' -f $serverPath), '-NoBrowser')
    $Process = Start-Process -FilePath $PowerShell.Source -ArgumentList $arguments -WindowStyle Hidden -PassThru

    $portPath = Join-Path $PackageRoot 'RUNTIME/server.port'
    $deadline = (Get-Date).AddSeconds(10)
    while (-not (Test-Path -LiteralPath $portPath -PathType Leaf)) {
        if ($Process.HasExited) { throw 'Smoke-test server exited before publishing its port.' }
        if ((Get-Date) -gt $deadline) { throw 'Timed out waiting for the smoke-test server.' }
        Start-Sleep -Milliseconds 100
    }

    $port = [int](Get-Content -LiteralPath $portPath -Raw)
    $Origin = "http://127.0.0.1:$port"
    $recoveredImagePath = Join-Path $PackageRoot 'DATA/images/nested/recovered.png'
    if (-not (Test-Path -LiteralPath $recoveredImagePath -PathType Leaf)) {
        throw 'Startup did not recover an image from an interrupted transaction.'
    }
    if (Test-Path -LiteralPath $recoveryTransaction) {
        throw 'Recovered transaction directory was not cleaned up.'
    }
    $index = Invoke-WebRequest -UseBasicParsing -Uri "$Origin/"
    if ($index.StatusCode -ne 200 -or $index.Content -notmatch 'Mind Your Prompt') { throw 'Index route failed.' }
    if ([string]$index.Headers['X-Content-Type-Options'] -ne 'nosniff') { throw 'Security headers are missing from the index response.' }

    Assert-HttpStatus {
        Invoke-WebRequest -UseBasicParsing -Uri "$Origin/api/session" -Headers @{ Origin = 'https://example.invalid' }
    } 403 'Cross-origin session requests must be rejected.'

    $session = Invoke-RestMethod -Uri "$Origin/api/session" -Headers @{ Origin = $Origin }
    $SessionToken = [string]$session.token
    if ([string]::IsNullOrWhiteSpace($SessionToken)) { throw 'Session endpoint did not return a token.' }

    Start-Sleep -Seconds 22
    if ($Process.HasExited) { throw 'Local server exited after browser-style idle time.' }
    $idleHealth = Invoke-RestMethod -Uri "$Origin/api/health"
    if (-not $idleHealth.ok) { throw 'Local server did not recover after browser-style idle time.' }

    Assert-HttpStatus {
        Invoke-WebRequest -UseBasicParsing -Uri "$Origin/api/prompts" -Method Post -Headers @{ Origin = $Origin } -ContentType 'application/json' -Body '[]'
    } 403 'Mutation without a session token must be rejected.'
    Assert-HttpStatus {
        Invoke-WebRequest -UseBasicParsing -Uri "$Origin/api/prompts" -Method Post -Headers (Get-MutationHeaders '') -ContentType 'text/plain' -Body '[]'
    } 415 'Mutation with a non-JSON content type must be rejected.'
    Assert-HttpStatus {
        Invoke-WebRequest -UseBasicParsing -Uri "$Origin/api/prompts" -Method Post -Headers @{ Origin = 'https://example.invalid'; 'X-MYP-Session' = $SessionToken } -ContentType 'application/json' -Body '[]'
    } 403 'Cross-origin mutation requests must be rejected.'

    $legacy = Read-PromptsResponse
    if ($legacy.Data.Count -ne 1 -or $legacy.Data[0].id -ne 'legacy-a') { throw 'Legacy BOM database did not load.' }
    if ([string]::IsNullOrWhiteSpace($legacy.Revision)) { throw 'Prompt read did not expose a revision.' }

    $firstBody = '[{"id":"first","title":"First Save","prompt":"Atomic save","images":[],"sourceImages":[]}]'
    $firstResult = Invoke-MypJson '/api/prompts' $firstBody $legacy.Revision
    $saved = Read-PromptsResponse
    if ($saved.Data.Count -ne 1 -or $saved.Data[0].id -ne 'first') { throw 'Prompt save/read smoke test failed.' }
    if ([string]$firstResult.revision -ne $saved.Revision) { throw 'Save response revision did not match the stored data revision.' }

    $backupFile = Join-Path $PackageRoot 'DATA/prompts.json.bak'
    if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf)) { throw 'Prompt save did not create a backup.' }
    $backupText = (Get-Content -LiteralPath $backupFile -Raw -Encoding UTF8).TrimStart([char]0xFEFF)
    $backup = @($backupText | ConvertFrom-Json)
    if ($backup.Count -ne 1 -or $backup[0].id -ne 'legacy-a') { throw 'Backup did not preserve the previous database.' }

    $secondBody = '[{"id":"second","title":"Second Save","prompt":"Backup rotation","images":[],"sourceImages":[]}]'
    Invoke-MypJson '/api/prompts' $secondBody $saved.Revision | Out-Null
    $second = Read-PromptsResponse
    $rotatedBackup = @(Get-Content -LiteralPath $backupFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    if ($rotatedBackup.Count -ne 1 -or $rotatedBackup[0].id -ne 'first') { throw 'Backup rotation failed.' }

    Assert-HttpStatus {
        Invoke-MypJson '/api/prompts' $firstBody $saved.Revision
    } 409 'A stale prompt revision must be rejected.'

    [System.IO.File]::WriteAllText($databaseFile, '{broken', [System.Text.UTF8Encoding]::new($false))
    $recovered = Read-PromptsResponse
    if ($recovered.Data.Count -ne 1 -or $recovered.Data[0].id -ne 'first') { throw 'Invalid primary database did not fall back to the valid backup.' }
    if ((Get-Content -LiteralPath $databaseFile -Raw) -ne '{broken') { throw 'Invalid primary database was modified during read.' }

    $repairBody = '[{"id":"repaired","title":"Repaired","prompt":"Preserve corrupt original","images":[],"sourceImages":[]}]'
    Invoke-MypJson '/api/prompts' $repairBody $recovered.Revision | Out-Null
    $repaired = Read-PromptsResponse
    $corruptFiles = @(Get-ChildItem -LiteralPath (Join-Path $PackageRoot 'DATA') -Filter 'prompts.corrupt-*.json' -File)
    if ($corruptFiles.Count -ne 1) { throw 'Damaged primary database was not preserved during repair save.' }
    if ((Get-Content -LiteralPath $corruptFiles[0].FullName -Raw) -ne '{broken') { throw 'Preserved damaged database content changed.' }

    Assert-HttpStatus {
        Invoke-MypJson '/api/prompts' '{}' $repaired.Revision
    } 400 'Non-array prompt data must be rejected.'

    $invalidUploadBody = @{ name = 'mismatch.jpg'; data = "data:image/png;base64,$png"; lastModified = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
    Assert-HttpStatus {
        Invoke-MypJson '/api/image' $invalidUploadBody ''
    } 400 'Image signatures must match the declared extension.'

    $uploadBody = @{ name = 'smoke.png'; data = "data:image/png;base64,$png"; lastModified = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
    $upload = Invoke-MypJson '/api/image' $uploadBody ''
    if ([string]::IsNullOrWhiteSpace([string]$upload.image)) { throw 'Image upload did not return a stored path.' }
    $imageResponse = Invoke-WebRequest -UseBasicParsing -Uri "$Origin/data/$($upload.image)"
    if ($imageResponse.RawContentLength -le 0) { throw 'Image read returned no data.' }
    $storedImagePath = Join-Path (Join-Path $PackageRoot 'DATA') ([string]$upload.image).Replace('/', [System.IO.Path]::DirectorySeparatorChar)

    $transactionBody = @{
        prompts = @(@{ id = 'with-image'; title = 'With image'; prompt = 'Delete atomically'; image = [string]$upload.image; images = @([string]$upload.image); sourceImages = @() })
        deleteImages = @()
        expectedRevision = $repaired.Revision
    } | ConvertTo-Json -Depth 10 -Compress
    Invoke-MypJson '/api/transaction' $transactionBody $repaired.Revision | Out-Null
    $withImage = Read-PromptsResponse

    $unsafeDeleteBody = @{
        prompts = @(@{ id = 'with-image'; title = 'With image'; prompt = 'Still referenced'; image = [string]$upload.image; images = @([string]$upload.image); sourceImages = @() })
        deleteImages = @([string]$upload.image)
        expectedRevision = $withImage.Revision
    } | ConvertTo-Json -Depth 10 -Compress
    Assert-HttpStatus {
        Invoke-MypJson '/api/transaction' $unsafeDeleteBody $withImage.Revision
    } 409 'A transaction must not delete an image still referenced by its prompt snapshot.'
    if (-not (Test-Path -LiteralPath $storedImagePath -PathType Leaf)) { throw 'Rejected referenced-image transaction removed the image.' }

    $unsafeDirectDeleteBody = @{ image = [string]$upload.image } | ConvertTo-Json -Compress
    Assert-HttpStatus {
        Invoke-MypJson '/api/delete-image' $unsafeDirectDeleteBody ''
    } 409 'Direct cleanup must not delete an image referenced by current prompt data.'
    if (-not (Test-Path -LiteralPath $storedImagePath -PathType Leaf)) { throw 'Rejected direct cleanup removed a referenced image.' }

    $deleteTransactionBody = @{
        prompts = @(@{ id = 'without-image'; title = 'Without image'; prompt = 'Committed'; image = ''; images = @(); sourceImages = @() })
        deleteImages = @([string]$upload.image)
        expectedRevision = $withImage.Revision
    } | ConvertTo-Json -Depth 10 -Compress
    Invoke-MypJson '/api/transaction' $deleteTransactionBody $withImage.Revision | Out-Null
    if (Test-Path -LiteralPath $storedImagePath) { throw 'Transactional image deletion did not remove the image.' }
    $withoutImage = Read-PromptsResponse
    if ($withoutImage.Data[0].id -ne 'without-image') { throw 'Transactional prompt save did not commit.' }

    $nestedRelative = 'images/nested/deep/smoke.png'
    $nestedImagePath = Join-Path $PackageRoot 'DATA/images/nested/deep/smoke.png'
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($nestedImagePath)) | Out-Null
    [System.IO.File]::WriteAllBytes($nestedImagePath, [Convert]::FromBase64String($png))
    $nestedSetupBody = @{
        prompts = @(@{ id = 'nested'; title = 'Nested image'; prompt = ''; image = $nestedRelative; images = @($nestedRelative); sourceImages = @() })
        deleteImages = @()
        expectedRevision = $withoutImage.Revision
    } | ConvertTo-Json -Depth 10 -Compress
    Invoke-MypJson '/api/transaction' $nestedSetupBody $withoutImage.Revision | Out-Null
    $nestedSetup = Read-PromptsResponse
    $nestedDeleteBody = @{
        prompts = @(@{ id = 'nested-cleared'; title = 'Nested cleared'; prompt = ''; image = ''; images = @(); sourceImages = @() })
        deleteImages = @($nestedRelative)
        expectedRevision = $nestedSetup.Revision
    } | ConvertTo-Json -Depth 10 -Compress
    Invoke-MypJson '/api/transaction' $nestedDeleteBody $nestedSetup.Revision | Out-Null
    if (Test-Path -LiteralPath $nestedImagePath) { throw 'Transactional deletion failed for a nested DATA/images path.' }
    $withoutImage = Read-PromptsResponse

    $rollbackUpload = Invoke-MypJson '/api/image' $uploadBody ''
    $rollbackImagePath = Join-Path (Join-Path $PackageRoot 'DATA') ([string]$rollbackUpload.image).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $rollbackSetupBody = @{
        prompts = @(@{ id = 'rollback'; title = 'Rollback'; prompt = 'Keep image'; image = [string]$rollbackUpload.image; images = @([string]$rollbackUpload.image); sourceImages = @() })
        deleteImages = @()
        expectedRevision = $withoutImage.Revision
    } | ConvertTo-Json -Depth 10 -Compress
    Invoke-MypJson '/api/transaction' $rollbackSetupBody $withoutImage.Revision | Out-Null
    $rollbackSetup = Read-PromptsResponse

    $DatabaseLock = [System.IO.File]::Open($databaseFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $rollbackBody = @{
        prompts = @(@{ id = 'rollback-failed'; title = 'Must not commit'; prompt = ''; image = ''; images = @(); sourceImages = @() })
        deleteImages = @([string]$rollbackUpload.image)
        expectedRevision = $rollbackSetup.Revision
    } | ConvertTo-Json -Depth 10 -Compress
    Assert-HttpStatus {
        Invoke-MypJson '/api/transaction' $rollbackBody $rollbackSetup.Revision
    } 500 'A failed database write must fail the whole transaction.'
    $DatabaseLock.Dispose()
    $DatabaseLock = $null
    if (-not (Test-Path -LiteralPath $rollbackImagePath -PathType Leaf)) { throw 'Failed transaction did not restore the moved image.' }
    $afterRollback = Read-PromptsResponse
    if ($afterRollback.Data[0].id -ne 'rollback') { throw 'Failed transaction changed prompts.json.' }

    $orphanUpload = Invoke-MypJson '/api/image' $uploadBody ''
    $orphanImagePath = Join-Path (Join-Path $PackageRoot 'DATA') ([string]$orphanUpload.image).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $deleteBody = @{ image = [string]$orphanUpload.image } | ConvertTo-Json -Compress
    Invoke-MypJson '/api/delete-image' $deleteBody '' | Out-Null
    if (Test-Path -LiteralPath $orphanImagePath) { throw 'Direct draft-image cleanup failed.' }

    $unauthorizedClose = @{ clientId = 'smoke-client-alpha-0001'; token = 'invalid' } | ConvertTo-Json -Compress
    Assert-HttpStatus {
        Invoke-RestMethod -Uri "$Origin/api/client/close" -Method Post -Headers @{ Origin = $Origin } -ContentType 'application/json' -Body $unauthorizedClose
    } 403 'Client close requests must require the current local session token.'

    $firstClient = @{ clientId = 'smoke-client-alpha-0001' } | ConvertTo-Json -Compress
    Invoke-MypJson '/api/client/open' $firstClient '' | Out-Null
    $firstClose = @{ clientId = 'smoke-client-alpha-0001'; token = $SessionToken } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$Origin/api/client/close" -Method Post -Headers @{ Origin = $Origin } -ContentType 'application/json' -Body $firstClose | Out-Null
    Start-Sleep -Seconds 3

    $replacementClient = @{ clientId = 'smoke-client-beta-0002' } | ConvertTo-Json -Compress
    Invoke-MypJson '/api/client/open' $replacementClient '' | Out-Null
    Start-Sleep -Seconds 8
    if ($Process.HasExited) { throw 'A reopened browser tab did not cancel the pending shutdown.' }

    $replacementClose = @{ clientId = 'smoke-client-beta-0002'; token = $SessionToken } | ConvertTo-Json -Compress
    $closeStarted = Get-Date
    Invoke-RestMethod -Uri "$Origin/api/client/close" -Method Post -Headers @{ Origin = $Origin } -ContentType 'application/json' -Body $replacementClose | Out-Null
    $closeDeadline = $closeStarted.AddSeconds(15)
    while (-not $Process.HasExited -and (Get-Date) -lt $closeDeadline) { Start-Sleep -Milliseconds 100 }
    if (-not $Process.HasExited) { throw 'Server did not stop after the last browser tab closed.' }
    $closeElapsed = ((Get-Date) - $closeStarted).TotalSeconds
    if ($closeElapsed -lt 9 -or $closeElapsed -gt 14) {
        throw "Server shutdown delay was outside the expected 10-second window: $closeElapsed seconds."
    }

    Write-Host 'MYP server smoke test passed.'
}
finally {
    if ($null -ne $DatabaseLock) { try { $DatabaseLock.Dispose() } catch {} }
    if ($null -ne $Process -and -not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
