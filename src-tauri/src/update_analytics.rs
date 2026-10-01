use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::Path;

pub fn load_install_id(path: &Path) -> Result<String, String> {
    fn read_id(path: &Path) -> Result<String, String> {
        let value = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::parse_str(value.trim()).map_err(|e| e.to_string())?;
        if id.get_version_num() != 4 {
            return Err("Installation ID must be UUID v4".to_string());
        }
        Ok(id.to_string())
    }
    match std::fs::read_to_string(path) {
        Ok(_) => return read_id(path),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let id = uuid::Uuid::new_v4().to_string();
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(id.as_bytes()).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            Ok(id)
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => read_id(path),
        Err(error) => Err(error.to_string()),
    }
}

pub fn manifest_endpoint(endpoint: &str, version: &str) -> Result<reqwest::Url, String> {
    let platform = tauri_plugin_updater::target().ok_or("Unsupported updater platform")?;
    let (target, arch) = platform.split_once('-').ok_or("Invalid updater platform")?;
    reqwest::Url::parse(
        &endpoint
            .replace("{{current_version}}", version)
            .replace("{{target}}", target)
            .replace("{{arch}}", arch),
    )
    .map_err(|e| e.to_string())
}

pub fn uses_analytics(endpoint: &str) -> bool {
    endpoint.contains("v={{current_version}}")
        && endpoint.contains("target={{target}}")
        && endpoint.contains("arch={{arch}}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_id_is_random_and_persisted() {
        let directory =
            std::env::temp_dir().join(format!("codex-install-id-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("analytics-install-id");
        let id = load_install_id(&path).unwrap();
        assert_eq!(uuid::Uuid::parse_str(&id).unwrap().get_version_num(), 4);
        assert_eq!(load_install_id(&path).unwrap(), id);
        assert_ne!(load_install_id(&directory.join("other-id")).unwrap(), id);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn bad_storage_disables_analytics_instead_of_replacing_identity() {
        let path = std::env::temp_dir().join(format!("codex-invalid-id-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, "invalid").unwrap();
        assert!(load_install_id(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn configured_endpoint_uses_the_updater_platform_variables() {
        let endpoint = "https://tup.itvincent.net/codex-usage-desktop/latest.json?v={{current_version}}&target={{target}}&arch={{arch}}";
        let url = manifest_endpoint(endpoint, "3.9.0").unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(params["v"], "3.9.0");
        assert_eq!(
            format!("{}-{}", params["target"], params["arch"]),
            tauri_plugin_updater::target().unwrap()
        );
        assert!(uses_analytics(endpoint));
        assert!(!uses_analytics(
            "https://github.com/owner/repo/releases/latest/download/latest.json"
        ));
    }
}
