param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$DataDir = Join-Path $RootDir 'DATA'
$ImageDir = Join-Path $DataDir 'images'
$RuntimeDir = Join-Path $RootDir 'RUNTIME'
$TransactionRoot = Join-Path $RuntimeDir 'transactions'
$DbPath = Join-Path $DataDir 'prompts.json'
$BackupPath = Join-Path $DataDir 'prompts.json.bak'
$IndexPath = Join-Path $RootDir 'index.html'
$AssetsDir = Join-Path $RootDir 'assets'
$LogPath = Join-Path $RuntimeDir 'server.log'
$PortPath = Join-Path $RuntimeDir 'server.port'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$MaxImageBytes = 80MB
$MaxPromptBodyBytes = 32MB
$MaxTransactionBodyBytes = 34MB
$MaxImageBodyBytes = 110MB
$SessionToken = ''
$ServerOrigin = ''
$ServerInstanceId = ''
$ClientCloseDelaySeconds = 10
$ActiveClientIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$ShutdownDeadline = $null

function Write-Utf8File {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

function Normalize-JsonText {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    return $Text.TrimStart([char]0xFEFF)
}

function Test-PromptJsonText {
    param([string]$Text)
    $normalized = (Normalize-JsonText $Text).Trim()
    if ([string]::IsNullOrWhiteSpace($normalized)) { return $false }
    if (-not ($normalized.StartsWith('[') -and $normalized.EndsWith(']'))) { return $false }
    try {
        $parsed = $normalized | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $parsed -and $normalized -ne '[]') { return $false }
        return $true
    }
    catch { return $false }
}

function Test-PromptJsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try { return Test-PromptJsonText (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) }
    catch { return $false }
}

function Ensure-Storage {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ImageDir | Out-Null
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    New-Item -ItemType Directory -Force -Path $TransactionRoot | Out-Null
    if (-not (Test-Path -LiteralPath $DbPath -PathType Leaf)) {
        if (Test-PromptJsonFile $BackupPath) {
            Copy-Item -LiteralPath $BackupPath -Destination $DbPath -Force
        }
        else {
            Write-Utf8File $DbPath '[]'
        }
    }
}

function Write-Log {
    param([string]$Text)
    try {
        Ensure-Storage
        Add-Content -LiteralPath $LogPath -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text) -Encoding UTF8
    } catch {}
}

function Read-Body {
    param($Request, [long]$MaxBytes = 33554432)
    if ($Request.ContentLength64 -gt $MaxBytes) { throw 'HTTP413:Request body is too large.' }
    $reader = [System.IO.StreamReader]::new($Request.InputStream, [System.Text.Encoding]::UTF8)
    try {
        $text = $reader.ReadToEnd()
        if ([System.Text.Encoding]::UTF8.GetByteCount($text) -gt $MaxBytes) { throw 'HTTP413:Request body is too large.' }
        return $text
    }
    finally { $reader.Dispose() }
}

function Read-CurrentPromptJson {
    Ensure-Storage
    $json = Normalize-JsonText (Get-Content -LiteralPath $DbPath -Raw -Encoding UTF8)
    if ([string]::IsNullOrWhiteSpace($json)) { $json = '[]' }
    if (Test-PromptJsonText $json) { return $json }
    if (Test-PromptJsonFile $BackupPath) {
        Write-Log 'Primary prompts.json is invalid; using the valid backup without deleting the primary file.'
        return Normalize-JsonText (Get-Content -LiteralPath $BackupPath -Raw -Encoding UTF8)
    }
    throw 'DATA/prompts.json is not a valid JSON array. The original file was left untouched.'
}

function Get-TextRevision {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes((Normalize-JsonText $Text))
        $hash = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally { $sha.Dispose() }
}

