$base = "https://maria-web-production.up.railway.app"
Write-Host "=== endpoints ==="
foreach ($u in @("/api/health","/api/config","/api/admin/config")) {
  try { $r = Invoke-WebRequest -Uri "$base$u" -UseBasicParsing; Write-Host ("[{0}] {1}" -f $r.StatusCode, $u) }
  catch { Write-Host ("[ERR {0}] {1}" -f $_.Exception.Response.StatusCode, $u) }
}
Write-Host "=== chat ==="
try {
  $r = Invoke-WebRequest -Uri "$base/api/chat" -Method POST -ContentType "application/json" -Body '{"question":"What can I do in Siruma?"}' -UseBasicParsing
  Write-Host ("[{0}] /api/chat -> {1}" -f $r.StatusCode, $r.Content.Substring(0,[Math]::Min($r.Content.Length,300)))
} catch { Write-Host "[ERR]" }
Write-Host "=== tts ==="
try {
  $r = Invoke-WebRequest -Uri "$base/api/tts" -Method POST -ContentType "application/json" -Body '{"text":"Hello,"}' -UseBasicParsing
  Write-Host ("[{0}] /api/tts -> {1}" -f $r.StatusCode, $r.Content)
} catch { Write-Host "[ERR]" }
Write-Host "=== avatar ==="
try {
  $r = Invoke-WebRequest -Uri "$base/api/avatar" -UseBasicParsing
  Write-Host ("[{0}] /api/avatar -> length={1}" -f $r.StatusCode, $r.Content.Length)
} catch { Write-Host "[ERR]" }
Write-Host "=== config voices ==="
try {
  $r = Invoke-WebRequest -Uri "$base/api/config" -UseBasicParsing
  $j = $r.Content | ConvertFrom-Json
  $j.voices | ForEach-Object { Write-Host ("{0} | {1} | {2}" -f $_.id, $_.label, $_.provider) }
} catch { Write-Host "[ERR]" }
