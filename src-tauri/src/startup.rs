use std::time::Duration;
use tokio::sync::watch;

// Registered on the builder, before any webview can invoke get_dashboard.
pub(crate) struct Startup(watch::Sender<Option<Result<(), String>>>);

impl Default for Startup {
    fn default() -> Self {
        Self(watch::channel(None).0)
    }
}

impl Startup {
    pub(crate) fn finish(&self, result: Result<(), String>) {
        // Retain the result even when no dashboard request is listening yet.
        self.0.send_replace(Some(result));
    }

    pub(crate) async fn wait(&self, limit: Duration) -> Result<(), String> {
        let mut receiver = self.0.subscribe();
        tokio::time::timeout(limit, async {
            loop {
                if let Some(result) = receiver.borrow_and_update().clone() {
                    return result;
                }
                receiver.changed().await.map_err(|_| "Se interrumpió el inicio de Nuvio".to_string())?;
            }
        })
        .await
        .map_err(|_| "Nuvio está tardando en preparar el almacenamiento. Pulsa Reintentar para volver a comprobarlo.".to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn dashboard_waits_for_initialization() {
        tauri::async_runtime::block_on(async {
            let startup = Arc::new(Startup::default());
            let pending = startup.clone();
            let request =
                tauri::async_runtime::spawn(
                    async move { pending.wait(Duration::from_secs(2)).await },
                );
            tokio::time::sleep(Duration::from_millis(20)).await;
            assert!(startup.0.borrow().is_none());
            startup.finish(Ok(()));
            assert_eq!(request.await.unwrap(), Ok(()));
        });
    }

    #[test]
    fn completed_startup_is_retained_for_late_requests() {
        let startup = Startup::default();
        startup.finish(Ok(()));
        tauri::async_runtime::block_on(async {
            for _ in 0..2 {
                assert_eq!(startup.wait(Duration::from_secs(1)).await, Ok(()));
            }
        });
    }

    #[test]
    fn startup_failure_reaches_dashboard() {
        let startup = Startup::default();
        startup.finish(Err("No se pudo abrir el catálogo".into()));
        tauri::async_runtime::block_on(async {
            assert_eq!(
                startup.wait(Duration::from_secs(1)).await,
                Err("No se pudo abrir el catálogo".into())
            );
        });
    }

    #[test]
    fn timeout_allows_retry_after_initialization_finishes() {
        tauri::async_runtime::block_on(async {
            let startup = Startup::default();
            assert!(startup
                .wait(Duration::from_millis(10))
                .await
                .unwrap_err()
                .contains("Reintentar"));
            startup.finish(Ok(()));
            assert_eq!(startup.wait(Duration::from_secs(1)).await, Ok(()));
        });
    }
}
