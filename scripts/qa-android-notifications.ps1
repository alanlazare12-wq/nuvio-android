param([Parameter(Mandatory = $true)][string]$Serial, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
} elseif ($env:ANDROID_SDK_ROOT) {
    $env:ANDROID_SDK_ROOT
} elseif ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'Android/Sdk'
} elseif ($env:USERPROFILE) {
    Join-Path $env:USERPROFILE 'AppData/Local/Android/Sdk'
} else {
    throw 'No se pudo localizar el Android SDK.'
}
$adb = Join-Path $sdk 'platform-tools/adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw "No se encontró ADB en $sdk." }
$java = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE 'Java') -Directory | Where-Object Name -Like 'jdk-17*' | Select-Object -First 1
if (-not $java) { throw 'Se necesita JDK 17.' }
$env:JAVA_HOME = $java.FullName
$deviceState = ((& $adb -s $Serial get-state 2>$null) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or $deviceState -ne 'device') { throw "El dispositivo Android '$Serial' no está disponible (estado: $deviceState)." }
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
$resultExitCode = $LASTEXITCODE
$result | Set-Content -LiteralPath (Join-Path $project 'qa/android-notification-tests.log')
$result
if ($resultExitCode -ne 0 -or ($result -join "`n") -notmatch 'NUVIO_NOTIFICATION_TESTS_PASSED') { throw 'Fallaron las pruebas de notificaciones.' }
& $adb -s $Serial pull "/sdcard/Android/data/$fixture/files/background-progress.png" (Join-Path $project 'qa/android-background-progress.png')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo recuperar la captura del progreso en segundo plano.' }
& $adb -s $Serial shell pm revoke $fixture android.permission.POST_NOTIFICATIONS
$denied = & $adb -s $Serial shell am instrument -w -r -e permission denied "$fixture.test/com.nuvio.notificationqa.NotificationInstrumentation"
$deniedExitCode = $LASTEXITCODE
$denied | Set-Content -LiteralPath (Join-Path $project 'qa/android-notification-denied-tests.log')
$denied
& $adb -s $Serial shell pm grant $fixture android.permission.POST_NOTIFICATIONS
if ($LASTEXITCODE -ne 0) { throw 'No se pudo restaurar el permiso de notificaciones después del caso denegado.' }
if ($deniedExitCode -ne 0 -or ($denied -join "`n") -notmatch 'NUVIO_NOTIFICATION_TESTS_PASSED') { throw 'Fallo el caso con permiso denegado.' }
