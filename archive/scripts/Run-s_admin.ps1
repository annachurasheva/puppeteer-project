# Run-s_admin.ps1 — обёртка: чистый Edge c CDP, сущность s_admin, порт 9222.
# Делегирует RunEdgeCdp.ps1 (профиль ВСЕГДА вне репо, чистота по доказанному v03).
& "$PSScriptRoot\RunEdgeCdp.ps1" -Profile s_admin
