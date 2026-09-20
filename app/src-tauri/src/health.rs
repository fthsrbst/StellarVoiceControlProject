//! Feature health for the in-app Debug panel, and the Touch ID checks (step W3).
//!
//! Every milestone that ships a feature ships a visible "is it working now?"
//! check. The shared shape is [`FeatureHealth`] (serde camelCase, lowercase
//! status), which the Debug panel renders directly.
//!
//! Two behaviours live here:
//!
//! * [`biometric_health`] — a **non-destructive** probe. It asks
//!   `canEvaluatePolicy` whether the device-owner policy is usable and never
//!   shows a prompt.
//! * [`biometric_selftest`] — the explicitly named self-test behind a panel
//!   button. It shows the real Touch ID prompt and moves no funds; it is never
//!   run automatically.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::biometric::{self, AuthError, Authenticator, BiometryKind};

/// The milestone this module's checks belong to.
pub const MILESTONE: &str = "W3";
/// Check id for the non-prompting biometric probe.
pub const BIOMETRIC_HEALTH_ID: &str = "w3.biometric";
/// Check id for the real-prompt self-test.
pub const BIOMETRIC_SELFTEST_ID: &str = "w3.biometric.selftest";
/// Human title for both checks.
pub const BIOMETRIC_TITLE: &str = "Touch ID approval";

/// The Debug contract's status vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    /// Verified live just now.
    Ok,
    /// Configured or degraded, but not fully verified.
    Warn,
    /// Broken; `detail` says why in one actionable sentence.
    Fail,
    /// Not run yet.
    Unknown,
}

/// One feature's health, per the Debug contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureHealth {
    pub id: String,
    pub title: String,
    pub milestone: String,
    pub status: HealthStatus,
    pub detail: String,
    /// Milliseconds since the Unix epoch.
    pub checked_at: u64,
}

impl FeatureHealth {
    pub fn new(
        id: &str,
        title: &str,
        milestone: &str,
        status: HealthStatus,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            id: id.to_string(),
            title: title.to_string(),
            milestone: milestone.to_string(),
            status,
            detail: detail.into(),
            checked_at: now_ms(),
        }
    }
}

/// Wall-clock milliseconds since the Unix epoch. Shared with the approval store
/// so `expiresAtMs` and `checkedAt` are on the same timeline.
pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Non-destructive biometric probe. Uses `canEvaluatePolicy` only — no prompt.
#[tauri::command]
pub fn biometric_health() -> FeatureHealth {
    let support = biometric::policy_support();
    if !support.available {
        return FeatureHealth::new(
            BIOMETRIC_HEALTH_ID,
            BIOMETRIC_TITLE,
            MILESTONE,
            HealthStatus::Fail,
            format!("Touch ID is unavailable: {}", support.detail),
        );
    }
    match support.biometry {
        BiometryKind::None => FeatureHealth::new(
            BIOMETRIC_HEALTH_ID,
            BIOMETRIC_TITLE,
            MILESTONE,
            HealthStatus::Warn,
            "No biometrics are enrolled; macOS will ask for the device password.",
        ),
        kind => FeatureHealth::new(
            BIOMETRIC_HEALTH_ID,
            BIOMETRIC_TITLE,
            MILESTONE,
            HealthStatus::Ok,
            format!("{} is available and enrolled.", kind.label()),
        ),
    }
}

/// The panel button's self-test: shows the real Touch ID prompt. Moves no funds.
/// A cancellation is reported as `warn` because the user chose to stop, not
/// because the gate is broken.
///
/// Returns `Result` because Tauri requires it for an async command that takes a
/// reference input; the failure is encoded in the `FeatureHealth` itself, so the
/// `Err` arm is never used.
#[tauri::command]
pub async fn biometric_selftest(
    authenticator: State<'_, Arc<dyn Authenticator>>,
) -> Result<FeatureHealth, String> {
    let authenticator = Arc::clone(authenticator.inner());
    let joined = tauri::async_runtime::spawn_blocking(move || {
        authenticator.authenticate(biometric::SELFTEST_REASON)
    })
    .await;

    let health = match joined {
        Ok(Ok(())) => FeatureHealth::new(
            BIOMETRIC_SELFTEST_ID,
            BIOMETRIC_TITLE,
            MILESTONE,
            HealthStatus::Ok,
            "Touch ID self-test passed; no funds were moved.",
        ),
        Ok(Err(AuthError::Cancelled)) => FeatureHealth::new(
            BIOMETRIC_SELFTEST_ID,
            BIOMETRIC_TITLE,
            MILESTONE,
            HealthStatus::Warn,
            "The self-test prompt was cancelled.",
        ),
        Ok(Err(error)) => FeatureHealth::new(
            BIOMETRIC_SELFTEST_ID,
            BIOMETRIC_TITLE,
            MILESTONE,
            HealthStatus::Fail,
            format!("{} — {}", error.label(), error.detail()),
        ),
        Err(error) => FeatureHealth::new(
            BIOMETRIC_SELFTEST_ID,
            BIOMETRIC_TITLE,
            MILESTONE,
            HealthStatus::Fail,
            format!("the self-test task did not finish: {error}"),
        ),
    };
    Ok(health)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_health_serializes_to_the_debug_contract() {
        let health = FeatureHealth {
            id: BIOMETRIC_HEALTH_ID.to_string(),
            title: BIOMETRIC_TITLE.to_string(),
            milestone: MILESTONE.to_string(),
            status: HealthStatus::Warn,
            detail: "password only".to_string(),
            checked_at: 1_700_000_000_000,
        };
        let json = serde_json::to_string(&health).unwrap();
        assert_eq!(
            json,
            r#"{"id":"w3.biometric","title":"Touch ID approval","milestone":"W3","status":"warn","detail":"password only","checkedAt":1700000000000}"#
        );
        assert_eq!(
            serde_json::from_str::<FeatureHealth>(&json).unwrap(),
            health
        );
    }

    #[test]
    fn every_status_serializes_lowercase() {
        for (status, wire) in [
            (HealthStatus::Ok, "ok"),
            (HealthStatus::Warn, "warn"),
            (HealthStatus::Fail, "fail"),
            (HealthStatus::Unknown, "unknown"),
        ] {
            assert_eq!(
                serde_json::to_string(&status).unwrap(),
                format!("\"{wire}\"")
            );
        }
    }

    #[test]
    fn new_stamps_a_plausible_check_time() {
        let health = FeatureHealth::new("x", "X", MILESTONE, HealthStatus::Ok, "fine");
        assert!(health.checked_at >= 1_600_000_000_000);
    }
}
