# KB-407: a message box that stays on screen until the owner dismisses it. Called by backup.ts (detached) when a
# backup fails or the last success is too old. No secrets are ever passed in (backup.ts redacts the message).
param(
  [string]$Title = "KiranaBill backup",
  [string]$Message = ""
)
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show($Message, $Title, 'OK', 'Warning') | Out-Null
