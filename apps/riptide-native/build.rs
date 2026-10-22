fn main() {
    // Pass BUILD_TYPE to compilation for Sentry environment
    if let Ok(build_type) = std::env::var("BUILD_TYPE") {
        println!("cargo:rustc-env=BUILD_TYPE={}", build_type);
    }

    // Pass SENTRY_ENVIRONMENT to compilation for Sentry
    if let Ok(sentry_env) = std::env::var("SENTRY_ENVIRONMENT") {
        println!("cargo:rustc-env=SENTRY_ENVIRONMENT={}", sentry_env);
    }

    // Pass BUILD_VERSION to compilation for Sentry release tracking
    if let Ok(build_version) = std::env::var("BUILD_VERSION") {
        println!("cargo:rustc-env=BUILD_VERSION={}", build_version);
    }

    tauri_build::build()
}
