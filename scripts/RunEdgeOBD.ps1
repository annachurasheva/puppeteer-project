# RunEdgeOBD.ps1 — чистый Edge c CDP для парсера OBD Memorial (obd-memorial.ru).
# Запускает Edge отдельным процессом с remote-debugging-port=9226.
# Профиль: user_01 (ВСЕГДА вне репо).
#Requires -Version 7.0
param(
    [int]$Port = 9226,
    [string]$Profile = "user_01"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Фолбэк: ищем msedge.exe в трёх стандартных путях, берём первый найденный.
$EdgeCandidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
)
$EdgePath = $EdgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

# Профиль — ВСЕГДА вне репо (чистота, как в прежней схеме).
# ВАЖНО: путь профиля задаётся здесь под конкретный ПК.
$ProfileDir = "C:\Users\$env:USERNAME\serv6675\Edge_OBD\$Profile\"
$repoRoot   = Split-Path -Parent $PSScriptRoot

# Страховка: профиль внутри репо — физически невозможен.
if ($ProfileDir -like "$repoRoot*") {
    Write-Error "Профиль внутри репо запрещён"; exit 1
}
if (-not $EdgePath -or -not (Test-Path $EdgePath)) {
    Write-Error "Не найден Edge ни в одном из путей: $($EdgeCandidates -join ', '); exit 1"
}
if (-not (Test-Path $ProfileDir)) {
    Write-Host "Создаю профиль: $ProfileDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}

# Чистка кэшей (безопасно): только Cache/Code Cache/GPUCache/ShaderCache.
# НЕ трогаем Local Storage / данные профиля.
foreach ($p in @("$ProfileDir\Default\Cache", "$ProfileDir\Default\Code Cache",
    "$ProfileDir\Default\GPUCache", "$ProfileDir\Default\ShaderCache")) {
    if (Test-Path $p) {
        Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Вычищено: $p" -ForegroundColor DarkGray
    }
}

$edgeArgs = @(
    "--user-data-dir=$ProfileDir", '--no-first-run',
    '--no-default-browser-check', '--disable-component-update',
    '--start-maximized', '--disk-cache-size=1', '--media-cache-size=1',
    '--aggressive-cache-discard', '--disable-features=BackForwardCache',
    '--disable-session-crashed-bubble', "--remote-debugging-port=$Port",
    'https://obd-memorial.ru'
)

Write-Host "Сущность: $Profile · порт: $Port" -ForegroundColor Cyan
Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs
Write-Host "Edge запущен: CDP localhost:$Port, профиль $Profile" -ForegroundColor Green
Write-Host "Затем запустите: node obd-edge.js" -ForegroundColor Yellow