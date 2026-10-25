import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

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
const preview = workflow.jobs.preview.steps.find(
  step => step.name === 'Generate Changelog Preview',
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

describe('Generate Changelog Preview', () => {
  // Fake `gh` backed by JSON files, so the step's real jq lookup filter runs
  // against stored comments and the stored bodies are what the step wrote.
  const fakeGh = `#!/usr/bin/env bash
set -euo pipefail
comments="$STATE/comments.json"
statuses="$STATE/statuses.json"
args=("$@")
arg_after() {
  for ((i = 0; i < \${#args[@]}; i++)); do
    if [[ "\${args[$i]}" == "$1" ]]; then printf '%s' "\${args[$((i + 1))]}"; return; fi
  done
}
field() {
  for a in "\${args[@]}"; do
    if [[ "$a" == "$1="* ]]; then printf '%s' "\${a#"$1="}"; return; fi
  done
}
case "$*" in
  *'/statuses/'*)
    # Like GitHub, a new status replaces any with the same context, ignoring case
    jq --arg c "$(field context)" --arg d "$(field description)" \
      'map(select((.context | ascii_downcase) != ($c | ascii_downcase))) + [{context: $c, description: $d}]' \
      "$statuses" > "$statuses.tmp"
    mv "$statuses.tmp" "$statuses" ;;
  *'--jq'*)
    jq -r "$(arg_after --jq)" "$comments" ;;
  *'-X PATCH'*)
    id="\${args[3]##*/}"
    jq --argjson id "$id" --rawfile b "$(field body | cut -c2-)" \
      'map(if .id == $id then .body = $b else . end)' "$comments" > "$comments.tmp"
    mv "$comments.tmp" "$comments" ;;
  *'-X POST'*)
    jq --rawfile b "$(field body | cut -c2-)" \
      '. + [{id: (length + 1), body: $b}]' "$comments" > "$comments.tmp"
    mv "$comments.tmp" "$comments" ;;
  *) exit 99 ;;
esac
`;

  let root: string;
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'craft-preview-'));
    repo = join(root, 'repo');
    for (const dir of [
      'packages/python',
      'packages/rust',
      'packages/foo bar',
      'packages/foo-bar',
    ]) {
      mkdirSync(join(repo, dir), { recursive: true });
    }
    spawnSync('git', ['init', '-q', repo]);
    mkdirSync(join(root, 'bin'));
    const executable = (name: string, body: string) => {
      writeFileSync(join(root, 'bin', name), body);
      chmodSync(join(root, 'bin', name), 0o755);
    };
    executable('gh', fakeGh);
    executable(
      'craft',
      `#!/usr/bin/env bash
printf '%s' '{"changelog":"- Entry","bumpType":"minor","prSkipped":false,"versioningPolicy":"auto"}'
`,
    );
    writeFileSync(join(root, 'comments.json'), '[]');
    writeFileSync(join(root, 'statuses.json'), '[]');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(dir: string, { comment = true } = {}): string {
    const summary = join(root, 'summary.md');
    writeFileSync(summary, '');
    const result = spawnSync(
      'bash',
      [
        '-eo',
        'pipefail',
        '-c',
        preview.run!.replace('${{ inputs.comment }}', String(comment)),
      ],
      {
        cwd: join(repo, dir),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: join(root, 'bin') + ':' + process.env.PATH,
          STATE: root,
          PR_NUMBER: '7',
          HEAD_SHA: 'abc123',
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_RUN_ID: '1',
          GITHUB_OUTPUT: join(root, 'output'),
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return readFileSync(summary, 'utf8');
  }

  const comments = () =>
    JSON.parse(readFileSync(join(root, 'comments.json'), 'utf8')) as {
      id: number;
      body: string;
    }[];
  const statuses = () =>
    JSON.parse(readFileSync(join(root, 'statuses.json'), 'utf8')) as {
      context: string;
      description: string;
    }[];
  const firstLines = (body: string) => body.split('\n').slice(0, 2);

  test('keeps the original comment identity for the repo root', () => {
    writeFileSync(
      join(root, 'comments.json'),
      JSON.stringify([
        { id: 1, body: '<!-- craft-changelog-preview -->\nold' },
      ]),
    );
    run('.');
    expect(comments()).toHaveLength(1);
    expect(firstLines(comments()[0].body)).toEqual([
      '<!-- craft-changelog-preview -->',
      '## Semver Impact of This PR',
    ]);
  });

  test('gives each package directory its own comment', () => {
    run('.');
    run('packages/python');
    run('packages/rust');
    run('packages/python');
    expect(comments().map(c => firstLines(c.body))).toEqual([
      ['<!-- craft-changelog-preview -->', '## Semver Impact of This PR'],
      [
        '<!-- craft-changelog-preview:packages/python -->',
        '## Semver Impact of This PR (packages/python)',
      ],
      [
        '<!-- craft-changelog-preview:packages/rust -->',
        '## Semver Impact of This PR (packages/rust)',
      ],
    ]);
  });

  test('uses a separate status context per directory', () => {
    const summary = run('packages/python', { comment: false });
    run('packages/rust', { comment: false });
    run('.', { comment: false });
    expect(statuses()).toEqual([
      {
        context: 'Changelog Preview / Semver Impact (packages/python)',
        description: 'Minor',
      },
      {
        context: 'Changelog Preview / Semver Impact (packages/rust)',
        description: 'Minor',
      },
      { context: 'Changelog Preview / Semver Impact', description: 'Minor' },
    ]);
    expect(summary).toContain('## Semver Impact of This PR (packages/python)');
    expect(comments()).toEqual([]);
  });

  test('keeps status contexts apart for directories differing only in case', ({
    skip,
  }) => {
    if (existsSync(join(repo, 'packages/PYTHON'))) {
      skip('needs a case-sensitive file system');
    }
    mkdirSync(join(repo, 'packages/Python'));
    run('packages/python', { comment: false });
    run('packages/Python', { comment: false });
    run('packages/Python', { comment: false });
    const contexts = statuses().map(s => s.context);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toBe(
      'Changelog Preview / Semver Impact (packages/python)',
    );
    expect(contexts[1]).toMatch(
      /^Changelog Preview \/ Semver Impact \(packages\/Python~[0-9a-f]{8}\)$/,
    );
  });

  test('keeps directories apart when sanitizing makes their names equal', () => {
    run('packages/foo-bar');
    run('packages/foo bar');
    run('packages/foo bar');
    const markers = comments().map(c => c.body.split('\n')[0]);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toBe(
      '<!-- craft-changelog-preview:packages/foo-bar -->',
    );
    expect(markers[1]).toMatch(
      /^<!-- craft-changelog-preview:packages\/foo-bar~[0-9a-f]{8} -->$/,
    );
  });
});
