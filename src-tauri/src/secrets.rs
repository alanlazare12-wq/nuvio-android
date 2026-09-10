use std::path::Path;
use zeroize::Zeroizing;

// Windows protects the stored API credentials for the current Windows user.
#[cfg(windows)]
fn protect(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::*;
    let source = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "Secreto demasiado grande")?,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI owns the output allocation; copy it before releasing with LocalFree.
    unsafe {
        let ok = if encrypt {
            CryptProtectData(
                &source,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err("Windows no pudo abrir el almacén de credenciales".into());
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as *mut _);
        Ok(bytes)
    }
}

pub fn save(path: &Path, value: &[u8]) -> Result<(), String> {
    #[cfg(any(windows, target_os = "android"))]
    {
        #[cfg(windows)]
        let bytes = protect(value, true)?;
        #[cfg(target_os = "android")]
        let bytes = crate::mobile::protect(value, true)?;
        let parent = path.parent().ok_or("Ruta de credenciales inválida")?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        use std::io::Write;
        tmp.write_all(&bytes).map_err(|e| e.to_string())?;
        tmp.persist(path).map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = (path, value);
    }
    Ok(())
}

pub fn remove(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    #[cfg(windows)]
    {
        Ok(Some(Zeroizing::new(protect(
            &std::fs::read(path).map_err(|e| e.to_string())?,
            false,
        )?)))
    }
    #[cfg(target_os = "android")]
    {
        Ok(Some(Zeroizing::new(crate::mobile::protect(
            &std::fs::read(path).map_err(|e| e.to_string())?,
            false,
        )?)))
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        Ok(None)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn credentials_round_trip_and_reject_corruption() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("secret.dpapi");
        save(&path, b"test-credential").unwrap();
        assert_eq!(&**load(&path).unwrap().unwrap(), b"test-credential");
        assert_ne!(std::fs::read(&path).unwrap(), b"test-credential");
        std::fs::write(&path, b"invalid").unwrap();
        assert!(load(&path).is_err());
    }
}
