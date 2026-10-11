# KB-407 (D75): registers the two Windows scheduled tasks for the backup. Run ONCE by the owner, in his own
# PowerShell window (a normal one - no administrator needed):
#
#   powershell -ExecutionPolicy Bypass -File scripts\backup\install-task.ps1            # install
#   powershell -ExecutionPolicy Bypass -File scripts\backup\install-task.ps1 -DryRun    # show what it WOULD do
#   powershell -ExecutionPolicy Bypass -File scripts\backup\install-task.ps1 -Remove    # undo
#
# Task 1 "KiranaBill Backup": 13:00 daily AND at every logon, only when you are signed in. The program itself skips the
#   run if a backup is under 20 hours old, so it never backs up twice in a day. Asleep at 13:00 -> it runs when the
#   laptop wakes; off -> at your next logon. If it fails it retries every 30 minutes, up to 6 times.
# Task 2 "KiranaBill Backup Check": 30 minutes after logon and at 18:00; shows a message box if the last good backup
#   is more than 36 hours old.
param(
  [switch]$Remove,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
$tsx = Join-Path $repo "node_modules\tsx\dist\cli.mjs"
$names = @("KiranaBill Backup", "KiranaBill Backup Check")

if ($Remove) {
  foreach ($n in $names) {
    if ($DryRun) { Write-Host "would remove task '$n'"; continue }
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false; Write-Host "removed '$n'" }
  }
  exit 0
}

if (-not (Test-Path $tsx)) { throw "Cannot find $tsx - run 'npm install' in $repo first." }
$cfg = Join-Path $env:APPDATA "KiranaBillBackup\config.json"
if (-not (Test-Path $cfg)) { throw "No backup settings at $cfg - run scripts/backup/setup-key.sh first." }

function New-BackupAction([string]$flag) {
  New-ScheduledTaskAction -Execute $node -Argument "`"$tsx`" scripts\backup\backup.ts $flag" -WorkingDirectory $repo
}

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# Task 1
$logon1 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$daily1 = New-ScheduledTaskTrigger -Daily -At "13:00"
$settings1 = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RunOnlyIfNetworkAvailable -RestartCount 6 -RestartInterval (New-TimeSpan -Minutes 30) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$task1 = New-ScheduledTask -Action (New-BackupAction "--if-stale") -Trigger @($logon1, $daily1) -Settings $settings1 -Principal $principal `
  -Description "KiranaBill: daily encrypted backup of the production database to Google Drive (KB-407)."

# Task 2
$logon2 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$logon2.Delay = "PT30M"
$daily2 = New-ScheduledTaskTrigger -Daily -At "18:00"
$settings2 = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
$task2 = New-ScheduledTask -Action (New-BackupAction "--check-stale") -Trigger @($logon2, $daily2) -Settings $settings2 -Principal $principal `
  -Description "KiranaBill: warns if the last good backup is more than 36 hours old (KB-407)."

foreach ($pair in @(@($names[0], $task1), @($names[1], $task2))) {
  if ($DryRun) {
    Write-Host "would register '$($pair[0])':"
    Write-Host ($pair[1].Actions | ForEach-Object { "  run: $($_.Execute) $($_.Arguments)  (in $($_.WorkingDirectory))" })
    Write-Host ($pair[1].Triggers | ForEach-Object { "  trigger: $($_.CimClass.CimClassName)" })
    continue
  }
  Register-ScheduledTask -TaskName $pair[0] -InputObject $pair[1] -Force | Out-Null
  Write-Host "registered '$($pair[0])'"
}
if (-not $DryRun) { Write-Host "Done. To run the backup right now:  Start-ScheduledTask -TaskName 'KiranaBill Backup'  (or: npm run backup)" }
