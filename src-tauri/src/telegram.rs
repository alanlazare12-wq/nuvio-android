use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::timeout;

use serde_json::Value;
use zeroize::Zeroize;

use crate::provider::{ProviderStatus, StorageProvider};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramAuthSnapshot {
    pub stage: String,
    pub message: String,
    pub connected: bool,
    pub account_label: Option<String>,
    pub hint: Option<String>,
    pub qr_link: Option<String>,
    pub is_premium: bool,
    pub qr_svg: Option<String>,
    pub timeout: Option<i32>,
    pub code_type: Option<String>,
    pub next_code_type: Option<String>,
}

impl Default for TelegramAuthSnapshot {
    fn default() -> Self {
        Self {
            stage: "needsCredentials".to_string(),
            message: "Configura tu API ID y API Hash para iniciar TDLib".to_string(),
            connected: false,
            account_label: None,
            hint: None,
            qr_link: None,
            is_premium: false,
            qr_svg: None,
            timeout: None,
            code_type: None,
            next_code_type: None,
        }
    }
}

pub struct TelegramService {
    pub(crate) sync_progress: Mutex<crate::progress::SyncProgress>,
    pub(crate) catalog_sync_gate: tokio::sync::Mutex<()>,
    client_id_atomic: Arc<AtomicI32>,
    database_directory: PathBuf,
    files_directory: PathBuf,
    database_key: String,
    cached: Arc<Mutex<TelegramAuthSnapshot>>,
    pub(crate) sent: Arc<Mutex<HashMap<i64, Result<tdlib_rs::types::Message, String>>>>,
    credentials_path: PathBuf,
    saved_api: Mutex<Option<(i32, String)>>,
}

impl TelegramService {
    pub(crate) fn client_id(&self) -> i32 {
        self.client_id_atomic.load(Ordering::SeqCst)
    }
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        let root = app_data_dir.join("telegram");
        let database_directory = root.join("db");
        let files_directory = root.join("files");
        fs::create_dir_all(&database_directory).map_err(|error| error.to_string())?;
        fs::create_dir_all(&files_directory).map_err(|error| error.to_string())?;
        let database_key = load_or_create_database_key(&root)?;

