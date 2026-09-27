const fs = require('node:fs');
const path = require('node:path');

const repo = 'itvincent-git/codex-usage-desktop';
const snapshotPath = path.join(__dirname, '..', '.release-downloads.json');
const installers = {
  'codex-usage-desktop-macos-arm64.dmg': 'macOS ARM64',
  'codex-usage-desktop-macos-x64.dmg': 'macOS x64',
  'codex-usage-desktop-windows-x64-setup.exe': 'Windows x64'
};
const platforms = Object.values(installers);

async function fetchInstallers() {
  const assets = {};
  for (let page = 1; ; page += 1) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'codex-usage-desktop-download-trend' };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}: ${await response.text()}`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('GitHub API returned an unexpected response.');
    for (const release of releases) {
      if (release.draft || release.prerelease || !release.tag_name?.startsWith('app-v')) continue;
      for (const asset of release.assets || []) {
        const platform = installers[asset.name];
        if (platform) assets[asset.id] = { platform, count: asset.download_count };
      }
    }
    if (releases.length < 100) return assets;
  }
}

function totals(assets) {
  const result = Object.fromEntries(platforms.map((platform) => [platform, 0]));
  for (const asset of Object.values(assets)) result[asset.platform] += asset.count;
  return result;
}

function row(values) {
  const total = platforms.reduce((sum, platform) => sum + values[platform], 0);
  return `${String(total).padStart(7)}  ${platforms.map((platform) => String(values[platform]).padStart(11)).join('  ')}`;
}

async function main() {
  const history = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : [];
  if (!Array.isArray(history)) throw new Error(`Invalid snapshot file: ${snapshotPath}`);

  const fetched = await fetchInstallers();
  const previous = history.at(-1);
  const assets = { ...(previous?.assets || {}) };
  for (const [id, asset] of Object.entries(fetched)) {
    assets[id] = { ...asset, count: Math.max(asset.count, assets[id]?.count || 0) };
  }
  history.push({ at: new Date().toISOString(), assets });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(history, null, 2)}\n`);

  console.log(`GitHub Release installer downloads: ${repo}`);
  console.log('                               Total  macOS ARM64    macOS x64  Windows x64');
  console.log(`Current observed cumulative   ${row(totals(assets))}`);
  console.log('\nGrowth between snapshots (UTC):');
  if (history.length === 1) {
    console.log('Baseline saved. Run again later to see a trend.');
  } else {
    console.log('From                 To                     Total  macOS ARM64    macOS x64  Windows x64');
    for (let index = Math.max(1, history.length - 14); index < history.length; index += 1) {
      const before = totals(history[index - 1].assets);
      const after = totals(history[index].assets);
      const growth = Object.fromEntries(platforms.map((platform) => [platform, after[platform] - before[platform]]));
      console.log(`${history[index - 1].at.slice(0, 16)}     ${history[index].at.slice(0, 16)}  ${row(growth)}`);
    }
  }
  console.log('\nCounts are downloads, not installations. Windows setup downloads also include app updates.');
  console.log(`Snapshots: ${snapshotPath}`);
}

if (require.main === module) main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
