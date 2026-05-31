' Desktop icon: start the server if needed, then open the app in the browser. No window.
Set sh = CreateObject("WScript.Shell")
Dim q : q = Chr(34)
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & q & "C:\Projects\study-suport\ss-open.ps1" & q, 0, True
