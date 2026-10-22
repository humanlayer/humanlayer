use chrono::Local;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const MAX_TRACE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TRACE_EVENTS: usize = 2_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactTrace {
    version: u8,
    #[serde(rename = "markedAt")]
    marked_at: Option<u64>,
    #[serde(rename = "exportedAt")]
    exported_at: u64,
    events: Vec<ArtifactTraceEvent>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactTraceEvent {
    at: u64,
    #[serde(rename = "type")]
    event_type: String,
    data: HashMap<String, Value>,
}

fn validate_artifact_trace(json: &str) -> Result<(), String> {
    if json.len() > MAX_TRACE_BYTES {
        return Err(format!(
            "Artifact trace exceeds the {MAX_TRACE_BYTES} byte limit"
        ));
    }
    let trace: ArtifactTrace =
        serde_json::from_str(json).map_err(|error| format!("Invalid artifact trace: {error}"))?;
    if trace.version != 1 {
        return Err("Invalid artifact trace version".to_string());
    }
    if trace.events.len() > MAX_TRACE_EVENTS {
        return Err(format!(
            "Artifact trace exceeds the {MAX_TRACE_EVENTS} event limit"
        ));
    }
    if trace
        .marked_at
        .is_some_and(|marked_at| marked_at > trace.exported_at)
    {
        return Err("Artifact trace mark is after its export time".to_string());
    }
    for event in &trace.events {
        if event.event_type.is_empty() || event.event_type.len() > 120 {
            return Err("Artifact trace contains an invalid event type".to_string());
        }
        if event.at > trace.exported_at {
            return Err("Artifact trace contains an event after its export time".to_string());
        }
        if event.data.len() > 64
            || event.data.iter().any(|(key, value)| {
                key.len() > 120
                    || !matches!(
                        value,
                        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
                    )
                    || value.as_str().is_some_and(|value| value.len() > 256)
            })
        {
            return Err("Artifact trace contains invalid event data".to_string());
        }
    }
    Ok(())
}

fn trace_open_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    options
}

async fn remove_temp_file(path: &Path) {
    if let Err(error) = fs::remove_file(path).await {
        if error.kind() != ErrorKind::NotFound {
            log::warn!("Failed to clean up artifact trace temp file: {error}");
        }
    }
}

async fn write_artifact_trace(dir: &Path, json: &str, timestamp: &str) -> Result<PathBuf, String> {
    validate_artifact_trace(json)?;
    fs::create_dir_all(dir)
        .await
        .map_err(|error| format!("Failed to create trace directory: {error}"))?;

    let temp_path = dir.join(format!(".artifact-side-panel-trace-{}.tmp", Uuid::new_v4()));
    let mut file = trace_open_options()
        .open(&temp_path)
        .await
        .map_err(|error| format!("Failed to create artifact trace temp file: {error}"))?;
    if let Err(error) = async {
        file.write_all(json.as_bytes()).await?;
        file.flush().await?;
        file.sync_all().await
    }
    .await
    {
        drop(file);
        remove_temp_file(&temp_path).await;
        return Err(format!("Failed to write artifact trace: {error}"));
    }
    drop(file);

    for collision in 0..10_000 {
        let suffix = if collision == 0 {
            String::new()
        } else {
            format!("-{collision}")
        };
        let path = dir.join(format!(
            "artifact-side-panel-trace-{timestamp}{suffix}.json"
        ));
        match fs::hard_link(&temp_path, &path).await {
            Ok(()) => {
                remove_temp_file(&temp_path).await;
                return Ok(path);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                remove_temp_file(&temp_path).await;
                return Err(format!("Failed to finalize artifact trace: {error}"));
            }
        }
    }

    remove_temp_file(&temp_path).await;
    Err("Failed to choose a unique artifact trace filename".to_string())
}

#[tauri::command]
pub async fn save_artifact_trace(json: String) -> Result<String, String> {
    let timestamp = Local::now().format("%Y-%m-%d_%H-%M-%S-%3f").to_string();
    let path = write_artifact_trace(&crate::logging::get_log_base_dir(), &json, &timestamp).await?;
    path.into_os_string()
        .into_string()
        .map_err(|_| "Invalid artifact trace path".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("riptide-artifact-trace-{}", Uuid::new_v4()))
    }

    fn trace_json(events: usize) -> String {
        serde_json::json!({
            "version": 1,
            "markedAt": 10,
            "exportedAt": 20,
            "events": (0..events).map(|index| serde_json::json!({
                "at": 10,
                "type": "panel-style",
                "data": { "index": index }
            })).collect::<Vec<_>>()
        })
        .to_string()
    }

    #[tokio::test]
    async fn validates_and_atomically_writes_collision_safe_traces_to_the_supplied_directory() {
        let root = temp_dir();
        let dir = root.join("nested").join("logs");
        let invalid_dir = root.join("invalid");
        assert!(write_artifact_trace(&invalid_dir, "{}", "timestamp")
            .await
            .is_err());
        assert!(!fs::try_exists(&invalid_dir).await.unwrap());

        let first_json = trace_json(1);
        let second_json = trace_json(2);
        let first = write_artifact_trace(&dir, &first_json, "2026-08-02_12-34-56-789")
            .await
            .unwrap();
        let second = write_artifact_trace(&dir, &second_json, "2026-08-02_12-34-56-789")
            .await
            .unwrap();

        assert_eq!(first.parent(), Some(dir.as_path()));
        assert_eq!(second.parent(), Some(dir.as_path()));
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(&first).await.unwrap(), first_json);
        assert_eq!(fs::read_to_string(&second).await.unwrap(), second_json);
        let mut entries = fs::read_dir(&dir).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            assert!(!entry.file_name().to_string_lossy().ends_with(".tmp"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&first).await.unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(root).await.ok();
    }
}
