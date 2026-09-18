param([ValidateSet('aarch64')][string]$Target = 'aarch64', [switch]$ReuseBuiltRust)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$signing = Join-Path $project '.release-signing'
$keystore = Join-Path $signing 'nuvio-android.jks'
$passwordFile = Join-Path $signing 'android-password.txt'
if (-not (Test-Path -LiteralPath $keystore) -or -not (Test-Path -LiteralPath $passwordFile)) {
    throw 'Se necesita la firma existente de Nuvio. No se generara otra clave de forma automatica.'
}
$javaDir = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE 'Java') -Directory | Where-Object Name -Like 'jdk-17*' | Select-Object -First 1
if (-not $javaDir) { throw 'Se necesita JDK 17.' }
$output = Join-Path $project 'release/GooglePlay'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$oldPassword = $env:NUVIO_ANDROID_KEY_PASSWORD
$oldKeystore = $env:NUVIO_ANDROID_KEYSTORE
try {
    $env:NUVIO_ANDROID_KEY_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
    $env:NUVIO_ANDROID_KEYSTORE = $keystore
    $bundleRoot = Join-Path $project 'src-tauri/gen/android/app/build/outputs/bundle'
    Remove-Item -LiteralPath $bundleRoot -Recurse -Force -ErrorAction SilentlyContinue
    Push-Location $project
    try {
        if ($ReuseBuiltRust) {
            & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-android.ps1 -Target $Target -ReuseBuiltRust
            if ($LASTEXITCODE -ne 0) { throw 'La validación previa del APK ARM64 reutilizable falló.' }
            $sdk = if ($env:ANDROID_HOME) {
                $env:ANDROID_HOME
            } elseif ($env:ANDROID_SDK_ROOT) {
                $env:ANDROID_SDK_ROOT
            } elseif ($env:LOCALAPPDATA) {
                Join-Path $env:LOCALAPPDATA 'Android/Sdk'
            } else {
                Join-Path $env:USERPROFILE 'AppData/Local/Android/Sdk'
            }
            $env:ANDROID_HOME = $sdk
            $env:ANDROID_SDK_ROOT = $sdk
            $env:JAVA_HOME = $javaDir.FullName
            Push-Location (Join-Path $project 'src-tauri/gen/android')
            try {
                & ./gradlew.bat :app:bundleArm64Release -x :app:rustBuildArm64Release --console=plain
                if ($LASTEXITCODE -ne 0) { throw 'No se pudo empaquetar el AAB ARM64 reutilizando la librería Rust release.' }
            } finally { Pop-Location }
        } else {
            & node scripts/tauri-android.mjs build --aab --apk --target $Target --ci
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el AAB.' }
        }
    } finally { Pop-Location }
    $bundle = Get-ChildItem -LiteralPath $bundleRoot -Recurse -Filter '*.aab' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $bundle) { throw 'No se genero ningun AAB nuevo.' }
    $verification = & (Join-Path $javaDir.FullName 'bin/jarsigner.exe') '-J-Duser.language=en' -verify -verbose -certs $bundle.FullName 2>&1
    $verification | Set-Content -LiteralPath (Join-Path $output 'aab-signature.txt')
    if ($LASTEXITCODE -ne 0 -or ($verification -join "`n") -notmatch 'jar verified\.') { throw 'No se pudo verificar la firma del AAB.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($bundle.FullName)
    try {
        foreach ($entry in @('BundleConfig.pb', 'base/manifest/AndroidManifest.xml', 'base/lib/arm64-v8a/libnuviodrive_v1_lib.so', 'base/lib/arm64-v8a/libtdjson.so')) {
            if (-not $archive.GetEntry($entry)) { throw "AAB incompleto: falta $entry" }
        }
    } finally { $archive.Dispose() }
    & (Join-Path $javaDir.FullName 'bin/keytool.exe') -exportcert -rfc -keystore $keystore -storepass:env NUVIO_ANDROID_KEY_PASSWORD -alias nuvio -file (Join-Path $output 'Nuvio-upload-certificate.pem')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo exportar el certificado publico.' }
    $destination = Join-Path $output "Nuvio-GooglePlay-$Target.aab"
    Copy-Item -LiteralPath $bundle.FullName -Destination $destination -Force
    Get-FileHash -LiteralPath $destination -Algorithm SHA256 | Format-List | Out-File -LiteralPath (Join-Path $output 'SHA256.txt')
    Write-Output "AAB firmado para Play Console: $destination"
} finally {
    $env:NUVIO_ANDROID_KEY_PASSWORD = $oldPassword
    $env:NUVIO_ANDROID_KEYSTORE = $oldKeystore
}
