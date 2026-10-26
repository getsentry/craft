import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
  let root: string;
  let repo: string;
  let baseSha: string;

  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const write = (path: string, body: string) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'craft-preview-'));
    repo = join(root, 'repo');
    mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    for (const dir of ['packages/python', 'packages/rust', 'server']) {
      write(join(repo, dir, 'file'), 'base\n');
    }
    git('add', '.');
    git('commit', '-qm', 'base');
    baseSha = git('rev-parse', 'HEAD');

    // Stub `craft` reports the bump stored in each package directory
    write(
      join(root, 'bin', 'craft'),
      `#!/usr/bin/env bash
printf '{"changelog":"- Entry in %s","bumpType":"%s"}' "\${PWD##*/}" "$(cat bump 2>/dev/null || echo minor)"
`,
    );
    // Fake \`gh\` that records statuses and stores comments, looking them up
    // with the step's own --jq filter
    write(
      join(root, 'bin', 'gh'),
      `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
field() {
  for a in "\${args[@]}"; do
    if [[ "$a" == "$1="* ]]; then printf '%s' "\${a#"$1="}"; return; fi
  done
}
case "$*" in
  *'/statuses/'*) printf '%s|%s\\n' "$(field context)" "$(field description)" >> "$STATE/statuses" ;;
  *'--jq'*) jq -r "\${args[3]}" "$STATE/comments.json" ;;
  *'-X PATCH'*)
    jq --argjson id "\${args[3]##*/}" --rawfile b "$(field body | cut -c2-)" \\
      'map(if .id == $id then .body = $b else . end)' "$STATE/comments.json" > "$STATE/tmp"
    mv "$STATE/tmp" "$STATE/comments.json" ;;
  *'-X POST'*)
    jq --rawfile b "$(field body | cut -c2-)" '. + [{id: (length + 1), body: $b}]' \\
      "$STATE/comments.json" > "$STATE/tmp"
    mv "$STATE/tmp" "$STATE/comments.json" ;;
  *) exit 99 ;;
esac
`,
    );
    chmodSync(join(root, 'bin', 'craft'), 0o755);
    chmodSync(join(root, 'bin', 'gh'), 0o755);
    writeFileSync(join(root, 'comments.json'), '[]');
    writeFileSync(join(root, 'statuses'), '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Commits a PR change touching the given directories */
  function change(...dirs: string[]) {
    for (const dir of dirs) {
      write(join(repo, dir, 'file'), 'changed\n');
    }
    git('commit', '-qam', 'change');
  }

  function run(
    directories: string,
    { comment = true, env = {} as Record<string, string> } = {},
  ) {
    const summary = join(root, 'summary.md');
    const output = join(root, 'output');
    writeFileSync(summary, '');
    writeFileSync(output, '');
    const result = spawnSync(
      'bash',
      [
        '-eo',
        'pipefail',
        '-c',
        preview.run!.replace('${{ inputs.comment }}', String(comment)),
      ],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: join(root, 'bin') + ':' + process.env.PATH,
          STATE: root,
          PR_NUMBER: '7',
          HEAD_SHA: 'abc123',
          BASE_SHA: baseSha,
          WORKING_DIRECTORIES: directories,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_RUN_ID: '1',
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
          ...env,
        },
      },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return {
      summary: readFileSync(summary, 'utf8'),
      output: readFileSync(output, 'utf8'),
    };
  }

  const comments = () =>
    (
      JSON.parse(readFileSync(join(root, 'comments.json'), 'utf8')) as {
        body: string;
      }[]
    ).map(c => c.body);
  const statuses = () =>
    readFileSync(join(root, 'statuses'), 'utf8').trim().split('\n');

  test.each(['', '.', 'packages/python'])(
    'keeps the single-package layout for working-directory %j',
    directory => {
      change('server');
      run(directory);
      run(directory);
      expect(comments()).toHaveLength(1);
      expect(comments()[0]).toMatch(
        /^<!-- craft-changelog-preview -->\n## Semver Impact of This PR\n\n🟡 \*\*Minor\*\* \(new features\)\n\n<details>\n<summary>📋 Changelog Preview<\/summary>\n/,
      );
    },
  );

  test('shows one collapsed section per changed package in a single comment', () => {
    write(join(repo, 'packages/rust/bump'), 'patch');
    change('packages/python', 'packages/rust');
    const directories = 'packages/python\n./packages/rust/\n';
    run(directories);
    const { output } = run(directories);

    expect(comments()).toHaveLength(1);
    const body = comments()[0];
    expect(body).toContain(
      '<!-- craft-changelog-preview -->\n## Changelog Preview\n',
    );
    expect(body).toContain(
      '<details>\n<summary><code>packages/python</code> · 🟡 Minor (new features)</summary>\n\n- Entry in python\n\n</details>\n\n' +
        '<details>\n<summary><code>packages/rust</code> · 🟢 Patch (bug fixes)</summary>\n\n- Entry in rust\n\n</details>',
    );
    expect(output).toContain('bump_type=minor\n');
  });

  test('leaves out packages the PR does not change', () => {
    change('packages/rust', 'server');
    run('packages/python\npackages/rust');
    expect(comments()[0]).toContain('<code>packages/rust</code>');
    expect(comments()[0]).not.toContain('packages/python');
  });

  test('says so when the PR changes none of the packages', () => {
    change('server');
    const { output } = run('packages/python\npackages/rust');
    expect(comments()[0]).toContain(
      '_This PR changes none of the previewed packages._',
    );
    expect(output).toContain('pr_skipped=true\n');
  });

  test('posts one status for all packages in status mode', () => {
    write(join(repo, 'packages/python/bump'), 'major');
    change('packages/python', 'packages/rust');
    const { summary } = run('packages/python\npackages/rust', {
      comment: false,
    });
    expect(statuses()).toEqual([
      'Changelog Preview / Semver Impact|packages/python: Major, packages/rust: Minor',
    ]);
    expect(summary).toContain('<code>packages/python</code> · 🔴 Major');
    expect(summary).toContain('<code>packages/rust</code> · 🟡 Minor');
    expect(comments()).toEqual([]);
  });

  /**
   * Moves `main` past the event's base SHA with a change to packages/python,
   * then branches the PR off the old base with a change to packages/rust
   */
  function advanceBaseAndBranch() {
    change('packages/python');
    git('checkout', '-qb', 'pr', baseSha);
    change('packages/rust');
  }

  test('ignores base-branch changes after the event base SHA in the merge ref', () => {
    advanceBaseAndBranch();
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge', 'pr');
    run('packages/python\npackages/rust', {
      env: { MERGE_CHECKOUT: 'success', BASE_REF: 'main' },
    });
    expect(comments()[0]).toContain('<code>packages/rust</code>');
    expect(comments()[0]).not.toContain('packages/python');
  });

  test('ignores base-branch changes merged into the PR head without a merge ref', () => {
    advanceBaseAndBranch();
    git('merge', '-q', '--no-ff', '-m', 'merge main', 'main');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    run('packages/python\npackages/rust', {
      env: { MERGE_CHECKOUT: 'failure', BASE_REF: 'main' },
    });
    expect(comments()[0]).toContain('<code>packages/rust</code>');
    expect(comments()[0]).not.toContain('packages/python');
  });
});
