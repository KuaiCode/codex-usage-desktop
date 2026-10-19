cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "4.0.1"
  sha256 arm:   "f45c6bc721c1b64254966c2b65b5f5156b5f1a93534198ceeb5cafd2b60f3edd",
         intel: "354b15464b88eceaed25911d771e7187d9843c9b561345ef848b26215795b07b"

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