        let client_id_atomic = Arc::new(AtomicI32::new(tdlib_rs::create_client()));
        let cached = Arc::new(Mutex::new(TelegramAuthSnapshot::default()));
        let sent = Arc::new(Mutex::new(HashMap::new()));
        let auth_updates = cached.clone();
        let send_updates = sent.clone();
        let client_id_recv = client_id_atomic.clone();
        std::thread::Builder::new()
            .name("telegram-receive".into())
            .spawn(move || loop {
                if let Some((update, id)) = tdlib_rs::receive() {
                    if id != client_id_recv.load(Ordering::SeqCst) {
                        continue;
                    }
                    match update {
                        tdlib_rs::enums::Update::AuthorizationState(v) => {
                            let value =
                                serde_json::to_value(&v.authorization_state).unwrap_or_default();
                            let snapshot = snapshot_from_state(
                                &value,
                                &format!("{:?}", v.authorization_state),
                            );
                            *auth_updates.lock().expect("auth mutex") = snapshot;
                        }
                        tdlib_rs::enums::Update::MessageSendSucceeded(v) => {
                            send_updates
                                .lock()
                                .expect("send mutex")
                                .insert(v.old_message_id, Ok(v.message));
                        }
                        tdlib_rs::enums::Update::MessageSendFailed(v) => {
                            send_updates
                                .lock()
                                .expect("send mutex")
                                .insert(v.old_message_id, Err(td_error(v.error)));
                        }
                        _ => {}
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            sync_progress: Mutex::new(crate::progress::SyncProgress::default()),
            catalog_sync_gate: tokio::sync::Mutex::new(()),
            client_id_atomic,
            database_directory,
            files_directory,
            database_key,
            cached,
            sent,
            credentials_path: root.join("api-credentials.dpapi"),
            saved_api: Mutex::new(None),
        })
    }

    pub async fn initialize(&self, remember_session: bool) -> Result<TelegramAuthSnapshot, String> {
        if !remember_session {
            crate::secrets::remove(&self.credentials_path)?;
        }
        call(tdlib_rs::functions::set_log_verbosity_level(
            0,
            self.client_id(),
        ))
        .await?;
        let state = self.refresh().await?;
        if remember_session && state.stage == "needsCredentials" {
            if let Some(bytes) = crate::secrets::load(&self.credentials_path)? {
                let (id, hash): (i32, String) = serde_json::from_slice(&bytes)
                    .map_err(|_| "Credenciales guardadas inválidas")?;
                *self.saved_api.lock().unwrap() = Some((id, hash.clone()));
                return self.configure(id, hash, true).await;
            }
        }
        Ok(state)
    }

    pub fn cached_snapshot(&self) -> TelegramAuthSnapshot {
        self.cached
            .lock()
            .expect("telegram auth mutex poisoned")
            .clone()
    }

    pub async fn refresh(&self) -> Result<TelegramAuthSnapshot, String> {
        let state = call(tdlib_rs::functions::get_authorization_state(self.client_id())).await?;
        let value = serde_json::to_value(&state).map_err(|error| error.to_string())?;
        let debug = format!("{state:?}");
        let mut snapshot = snapshot_from_state(&value, &debug);

        if snapshot.connected {
            if let Ok(tdlib_rs::enums::User::User(me)) =
                call(tdlib_rs::functions::get_me(self.client_id())).await
            {
                let full_name = format!("{} {}", me.first_name, me.last_name)
                    .trim()
                    .to_string();
                snapshot.account_label = Some(if full_name.is_empty() {
                    format!("Telegram #{}", me.id)
                } else {
                    full_name
                });
                snapshot.is_premium = me.is_premium;
            }
        }

        *self.cached.lock().expect("telegram auth mutex poisoned") = snapshot.clone();
        Ok(snapshot)
    }

    pub async fn configure(
        &self,
        api_id: i32,
        mut api_hash: String,
        remember_session: bool,
    ) -> Result<TelegramAuthSnapshot, String> {
        if api_id <= 0
            || api_hash.trim().len() != 32
            || !api_hash.trim().bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err("API ID o API Hash inválidos".to_string());
        }

        let result = call(tdlib_rs::functions::set_tdlib_parameters(
            false,
            self.database_directory.to_string_lossy().into_owned(),
            self.files_directory.to_string_lossy().into_owned(),
            self.database_key.clone(),
            true,
            true,
            true,
            false,
            api_id,
            api_hash.clone(),
            "es-MX".to_string(),
            "Nuvio".to_string(),
            std::env::consts::OS.to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
            self.client_id(),
        ))
        .await;
        if result.is_ok() {
            *self.saved_api.lock().unwrap() = Some((api_id, api_hash.clone()));
            if remember_session {
                let bytes = zeroize::Zeroizing::new(
                    serde_json::to_vec(&(api_id, &api_hash)).map_err(|e| e.to_string())?,
                );
                crate::secrets::save(&self.credentials_path, &bytes)?;
            } else {
                crate::secrets::remove(&self.credentials_path)?;
            }
        }
        api_hash.zeroize();
        result?;
        self.refresh().await
    }

    pub async fn reset_to_phone(&self) -> Result<TelegramAuthSnapshot, String> {
        let current_stage = self.cached_snapshot().stage;
        if self.cached_snapshot().connected
            || current_stage == "ready"
            || current_stage == "needsCredentials"
            || current_stage == "initializing"
            || current_stage == "phone"
        {
            return self.refresh().await;
        }
        let old_id = self.client_id();
        let _ = call(tdlib_rs::functions::close(old_id)).await;
        for _ in 0..60 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if self.cached_snapshot().stage == "closed" {
                break;
            }
        }
        let _ = fs::remove_dir_all(&self.database_directory);
        let _ = fs::create_dir_all(&self.database_directory);
        let new_id = tdlib_rs::create_client();
        self.client_id_atomic.store(new_id, Ordering::SeqCst);
        let _ = call(tdlib_rs::functions::set_log_verbosity_level(0, new_id)).await;

