# RunEdgeCdp.ps1 — чистый Edge c CDP для тестов ok.ru.
#Requires -Version 7.0
param(
    [ValidateSet("s_admin","admin","moderator","editor","user_01")]
    [string]$Profile = "user_01"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Профиль — ВСЕГДА вне репо. Чистота — по доказанному v03.
$ports = @{ s_admin=9222; admin=9223; moderator=9224; editor=9225; user_01=9226 }
$Port = $ports[$Profile]

# Фолбэк (TASK-0162): ищем msedge.exe в трёх стандартных путях, берём первый найденный.
$EdgeCandidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
)
$EdgePath = $EdgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$ProfileDir = "C:\Users\An\serv6675\Edge_test_ok\$Profile\"
$DistDir    = Join-Path $PSScriptRoot ".." "dist"
$repoRoot   = Split-Path -Parent $PSScriptRoot

# Страховка: профиль внутри репо — физически невозможен.
if ($ProfileDir -like "$repoRoot*") {
    Write-Error "Профиль внутри репо запрещён"; exit 1
}
if (-not $EdgePath -or -not (Test-Path $EdgePath)) {
    Write-Error "Не найден Edge ни в одном из путей: $($EdgeCandidates -join ', ')"; exit 1
}
if (-not (Test-Path (Join-Path $DistDir "manifest.json"))) {
    Write-Error "dist/ без расширения: сначала pwsh scripts/Build.ps1"; exit 1
}
if (-not (Test-Path $ProfileDir)) {
    Write-Host "Создаю профиль: $ProfileDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}

# Чистка (безопасно): только кэши. НЕ ТРОГАТЬ:
# Local Extension Settings (БАЗА КАРТОЧЕК!), Local Storage.
# Preferences правится точечно (TASK-0167) — только extensions.ui.developer_mode.
foreach ($p in @("$ProfileDir\Default\Cache","$ProfileDir\Default\Code Cache",
    "$ProfileDir\Default\GPUCache","$ProfileDir\Default\ShaderCache",
    "$ProfileDir\Default\Service Worker\CacheStorage")) {
    if (Test-Path $p) {
        Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Вычищено: $p" -ForegroundColor DarkGray
    }
}

# Developer mode по умолчанию (TASK-0167): расширения ставятся без танцев с
# «Режимом разработчика» в edge://extensions. Preferences существует —
# точечно дополняем (остальное НЕ перезаписываем); не существует — минимальный json.
$PrefsDir  = Join-Path $ProfileDir 'Default'
$PrefsPath = Join-Path $PrefsDir 'Preferences'
if (-not (Test-Path $PrefsDir)) {
    New-Item -ItemType Directory -Path $PrefsDir -Force | Out-Null
}
$prefs = @{}
if (Test-Path $PrefsPath) {
    try {
        $rawPrefs = Get-Content -LiteralPath $PrefsPath -Raw -ErrorAction Stop
        $parsed   = $rawPrefs | ConvertFrom-Json -AsHashtable -ErrorAction Stop
        if ($parsed -is [System.Collections.IDictionary]) { $prefs = $parsed }
    } catch {
        Write-Host "Предупреждение: Preferences не читается — создаю минимальный" -ForegroundColor Yellow
        $prefs = @{}
    }
}
if (-not $prefs.ContainsKey('extensions')) { $prefs['extensions'] = @{} }
if (-not ($prefs['extensions'] -is [System.Collections.IDictionary])) { $prefs['extensions'] = @{} }
if (-not $prefs['extensions'].ContainsKey('ui')) { $prefs['extensions']['ui'] = @{} }
if (-not ($prefs['extensions']['ui'] -is [System.Collections.IDictionary])) { $prefs['extensions']['ui'] = @{} }
$prefs['extensions']['ui']['developer_mode'] = $true
$prefs | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $PrefsPath -Encoding utf8 -NoNewline
Write-Host "Developer mode: включён ($PrefsPath)" -ForegroundColor DarkGray

$edgeArgs = @(
    "--user-data-dir=$ProfileDir", '--no-first-run',
    '--no-default-browser-check', '--disable-component-update',
    '--start-maximized', '--disk-cache-size=1', '--media-cache-size=1',
    '--aggressive-cache-discard', '--disable-features=BackForwardCache',
    '--disable-session-crashed-bubble', "--remote-debugging-port=$Port",
    "--disable-extensions-except=$DistDir", "--load-extension=$DistDir"
)

Write-Host "Сущность: $Profile · порт: $Port" -ForegroundColor Cyan
Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs
Write-Host "Edge чист: наше расширение из dist, CDP localhost:$Port" -ForegroundColor Green
Write-Host 'ВАЖНО: после Reload расширения — F5 на вкладках ok.ru.' -ForegroundColor Yellow
