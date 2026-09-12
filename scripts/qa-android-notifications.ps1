param([Parameter(Mandatory = $true)][string]$Serial, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$java = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE 'Java') -Directory | Where-Object Name -Like 'jdk-17*' | Select-Object -First 1
$env:JAVA_HOME = $java.FullName
$env:ANDROID_HOME = $sdk
$android = Join-Path $project 'src-tauri/gen/android'
if (-not $SkipBuild) {
    Push-Location $android
    try {
        & ./gradlew.bat -PnotificationQa :notification-qa:assembleDebug :notification-qa:assembleDebugAndroidTest --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la prueba de notificaciones.' }
    } finally { Pop-Location }
}
$fixture = 'com.nuvio.notificationqa'
& $adb -s $Serial install -r (Join-Path $android 'notification-qa/build/outputs/apk/debug/notification-qa-debug.apk')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el fixture.' }
& $adb -s $Serial install -r (Join-Path $android 'notification-qa/build/outputs/apk/androidTest/debug/notification-qa-debug-androidTest.apk')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar la instrumentacion.' }
& $adb -s $Serial shell pm grant $fixture android.permission.POST_NOTIFICATIONS
& $adb -s $Serial shell input keyevent 82
$result = & $adb -s $Serial shell am instrument -w -r "$fixture.test/com.nuvio.notificationqa.NotificationInstrumentation"
$result | Set-Content -LiteralPath (Join-Path $project 'qa/android-notification-tests.log')
$result
if ($LASTEXITCODE -ne 0 -or ($result -join "`n") -notmatch 'NUVIO_NOTIFICATION_TESTS_PASSED') { throw 'Fallaron las pruebas de notificaciones.' }
& $adb -s $Serial pull "/sdcard/Android/data/$fixture/files/background-progress.png" (Join-Path $project 'qa/android-background-progress.png')
& $adb -s $Serial shell pm revoke $fixture android.permission.POST_NOTIFICATIONS
$denied = & $adb -s $Serial shell am instrument -w -r -e permission denied "$fixture.test/com.nuvio.notificationqa.NotificationInstrumentation"
$denied | Set-Content -LiteralPath (Join-Path $project 'qa/android-notification-denied-tests.log')
$denied
& $adb -s $Serial shell pm grant $fixture android.permission.POST_NOTIFICATIONS
if (($denied -join "`n") -notmatch 'NUVIO_NOTIFICATION_TESTS_PASSED') { throw 'Fallo el caso con permiso denegado.' }