        let saved = self.saved_api.lock().unwrap().clone();
        if let Some((api_id, api_hash)) = saved {
            let _ = call(tdlib_rs::functions::set_tdlib_parameters(
                false,
                self.database_directory.to_string_lossy().into_owned(),
                self.files_directory.to_string_lossy().into_owned(),
                self.database_key.clone(),
                true,
                true,
                true,
                false,
                api_id,
                api_hash,
                "es-MX".to_string(),
                "Nuvio".to_string(),
                std::env::consts::OS.to_string(),
                env!("CARGO_PKG_VERSION").to_string(),
                new_id,
            ))
            .await;
        } else if let Ok(Some(bytes)) = crate::secrets::load(&self.credentials_path) {
            if let Ok((api_id, api_hash)) = serde_json::from_slice::<(i32, String)>(&bytes) {
                *self.saved_api.lock().unwrap() = Some((api_id, api_hash.clone()));
                let _ = call(tdlib_rs::functions::set_tdlib_parameters(
                    false,
                    self.database_directory.to_string_lossy().into_owned(),
                    self.files_directory.to_string_lossy().into_owned(),
                    self.database_key.clone(),
                    true,
                    true,
                    true,
                    false,
                    api_id,
                    api_hash,
                    "es-MX".to_string(),
                    "Nuvio".to_string(),
                    std::env::consts::OS.to_string(),
                    env!("CARGO_PKG_VERSION").to_string(),
                    new_id,
                ))
                .await;
            }
        }
        for _ in 0..60 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if self.cached_snapshot().stage == "phone" {
                break;
            }
        }
        self.refresh().await
    }

    pub async fn submit_phone(&self, mut phone: String) -> Result<TelegramAuthSnapshot, String> {
        let normalized: String = phone.chars().filter(|c| !c.is_whitespace()).collect();
        if !normalized.starts_with('+') || normalized.len() < 8 {
            phone.zeroize();
            return Err("Usa el número en formato internacional, por ejemplo +52 seguido de los 10 dígitos de tu número".to_string());
        }
        if self.cached_snapshot().stage != "phone" {
            let _ = self.reset_to_phone().await;
        }
        let result = call(tdlib_rs::functions::set_authentication_phone_number(
            normalized,
            None,
            self.client_id(),
        ))
        .await;
        phone.zeroize();
        result?;
        self.refresh().await
    }

    pub async fn submit_phone_sms(&self, phone: String) -> Result<TelegramAuthSnapshot, String> {
        self.submit_phone(phone).await
    }

    pub async fn submit_email(&self, mut email: String) -> Result<TelegramAuthSnapshot, String> {
        let value = email.trim().to_string();
        if !value.contains('@') || value.starts_with('@') || value.ends_with('@') {
            email.zeroize();
            return Err("Ingresa un correo válido".to_string());
        }
        if self.cached_snapshot().stage != "phone" {
            let _ = self.reset_to_phone().await;
        }
        let result = call(tdlib_rs::functions::set_authentication_email_address(
            value,
            self.client_id(),
        ))
        .await;
        email.zeroize();
        result?;
        self.refresh().await
    }

    pub async fn submit_email_code(
        &self,
        mut code: String,
    ) -> Result<TelegramAuthSnapshot, String> {
        let value = code.trim().to_string();
        if value.len() < 4 {
            code.zeroize();
            return Err("El código de correo es demasiado corto".to_string());
        }
        let authentication = tdlib_rs::enums::EmailAddressAuthentication::Code(
            tdlib_rs::types::EmailAddressAuthenticationCode { code: value },
        );
        let result = call(tdlib_rs::functions::check_authentication_email_code(
            authentication,
            self.client_id(),
        ))
        .await;
        code.zeroize();
        result?;
        self.refresh().await
    }

    pub async fn submit_code(&self, mut code: String) -> Result<TelegramAuthSnapshot, String> {
        let value = code.trim().to_string();
        if value.len() < 4 {
            code.zeroize();
            return Err("El código de autenticación es demasiado corto".to_string());
        }
        let result = call(tdlib_rs::functions::check_authentication_code(
            value,
            self.client_id(),
        ))
        .await;
        code.zeroize();
        result?;
        self.refresh().await
    }

    pub async fn resend_code(&self) -> Result<TelegramAuthSnapshot, String> {
        let result = call(tdlib_rs::functions::resend_authentication_code(
            Some(tdlib_rs::enums::ResendCodeReason::UserRequest),
            self.client_id(),
        ))
        .await;
        result?;
        self.refresh().await
    }

    pub async fn submit_password(
        &self,
        mut password: String,
    ) -> Result<TelegramAuthSnapshot, String> {
        if password.is_empty() {
            return Err("La contraseña no puede estar vacía".to_string());
        }
        let value = password.clone();
        let result = call(tdlib_rs::functions::check_authentication_password(
            value,
            self.client_id(),
        ))
        .await;
        password.zeroize();
        result?;
        self.refresh().await
    }

    pub async fn request_qr(&self) -> Result<TelegramAuthSnapshot, String> {
        let current = self.cached_snapshot().stage;
        if current == "qr" {
            return self.refresh().await;
        }
        if current != "phone" {
            self.reset_to_phone().await?;
        }
        call(tdlib_rs::functions::request_qr_code_authentication(
            Vec::new(),
            self.client_id(),
        ))
        .await?;
        self.refresh().await
    }

    pub async fn register_user(
        &self,
        mut first_name: String,
        mut last_name: String,
    ) -> Result<TelegramAuthSnapshot, String> {
        if first_name.trim().is_empty() {
            return Err("El nombre es obligatorio para terminar el registro".to_string());
        }
        let first = first_name.trim().to_string();
        let last = last_name.trim().to_string();
        let result = call(tdlib_rs::functions::register_user(
            first,
            last,
            false,
            self.client_id(),
        ))
        .await;
        first_name.zeroize();
        last_name.zeroize();
        result?;
        self.refresh().await
    }

    pub async fn log_out(&self) -> Result<TelegramAuthSnapshot, String> {
        call(tdlib_rs::functions::log_out(self.client_id())).await?;
        let snapshot = TelegramAuthSnapshot {
            stage: "closed".to_string(),
            message: "Sesión cerrada".to_string(),
            ..TelegramAuthSnapshot::default()
        };
        *self.cached.lock().expect("telegram auth mutex poisoned") = snapshot.clone();
        Ok(snapshot)
    }

    pub async fn forget_session(&self) -> Result<TelegramAuthSnapshot, String> {
        crate::secrets::remove(&self.credentials_path)?;
        let _ = call(tdlib_rs::functions::log_out(self.client_id())).await;
        let deadline = std::time::Instant::now() + Duration::from_secs(12);
        while std::time::Instant::now() < deadline {
            if self.cached_snapshot().stage == "closed" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        if self.database_directory.exists() {
            let _ = fs::remove_dir_all(&self.database_directory);
        }
        fs::create_dir_all(&self.database_directory).map_err(|e| e.to_string())?;
        let snapshot = TelegramAuthSnapshot {
            stage: "closed".to_string(),
            message: "Sesión olvidada. Reinicia Nuvio para conectar otra cuenta.".to_string(),
            ..TelegramAuthSnapshot::default()
        };
        *self.cached.lock().expect("telegram auth mutex poisoned") = snapshot.clone();
        Ok(snapshot)
    }
}

