use sentry::protocol::{Event, Value};
use sentry::ClientInitGuard;

/// Keys that should NEVER be sent to Sentry - contains user content or secrets
/// Pattern from: apps/wui/src/lib/telemetry/sentry.ts:188-199
const SENSITIVE_KEYS: &[&str] = &[
    "store",
    "state",
    "session",
    "conversation",
    "approval",
    "messages",
    "prompt",
    "file_content",
    "working_directory",
    "api_key",
    "token",
    "password",
    "secret",
    "key",
    "auth",
    "credential",
    "content",
    "user_message",
    "assistant_message",
    "stdin",
    "stdout",
    "stderr",
];

/// Check if a key contains any sensitive substring (case-insensitive)
fn is_sensitive_key(key: &str) -> bool {
    let key_lower = key.to_lowercase();
    SENSITIVE_KEYS
        .iter()
        .any(|sensitive| key_lower.contains(sensitive))
}

/// Check if a JSON value contains any sensitive keys
fn contains_sensitive_data(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            map.keys().any(|k| is_sensitive_key(k)) || map.values().any(contains_sensitive_data)
        }
        Value::Array(arr) => arr.iter().any(contains_sensitive_data),
        Value::String(s) => {
            let s_lower = s.to_lowercase();
            SENSITIVE_KEYS
                .iter()
                .any(|sensitive| s_lower.contains(sensitive))
        }
        _ => false,
    }
}

/// Scrub sensitive data from Sentry events before sending
/// Pattern from: apps/wui/src/lib/telemetry/sentry.ts:127-216
fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    // Scrub extra context data
    event.extra.retain(|key, value| {
        if is_sensitive_key(key) {
            return false;
        }
        // Also check if the value contains sensitive data
        !contains_sensitive_data(value)
    });

    // Scrub breadcrumb data
    for breadcrumb in &mut event.breadcrumbs.values {
        // Filter out console breadcrumbs entirely
        if breadcrumb.category.as_deref() == Some("console") {
            breadcrumb.data.clear();
            continue;
        }

        // Scrub sensitive keys from breadcrumb data
        breadcrumb.data.retain(|key, _| !is_sensitive_key(key));
    }

    // Remove breadcrumbs with console category
    event
        .breadcrumbs
        .values
        .retain(|b| b.category.as_deref() != Some("console"));

    // Scrub contexts
    if let Some(state) = event.contexts.remove("state") {
        drop(state); // Explicitly drop the state context
    }

    Some(event)
}

/// Initialize Sentry error tracking
/// Returns a guard that must be kept alive for the duration of the application
pub fn init() -> Option<ClientInitGuard> {
    if cfg!(debug_assertions) {
        log::info!("Sentry disabled in debug builds");
        return None;
    }

    // Builds from source have no DSN, so they report nowhere.
    let Some(dsn) = configured_dsn(option_env!("RIPTIDE_NATIVE_SENTRY_DSN")) else {
        log::info!("Sentry DSN not configured, skipping initialization");
        return None;
    };

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: option_env!("BUILD_VERSION")
                .map(std::borrow::Cow::from)
                .or_else(|| sentry::release_name!()),
            environment: Some(
                if cfg!(debug_assertions) {
                    "local"
                } else {
                    // Use SENTRY_ENVIRONMENT for production builds (prod/devcloud)
                    option_env!("SENTRY_ENVIRONMENT").unwrap_or("local")
                }
                .into(),
            ),
            traces_sample_rate: 0.1,
            // Scrub sensitive data before sending
            before_send: Some(std::sync::Arc::new(scrub_event)),
            ..Default::default()
        },
    ));

    // Set up panic handler to capture panics (without including panic message details)
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Only capture panic location, not the message (which could contain user data)
        let location = info.location().map_or_else(
            || "unknown location".to_string(),
            |loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()),
        );
        sentry::capture_message(&format!("Panic at {}", location), sentry::Level::Fatal);
        default_panic(info);
    }));

    log::info!("Sentry initialized for error reporting");
    Some(guard)
}

/// Capture an error with optional context (scrubbed)
/// NOTE: Be careful not to pass user content as context
pub fn capture_error(error: &str, context: Option<&str>) {
    // Only set context if it doesn't contain sensitive keywords
    if let Some(ctx) = context {
        if !SENSITIVE_KEYS
            .iter()
            .any(|s| ctx.to_lowercase().contains(s))
        {
            sentry::configure_scope(|scope| {
                scope.set_extra("context", serde_json::json!(ctx));
            });
        }
    }
    sentry::capture_message(error, sentry::Level::Error);
}

/// The DSN baked in at build time, or None when unset or empty.
fn configured_dsn(raw: Option<&'static str>) -> Option<&'static str> {
    raw.filter(|dsn| !dsn.is_empty())
}

#[cfg(test)]
mod tests {
    use super::configured_dsn;

    #[test]
    fn no_dsn_means_no_sentry() {
        assert_eq!(configured_dsn(None), None);
        assert_eq!(configured_dsn(Some("")), None);
    }

    #[test]
    fn keeps_a_set_dsn() {
        assert_eq!(
            configured_dsn(Some("https://key@sentry.example/1")),
            Some("https://key@sentry.example/1")
        );
    }
}
