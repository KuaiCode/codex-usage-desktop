const { git } = require('./git-utils.cjs');

async function previousRelease(cwd, ref = 'HEAD') {
  const repo = process.env.GITHUB_REPOSITORY || 'itvincent-git/codex-usage-desktop';
  const tags = new Set();
  for (let page = 1; ; page += 1) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'codex-usage-desktop-release' };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`GitHub releases query failed (HTTP ${response.status}).`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('GitHub API returned an unexpected response.');
    for (const release of releases) {
      if (!release.draft && !release.prerelease && /^app-v\d+\.\d+\.\d+$/.test(release.tag_name)) {
        tags.add(release.tag_name);
      }
    }
    if (releases.length < 100) break;
  }

  const ancestors = git(['tag', '--merged', ref], { cwd }).trim().split('\n');
  const publishedTags = ancestors.filter(tag => tags.has(tag));
  if (publishedTags.length === 0) return '';
  return git(['describe', '--tags', '--abbrev=0', ...publishedTags.flatMap(tag => ['--match', tag]), ref], { cwd }).trim();
}

if (require.main === module) {
  previousRelease(process.cwd(), process.argv[2]).then(tag => console.log(tag)).catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { previousRelease };
