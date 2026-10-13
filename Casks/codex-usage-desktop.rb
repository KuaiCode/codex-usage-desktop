cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.15.2"
  sha256 arm:   "722d3f66219d8dc281bcb6f5a2cf48884ed0bae6db9ef1a8f5374ca86f61d883",
         intel: "49b01c56c38950f5789e20bbe2e3a54ea8adbe306fdb95cb0a9bdcfd3ed7c670"

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
