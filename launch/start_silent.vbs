Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
serverScript = rootDir & "\server\MYP.ps1"

shell.CurrentDirectory = rootDir
shell.Run """" & powershellPath & """ -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File """ & serverScript & """", 0, False