impl StorageProvider for TelegramService {
    fn provider_id(&self) -> &'static str {
        "telegram"
    }

    fn status(&self) -> ProviderStatus {
        let snapshot = self.cached_snapshot();
        ProviderStatus {
            connected: snapshot.connected,
            account_label: snapshot.account_label,
            label: snapshot.message,
        }
    }
}

fn snapshot_from_state(value: &Value, debug: &str) -> TelegramAuthSnapshot {
    let json = value.to_string().to_ascii_lowercase();
    let debug_lower = debug.to_ascii_lowercase();
    let state_text = format!("{json} {debug_lower}");
    let mut snapshot = TelegramAuthSnapshot::default();

    if state_text.contains("waittdlibparameters")
        || state_text.contains("authorizationstatewaittdlibparameters")
    {
        snapshot.stage = "needsCredentials".to_string();
        snapshot.message = "TDLib necesita las credenciales de la aplicación".to_string();
    } else if state_text.contains("waitencryptionkey")
        || state_text.contains("authorizationstatewaitencryptionkey")
    {
        snapshot.stage = "initializing".to_string();
        snapshot.message = "Abriendo el almacén local cifrado de Telegram".to_string();
    } else if state_text.contains("waitphonenumber")
        || state_text.contains("authorizationstatewaitphonenumber")
    {
        snapshot.stage = "phone".to_string();
        snapshot.message = "Ingresa el teléfono asociado a tu cuenta".to_string();
    } else if state_text.contains("waitemailaddress")
        || state_text.contains("authorizationstatewaitemailaddress")
    {
        snapshot.stage = "email".to_string();
        snapshot.message = "Telegram solicita un correo de autenticación".to_string();
    } else if state_text.contains("waitemailcode")
        || state_text.contains("authorizationstatewaitemailcode")
    {
        snapshot.stage = "emailCode".to_string();
        snapshot.message = "Ingresa el código enviado al correo".to_string();
        snapshot.hint = find_string(value, &["email_address_pattern"]);
    } else if state_text.contains("waitcode") || state_text.contains("authorizationstatewaitcode") {
        snapshot.stage = "code".to_string();
        snapshot.message = "Ingresa el código enviado por Telegram".to_string();

        let code_info = value.get("code_info").or_else(|| value.get("codeInfo"));
        let timeout_val = code_info
            .and_then(|info| info.get("timeout"))
            .and_then(|t| t.as_i64())
            .map(|t| t as i32);
        snapshot.timeout = timeout_val;

        let code_type_obj = code_info.and_then(|info| info.get("type"));
        let code_type_debug = format!("{code_type_obj:?} {code_info:?} {state_text}").to_ascii_lowercase();

        let next_type_obj = code_info.and_then(|info| info.get("next_type").or_else(|| info.get("nextType")));
        let next_type_debug = format!("{next_type_obj:?}").to_ascii_lowercase();

        if next_type_debug.contains("sms") {
            snapshot.next_code_type = Some("sms".to_string());
        } else if next_type_debug.contains("call") {
            snapshot.next_code_type = Some("call".to_string());
        } else if next_type_obj.map_or(false, |v| v.is_null()) {
            snapshot.next_code_type = Some("none".to_string());
        }

        if code_type_debug.contains("telegrammessage") {
            snapshot.code_type = Some("telegram".to_string());
            if let Some(t) = timeout_val {
                if t > 0 {
                    snapshot.hint = Some(format!(
                        "Código enviado a tu app oficial de Telegram (en tus otros dispositivos). Si no tienes acceso a la app, podrás solicitar el reenvío por SMS o llamada al terminar el contador de {}s.",
                        t
                    ));
                } else {
                    snapshot.hint = Some(
                        "Código enviado a tu app oficial de Telegram. Si no tienes acceso a la app, pulsa en solicitar por SMS o llamada."
                            .to_string(),
                    );
                }
            } else {
                snapshot.hint = Some(
                    "Código enviado a tu app oficial de Telegram. Si no tienes acceso a la app, pulsa en solicitar por SMS o llamada."
                        .to_string(),
                );
            }
        } else if code_type_debug.contains("sms") {
            snapshot.code_type = Some("sms".to_string());
            snapshot.hint = Some(
                "Código enviado por mensaje SMS a tu teléfono celular (en tu bandeja de mensajería)."
                    .to_string(),
            );
        } else if code_type_debug.contains("call") {
            snapshot.code_type = Some("call".to_string());
            snapshot.hint = Some(
                "Recibirás una llamada telefónica para dictarte el código de verificación."
                    .to_string(),
            );
        } else if code_type_debug.contains("fragment") {
            snapshot.code_type = Some("fragment".to_string());
            snapshot.hint = Some(
                "Código enviado a través de la plataforma Fragment."
                    .to_string(),
            );
        } else {
            snapshot.code_type = Some("unknown".to_string());
            snapshot.hint = Some(
                "Revisa tu app de Telegram o tus mensajes SMS para ingresar el código."
                    .to_string(),
            );
        }
    } else if state_text.contains("waitpassword")
        || state_text.contains("authorizationstatewaitpassword")
    {
        snapshot.stage = "password".to_string();
        snapshot.message = "Tu cuenta usa verificación en dos pasos".to_string();
        snapshot.hint = find_string(value, &["password_hint", "hint"]);
    } else if state_text.contains("waitotherdeviceconfirmation")
        || state_text.contains("authorizationstatewaitotherdeviceconfirmation")
    {
        snapshot.stage = "qr".to_string();
        snapshot.message = "Escanea el código desde otra sesión de Telegram".to_string();
        snapshot.qr_link = find_string(value, &["link"]);
        snapshot.qr_svg = snapshot
            .qr_link
            .as_ref()
            .and_then(|link| qrcode::QrCode::new(link.as_bytes()).ok())
            .map(|qr| {
                qr.render::<qrcode::render::svg::Color>()
                    .min_dimensions(220, 220)
                    .build()
            });
    } else if state_text.contains("waitregistration")
        || state_text.contains("authorizationstatewaitregistration")
    {
        snapshot.stage = "registration".to_string();
        snapshot.message = "Completa el registro de tu cuenta de Telegram".to_string();
    } else if state_text.contains("authorizationstateready") || debug_lower.contains("ready") {
        snapshot.stage = "ready".to_string();
        snapshot.message = "Telegram conectado".to_string();
        snapshot.connected = true;
    } else if state_text.contains("loggingout") {
        snapshot.stage = "loggingOut".to_string();
        snapshot.message = "Cerrando sesión".to_string();
    } else if state_text.contains("closing") {
        snapshot.stage = "closing".to_string();
        snapshot.message = "Cerrando TDLib".to_string();
    } else if state_text.contains("closed") {
        snapshot.stage = "closed".to_string();
        snapshot.message = "TDLib cerrado".to_string();
    } else {
        snapshot.stage = "initializing".to_string();
        snapshot.message = "Inicializando Telegram".to_string();
    }

    snapshot
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(Value::String(found)) = map.get(*key) {
                    if !found.is_empty() {
                        return Some(found.clone());
                    }
                }
            }
            map.values().find_map(|child| find_string(child, keys))
        }
        Value::Array(values) => values.iter().find_map(|child| find_string(child, keys)),
        _ => None,
    }
}

