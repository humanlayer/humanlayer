cask "codelayer" do
  version "0.1.0"
  sha256 "YOUR_SHA256_HERE"  # Update after building DMG

  url "https://github.com/humanlayer/humanlayer/releases/download/v#{version}/HumanLayer-#{version}-darwin-arm64.dmg",
      verified: "github.com/humanlayer/humanlayer/"
  
  name "CodeLayer"
  desc "Desktop application for managing AI agent approvals and sessions"
  homepage "https://humanlayer.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "HumanLayer.app"

  # Create symlinks for bundled binaries in PATH
  # These binaries are located in the app bundle at Contents/Resources/bin/
  binary "#{appdir}/HumanLayer.app/Contents/Resources/bin/humanlayer"
  binary "#{appdir}/HumanLayer.app/Contents/Resources/bin/hld", target: "hld"

  zap trash: [
    "~/Library/Application Support/HumanLayer",
    "~/Library/Preferences/dev.humanlayer.codelayer.plist",
    "~/Library/Saved Application State/dev.humanlayer.codelayer.savedState",
    "~/.humanlayer/codelayer*.json",
    "~/.humanlayer/daemon*.db",
    "~/.humanlayer/daemon*.sock",
  ]
end