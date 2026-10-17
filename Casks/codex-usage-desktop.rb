cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.17.1"
  sha256 arm:   "8b999a1b92449885f83d8c1e9561c7a82f783abedada9441fc1a6bfcf2140b0a",
         intel: "72da4408b876dbbc7c0324c01b79114c08c78ce4dc42a78e1f2def2c5b3bf755"

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
