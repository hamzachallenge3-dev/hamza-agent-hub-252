/** Cross-forge intelligence helpers from Hamza plugin-builder handoff (lab). */

const FORGES: Array<{ id: string; host: RegExp; label: string }> = [
  { id: 'github', host: /github\.com/i, label: 'GitHub' },
  { id: 'gitlab', host: /gitlab\.com|gitlab\./i, label: 'GitLab' },
  { id: 'bitbucket', host: /bitbucket\.org/i, label: 'Bitbucket' },
  { id: 'azure-devops', host: /dev\.azure\.com|visualstudio\.com/i, label: 'Azure DevOps' },
  { id: 'codeberg', host: /codeberg\.org/i, label: 'Codeberg' },
  { id: 'gitea', host: /gitea\./i, label: 'Gitea' },
  { id: 'forgejo', host: /forgejo\./i, label: 'Forgejo' },
  { id: 'sourceforge', host: /sourceforge\.net/i, label: 'SourceForge' },
  { id: 'launchpad', host: /launchpad\.net/i, label: 'Launchpad' },
  { id: 'srht', host: /sr\.ht|sourcehut/i, label: 'SourceHut' },
];

export function forgeDetect(url: string): {
  forge: string;
  label: string;
  url: string;
  supported: boolean;
} {
  for (const f of FORGES) {
    if (f.host.test(url)) {
      return { forge: f.id, label: f.label, url, supported: true };
    }
  }
  return { forge: 'unknown', label: 'Unknown', url, supported: false };
}

export function githubUrlTricks(repoUrl: string): Record<string, string> {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return { error: 'not a github repo url', input: repoUrl };
  const owner = m[1]!;
  const repo = m[2]!.replace(/\.git$/, '');
  const base = `https://github.com/${owner}/${repo}`;
  return {
    repo: base,
    gitingest: `https://gitingest.com/${owner}/${repo}`,
    gitdiagram: `https://gitdiagram.com/${owner}/${repo}`,
    github_dev: `https://github.dev/${owner}/${repo}`,
    raw_main_readme: `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
    api: `https://api.github.com/repos/${owner}/${repo}`,
    commits: `${base}/commits`,
    issues: `${base}/issues`,
    pulls: `${base}/pulls`,
    network: `${base}/network`,
    compare_template: `${base}/compare/<base>...<head>`,
  };
}

export function agentMiningQueries(): { skills: string[]; agents: string[]; mcp: string[]; tools: string[] } {
  return {
    skills: [
      'filename:SKILL.md path:skills',
      'SKILL.md "description:" language:Markdown',
      'path:.claude/skills extension:md',
    ],
    agents: [
      'filename:agents.md OR filename:AGENTS.md',
      '"you are a" agent reviewer OR architect path:agents',
      'path:.cursor/agents extension:md',
    ],
    mcp: [
      'filename:mcp.json OR filename:server.json "mcpServers"',
      '"@modelcontextprotocol/sdk" filename:package.json',
      'path:src "ListToolsRequestSchema" OR "tools/list"',
    ],
    tools: [
      '"inputSchema" "name" "description" path:tools',
      'filename:tools.ts OR filename:tools.js "server.tool"',
    ],
  };
}
