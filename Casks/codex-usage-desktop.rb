cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.16.1"
  sha256 arm:   "c46598e8543a25a21d10148b34aec421d12742619924ed91305d90acbe320ebc",
         intel: "05d6e23dcc928f4605015e447c2e61618f0c52b4fe655605bf30fbb37fda9278"

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
