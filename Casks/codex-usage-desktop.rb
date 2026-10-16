cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.17.0"
  sha256 arm:   "2723c2c28e1f1005ca76ddcce33ae90a1b55bc08a308f774e434bcc49e6913ee",
         intel: "abad7b063b6fa81c1fea9941b796c6c0e981fef232e3d6b7a14e8f2519c79dbe"

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
