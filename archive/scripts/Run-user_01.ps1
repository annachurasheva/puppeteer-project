# Run-user_01.ps1 — обёртка: чистый Edge c CDP, сущность user_01, порт 9226.
# Делегирует RunEdgeCdp.ps1 (профиль ВСЕГДА вне репо, чистота по доказанному v03).
& "$PSScriptRoot\RunEdgeCdp.ps1" -Profile user_01
