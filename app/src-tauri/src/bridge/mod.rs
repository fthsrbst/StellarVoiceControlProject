//! The Freighter signing bridge server (step W4b).
//!
//! The Polaris webview cannot talk to the user's Freighter extension, so signing
//! happens on a short-lived loopback page the app opens in the **normal** browser.
//! This module is the Rust half of that contract
//! (`docs/freighter-bridge.md`): it mints a one-time token, serves
//! `bridge.html` and the two protocol endpoints from `127.0.0.1`, opens the URL,
//! waits for the result page and then **independently verifies** the returned
//! envelope before reporting success. Polaris still holds no secret key at any
//! point: Freighter owns the key, the app only ever sees a public address and a
//! signed XDR.
//!
//! Three Tauri commands are exported:
//!
//! * [`commands::bridge_sign`] — takes an authorized approval id, releases its
//!   XDR through the gate's only exit (`take_authorized`), runs the session and
//!   verifies the result.
//! * [`commands::bridge_selftest`] — the Debug panel's "Test Freighter signing
//!   (no funds)" button. It runs the same path with an externally supplied XDR,
//!   but refuses any envelope whose source is not the configured owner or whose
//!   sequence is not exactly `0`: a sequence-0 transaction can never be applied
//!   on-chain, so the self-test cannot sign a real transaction.
//! * [`commands::bridge_health`] — the non-prompting health check.
//! * [`commands::bridge_sign_challenge`] — wallet-only signing of a SEP-10 login
//!   challenge (step W5a). It refuses any envelope that is not a sequence-0,
//!   anchor-signed challenge before the gate is touched, so no Touch ID is needed
//!   (a sequence-0 transaction can never be applied on-chain) and no real payment
//!   can reach the browser without a prompt.
//! * [`commands::anchor_signing_health`] — the non-prompting W5a health check.
//!
//! The XDR is verified without an XDR crate ([`verify`]) and the `G...` address
//! is decoded without a StrKey crate ([`strkey`]); both are deliberately small so
//! the security-relevant surface is auditable.

pub mod commands;
pub mod launch;
pub mod server;
pub mod strkey;
pub mod verify;

#[allow(unused_imports)]
pub use server::{BridgeLaunch, SigningSession};
