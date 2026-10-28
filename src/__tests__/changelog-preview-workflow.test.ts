import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

const workflow = load(
  readFileSync(
    join(__dirname, '../../.github/workflows/changelog-preview.yml'),
    'utf8',
  ),
) as {
  jobs: {
    preview: {
      steps: { name?: string; run?: string; env?: Record<string, string> }[];
    };
  };
};
const install = workflow.jobs.preview.steps.find(
  step => step.name === 'Install Craft',
)!;

test.each(['latest', 'missing-tag', 'v2.35.0'])(
  'installs %s with authenticated release lookups and anonymous asset downloads',
  version => {
    const directory = mkdtempSync(join(tmpdir(), 'craft-preview-install-'));
    try {
      const executable = (name: string, body: string) => {
        const path = join(directory, name);
        writeFileSync(path, '#!/usr/bin/env bash\nset -euo pipefail\n' + body);
        chmodSync(path, 0o755);
      };
      executable(
        'gh',
        `
[[ "\${GH_TOKEN:-}" == 'fixture-token' ]] || exit 90
[[ "$*" == 'api repos/getsentry/craft/releases/latest --jq '* ]] || exit 91
printf 'authenticated\\n' >> "$CALLS"
printf 'https://github.com/getsentry/craft/releases/download/v2.35.0/craft\\n'
`,
      );
      executable(
        'curl',
        `
# An unauthenticated API request reproduces the hosted 403.
[[ "$*" != *'api.github.com'* ]] || exit 22
# The token belongs only on API requests, never asset download headers.
[[ "$*" != *'fixture-token'* ]] || exit 92
if [[ "$1" == '-sfI' ]]; then
  [[ "$2" != *'missing-tag'* ]]
  exit
fi
[[ "$1" == '-fsSL' && "$2" == '-o' ]] || exit 93
printf '#!/usr/bin/env bash\\nprintf "2.35.0\\\\n"\\n' > "$3"
`,
      );
      executable('sudo', 'exec "$@"\n');
      const result = spawnSync(
        'bash',
        [
          '-euo',
          'pipefail',
          '-c',
          install.run!.replaceAll(
            '/usr/local/bin/craft',
            join(directory, 'craft'),
          ),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ...Object.fromEntries(
              Object.entries(install.env || {}).map(([key, value]) => [
                key,
                value.replace('${{ secrets.GITHUB_TOKEN }}', 'fixture-token'),
              ]),
            ),
            PATH: directory + ':' + process.env.PATH,
            CRAFT_VERSION_INPUT: version,
            CALLS: join(directory, 'calls'),
          },
        },
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('2.35.0');
      if (version !== 'v2.35.0') {
        expect(readFileSync(join(directory, 'calls'), 'utf8')).toBe(
          'authenticated\n',
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

const preview = workflow.jobs.preview.steps.find(
  step => step.name === 'Generate Changelog Preview',
)!;

function runPreview(craftOutput: object, comment: 'true' | 'false') {
  const directory = mkdtempSync(join(tmpdir(), 'craft-preview-'));
  try {
    const executable = (name: string, body: string) => {
      const path = join(directory, name);
      writeFileSync(path, '#!/usr/bin/env bash\nset -euo pipefail\n' + body);
      chmodSync(path, 0o755);
    };
    writeFileSync(join(directory, 'result.json'), JSON.stringify(craftOutput));
    executable('craft', `cat "${join(directory, 'result.json')}"\n`);
    // Records each call; comment bodies are copied from their @file argument
    executable(
      'gh',
      `
printf '%s\\n' "$*" >> "$CALLS"
for arg in "$@"; do
  if [[ "$arg" == body=@* ]]; then cat "\${arg#body=@}" >> "$CALLS"; fi
done
`,
    );
    const files = {
      output: join(directory, 'output'),
      summary: join(directory, 'summary'),
      calls: join(directory, 'calls'),
    };
    for (const file of Object.values(files)) {
      writeFileSync(file, '');
    }
    const result = spawnSync(
      'bash',
      [
        '-eo',
        'pipefail',
        '-c',
        preview.run!.replace('${{ inputs.comment }}', comment),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: directory + ':' + process.env.PATH,
          PR_NUMBER: '7',
          HEAD_SHA: 'abc123',
          GITHUB_REPOSITORY: 'getsentry/example',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_RUN_ID: '1',
          GITHUB_OUTPUT: files.output,
          GITHUB_STEP_SUMMARY: files.summary,
          CALLS: files.calls,
        },
      },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return {
      output: readFileSync(files.output, 'utf8'),
      summary: readFileSync(files.summary, 'utf8'),
      calls: readFileSync(files.calls, 'utf8'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('lists each workspace the PR lands in with its bump in one comment', () => {
  const { output, calls } = runPreview(
    {
      changelog: '### New Features\n\n> - Add option',
      bumpType: 'minor',
      versioningPolicy: 'auto',
      prSkipped: false,
      workspaces: [
        { name: 'clients/python', bumpType: 'minor', versioningPolicy: 'auto' },
        { name: 'clients/rust', bumpType: 'patch', versioningPolicy: 'auto' },
        { name: 'server', bumpType: 'minor', versioningPolicy: 'calver' },
      ],
    },
    'true',
  );

  expect(output).toContain('workspace_count=3\n');
  // One comment body, posted once
  expect(calls.match(/^<!-- craft-changelog-preview -->$/gm)).toHaveLength(1);
  expect(calls).toContain(
    'This PR lands in these workspaces:\n\n' +
      '- `clients/python`: 🟡 **Minor** (new features)\n' +
      '- `clients/rust`: 🟢 **Patch** (bug fixes)\n' +
      '- `server`: CalVer\n',
  );
  expect(calls.match(/> - Add option/g)).toHaveLength(1);
});

test('names each workspace and bump in a single commit status', () => {
  const { calls, summary } = runPreview(
    {
      changelog: '',
      bumpType: 'minor',
      versioningPolicy: 'auto',
      prSkipped: true,
      workspaces: [
        { name: 'clients/python', bumpType: 'minor', versioningPolicy: 'auto' },
        { name: 'clients/rust', bumpType: null, versioningPolicy: 'auto' },
      ],
    },
    'false',
  );

  const statuses = calls.split('\n').filter(line => line.includes('statuses'));
  expect(statuses).toHaveLength(1);
  expect(statuses[0]).toContain(
    'description=clients/python: Minor, clients/rust: None',
  );
  expect(statuses[0]).toContain('context=Changelog Preview / Semver Impact');
  expect(summary).toContain('_This PR will not appear in the changelog._');
});

test('says so when the PR lands in no workspace', () => {
  const { output, summary, calls } = runPreview(
    {
      changelog: '',
      bumpType: null,
      versioningPolicy: 'auto',
      prSkipped: false,
      workspaces: [],
    },
    'false',
  );

  expect(output).toContain('workspace_count=0\n');
  expect(calls).toContain('description=No workspace changed');
  expect(summary).toContain('⚪ **None** (no workspace changed)');
  expect(summary).toContain('will not appear in any changelog');
});

test('keeps the single-changelog preview without workspaces', () => {
  const { output, summary, calls } = runPreview(
    {
      changelog: '### Bug Fixes\n\n> - Fix crash',
      bumpType: 'patch',
      versioningPolicy: 'auto',
      prSkipped: false,
    },
    'false',
  );

  expect(output).toContain('workspace_count=\n');
  expect(calls).toContain('description=Patch');
  expect(summary).toContain('🟢 **Patch** (bug fixes)');
  expect(summary).toContain('> - Fix crash');
});
