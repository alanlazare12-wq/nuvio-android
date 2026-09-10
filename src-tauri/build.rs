fn main() {
    println!("cargo:rerun-if-env-changed=NUVIO_TDLIB_DIR");
    if let Some(directory) = std::env::var_os("NUVIO_TDLIB_DIR") {
        link_local_windows_tdlib(std::path::Path::new(&directory));
    } else {
        tdlib_rs::build::build(None);
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        stage_android_tdlib();
    }
    tauri_build::build();
}

// TDLib's `static` feature embeds the C++ runtime; tdjson itself is still a
// shared library. Package it for both normal Gradle builds and no-symlink builds.
fn stage_android_tdlib() {
    use std::{fs, path::PathBuf};
    let abi = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64-v8a",
        "arm" => "armeabi-v7a",
        "x86" => "x86",
        "x86_64" => "x86_64",
        other => panic!("Unsupported Android architecture: {other}"),
    };
    let source = PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("tdlib/lib");
    assert!(
        source.join("libtdjson.so").is_file(),
        "TDLib Android SDK is missing libtdjson.so"
    );
    let destination = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("gen/android/app/src/main/jniLibs")
        .join(abi);
    fs::create_dir_all(&destination).expect("Create Android JNI directory");
    for entry in fs::read_dir(source).expect("Read Android TDLib SDK") {
        let entry = entry.unwrap();
        if entry.path().extension().is_some_and(|ext| ext == "so") {
            let bytes = fs::read(entry.path()).expect("Read Android runtime library");
            let target = destination.join(entry.file_name());
            if fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
                fs::write(target, bytes).expect("Include Android runtime library in APK");
            }
        }
    }
}

// An explicit local SDK lets Windows checks/builds run offline. The default
// downloader remains available when the SDK has not been supplied.
fn link_local_windows_tdlib(directory: &std::path::Path) {
    assert_eq!(
        std::env::var("CARGO_CFG_TARGET_OS").unwrap(),
        "windows",
        "NUVIO_TDLIB_DIR is currently supported for Windows targets only"
    );
    let directory = directory
        .canonicalize()
        .expect("NUVIO_TDLIB_DIR must point to an existing TDLib SDK");
    let library = directory.join("lib");
    let binaries = directory.join("bin");
    assert!(library.join("tdjson.lib").is_file() && binaries.join("tdjson.dll").is_file(),
        "NUVIO_TDLIB_DIR must contain lib/tdjson.lib and bin/tdjson.dll for the target architecture");
    println!("cargo:rerun-if-changed={}", directory.display());
    println!("cargo:rustc-link-search=native={}", library.display());
    println!("cargo:rustc-link-search=native={}", binaries.display());
    println!("cargo:rustc-link-lib=dylib=tdjson");
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let profile = out.ancestors().nth(3).expect("Cargo profile directory");
    for entry in std::fs::read_dir(&binaries).expect("Read local TDLib binaries") {
        let entry = entry.expect("Read TDLib binary");
        if entry
            .path()
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("dll"))
        {
            let bytes = std::fs::read(entry.path()).expect("Read TDLib DLL");
            for destination in [profile.to_path_buf(), profile.join("deps")] {
                std::fs::create_dir_all(&destination).expect("Create Cargo output directory");
                let target = destination.join(entry.file_name());
                if std::fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
                    std::fs::write(target, &bytes).expect("Copy TDLib DLL to Cargo output");
                }
            }
        }
    }
}
