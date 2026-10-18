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
