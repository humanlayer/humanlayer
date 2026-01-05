# CodeLayer Windows Build Script
# Prerequisites: Rust, Go 1.21+, Bun, Visual Studio Build Tools, mingw-w64 (for CGO)

param(
    [switch]$Clean,
    [switch]$SkipDaemon,
    [switch]$DevMode
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$WuiDir = Join-Path $RepoRoot "humanlayer-wui"
$HldDir = Join-Path $RepoRoot "hld"
$BinDir = Join-Path $WuiDir "src-tauri\bin"

Write-Host "=== CodeLayer Windows Build ===" -ForegroundColor Cyan
Write-Host "Repository: $RepoRoot"
Write-Host "WUI Directory: $WuiDir"
Write-Host ""

# Clean if requested
if ($Clean) {
    Write-Host "Cleaning previous build artifacts..." -ForegroundColor Yellow
    if (Test-Path $BinDir) { Remove-Item -Recurse -Force $BinDir }
    if (Test-Path (Join-Path $WuiDir "src-tauri\target")) {
        Remove-Item -Recurse -Force (Join-Path $WuiDir "src-tauri\target")
    }
    # Restore all original files if they exist
    $origFiles = @(
        @{ Orig = Join-Path $WuiDir "src-tauri\src\daemon.rs.orig"; Target = Join-Path $WuiDir "src-tauri\src\daemon.rs" },
        @{ Orig = Join-Path $WuiDir "src-tauri\src\lib.rs.orig"; Target = Join-Path $WuiDir "src-tauri\src\lib.rs" },
        @{ Orig = Join-Path $WuiDir "src-tauri\Cargo.toml.orig"; Target = Join-Path $WuiDir "src-tauri\Cargo.toml" },
        @{ Orig = Join-Path $WuiDir "src-tauri\tauri.conf.json.orig"; Target = Join-Path $WuiDir "src-tauri\tauri.conf.json" },
        @{ Orig = Join-Path $RepoRoot "claudecode-go\client.go.orig"; Target = Join-Path $RepoRoot "claudecode-go\client.go" }
    )
    foreach ($file in $origFiles) {
        if (Test-Path $file.Orig) {
            Write-Host "  Restoring $(Split-Path $file.Target -Leaf)..."
            Move-Item -Force $file.Orig $file.Target
        }
    }
    Write-Host "Clean complete." -ForegroundColor Green
    if (!$SkipDaemon -and !$DevMode) {
        Write-Host "Run the script again without -Clean to build."
        exit 0
    }
}

# Check for required tools
Write-Host "`n[0/4] Checking prerequisites..." -ForegroundColor Green

# Check for gcc (required for CGO/SQLite)
$gccPath = $null
$mingwPaths = @(
    "$env:USERPROFILE\scoop\apps\mingw\current\bin",
    "C:\mingw64\bin",
    "C:\msys64\mingw64\bin",
    "C:\ProgramData\chocolatey\lib\mingw\tools\install\mingw64\bin"
)

foreach ($path in $mingwPaths) {
    if (Test-Path (Join-Path $path "gcc.exe")) {
        $gccPath = $path
        break
    }
}

# Also check if gcc is already in PATH
try {
    $null = Get-Command gcc -ErrorAction Stop
    $gccInPath = $true
} catch {
    $gccInPath = $false
}

if (!$gccPath -and !$gccInPath) {
    Write-Host "  ERROR: gcc not found. mingw-w64 is required for building the daemon." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Install mingw-w64 using one of these methods:" -ForegroundColor Yellow
    Write-Host "    scoop install mingw" -ForegroundColor White
    Write-Host "    choco install mingw -y" -ForegroundColor White
    Write-Host ""
    Write-Host "  Then run this script again." -ForegroundColor Yellow
    exit 1
}

if ($gccPath -and !$gccInPath) {
    Write-Host "  Found gcc at: $gccPath" -ForegroundColor Gray
    $env:PATH = "$gccPath;$env:PATH"
}

Write-Host "  gcc: OK" -ForegroundColor Gray

# Verify other tools
try { $null = Get-Command go -ErrorAction Stop; Write-Host "  go: OK" -ForegroundColor Gray }
catch { Write-Host "  ERROR: go not found" -ForegroundColor Red; exit 1 }

try { $null = Get-Command bun -ErrorAction Stop; Write-Host "  bun: OK" -ForegroundColor Gray }
catch { Write-Host "  ERROR: bun not found" -ForegroundColor Red; exit 1 }

try { $null = Get-Command cargo -ErrorAction Stop; Write-Host "  cargo: OK" -ForegroundColor Gray }
catch { Write-Host "  ERROR: cargo (Rust) not found" -ForegroundColor Red; exit 1 }

# Step 1: Apply Windows patches
Write-Host "`n[1/4] Applying Windows patches..." -ForegroundColor Green

# Define file paths
$DaemonRs = Join-Path $WuiDir "src-tauri\src\daemon.rs"
$LibRs = Join-Path $WuiDir "src-tauri\src\lib.rs"
$CargoToml = Join-Path $WuiDir "src-tauri\Cargo.toml"
$TauriConf = Join-Path $WuiDir "src-tauri\tauri.conf.json"
$ClientGo = Join-Path $RepoRoot "claudecode-go\client.go"

# Windows versions
$WindowsDaemonRs = Join-Path $ScriptDir "src-tauri\src\daemon.rs"
$WindowsLibRs = Join-Path $ScriptDir "src-tauri\src\lib.rs"
$WindowsTauriConf = Join-Path $ScriptDir "src-tauri\tauri.conf.json"
$WindowsClientGo = Join-Path $ScriptDir "claudecode-go\client.go"

# Backup original files (only if not already backed up)
$filesToBackup = @($DaemonRs, $LibRs, $CargoToml, $TauriConf, $ClientGo)
foreach ($file in $filesToBackup) {
    if ((Test-Path $file) -and !(Test-Path "$file.orig")) {
        Write-Host "  Backing up $(Split-Path $file -Leaf)..."
        Copy-Item $file "$file.orig"
    }
}

# Copy Windows-compatible files
Write-Host "  Copying Windows-compatible daemon.rs..."
Copy-Item $WindowsDaemonRs $DaemonRs -Force

Write-Host "  Copying Windows-compatible lib.rs..."
Copy-Item $WindowsLibRs $LibRs -Force

Write-Host "  Copying Windows-compatible tauri.conf.json..."
Copy-Item $WindowsTauriConf $TauriConf -Force

Write-Host "  Copying Windows-compatible client.go..."
Copy-Item $WindowsClientGo $ClientGo -Force

# Apply Cargo.toml patch (make nix conditional)
Write-Host "  Patching Cargo.toml to make nix Unix-only..."
$cargoContent = Get-Content $CargoToml -Raw

# Remove the unconditional nix dependency
$cargoContent = $cargoContent -replace 'nix = \{ version = "0\.30\.1", features = \["signal", "process"\] \}\r?\n', ''

# Add Unix-conditional nix dependency before macOS dependencies
$cargoContent = $cargoContent -replace '(\[target\.''cfg\(target_os = "macos"\)''\.dependencies\])', @"
[target.'cfg(unix)'.dependencies]
nix = { version = "0.30.1", features = ["signal", "process"] }

`$1
"@

Set-Content $CargoToml $cargoContent -NoNewline
Write-Host "  Patches applied successfully." -ForegroundColor Green

# Step 2: Build hld daemon with CGO
if (!$SkipDaemon) {
    Write-Host "`n[2/4] Building hld daemon (with CGO for SQLite)..." -ForegroundColor Green
    Push-Location $HldDir

    try {
        # CGO is required for go-sqlite3
        $env:CGO_ENABLED = "1"
        $env:GOOS = "windows"
        $env:GOARCH = "amd64"

        Write-Host "  CGO_ENABLED=1 (required for SQLite)"
        Write-Host "  Running: go build -o hld.exe ./cmd/hld"
        go build -o hld.exe ./cmd/hld

        if (!(Test-Path $BinDir)) {
            New-Item -ItemType Directory -Path $BinDir | Out-Null
        }

        # Copy to both hld and hld.exe (Tauri resources expect hld, runtime expects hld.exe)
        Copy-Item -Force hld.exe (Join-Path $BinDir "hld.exe")
        Copy-Item -Force hld.exe (Join-Path $BinDir "hld")
        Remove-Item hld.exe

        Write-Host "  Daemon built and copied to $BinDir" -ForegroundColor Green
    }
    finally {
        Pop-Location
        # Clear environment variables
        Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
        Remove-Item Env:GOOS -ErrorAction SilentlyContinue
        Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "`n[2/4] Skipping daemon build (-SkipDaemon)..." -ForegroundColor Yellow

    # Check if daemon exists
    $daemonPath = Join-Path $BinDir "hld.exe"
    if (!(Test-Path $daemonPath)) {
        Write-Host "  WARNING: hld.exe not found at $daemonPath" -ForegroundColor Yellow
        Write-Host "  The application may not work without the daemon." -ForegroundColor Yellow
    }
}

# Step 3: Install frontend dependencies
Write-Host "`n[3/4] Installing frontend dependencies..." -ForegroundColor Green
Push-Location $WuiDir
try {
    Write-Host "  Running: bun install"
    bun install
}
finally {
    Pop-Location
}

# Step 4: Build Tauri app
Write-Host "`n[4/4] Building Tauri application..." -ForegroundColor Green
Push-Location $WuiDir
try {
    if ($DevMode) {
        Write-Host "  Running: bun run tauri dev"
        bun run tauri dev
    } else {
        Write-Host "  Running: bun run tauri build"
        bun run tauri build
    }
}
finally {
    Pop-Location
}

Write-Host "`n=== Build Complete ===" -ForegroundColor Cyan

if (!$DevMode) {
    $msiPath = Join-Path $WuiDir "src-tauri\target\release\bundle\msi"
    $exePath = Join-Path $WuiDir "src-tauri\target\release\humanlayer-wui.exe"

    Write-Host ""
    Write-Host "Output files:" -ForegroundColor Green

    if (Test-Path $msiPath) {
        $msiFiles = Get-ChildItem $msiPath -Filter "*.msi"
        foreach ($msi in $msiFiles) {
            Write-Host "  MSI Installer: $($msi.FullName)"
        }
    }

    if (Test-Path $exePath) {
        Write-Host "  Executable: $exePath"
    }

    Write-Host ""
    Write-Host "To restore original files, run: .\build.ps1 -Clean" -ForegroundColor Gray
}
