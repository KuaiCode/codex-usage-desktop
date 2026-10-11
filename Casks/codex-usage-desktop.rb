cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.15.1"
  sha256 arm:   "a06e9c0def5d2cfe51e215c1c3749ef69ba65318bbd3236c53524cfb15be01d0",
         intel: "d5db4a7c365008fe871a2f7f72bdf97edafc4bbe162a1a9ea85dace2c8c7f759"

  url "https://github.com/itvincent-git/codex-usage-desktop/releases/download/app-v#{version}/codex-usage-desktop-macos-#{arch}.dmg"
  name "Codex Usage Desktop"
  desc "Local-first dashboard for Codex CLI token usage and cost estimates"
  homepage "https://github.com/itvincent-git/codex-usage-desktop"

  depends_on :macos

  app "Codex Usage Desktop.app"

  zap trash: [
    "~/Library/Application Support/com.ccusage.codex.desktop",
    "~/Library/Caches/com.ccusage.codex.desktop",
    "~/Library/Logs/com.ccusage.codex.desktop",
    "~/Library/Preferences/com.ccusage.codex.desktop.plist",
    "~/Library/Saved Application State/com.ccusage.codex.desktop.savedState",
  ]
end