fn load_or_create_database_key(root: &Path) -> Result<String, String> {
    let key_path = root.join("tdlib.key");
    #[cfg(any(windows, target_os = "android"))]
    if let Some(bytes) = crate::secrets::load(&root.join("tdlib-key.dpapi"))? {
        return String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string());
    }
    if key_path.exists() {
        let key = fs::read_to_string(&key_path).map_err(|error| error.to_string())?;
        let key = key.trim().to_string();
        if key.len() >= 32 {
            #[cfg(any(windows, target_os = "android"))]
            {
                crate::secrets::save(&root.join("tdlib-key.dpapi"), key.as_bytes())?;
                fs::remove_file(&key_path).map_err(|e| e.to_string())?;
            }
            return Ok(key);
        }
    }

    let bytes: [u8; 32] = rand::random();
    let key = hex::encode(bytes);
    #[cfg(any(windows, target_os = "android"))]
    crate::secrets::save(&root.join("tdlib-key.dpapi"), key.as_bytes())?;
    #[cfg(not(any(windows, target_os = "android")))]
    fs::write(&key_path, &key).map_err(|error| error.to_string())?;
    Ok(key)
}

fn td_error(error: tdlib_rs::types::Error) -> String {
    let msg_lower = error.message.to_ascii_lowercase();
    if error.code == 400 && (msg_lower.contains("can't be resend") || msg_lower.contains("cannot be resend") || msg_lower.contains("can't be resent")) {
        return "Telegram requiere esperar a que finalice la cuenta regresiva antes de solicitar el código por SMS o llamada telefónica.".to_string();
    }
    if error.code == 400 && msg_lower.contains("phone_code_expired") {
        return "El código de verificación ha expirado. Solicita un nuevo código o reenvío.".to_string();
    }
    if error.code == 400 && msg_lower.contains("phone_number_invalid") {
        return "El número de teléfono no es válido. Ingresa tu número en formato internacional (+ y lada).".to_string();
    }
    if error.code == 400 && msg_lower.contains("phone_number_banned") {
        return "Este número de teléfono ha sido suspendido o bloqueado por Telegram.".to_string();
    }
    if error.code == 420 || error.code == 429 || msg_lower.contains("flood_wait") || msg_lower.contains("too many requests") {
        return "Demasiadas solicitudes a Telegram. Por favor espera unos minutos antes de intentar de nuevo.".to_string();
    }
    if error.code == 406 {
        return "Telegram rechazó esta operación por una condición interna no mostrable."
            .to_string();
    }
    format!("Telegram {}: {}", error.code, error.message)
}

