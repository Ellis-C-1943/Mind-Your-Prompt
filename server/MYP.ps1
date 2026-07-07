param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$DataDir = Join-Path $RootDir 'DATA'
$ImageDir = Join-Path $DataDir 'images'
$RuntimeDir = Join-Path $RootDir 'RUNTIME'
$DbPath = Join-Path $DataDir 'prompts.json'
$IndexPath = Join-Path $RootDir 'index.html'
$AssetsDir = Join-Path $RootDir 'assets'
$LogPath = Join-Path $RuntimeDir 'server.log'
$PortPath = Join-Path $RuntimeDir 'server.port'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$MaxImageBytes = 80MB
$IdleTimeoutSeconds = 20

function Write-Utf8File {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

function Ensure-Storage {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ImageDir | Out-Null
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    if (-not (Test-Path -LiteralPath $DbPath)) {
        Write-Utf8File $DbPath '[]'
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
    param($Request)
    $reader = [System.IO.StreamReader]::new($Request.InputStream, [System.Text.Encoding]::UTF8)
    try { return $reader.ReadToEnd() }
    finally { $reader.Dispose() }
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
    $json = $Object | ConvertTo-Json -Depth 20
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
    if ([string]::IsNullOrWhiteSpace($RelativePath)) { throw 'Empty path.' }
    $clean = $RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar).TrimStart([System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $BaseDir $clean))
    $root = [System.IO.Path]::GetFullPath($BaseDir)
    if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $root += [System.IO.Path]::DirectorySeparatorChar
    }
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Blocked unsafe path.'
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
        throw 'Only DATA/images paths are allowed.'
    }
    return Resolve-SafePath $DataDir $relative
}

function Remove-Image {
    param([string]$RelativeImage)
    if ([string]::IsNullOrWhiteSpace($RelativeImage)) { return }
    try {
        $path = Resolve-SafeImagePath $RelativeImage
        $imageRoot = [System.IO.Path]::GetFullPath($ImageDir)
        if (-not $imageRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
            $imageRoot += [System.IO.Path]::DirectorySeparatorChar
        }
        if ((Test-Path -LiteralPath $path) -and ($path.StartsWith($imageRoot, [System.StringComparison]::OrdinalIgnoreCase))) {
            Remove-Item -LiteralPath $path -Force
        }
    } catch {
        Write-Log ("Skipped unsafe image delete: {0}" -f $_.Exception.Message)
    }
}

function Handle-Request {
    param($Context)
    $request = $Context.Request
    $path = $request.Url.AbsolutePath
    $method = $request.HttpMethod.ToUpperInvariant()

    try {
        if ($method -eq 'GET' -and $path -eq '/api/health') {
            Send-Json $Context @{ ok = $true; app = 'MYP' }
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

        if ($method -eq 'GET' -and $path -eq '/api/prompts') {
            Ensure-Storage
            $json = Get-Content -LiteralPath $DbPath -Raw -Encoding UTF8
            if ([string]::IsNullOrWhiteSpace($json)) { $json = '[]' }
            Send-Text $Context $json 'application/json; charset=utf-8'
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/prompts') {
            Ensure-Storage
            $body = Read-Body $request
            if ([string]::IsNullOrWhiteSpace($body)) { $body = '[]' }
            $null = $body | ConvertFrom-Json
            Write-Utf8File $DbPath $body
            Send-Json $Context @{ ok = $true }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/image') {
            Ensure-Storage
            $body = Read-Body $request | ConvertFrom-Json
            $ext = [System.IO.Path]::GetExtension([string]$body.name).ToLowerInvariant()
            if (@('.jpg', '.jpeg', '.png') -notcontains $ext) {
                throw 'Only JPG, JPEG, and PNG images are supported.'
            }
            $data = [string]$body.data
            $data = $data -replace '^data:[^,]*base64,', ''
            $bytes = [Convert]::FromBase64String($data)
            if ($bytes.Length -gt $MaxImageBytes) {
                throw 'Image is too large. Maximum size is 80MB.'
            }
            $fileName = ('{0}{1}' -f ([guid]::NewGuid().ToString('N')), $ext)
            $target = Join-Path $ImageDir $fileName
            [System.IO.File]::WriteAllBytes($target, $bytes)
            $modified = [string]$body.lastModified
            if (-not [string]::IsNullOrWhiteSpace($modified)) {
                try { [System.IO.File]::SetLastWriteTime($target, ([datetime]::Parse($modified)).ToLocalTime()) } catch {}
            }
            Remove-Image ([string]$body.oldImage)
            $written = (Get-Item -LiteralPath $target).LastWriteTime.ToString('o')
            Send-Json $Context @{ ok = $true; image = "images/$fileName"; modified = $written }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/delete-image') {
            $body = Read-Body $request
            if (-not [string]::IsNullOrWhiteSpace($body)) {
                $json = $body | ConvertFrom-Json
                Remove-Image ([string]$json.image)
            }
            Send-Json $Context @{ ok = $true }
            return $true
        }

        if ($method -eq 'POST' -and $path -eq '/api/shutdown') {
            Send-Json $Context @{ ok = $true }
            return $false
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
        Send-Error $Context $_.Exception.Message 500
        return $true
    }
}

Ensure-Storage

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
Set-Content -LiteralPath $PortPath -Value $port -Encoding ASCII
Write-Log "MYP started at $url"
if (-not $NoBrowser) { Open-Browser $url }

$running = $true
$lastRequest = Get-Date
try {
    while ($running) {
        try { $async = $listener.BeginGetContext($null, $null) }
        catch {
            Write-Log ("Listener stopped before accepting a request: {0}" -f $_.Exception.Message)
            break
        }

        while (-not $async.AsyncWaitHandle.WaitOne(1000)) {
            if (((Get-Date) - $lastRequest).TotalSeconds -gt $IdleTimeoutSeconds) {
                $running = $false
                break
            }
        }
        if (-not $running) { break }

        try { $context = $listener.EndGetContext($async) }
        catch {
            Write-Log ("Failed to receive request: {0}" -f $_.Exception.Message)
            continue
        }

        $lastRequest = Get-Date
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
