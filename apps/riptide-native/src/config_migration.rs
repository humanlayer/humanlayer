use serde_json::Value;
use std::path::Path;

/// Migrate config files to expand tilde paths in artifactsRepo
/// This fixes configs that were written with unexpanded "~" paths
pub fn migrate_configs_on_boot() {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            log::warn!("Could not determine home directory for config migration");
            return;
        }
    };

    // Migrate ~/.humanlayer/riptide/config.json
    let riptide_config = home.join(".humanlayer").join("riptide").join("config.json");
    if let Err(e) = migrate_config_file(&riptide_config) {
        log::warn!("Failed to migrate riptide config: {}", e);
    }

    // Migrate ~/.config/rpi/config.json
    let rpi_config = home.join(".config").join("rpi").join("config.json");
    if let Err(e) = migrate_config_file(&rpi_config) {
        log::warn!("Failed to migrate rpi config: {}", e);
    }
}

/// Migrate a single config file by expanding tilde in artifactsRepo
fn migrate_config_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read config: {}", e))?;

    let mut config: Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    let mut modified = false;

    if let Value::Object(ref mut map) = config {
        if let Some(Value::String(artifacts_repo)) = map.get("artifactsRepo") {
            // Check if the path contains an unexpanded tilde
            if artifacts_repo.starts_with('~') {
                let expanded = shellexpand::tilde(artifacts_repo).to_string();
                log::info!(
                    "Migrating config {:?}: expanding artifactsRepo from '{}' to '{}'",
                    path,
                    artifacts_repo,
                    expanded
                );
                map.insert("artifactsRepo".to_string(), Value::String(expanded));
                modified = true;
            }
        }
    }

    if modified {
        let new_content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(path, new_content).map_err(|e| format!("Failed to write config: {}", e))?;
        log::info!("Successfully migrated config: {:?}", path);
    }

    Ok(())
}
