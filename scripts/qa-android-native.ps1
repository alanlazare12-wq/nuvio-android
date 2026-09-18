param([Parameter(Mandatory = $true)][string]$Serial)
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
$deviceState = ((& $adb -s $Serial get-state 2>$null) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or $deviceState -ne 'device') { throw "El dispositivo Android '$Serial' no está disponible (estado: $deviceState)." }
$env:JAVA_HOME = $java.FullName
$env:ANDROID_HOME = $sdk
$keystore = Join-Path $project '.release-signing/nuvio-android.jks'
$passwordFile = Join-Path $project '.release-signing/android-password.txt'
if (-not (Test-Path -LiteralPath $keystore) -or -not (Test-Path -LiteralPath $passwordFile)) {
    throw 'Falta la firma Android de release; la QA nativa nunca debe crear o sustituir la clave de publicación.'
}
$env:NUVIO_ANDROID_KEYSTORE = $keystore
$env:NUVIO_ANDROID_KEY_PASSWORD = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
try {
    Push-Location (Join-Path $project 'src-tauri/gen/android')
    try {
        & ./gradlew.bat :app:assembleArm64Release :app:assembleArm64ReleaseAndroidTest -x :app:rustBuildArm64Release --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la instrumentación Android.' }
    } finally { Pop-Location }
    # Repackage against the same R8 mapping used to compile the instrumentation.
    # Rust/JNI must already have been built with package-android.ps1.
    & (Join-Path $PSScriptRoot 'package-android.ps1') -VerifyOnly
    $tests = @(Get-ChildItem -LiteralPath (Join-Path $project 'src-tauri/gen/android/app/build/outputs/apk/androidTest/arm64/release') -Filter '*.apk')
    if ($tests.Count -ne 1) { throw 'Se esperaba un único APK de instrumentación ARM64 release.' }
    & $adb -s $Serial install -r (Join-Path $project 'release/Android/Nuvio-Android-aarch64.apk')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el APK de distribución.' }
    & $adb -s $Serial install -r $tests[0].FullName
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar la instrumentación.' }
    & $adb -s $Serial shell mkdir -p /sdcard/Download/Nuvio-QA
    Write-Output 'En el selector de Android, elige Download/Nuvio-QA y concede acceso. La prueba borra únicamente sus archivos temporales.'
    $result = & $adb -s $Serial shell am instrument -w -r com.nuvio.drive.test/com.nuvio.drive.NativeStorageInstrumentation
    $resultExitCode = $LASTEXITCODE
    $result | Set-Content -LiteralPath (Join-Path $project 'qa/android-native-tests.log')
    $result
    if ($resultExitCode -ne 0 -or ($result -join "`n") -notmatch 'NUVIO_NATIVE_TESTS_PASSED') { throw 'La prueba nativa de Android no pasó.' }
} finally {
    $env:NUVIO_ANDROID_KEY_PASSWORD = $null
}
