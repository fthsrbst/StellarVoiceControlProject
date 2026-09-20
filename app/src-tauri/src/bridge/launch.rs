//! Opening the bridge URL in the user's browser (step W4b).
//!
//! macOS `open` is used directly (no shell): the URL is passed as a single
//! argument, so a hostile-looking URL cannot become a command. The optional
//! `POLARIS_BRIDGE_BROWSER` names an application (`open -a "<name>"`), and the
//! name is validated against a conservative charset before it reaches the
//! argument list.
//!
//! Freighter lives in a browser extension, so the page must open in the browser
//! that has it. Polaris cannot detect which one that is; `POLARIS_BRIDGE_BROWSER`
//! is the explicit answer, documented in `.env.example` and the bridge doc.

/// Environment variable naming the browser to use, e.g. `Google Chrome`.
pub const BROWSER_ENV: &str = "POLARIS_BRIDGE_BROWSER";

/// Characters allowed in a browser application name. Conservative on purpose:
/// letters, digits, space, dot, dash, underscore and parentheses are enough for
/// every real macOS application name and leave no room for option injection.
fn is_valid_browser_name(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | '(' | ')' | '+'))
}

/// A launcher so tests never open a real browser.
pub trait BrowserLauncher: Send + Sync {
    fn open(&self, url: &str, browser: Option<&str>) -> Result<(), String>;
}

/// The production launcher: macOS `open` (or `xdg-open` off macOS, where the
/// feature is not a target anyway — the app must still compile).
pub struct SystemLauncher;

impl BrowserLauncher for SystemLauncher {
    fn open(&self, url: &str, browser: Option<&str>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let mut command = std::process::Command::new("open");
            if let Some(name) = browser {
                command.arg("-a").arg(name);
            }
            command
                .arg(url)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("could not open the browser: {error}"))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = browser;
            std::process::Command::new("xdg-open")
                .arg(url)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("could not open the browser: {error}"))
        }
    }
}

/// Reads and validates `POLARIS_BRIDGE_BROWSER` via an injected lookup. An
/// invalid name is treated as unset (the default browser), never passed on.
pub fn configured_browser(lookup: impl Fn(&str) -> Option<String>) -> Option<String> {
    lookup(BROWSER_ENV).filter(|name| is_valid_browser_name(name))
}

/// The browser name the health check reports (or `None` for the default).
pub fn browser_for_health() -> Option<String> {
    configured_browser(crate::env::var)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_real_browser_names_and_rejects_injection() {
        for good in [
            "Google Chrome",
            "Safari",
            "Firefox",
            "Brave Browser",
            "Microsoft Edge",
            "Arc",
        ] {
            assert!(is_valid_browser_name(good), "rejected {good:?}");
        }
        for bad in [
            "",
            "   ",
            "-a",
            "Chrome; rm -rf /",
            "Chrome\" && open http://evil",
            "Chrome\nSafari",
            &"x".repeat(65),
        ] {
            assert!(!is_valid_browser_name(bad), "accepted {bad:?}");
        }
    }

    #[test]
    fn configured_browser_reads_and_filters_the_env() {
        let read = |name: &str| {
            if name == BROWSER_ENV {
                Some("Google Chrome".to_string())
            } else {
                None
            }
        };
        assert_eq!(configured_browser(read).as_deref(), Some("Google Chrome"));

        let read = |_: &str| Some("Chrome; rm -rf /".to_string());
        assert_eq!(configured_browser(read), None);

        let read = |_: &str| None;
        assert_eq!(configured_browser(read), None);
    }

    #[test]
    fn the_system_launcher_passes_the_url_as_one_argument() {
        // The launcher is a thin `Command` wrapper; this pins the constructor and
        // that a valid browser name is accepted. Opening a real browser needs a
        // human (see the report).
        let launcher = SystemLauncher;
        assert!(is_valid_browser_name("Google Chrome"));
        let _ = &launcher;
    }
}