function New-SessionToken {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    return ([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Write-PromptJsonSafely {
    param([string]$Json)
    $normalized = Normalize-JsonText $Json
    if (-not (Test-PromptJsonText $normalized)) { throw 'HTTP400:Prompt data must be a valid JSON array.' }

    $tempPath = Join-Path $DataDir ('.prompts.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
    Write-Utf8File $tempPath $normalized
    try {
        if (Test-Path -LiteralPath $DbPath -PathType Leaf) {
            if (Test-PromptJsonFile $DbPath) {
                try {
                    [System.IO.File]::Replace($tempPath, $DbPath, $BackupPath, $true)
                    return
                }
                catch {
                    Write-Log ("Atomic replace unavailable; using compatible save fallback: {0}" -f $_.Exception.Message)
                    try { Copy-Item -LiteralPath $DbPath -Destination $BackupPath -Force } catch {}
                    Copy-Item -LiteralPath $tempPath -Destination $DbPath -Force
                    return
                }
            }

            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            $corruptPath = Join-Path $DataDir ("prompts.corrupt-{0}.json" -f $stamp)
            try { Copy-Item -LiteralPath $DbPath -Destination $corruptPath -Force } catch {}
            Copy-Item -LiteralPath $tempPath -Destination $DbPath -Force
            return
        }
        Move-Item -LiteralPath $tempPath -Destination $DbPath -Force
    }
    finally {
        Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    }
}

function Test-ImageSignature {
    param([byte[]]$Bytes, [string]$Extension)
    if ($Extension -eq '.png') {
        if ($Bytes.Length -lt 8) { return $false }
        $signature = @(137, 80, 78, 71, 13, 10, 26, 10)
        for ($index = 0; $index -lt $signature.Count; $index++) {
            if ($Bytes[$index] -ne $signature[$index]) { return $false }
        }
        return $true
    }
    return $Bytes.Length -ge 3 -and $Bytes[0] -eq 255 -and $Bytes[1] -eq 216 -and $Bytes[2] -eq 255
}

function Write-ImageSafely {
    param([string]$Path, [byte[]]$Bytes)
    $tempPath = Join-Path $ImageDir ('.image.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllBytes($tempPath, $Bytes)
        Move-Item -LiteralPath $tempPath -Destination $Path -Force
    }
    finally { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
}

function Set-ResponseSecurityHeaders {
    param($Context, [string]$Path)
    try { $Context.Response.Headers['X-Content-Type-Options'] = 'nosniff' } catch {}
    try { $Context.Response.Headers['Referrer-Policy'] = 'no-referrer' } catch {}
    try { $Context.Response.Headers['Cross-Origin-Resource-Policy'] = 'same-origin' } catch {}
    try { $Context.Response.Headers['X-Frame-Options'] = 'DENY' } catch {}
    if ($Path -eq '/' -or $Path -eq '/index.html') {
        try {
            $Context.Response.Headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        } catch {}
    }
    if ($Path.StartsWith('/api/', [System.StringComparison]::OrdinalIgnoreCase)) {
        try { $Context.Response.Headers['Cache-Control'] = 'no-store' } catch {}
    }
}

function Send-Bytes {
    param($Context, [byte[]]$Bytes, [string]$ContentType, [int]$StatusCode = 200)
    try {
        $Context.Response.StatusCode = $StatusCode
        $Context.Response.ContentType = $ContentType
        $Context.Response.ContentLength64 = $Bytes.Length
        $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    }
    catch {
        try { Write-Log ("Client disconnected while sending response: {0}" -f $_.Exception.Message) } catch {}
    }
    finally {
        try { $Context.Response.Close() } catch {}
    }
}

function Send-Text {
    param($Context, [string]$Text, [string]$ContentType = 'text/plain; charset=utf-8', [int]$StatusCode = 200)
    Send-Bytes $Context ([System.Text.Encoding]::UTF8.GetBytes($Text)) $ContentType $StatusCode
}

function Send-Json {
    param($Context, $Object, [int]$StatusCode = 200)
    $json = $Object | ConvertTo-Json -Depth 20 -Compress
    Send-Text $Context $json 'application/json; charset=utf-8' $StatusCode
}

function Send-Empty {
    param($Context, [int]$StatusCode = 204)
    try {
        $Context.Response.StatusCode = $StatusCode
        $Context.Response.ContentLength64 = 0
    } finally {
        try { $Context.Response.Close() } catch {}
    }
}

function Send-Error {
    param($Context, [string]$Message, [int]$StatusCode = 500)
    if ($StatusCode -ge 500) { Write-Log ("ERROR {0}: {1}" -f $StatusCode, $Message) }
    Send-Json $Context @{ ok = $false; error = $Message } $StatusCode
}

function Open-Browser {
    param([string]$Url)
    Start-Process $Url | Out-Null
}

function Test-LocalServer {
    param([int]$Port)
    $request = $null
    $response = $null
    try {
        $request = [System.Net.WebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $request.Method = 'GET'
        $request.Timeout = 1000
        $request.ReadWriteTimeout = 1000
        $response = $request.GetResponse()
        return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300)
    }
    catch { return $false }
    finally { if ($null -ne $response) { $response.Close() } }
}

function Get-ContentType {
    param([string]$Path)
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.js'   { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.svg'  { 'image/svg+xml' }
        '.ico'  { 'image/x-icon' }
        default { 'application/octet-stream' }
    }
}

function Resolve-SafePath {
    param([string]$BaseDir, [string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath)) { throw 'HTTP400:Empty path.' }
    $clean = $RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar).TrimStart([System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $BaseDir $clean))
    $root = [System.IO.Path]::GetFullPath($BaseDir)
    if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $root += [System.IO.Path]::DirectorySeparatorChar
    }
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'HTTP400:Blocked unsafe path.'
    }
    return $full
}

function Resolve-SafeImagePath {
    param([string]$RelativeImage)
    $relative = [string]$RelativeImage
    if ($relative.StartsWith('/data/', [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $relative.Substring('/data/'.Length)
    }
    if ($relative.StartsWith('data/', [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $relative.Substring('data/'.Length)
    }
    if (-not $relative.StartsWith('images/', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'HTTP400:Only DATA/images paths are allowed.'
    }
    return Resolve-SafePath $DataDir $relative
}

function Normalize-ImageReference {
    param([string]$RelativeImage)
    $relative = ([string]$RelativeImage).Replace('\', '/').Trim()
    if ($relative.StartsWith('/data/', [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $relative.Substring('/data/'.Length)
    }
    if ($relative.StartsWith('data/', [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $relative.Substring('data/'.Length)
    }
    return $relative.TrimStart('/').ToLowerInvariant()
}

function Get-PromptImageReferences {
    param([string]$PromptJson)
    $references = @{}
    $normalized = Normalize-JsonText $PromptJson
    if (-not (Test-PromptJsonText $normalized)) { return $references }
    foreach ($prompt in @($normalized | ConvertFrom-Json)) {
        foreach ($value in @($prompt.image) + @($prompt.images) + @($prompt.sourceImages)) {
            $reference = Normalize-ImageReference ([string]$value)
            if (-not [string]::IsNullOrWhiteSpace($reference)) { $references[$reference] = $true }
        }
    }
    return $references
}

function Test-PromptReferencesImage {
    param([string]$PromptJson, [string]$RelativeImage)
    $reference = Normalize-ImageReference $RelativeImage
    if ([string]::IsNullOrWhiteSpace($reference)) { return $false }
    return (Get-PromptImageReferences $PromptJson).ContainsKey($reference)
}

function Remove-Image {
    param([string]$RelativeImage)
    if ([string]::IsNullOrWhiteSpace($RelativeImage)) { return }
    $path = Resolve-SafeImagePath $RelativeImage
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}

function Test-SameOriginRequest {
    param($Request)
    $origin = [string]$Request.Headers['Origin']
    if (-not [string]::IsNullOrWhiteSpace($origin)) {
        return $origin.TrimEnd('/') -eq $script:ServerOrigin
    }
    $fetchSite = [string]$Request.Headers['Sec-Fetch-Site']
    return [string]::IsNullOrWhiteSpace($fetchSite) -or $fetchSite -eq 'same-origin' -or $fetchSite -eq 'none'
}

function Assert-JsonContentType {
    param($Request)
    $contentType = [string]$Request.ContentType
    if ([string]::IsNullOrWhiteSpace($contentType) -or -not $contentType.StartsWith('application/json', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'HTTP415:Content-Type must be application/json.'
    }
}

function Assert-SessionToken {
    param([string]$Token)
    if ([string]::IsNullOrWhiteSpace($Token) -or $Token -ne $script:SessionToken) {
        throw 'HTTP403:Invalid local session token.'
    }
}

function Assert-AuthorizedMutation {
    param($Request)
    if (-not (Test-SameOriginRequest $Request)) { throw 'HTTP403:Cross-origin request blocked.' }
    Assert-SessionToken ([string]$Request.Headers['X-MYP-Session'])
    Assert-JsonContentType $Request
}

function Read-ClientLifecycleBody {
    param($Request, [switch]$TokenInBody)
    if (-not (Test-SameOriginRequest $Request)) { throw 'HTTP403:Cross-origin request blocked.' }
    Assert-JsonContentType $Request
    $bodyText = Read-Body $Request 4KB
    try { $body = $bodyText | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'HTTP400:Client lifecycle body must be valid JSON.' }
    $token = if ($TokenInBody) { [string]$body.token } else { [string]$Request.Headers['X-MYP-Session'] }
    Assert-SessionToken $token
    $clientId = [string]$body.clientId
    if ($clientId -notmatch '^[A-Za-z0-9_-]{16,128}$') { throw 'HTTP400:Invalid client identifier.' }
    return [pscustomobject]@{ ClientId = $clientId }
}

function Recover-PendingTransactions {
    Ensure-Storage
    foreach ($directory in @(Get-ChildItem -LiteralPath $TransactionRoot -Directory -ErrorAction SilentlyContinue)) {
        $committed = Join-Path $directory.FullName 'committed.marker'
        $filesRoot = Join-Path $directory.FullName 'files'
        if (-not (Test-Path -LiteralPath $committed -PathType Leaf) -and (Test-Path -LiteralPath $filesRoot -PathType Container)) {
            $filesRootFull = [System.IO.Path]::GetFullPath($filesRoot)
            foreach ($file in @(Get-ChildItem -LiteralPath $filesRoot -File -Recurse -ErrorAction SilentlyContinue)) {
                $relative = $file.FullName.Substring($filesRootFull.Length).TrimStart('\', '/')
                $target = [System.IO.Path]::GetFullPath((Join-Path $ImageDir $relative))
                if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
                    try {
                        New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($target)) | Out-Null
                        Move-Item -LiteralPath $file.FullName -Destination $target -Force
                    } catch {}
                }
            }
        }
        Remove-Item -LiteralPath $directory.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-PromptTransaction {
    param([string]$PromptJson, [string[]]$DeleteImages, [string]$ExpectedRevision)
    $normalized = Normalize-JsonText $PromptJson
    if (-not (Test-PromptJsonText $normalized)) { throw 'HTTP400:Prompt data must be a valid JSON array.' }

    $currentJson = Read-CurrentPromptJson
    $currentRevision = Get-TextRevision $currentJson
    if (-not [string]::IsNullOrWhiteSpace($ExpectedRevision) -and $ExpectedRevision -ne $currentRevision) {
        throw 'HTTP409:Prompt data changed in another window. Reload before saving again.'
    }

    $nextReferences = Get-PromptImageReferences $normalized
    $uniqueDeletes = @($DeleteImages | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    foreach ($relative in $uniqueDeletes) {
        $reference = Normalize-ImageReference ([string]$relative)
        if ($nextReferences.ContainsKey($reference)) {
            throw 'HTTP409:Refused to delete an image that is still referenced by prompt data.'
        }
    }

    $transactionDir = Join-Path $TransactionRoot ([guid]::NewGuid().ToString('N'))
    $filesRoot = Join-Path $transactionDir 'files'
    New-Item -ItemType Directory -Force -Path $filesRoot | Out-Null
    Write-Utf8File (Join-Path $transactionDir 'pending.marker') (Get-Date).ToString('o')
    $moved = New-Object 'System.Collections.Generic.List[object]'
    $imageRoot = [System.IO.Path]::GetFullPath($ImageDir)
    if (-not $imageRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $imageRoot += [System.IO.Path]::DirectorySeparatorChar
    }

    try {
        foreach ($relative in $uniqueDeletes) {
            $source = Resolve-SafeImagePath ([string]$relative)
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
            $relativeToImages = $source.Substring($imageRoot.Length)
            $temporary = Join-Path $filesRoot $relativeToImages
            New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($temporary)) | Out-Null
            Move-Item -LiteralPath $source -Destination $temporary -Force
            $moved.Add([pscustomobject]@{ Source = $source; Temporary = $temporary })
        }

        Write-PromptJsonSafely $normalized
        Write-Utf8File (Join-Path $transactionDir 'committed.marker') (Get-Date).ToString('o')
        $newRevision = Get-TextRevision $normalized
        Remove-Item -LiteralPath $transactionDir -Recurse -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ Revision = $newRevision; Deleted = $moved.Count }
    }
    catch {
        foreach ($entry in $moved) {
            if ((Test-Path -LiteralPath $entry.Temporary -PathType Leaf) -and -not (Test-Path -LiteralPath $entry.Source -PathType Leaf)) {
                try { Move-Item -LiteralPath $entry.Temporary -Destination $entry.Source -Force } catch {}
            }
        }
        Remove-Item -LiteralPath $transactionDir -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Get-ExpectedRevision {
    param($Request, $Body)
    $expected = [string]$Request.Headers['X-MYP-Revision']
    if ([string]::IsNullOrWhiteSpace($expected) -and $null -ne $Body) {
        $property = $Body.PSObject.Properties['expectedRevision']
        if ($null -ne $property) { $expected = [string]$property.Value }
    }
    return $expected
}

function Convert-PromptsToJson {
    param($Prompts)
    if ($null -eq $Prompts) { return '[]' }
    return ConvertTo-Json -InputObject @($Prompts) -Depth 20 -Compress
}

function Handle-Request {
    param($Context)
    $request = $Context.Request
    $path = $request.Url.AbsolutePath
    $method = $request.HttpMethod.ToUpperInvariant()
    Set-ResponseSecurityHeaders $Context $path

    try {
        if ($method -eq 'GET' -and $path -eq '/api/health') {
            Send-Json $Context @{ ok = $true; app = 'MYP'; instance = $script:ServerInstanceId }
            return $true
        }

        if ($method -eq 'GET' -and $path -eq '/api/session') {
            if (-not (Test-SameOriginRequest $request)) { throw 'HTTP403:Cross-origin request blocked.' }
            Send-Json $Context @{ ok = $true; token = $script:SessionToken }
            return $true
        }

        if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
            Send-Bytes $Context ([System.IO.File]::ReadAllBytes($IndexPath)) (Get-ContentType $IndexPath)
            return $true
        }

        if ($method -eq 'GET' -and $path.StartsWith('/assets/', [System.StringComparison]::OrdinalIgnoreCase)) {
            $rel = [uri]::UnescapeDataString($path.Substring('/assets/'.Length))
            $file = Resolve-SafePath $AssetsDir $rel
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
                Send-Error $Context 'Asset not found.' 404
                return $true
            }
            Send-Bytes $Context ([System.IO.File]::ReadAllBytes($file)) (Get-ContentType $file)
            return $true
        }

        if ($method -eq 'GET' -and $path -eq '/favicon.ico') {
            $iconPath = Join-Path $RootDir 'assets\icons\favicon.png'
            if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
                Send-Bytes $Context ([System.IO.File]::ReadAllBytes($iconPath)) 'image/png'
            } else {
                Send-Empty $Context 204
            }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/client/open') {
            $body = Read-ClientLifecycleBody $request
            $script:ActiveClientIds.Add($body.ClientId) | Out-Null
            $script:ShutdownDeadline = $null
            Send-Json $Context @{ ok = $true; active = $true }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/client/close') {
            $body = Read-ClientLifecycleBody $request -TokenInBody
            $removed = $script:ActiveClientIds.Remove($body.ClientId)
            if ($removed -and $script:ActiveClientIds.Count -eq 0) {
                $script:ShutdownDeadline = [datetime]::UtcNow.AddSeconds($script:ClientCloseDelaySeconds)
            }
            Send-Json $Context @{ ok = $true; closing = ($null -ne $script:ShutdownDeadline) }
            return $true
        }

        if ($method -eq 'GET' -and $path -eq '/api/prompts') {
            $json = Read-CurrentPromptJson
            $revision = Get-TextRevision $json
            try { $Context.Response.Headers['X-MYP-Revision'] = $revision } catch {}
            Send-Text $Context $json 'application/json; charset=utf-8'
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/prompts') {
            Assert-AuthorizedMutation $request
            $body = Read-Body $request $MaxPromptBodyBytes
            if ([string]::IsNullOrWhiteSpace($body)) { $body = '[]' }
            $result = Invoke-PromptTransaction $body @() ([string]$request.Headers['X-MYP-Revision'])
            try { $Context.Response.Headers['X-MYP-Revision'] = $result.Revision } catch {}
            Send-Json $Context @{ ok = $true; revision = $result.Revision }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/transaction') {
            Assert-AuthorizedMutation $request
            $bodyText = Read-Body $request $MaxTransactionBodyBytes
            try { $body = $bodyText | ConvertFrom-Json -ErrorAction Stop }
            catch { throw 'HTTP400:Transaction body must be valid JSON.' }
            if ($null -eq $body.PSObject.Properties['prompts']) { throw 'HTTP400:Transaction must include prompts.' }
            $promptJson = Convert-PromptsToJson $body.prompts
            $deleteImages = @()
            if ($null -ne $body.PSObject.Properties['deleteImages']) { $deleteImages = @($body.deleteImages) }
            if ($deleteImages.Count -gt 5000) { throw 'HTTP400:Too many image deletions in one transaction.' }
            $expectedRevision = Get-ExpectedRevision $request $body
            $result = Invoke-PromptTransaction $promptJson $deleteImages $expectedRevision
            try { $Context.Response.Headers['X-MYP-Revision'] = $result.Revision } catch {}
            Send-Json $Context @{ ok = $true; revision = $result.Revision; deleted = $result.Deleted }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/image') {
            Assert-AuthorizedMutation $request
            Ensure-Storage
            try { $body = Read-Body $request $MaxImageBodyBytes | ConvertFrom-Json -ErrorAction Stop }
            catch { throw 'HTTP400:Image body must be valid JSON.' }
            $ext = [System.IO.Path]::GetExtension([string]$body.name).ToLowerInvariant()
            if (@('.jpg', '.jpeg', '.png') -notcontains $ext) {
                throw 'HTTP400:Only JPG, JPEG, and PNG images are supported.'
            }
            $data = [string]$body.data
            $data = $data -replace '^data:[^,]*base64,', ''
            try { $bytes = [Convert]::FromBase64String($data) }
            catch { throw 'HTTP400:Image data is not valid base64.' }
            if ($bytes.Length -gt $MaxImageBytes) {
                throw 'HTTP413:Image is too large. Maximum size is 80MB.'
            }
            $fileName = ('{0}{1}' -f ([guid]::NewGuid().ToString('N')), $ext)
            $target = Join-Path $ImageDir $fileName
            if (-not (Test-ImageSignature $bytes $ext)) { throw 'HTTP400:The uploaded file does not match its image type.' }
            Write-ImageSafely $target $bytes
            $modified = [string]$body.lastModified
            if (-not [string]::IsNullOrWhiteSpace($modified)) {
                try { [System.IO.File]::SetLastWriteTime($target, ([datetime]::Parse($modified)).ToLocalTime()) } catch {}
            }
            if (-not [string]::IsNullOrWhiteSpace([string]$body.oldImage)) {
                $currentPromptJson = Read-CurrentPromptJson
                if (-not (Test-PromptReferencesImage $currentPromptJson ([string]$body.oldImage))) {
                    Remove-Image ([string]$body.oldImage)
                }
            }
            $written = (Get-Item -LiteralPath $target).LastWriteTime.ToString('o')
            Send-Json $Context @{ ok = $true; image = "images/$fileName"; modified = $written }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/delete-image') {
            Assert-AuthorizedMutation $request
            $bodyText = Read-Body $request 1MB
            if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
                try { $body = $bodyText | ConvertFrom-Json -ErrorAction Stop }
                catch { throw 'HTTP400:Delete body must be valid JSON.' }
                $currentPromptJson = Read-CurrentPromptJson
                if (Test-PromptReferencesImage $currentPromptJson ([string]$body.image)) {
                    throw 'HTTP409:Refused to delete an image that is still referenced by prompt data.'
                }
                Remove-Image ([string]$body.image)
            }
            Send-Json $Context @{ ok = $true }
            return $true
        }

        if ($method -eq 'GET' -and $path.StartsWith('/data/images/', [System.StringComparison]::OrdinalIgnoreCase)) {
            $rel = [uri]::UnescapeDataString($path.Substring('/data/'.Length))
            $file = Resolve-SafeImagePath $rel
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
                Send-Error $Context 'Image not found.' 404
                return $true
            }
            Send-Bytes $Context ([System.IO.File]::ReadAllBytes($file)) (Get-ContentType $file)
            return $true
        }

        Send-Error $Context 'Not found.' 404
        return $true
    }
    catch {
        $message = [string]$_.Exception.Message
        $status = 500
        if ($message -match '^HTTP(?<status>\d{3}):(?<text>.*)$') {
            $status = [int]$Matches['status']
            $message = $Matches['text']
        }
        Send-Error $Context $message $status
        return $true
    }
}

Ensure-Storage
Recover-PendingTransactions

if (-not $NoBrowser -and (Test-Path -LiteralPath $PortPath)) {
    $existingPortText = (Get-Content -LiteralPath $PortPath -Raw -ErrorAction SilentlyContinue).Trim()
    $existingPort = 0
    if ([int]::TryParse($existingPortText, [ref]$existingPort) -and $existingPort -ge 47350 -and $existingPort -le 47370) {
        if (Test-LocalServer $existingPort) {
            $existingUrl = "http://127.0.0.1:$existingPort/"
            Write-Log "MYP already running at $existingUrl"
            Open-Browser $existingUrl
            exit 0
        }
    }
    Remove-Item -LiteralPath $PortPath -Force -ErrorAction SilentlyContinue
}

$listener = [System.Net.HttpListener]::new()
$port = $null
foreach ($candidate in 47350..47370) {
    $listener.Prefixes.Clear()
    $prefix = "http://127.0.0.1:$candidate/"
    $listener.Prefixes.Add($prefix)
    try {
        $listener.Start()
        $port = $candidate
        break
    }
    catch { continue }
}

if ($null -eq $port) {
    Write-Log 'No available local port.'
    throw 'No available local port.'
}

$url = "http://127.0.0.1:$port/"
$ServerOrigin = $url.TrimEnd('/')
$SessionToken = New-SessionToken
$ServerInstanceId = [guid]::NewGuid().ToString('N')
Set-Content -LiteralPath $PortPath -Value $port -Encoding ASCII
Write-Log "MYP started at $url"
if (-not $NoBrowser) { Open-Browser $url }

$running = $true
$pendingContext = $null
try {
    while ($running) {
        if ($null -ne $script:ShutdownDeadline -and [datetime]::UtcNow -ge $script:ShutdownDeadline) {
            Write-Log ("MYP stopped after the last browser tab remained closed for {0} seconds." -f $script:ClientCloseDelaySeconds)
            break
        }

        try {
            if ($null -eq $pendingContext) { $pendingContext = $listener.GetContextAsync() }
            if (-not $pendingContext.Wait(250)) { continue }
            $context = $pendingContext.GetAwaiter().GetResult()
            $pendingContext = $null
        }
        catch {
            Write-Log ("Listener stopped before accepting a request: {0}" -f $_.Exception.Message)
            break
        }

        try { $running = [bool](Handle-Request $context) }
        catch {
            Write-Log ("Unhandled request error: {0}" -f $_.Exception.Message)
            try { Send-Error $context 'Internal server error.' 500 } catch {}
            $running = $true
        }
    }
}
finally {
    try { if ($listener.IsListening) { $listener.Stop() } } catch {}
    try { $listener.Close() } catch {}
    Remove-Item -LiteralPath $PortPath -Force -ErrorAction SilentlyContinue
    Write-Log 'MYP stopped.'
}
