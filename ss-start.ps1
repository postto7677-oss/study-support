# Study Support サーバーを「未起動なら」非表示で常駐起動する。
# Start-Process で起動したプロセスは親終了後も生き続ける（確実にデタッチ）。
$up = $false
try { $null = Invoke-WebRequest 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2; $up = $true } catch {}
if (-not $up) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','"C:\Projects\study-suport\server.bat"' -WindowStyle Hidden -WorkingDirectory 'C:\Projects\study-suport'
}
