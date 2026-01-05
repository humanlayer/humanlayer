# CodeLayer Windows Port

This folder contains everything needed to build CodeLayer on Windows.

## Prerequisites

1. **Rust** (latest stable)
   - Install from: https://rustup.rs/
   - Ensure `cargo` is in PATH

2. **Go 1.21+**
   - Install from: https://go.dev/dl/
   - Ensure `go` is in PATH

3. **Bun**
   - Install from: https://bun.sh/
   - Or: `powershell -c "irm bun.sh/install.ps1 | iex"`

4. **Visual Studio Build Tools**
   - Install "Desktop development with C++" workload
   - Or install full Visual Studio 2022

5. **mingw-w64** (Required for CGO/SQLite)
   - The daemon uses SQLite which requires CGO compilation
   - Install via scoop (recommended): `scoop install mingw`
   - Or via chocolatey: `choco install mingw -y`
   - Verify with: `gcc --version`

6. **WebView2**
   - Usually pre-installed on Windows 10/11
   - If missing: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## Build Instructions

### Quick Build

```powershell
cd codelayer-windows
.\build.ps1
```

The script will:
1. Check for all prerequisites (including mingw)
2. Apply Windows-specific patches
3. Build the daemon with CGO enabled
4. Build the Tauri application
5. Create MSI and NSIS installers

### Build Options

```powershell
# Clean build (removes previous artifacts and restores original files)
.\build.ps1 -Clean

# Skip daemon build (if hld.exe already exists)
.\build.ps1 -SkipDaemon

# Development mode (runs `tauri dev` instead of `tauri build`)
.\build.ps1 -DevMode
```

### Manual Build Steps

If you prefer to build manually:

1. **Ensure mingw is in PATH:**
   ```powershell
   # If installed via scoop:
   $env:PATH = "$env:USERPROFILE\scoop\apps\mingw\current\bin;$env:PATH"
   gcc --version  # Verify
   ```

2. **Build the daemon with CGO:**
   ```powershell
   cd hld
   $env:CGO_ENABLED = "1"
   $env:GOOS = "windows"
   $env:GOARCH = "amd64"
   go build -o hld.exe ./cmd/hld

   # Copy to bin folder (both names needed)
   mkdir ..\humanlayer-wui\src-tauri\bin -Force
   cp hld.exe ..\humanlayer-wui\src-tauri\bin\hld.exe
   cp hld.exe ..\humanlayer-wui\src-tauri\bin\hld
   ```

3. **Apply Windows patches:**
   ```powershell
   # Backup originals
   cp humanlayer-wui\src-tauri\src\daemon.rs humanlayer-wui\src-tauri\src\daemon.rs.orig
   cp humanlayer-wui\src-tauri\Cargo.toml humanlayer-wui\src-tauri\Cargo.toml.orig

   # Copy Windows-compatible daemon.rs
   cp codelayer-windows\src-tauri\src\daemon.rs humanlayer-wui\src-tauri\src\daemon.rs

   # Manually edit Cargo.toml to make nix conditional (see Cargo.toml section below)
   ```

4. **Build the app:**
   ```powershell
   cd humanlayer-wui
   bun install
   bun run tauri build
   ```

## Cargo.toml Changes

The `nix` crate only supports Unix. For Windows, you need to modify `src-tauri/Cargo.toml`:

**Find this line (around line 38):**
```toml
nix = { version = "0.30.1", features = ["signal", "process"] }
```

**Remove it and add before the macOS dependencies section:**
```toml
[target.'cfg(unix)'.dependencies]
nix = { version = "0.30.1", features = ["signal", "process"] }
```

The build script (`build.ps1`) does this automatically.

## Output

After a successful build:
- **MSI Installer**: `humanlayer-wui/src-tauri/target/release/bundle/msi/CodeLayer_*.msi`
- **NSIS Installer**: `humanlayer-wui/src-tauri/target/release/bundle/nsis/CodeLayer_*-setup.exe`
- **Executable**: `humanlayer-wui/src-tauri/target/release/humanlayer-wui.exe`

## What the Build Script Does

1. **Checks prerequisites** - Verifies gcc, go, bun, cargo are available
2. **Backs up original files** - Creates `.orig` copies of daemon.rs and Cargo.toml
3. **Copies Windows-compatible daemon.rs** - Replaces Unix signal handling with cross-platform code
4. **Patches Cargo.toml** - Makes the `nix` crate Unix-only via conditional compilation
5. **Builds hld daemon with CGO** - Required for SQLite support
6. **Updates Tauri resources** - Ensures hld.exe is bundled
7. **Installs dependencies** - Runs `bun install`
8. **Builds Tauri app** - Runs `bun run tauri build`

