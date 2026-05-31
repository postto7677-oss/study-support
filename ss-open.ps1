# デスクトップアイコン用：サーバーを（必要なら）起動し、ブラウザでアプリを開く。
$up = $false
try { $null = Invoke-WebRequest 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2; $up = $true } catch {}
if (-not $up) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','"C:\Projects\study-suport\server.bat"' -WindowStyle Hidden -WorkingDirectory 'C:\Projects\study-suport'
  # サーバーの立ち上がりを待つ（最大15秒）
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try { $null = Invoke-WebRequest 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2; break } catch {}
  }
}
Start-Process 'http://localhost:5173/'
