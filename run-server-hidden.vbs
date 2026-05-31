' Start the Study Support server hidden (called from logon autostart).
' Launch PowerShell hidden; its Start-Process detaches the server so it keeps running.
' wait=True (3rd arg) avoids the async child being killed when this host exits.
Set sh = CreateObject("WScript.Shell")
Dim q : q = Chr(34)
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & q & "C:\Projects\study-suport\ss-start.ps1" & q, 0, True