## Restoring Original Files

To restore the original macOS/Unix build:
```powershell
.\build.ps1 -Clean
```

This will restore the original daemon.rs and Cargo.toml from the `.orig` backups.

## Troubleshooting

### "gcc not found" or "CGO_ENABLED" errors
Install mingw-w64:
```powershell
scoop install mingw
# or
choco install mingw -y
```

### "Binary was compiled with 'CGO_ENABLED=0'"
The daemon requires CGO for SQLite. Ensure:
1. mingw-w64 is installed
2. gcc is in PATH
3. Build with `$env:CGO_ENABLED = "1"`

### "nix crate doesn't compile"
Ensure the Cargo.toml patch was applied correctly. The `nix` dependency must be under `[target.'cfg(unix)'.dependencies]`.

### "hld.exe not found"
Run the build script with daemon: `.\build.ps1` (without `-SkipDaemon`)

### "WebView2 not found"
Install WebView2 runtime from Microsoft.

### Application crashes on startup
Check that hld.exe is in the `bin/` folder inside the app resources:
```powershell
ls humanlayer-wui\src-tauri\bin\
```

### Build fails with linker errors
Ensure Visual Studio Build Tools are installed with the "Desktop development with C++" workload.

### "Command not found: bun/go/cargo"
Ensure all prerequisites are installed and in your PATH. Try opening a new terminal after installation.

### Hotkey (Win+Shift+H) not working
The global hotkey may be taken by another application. CodeLayer will still work, but the quick launcher hotkey won't be available. Check Windows Settings > Accessibility for conflicting shortcuts.

## Known Limitations

1. **No native window theming** - Windows version uses CSS-only theming, may have white flash on startup
2. **No code signing** - Windows SmartScreen may warn on first launch (click "More info" > "Run anyway")
3. **No auto-update** - Manual reinstallation required for updates
4. **No graceful shutdown** - Daemon is terminated immediately (no SIGTERM on Windows)
5. **Global hotkey conflicts** - Win+Shift+H may conflict with Windows accessibility features

## Architecture

The Windows port makes these key changes to the codebase:

### daemon.rs Changes
- Replaces Unix SIGTERM signal handling with `Child::kill()` (cross-platform)
- Adds `.exe` extension to binary paths via `#[cfg(windows)]`
- Adds `CREATE_NO_WINDOW` flag to hide daemon console window
- Uses `std::os::windows::process::CommandExt` for Windows-specific process creation

### claudecode-go Changes
- Claude binary detection uses `USERPROFILE` as fallback for `HOME`
- Searches Windows-specific paths: `.local\bin\claude.exe`, `LOCALAPPDATA\Programs\`, `APPDATA\npm\`
- Tries both `claude` and `claude.exe` in PATH lookup

### lib.rs Changes
- Global hotkey registration is non-fatal (logs warning instead of crashing)

All other code (frontend, HTTP communication, SQLite database) works unchanged on Windows.

## Contributing

To contribute Windows improvements:
1. Fork the humanlayer/humanlayer repository
2. Make changes in this `codelayer-windows/` folder
3. Test on Windows
4. Submit a PR with your improvements

## Technical Details

### Process Management

Windows doesn't have Unix signals (SIGTERM, SIGKILL). The Windows port uses:
- `std::process::Child::kill()` - Calls `TerminateProcess()` on Windows
- `CREATE_NO_WINDOW` flag (0x08000000) - Hides the daemon console window
- This is immediate termination (no graceful shutdown)
- Future improvement: Use named pipes or WM_CLOSE for graceful shutdown

### CGO Requirement

The `mattn/go-sqlite3` package requires CGO because it wraps the C SQLite library. On Windows:
- mingw-w64 provides the GCC compiler needed for CGO
- Build with `CGO_ENABLED=1` environment variable
- The resulting binary is larger (~42MB vs ~25MB) but fully functional

### File Paths

Windows binaries need `.exe` extension. The daemon.rs includes:
```rust
#[cfg(windows)]
const DAEMON_BINARY: &str = "hld.exe";
#[cfg(not(windows))]
const DAEMON_BINARY: &str = "hld";
```

### Resource Bundling

Tauri's resource bundling works the same on Windows. The `bin/hld.exe` is bundled into the app resources and extracted at runtime. Both `bin/hld` and `bin/hld.exe` are included for compatibility.