/// A stalled network must return an actionable error instead of locking the UI.
pub(crate) async fn call<T>(
    request: impl Future<Output = Result<T, tdlib_rs::types::Error>>,
) -> Result<T, String> {
    timeout(Duration::from_secs(45), request)
        .await
        .map_err(|_| {
            "Telegram no respondió en 45 segundos. Revisa tu conexión y vuelve a intentar."
                .to_string()
        })?
        .map_err(td_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_snapshot_from_state_code_info() {
        let json = serde_json::json!({
            "@type": "authorizationStateWaitCode",
            "code_info": {
                "phone_number": "+521234567890",
                "type": {
                    "@type": "authenticationCodeTypeTelegramMessage",
                    "length": 5
                },
                "next_type": {
                    "@type": "authenticationCodeTypeSms",
                    "length": 5
                },
                "timeout": 60
            }
        });
        let snapshot = snapshot_from_state(&json, "WaitCode");
        assert_eq!(snapshot.stage, "code");
        assert_eq!(snapshot.timeout, Some(60));
        assert_eq!(snapshot.code_type, Some("telegram".to_string()));
        assert_eq!(snapshot.next_code_type, Some("sms".to_string()));
        assert!(snapshot.hint.unwrap().contains("Telegram"));
    }

    #[test]
    fn test_snapshot_from_state_sms_info() {
        let json = serde_json::json!({
            "@type": "authorizationStateWaitCode",
            "code_info": {
                "phone_number": "+521234567890",
                "type": {
                    "@type": "authenticationCodeTypeSms",
                    "length": 5
                },
                "next_type": {
                    "@type": "authenticationCodeTypeCall",
                    "length": 5
                },
                "timeout": 120
            }
        });
        let snapshot = snapshot_from_state(&json, "WaitCode");
        assert_eq!(snapshot.stage, "code");
        assert_eq!(snapshot.timeout, Some(120));
        assert_eq!(snapshot.code_type, Some("sms".to_string()));
        assert_eq!(snapshot.next_code_type, Some("call".to_string()));
        assert!(snapshot.hint.unwrap().contains("SMS"));
    }

    #[test]
    fn test_td_error_humanization() {
        let err_resend = tdlib_rs::types::Error {
            code: 400,
            message: "Authentication code can't be resend".to_string(),
        };
        assert!(td_error(err_resend).contains("cuenta regresiva"));
    }

    #[test]
    fn test_tdlib_qr_to_phone() {
        tauri::async_runtime::block_on(async {
            let temp_dir = tempfile::tempdir().unwrap();
            let service = TelegramService::new(temp_dir.path()).unwrap();
            let init = service.initialize(false).await.unwrap();
            assert_eq!(init.stage, "needsCredentials");
            let configured = service
                .configure(94575, "a3406de8d171bb422bb6ddf3bbd800e2".into(), false)
                .await
                .unwrap();
            assert_eq!(configured.stage, "phone");
            let qr = service.request_qr().await.unwrap();
            assert_eq!(qr.stage, "qr");

            let reset = service.reset_to_phone().await.unwrap();
            assert_eq!(reset.stage, "phone");
        });
    }
}

