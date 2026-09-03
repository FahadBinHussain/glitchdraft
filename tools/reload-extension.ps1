# reloads the unpacked GlitchDraft extension INCLUDING manifest.json changes.
# (same pattern as blindspot tools/reload-extension.ps1: Extensions Reloader
# only toggles management.setEnabled and never re-reads the manifest, so
# manifest bumps used to need a manual edge://extensions click. this opens the
# loader page, which messages bg to blank its tab + self-reload.)
$extId = "aimiggpljpaaboligendncoficimnmpd"
Start-Process "msedge" -ArgumentList "chrome-extension://$extId/reload.html"
