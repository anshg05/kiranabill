# D117 (owner, 19 Nov 2026): build a release APK signed with the release key. The password is typed (or pasted) at a hidden prompt,
# lives only in this PowerShell process and the one Gradle run it starts, and is cleared afterwards. Nothing secret is written to disk.
#   & .\scripts\release-apk.ps1 -Flavor kvbtest    (the release-signed test app "KVB Test")
#   & .\scripts\release-apk.ps1 -Flavor prod       (the real app; run `npx cap sync android` after the right web build first)
param(
  [ValidateSet("prod", "kvbtest")][string]$Flavor = "prod",
  [string]$Keystore = "$HOME\KVB-keys\kirana-voice-bill-release.jks"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Keystore)) { throw "No release key at $Keystore" }
$task = "assemble" + $Flavor.Substring(0, 1).ToUpper() + $Flavor.Substring(1) + "Release"
$secure = Read-Host -AsSecureString "Release key password"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:KVB_RELEASE_KEYSTORE = $Keystore
  $env:KVB_RELEASE_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:JAVA_HOME = "E:\Android\jdk-21"
  Push-Location (Join-Path $PSScriptRoot "..\android")
  try {
    .\gradlew.bat $task --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($task)" }
  } finally {
    .\gradlew.bat --stop | Out-Null
    Pop-Location
  }
  Write-Host "Built: android\app\build\outputs\apk\$Flavor\release\app-$Flavor-release.apk"
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:KVB_RELEASE_STORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:KVB_RELEASE_KEYSTORE -ErrorAction SilentlyContinue
}
