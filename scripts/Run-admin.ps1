# Run-admin.ps1 — обёртка: чистый Edge c CDP, сущность admin, порт 9223.
# Делегирует RunEdgeCdp.ps1 (профиль ВСЕГДА вне репо, чистота по доказанному v03).
& "$PSScriptRoot\RunEdgeCdp.ps1" -Profile admin
