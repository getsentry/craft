import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import { load } from 'js-yaml';
import { afterEach, expect, test } from 'vitest';

interface ActionStep {
  env?: Record<string, string>;
  if?: string;
  name?: string;
  run?: string;
  'continue-on-error'?: boolean;
}

function getActionSteps(): ActionStep[] {
  const action = load(
    readFileSync(join(__dirname, '../../action.yml'), 'utf8'),
  ) as {
    runs?: { steps?: ActionStep[] };
  };
  return action.runs?.steps || [];
}

function getActionStep(name: string): ActionStep {
  const step = getActionSteps().find(step => step.name === name);
  if (!step?.run) {
    throw new Error(`Missing ${name} action step`);
  }
  return step;
}

const tempDirectories: string[] = [];

function createActionEnvironment() {
  const directory = mkdtempSync(join(tmpdir(), 'craft-action-test-'));
  tempDirectories.push(directory);
  const binDirectory = join(directory, 'bin');
  const craftCalls = join(directory, 'craft-calls');
  const ghTitles = join(directory, 'gh-titles');
  const gitCalls = join(directory, 'git-calls');
  const output = join(directory, 'github-output');
  mkdirSync(binDirectory);
  writeFileSync(craftCalls, '');
  writeFileSync(ghTitles, '');
  writeFileSync(gitCalls, '');
  writeFileSync(output, '');
  writeFileSync(
    join(binDirectory, 'craft'),
    '#!/usr/bin/env bash\nif [[ -n "${CRAFT_WORKSPACE:-}" ]]; then\n  exit 1\nfi\nprintf "%s\\n" "$*" >> "$CRAFT_CALLS"\nif [[ "$1" == "targets" ]]; then\n  printf \'["github"]\'\nfi\n',
  );
  writeFileSync(
    join(binDirectory, 'git'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$GIT_CALLS"\n',
  );
  writeFileSync(
    join(binDirectory, 'gh'),
    `#!/usr/bin/env bash
if [[ "$*" == *"issue list"* ]]; then
  printf '[]'
  exit 0
fi
if [[ "$*" == *"issue create"* ]]; then
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == '--title' ]]; then
      printf '%s\\n' "$2" >> "$GH_TITLES"
      break
    fi
    shift
  done
  printf 'https://github.com/getsentry/publish/issues/1\\n'
fi
`,
  );
  chmodSync(join(binDirectory, 'craft'), 0o755);
  chmodSync(join(binDirectory, 'gh'), 0o755);
  chmodSync(join(binDirectory, 'git'), 0o755);

  return { binDirectory, craftCalls, directory, ghTitles, gitCalls, output };
}

function mockReleaseApi(
  environment: ReturnType<typeof createActionEnvironment>,
  release: unknown = {
    tag_name: '2.33.1',
    draft: false,
    assets: [{ name: 'craft', state: 'uploaded' }],
  },
  options: { tagSha?: string; commitSha?: string; version?: string } = {},
) {
  const calls = join(environment.directory, 'release-api-calls');
  const sha = '7fe142107c12ea31eaaba10e4985674490bf808b';
  const version = options.version ?? '2.33.1';
  writeFileSync(calls, '');
  writeFileSync(
    join(environment.directory, 'package.json'),
    JSON.stringify({ version }),
  );
  writeFileSync(
    join(environment.directory, 'commit-response'),
    JSON.stringify({ sha: options.commitSha ?? sha }),
  );
  writeFileSync(
    join(environment.directory, 'tag-response'),
    JSON.stringify({
      ref: `refs/tags/${version}`,
      object: { type: 'commit', sha: options.tagSha ?? sha },
    }),
  );
  writeFileSync(
    join(environment.directory, 'release-response'),
    JSON.stringify(release),
  );
  writeFileSync(
    join(environment.binDirectory, 'gh'),
    `#!/usr/bin/env bash
printf '%s\n' "$2" >> "$GH_API_CALLS"
case "$2" in
  repos/getsentry/craft/commits/*) cat "$GH_RELEASES_DIRECTORY/commit-response" ;;
  repos/getsentry/craft/git/ref/tags/*) cat "$GH_RELEASES_DIRECTORY/tag-response" ;;
  repos/getsentry/craft/releases/tags/*) cat "$GH_RELEASES_DIRECTORY/release-response" ;;
  *) exit 1 ;;
esac
`,
  );
  chmodSync(join(environment.binDirectory, 'gh'), 0o755);
  return calls;
}

function resolveActionRef(
  environment: ReturnType<typeof createActionEnvironment>,
  calls: string,
  actionRef = '7fe142107c12ea31eaaba10e4985674490bf808b',
) {
  return spawnSync(
    'bash',
    [
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      '',
      actionRef,
      environment.directory,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_API_CALLS: calls,
        GH_RELEASES_DIRECTORY: environment.directory,
        PATH: `${environment.binDirectory}:${process.env.PATH}`,
      },
    },
  );
}

function runRequestPublish(
  workspace: string,
  environment: ReturnType<typeof createActionEnvironment>,
) {
  return spawnSync(
    'bash',
    ['-e', '-c', getActionStep('Request publish').run!],
    {
      cwd: environment.directory,
      env: {
        ...process.env,
        CHANGELOG_FILE: '',
        GITHUB_ACTOR: 'byk',
        GITHUB_OUTPUT: environment.output,
        GITHUB_REPOSITORY: 'getsentry/toolkit',
        GH_TITLES: environment.ghTitles,
        MERGE_TARGET: '(default)',
        PATH: `${environment.binDirectory}:${process.env.PATH}`,
        PUBLISH_REPO: 'getsentry/publish',
        RELEASE_BRANCH: 'release/1.2.3',
        RELEASE_PREVIOUS_TAG: '1.2.2',
        RELEASE_SHA: 'abc123',
        RESOLVED_VERSION: '1.2.3',
        SUBDIRECTORY: '',
        TARGETS: ' - [ ] github',
        WORKSPACE: workspace,
      },
    },
  );
}

function runActionStep(
  stepName: string,
  workspace: string,
  environment: ReturnType<typeof createActionEnvironment>,
  pathInput = '.',
  locale = 'C',
) {
  return spawnSync('bash', ['-e', '-c', getActionStep(stepName).run!], {
    cwd: environment.directory,
    env: {
      ...process.env,
      CRAFT_CALLS: environment.craftCalls,
      CRAFT_CONFIG_FROM_MERGE_TARGET: '',
      GITHUB_OUTPUT: environment.output,
      GIT_CALLS: environment.gitCalls,
      LC_ALL: locale,
      MERGE_TARGET: '',
      PATH: `${environment.binDirectory}:${process.env.PATH}`,
      PATH_INPUT: pathInput,
      VERSION: '',
      WORKSPACE: workspace,
    },
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('provides the Git actor name to Craft dogfooding releases', () => {
  const workflow = load(
    readFileSync(
      join(__dirname, '../../.github/workflows/release.yml'),
      'utf8',
    ),
  ) as {
    jobs?: {
      release?: {
        steps?: Array<{ name?: string; with?: Record<string, string> }>;
      };
    };
  };
  const prepareRelease = workflow.jobs?.release?.steps?.find(
    step => step.name === 'Prepare release (dogfooding)',
  );

  expect(prepareRelease?.with?.git_user_name).toBe('${{ github.actor }}');
});

test('forwards workspace input to every Craft command', () => {
  expect(getActionStep('Validate workspace').env?.PATH_INPUT).toBe(
    '${{ inputs.path }}',
  );
  expect(getActionStep('Craft Prepare').env?.WORKSPACE).toBe(
    '${{ inputs.workspace }}',
  );
  expect(getActionStep('Read Craft Targets').env?.WORKSPACE).toBe(
    '${{ inputs.workspace }}',
  );
});

test('allows the action to fetch a nightly when no local build artifact exists', () => {
  const artifact = getActionSteps().find(
    step => step.name === 'Download Craft from build artifact',
  );

  expect(artifact?.if).toContain("inputs.craft_version == ''");
  expect(artifact?.['continue-on-error']).toBe(true);
  expect(getActionStep('Install Craft from artifact or release').run).toContain(
    '-z "$CRAFT_VERSION_INPUT" && -f /tmp/craft-artifact/dist/craft',
  );
});

test('resolves a moving major action tag to its matching release', () => {
  const environment = createActionEnvironment();
  writeFileSync(
    join(environment.directory, 'package.json'),
    JSON.stringify({ version: '2.33.0' }),
  );

  const result = spawnSync(
    'bash',
    [
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      '',
      'v2',
      environment.directory,
    ],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('2.33.0');
});

test('resolves a SHA-pinned action to its matching release', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment);
  const result = resolveActionRef(environment, calls);

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('2.33.1');
  expect(readFileSync(calls, 'utf8')).toBe(
    'repos/getsentry/craft/git/ref/tags/2.33.1\n' +
      'repos/getsentry/craft/releases/tags/2.33.1\n',
  );
});

test('pins a development action SHA to its own nightly build', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, undefined, {
    version: '2.34.0-dev.0',
  });
  const result = resolveActionRef(environment, calls);

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(
    'nightly-7fe142107c12ea31eaaba10e4985674490bf808b',
  );
  expect(readFileSync(calls, 'utf8')).toBe('');
});

test('pins a short development action ref to its resolved commit', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, undefined, {
    version: '2.34.0-dev.0',
  });
  const result = resolveActionRef(environment, calls, '7fe1421');

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(
    'nightly-7fe142107c12ea31eaaba10e4985674490bf808b',
  );
  expect(readFileSync(calls, 'utf8')).toBe(
    'repos/getsentry/craft/commits/7fe1421\n',
  );
});

test.each([
  ['nightly', 'nightly'],
  [
    'nightly-7fe142107c12ea31eaaba10e4985674490bf808b',
    'nightly-7fe142107c12ea31eaaba10e4985674490bf808b',
  ],
])('resolves explicit Craft nightly input %s', (input, expected) => {
  const environment = createActionEnvironment();
  const result = spawnSync(
    'bash',
    [
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      input,
      'v2',
      environment.directory,
    ],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(expected);
});

test('refuses a truncated immutable nightly tag', () => {
  const environment = createActionEnvironment();
  const result = spawnSync(
    'bash',
    [
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      'nightly-7fe1421',
      'v2',
      environment.directory,
    ],
    { encoding: 'utf8' },
  );

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
});

test('resolves a published tag even when release target_commitish is a branch', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, {
    tag_name: '2.33.1',
    target_commitish: 'master',
    draft: false,
    assets: [{ name: 'craft', state: 'uploaded' }],
  });
  const result = resolveActionRef(environment, calls);

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('2.33.1');
});

test('refuses a SHA with no published release even if package.json has a version', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, { message: 'Not Found' });
  const result = resolveActionRef(environment, calls);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('No published Craft release');
});

test('resolves a short action SHA to the full commit before checking the release', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment);
  const result = resolveActionRef(environment, calls, '7fe1421');

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('2.33.1');
  expect(readFileSync(calls, 'utf8')).toBe(
    'repos/getsentry/craft/commits/7fe1421\n' +
      'repos/getsentry/craft/git/ref/tags/2.33.1\n' +
      'repos/getsentry/craft/releases/tags/2.33.1\n',
  );
});

test('rejects a short action ref that does not resolve to its SHA prefix', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, undefined, {
    commitSha: '8c1d36f152366f100b3178cffefd777ce59b3c0e',
  });
  const result = resolveActionRef(environment, calls, '7fe1421');

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('not an unambiguous Craft commit SHA');
  expect(readFileSync(calls, 'utf8')).toBe(
    'repos/getsentry/craft/commits/7fe1421\n',
  );
});

test('accepts a longer future commit SHA when its tag and release match', () => {
  const environment = createActionEnvironment();
  const sha = 'a'.repeat(64);
  const calls = mockReleaseApi(environment, undefined, { tagSha: sha });
  const result = resolveActionRef(environment, calls, sha);

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('2.33.1');
  expect(readFileSync(calls, 'utf8')).not.toContain('/commits/');
});

test('does not trust release target_commitish when its tag points elsewhere', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(
    environment,
    {
      tag_name: '2.33.1',
      target_commitish: '7fe142107c12ea31eaaba10e4985674490bf808b',
      draft: false,
      assets: [{ name: 'craft', state: 'uploaded' }],
    },
    { tagSha: '8c1d36f152366f100b3178cffefd777ce59b3c0e' },
  );
  const result = resolveActionRef(environment, calls);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('does not point to action SHA');
  expect(readFileSync(calls, 'utf8')).not.toContain('/releases/tags/');
});

test('does not accept an unpublished package version as a release', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, undefined, {
    version: '2.34.0-dev.1',
  });
  writeFileSync(
    join(environment.directory, 'tag-response'),
    JSON.stringify({ message: 'Not Found' }),
  );
  const result = resolveActionRef(environment, calls);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(readFileSync(calls, 'utf8')).not.toContain('/releases/tags/');
});

test.each([
  { draft: true, assets: [{ name: 'craft', state: 'uploaded' }] },
  { draft: false, assets: [] },
  { draft: false, assets: [{ name: 'craft', state: 'open' }] },
])('refuses a matching SHA without a published binary: %j', release => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, {
    tag_name: '2.33.1',
    ...release,
  });
  const result = resolveActionRef(environment, calls);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('No published Craft release');
});

test('refuses an invalid release API response', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, { message: 'rate limited' });
  const result = resolveActionRef(environment, calls);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('No published Craft release');
});

test('refuses to resolve a SHA when the release API fails', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment);
  const ghPath = join(environment.binDirectory, 'gh');
  writeFileSync(
    ghPath,
    readFileSync(ghPath, 'utf8').replace(
      'repos/getsentry/craft/releases/tags/*) cat "$GH_RELEASES_DIRECTORY/release-response" ;;',
      'repos/getsentry/craft/releases/tags/*) exit 1 ;;',
    ),
  );
  const result = resolveActionRef(environment, calls);

  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Could not verify published Craft release');
  expect(readFileSync(calls, 'utf8')).toContain('/releases/tags/2.33.1');
});

test('honors an explicit Craft version for a SHA-pinned action', () => {
  const environment = createActionEnvironment();
  const result = spawnSync(
    'bash',
    [
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      '2.33.0',
      '7fe142107c12ea31eaaba10e4985674490bf808b',
      environment.directory,
    ],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('2.33.0');
});

test('keeps ordinary release refs without reading package.json', () => {
  const environment = createActionEnvironment();
  const result = spawnSync(
    'bash',
    [
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      '',
      '2.33.1',
      environment.directory,
    ],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe('2.33.1');
});

test.each(['3.0.0', '2.34.0-dev.0', 'not-a-version'])(
  'refuses a v2 action tag pointing at %s instead of using latest',
  version => {
    const environment = createActionEnvironment();
    writeFileSync(
      join(environment.directory, 'package.json'),
      JSON.stringify({ version }),
    );

    const result = spawnSync(
      'bash',
      [
        join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
        '',
        'v2',
        environment.directory,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  },
);

test.each(['v2', '7fe142107c12ea31eaaba10e4985674490bf808b'])(
  'does not install the latest release when the binary for %s is missing',
  actionRef => {
    const environment = createActionEnvironment();
    const curlCalls = join(environment.directory, 'curl-calls');
    const scriptsDirectory = join(environment.directory, '.github/scripts');
    mkdirSync(scriptsDirectory, { recursive: true });
    writeFileSync(
      join(scriptsDirectory, 'resolve-craft-version.sh'),
      readFileSync(
        join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      ),
    );
    const ghApiCalls = mockReleaseApi(
      environment,
      {
        tag_name: '2.33.0',
        draft: false,
        assets: [{ name: 'craft', state: 'uploaded' }],
      },
      { version: '2.33.0' },
    );
    writeFileSync(curlCalls, '');
    writeFileSync(
      join(environment.binDirectory, 'curl'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CURL_CALLS"\nexit 22\n',
    );
    writeFileSync(
      join(environment.binDirectory, 'sudo'),
      '#!/usr/bin/env bash\nexit 99\n',
    );
    chmodSync(join(environment.binDirectory, 'curl'), 0o755);
    chmodSync(join(environment.binDirectory, 'sudo'), 0o755);

    const result = spawnSync(
      'bash',
      [
        '-e',
        '-c',
        getActionStep('Install Craft from artifact or release').run!,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ACTION_PATH: environment.directory,
          ACTION_REF: actionRef,
          CRAFT_VERSION_INPUT: '',
          CURL_CALLS: curlCalls,
          GH_API_CALLS: ghApiCalls,
          GH_RELEASES_DIRECTORY: environment.directory,
          PATH: `${environment.binDirectory}:${process.env.PATH}`,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Craft release '2.33.0'");
    expect(readFileSync(curlCalls, 'utf8')).toContain(
      '/releases/download/2.33.0/craft',
    );
    expect(readFileSync(curlCalls, 'utf8')).not.toContain('/releases/latest');
  },
);

test('does not attempt a download for a SHA without a published Craft release', () => {
  const environment = createActionEnvironment();
  const ghApiCalls = mockReleaseApi(environment, { message: 'Not Found' });
  const curlCalls = join(environment.directory, 'curl-calls');
  const scriptsDirectory = join(environment.directory, '.github/scripts');
  mkdirSync(scriptsDirectory, { recursive: true });
  writeFileSync(
    join(scriptsDirectory, 'resolve-craft-version.sh'),
    readFileSync(
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
    ),
  );
  writeFileSync(curlCalls, '');
  writeFileSync(
    join(environment.binDirectory, 'curl'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CURL_CALLS"\nexit 22\n',
  );
  chmodSync(join(environment.binDirectory, 'curl'), 0o755);

  const result = spawnSync(
    'bash',
    ['-e', '-c', getActionStep('Install Craft from artifact or release').run!],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACTION_PATH: environment.directory,
        ACTION_REF: '7fe142107c12ea31eaaba10e4985674490bf808b',
        CRAFT_VERSION_INPUT: '',
        CURL_CALLS: curlCalls,
        GH_API_CALLS: ghApiCalls,
        GH_RELEASES_DIRECTORY: environment.directory,
        PATH: `${environment.binDirectory}:${process.env.PATH}`,
      },
    },
  );

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('No published Craft release');
  expect(readFileSync(curlCalls, 'utf8')).toBe('');
});

test.each([
  ['explicit rolling tag', 'nightly', 'v2', 'nightly'],
  [
    'pinned development commit',
    '',
    '7fe142107c12ea31eaaba10e4985674490bf808b',
    'nightly-7fe142107c12ea31eaaba10e4985674490bf808b',
  ],
])(
  'installs %s from GHCR without accessing releases',
  (_name, input, ref, tag) => {
    const environment = createActionEnvironment();
    const calls = mockReleaseApi(environment, undefined, {
      version: '2.34.0-dev.0',
    });
    const scriptsDirectory = join(environment.directory, '.github/scripts');
    mkdirSync(scriptsDirectory, { recursive: true });
    writeFileSync(
      join(scriptsDirectory, 'resolve-craft-version.sh'),
      readFileSync(
        join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
      ),
    );
    const nightlyCalls = join(environment.directory, 'nightly-calls');
    const installCalls = join(environment.directory, 'install-calls');
    writeFileSync(nightlyCalls, '');
    writeFileSync(installCalls, '');
    writeFileSync(
      join(environment.binDirectory, 'node'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$2" >> "$NIGHTLY_CALLS"\nprintf "Craft test binary" > "$3"\n',
    );
    writeFileSync(
      join(environment.binDirectory, 'sudo'),
      '#!/usr/bin/env bash\n[[ "$1" == install && -s "$4" ]] || exit 9\nprintf "%s\\n" "$5" >> "$INSTALL_CALLS"\n',
    );
    writeFileSync(
      join(environment.binDirectory, 'curl'),
      '#!/usr/bin/env bash\nexit 10\n',
    );
    for (const name of ['node', 'sudo', 'curl']) {
      chmodSync(join(environment.binDirectory, name), 0o755);
    }

    const result = spawnSync(
      'bash',
      [
        '-e',
        '-c',
        getActionStep('Install Craft from artifact or release').run!,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ACTION_PATH: environment.directory,
          ACTION_REF: ref,
          CRAFT_VERSION_INPUT: input,
          GH_API_CALLS: calls,
          GH_RELEASES_DIRECTORY: environment.directory,
          NIGHTLY_CALLS: nightlyCalls,
          INSTALL_CALLS: installCalls,
          PATH: `${environment.binDirectory}:${process.env.PATH}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(nightlyCalls, 'utf8')).toBe(`${tag}\n`);
    expect(readFileSync(installCalls, 'utf8')).toBe('/usr/local/bin/craft\n');
    expect(readFileSync(calls, 'utf8')).toBe('');
  },
);

test('fails closed when the pinned development nightly is unavailable', () => {
  const environment = createActionEnvironment();
  const calls = mockReleaseApi(environment, undefined, {
    version: '2.34.0-dev.0',
  });
  const scriptsDirectory = join(environment.directory, '.github/scripts');
  mkdirSync(scriptsDirectory, { recursive: true });
  writeFileSync(
    join(scriptsDirectory, 'resolve-craft-version.sh'),
    readFileSync(
      join(__dirname, '../../.github/scripts/resolve-craft-version.sh'),
    ),
  );
  const installCalls = join(environment.directory, 'install-calls');
  writeFileSync(installCalls, '');
  writeFileSync(
    join(environment.binDirectory, 'node'),
    '#!/usr/bin/env bash\nexit 1\n',
  );
  writeFileSync(
    join(environment.binDirectory, 'sudo'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$INSTALL_CALLS"\nexit 1\n',
  );
  for (const name of ['node', 'sudo']) {
    chmodSync(join(environment.binDirectory, name), 0o755);
  }

  const result = spawnSync(
    'bash',
    ['-e', '-c', getActionStep('Install Craft from artifact or release').run!],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ACTION_PATH: environment.directory,
        ACTION_REF: '7fe142107c12ea31eaaba10e4985674490bf808b',
        CRAFT_VERSION_INPUT: '',
        GH_API_CALLS: calls,
        GH_RELEASES_DIRECTORY: environment.directory,
        INSTALL_CALLS: installCalls,
        PATH: `${environment.binDirectory}:${process.env.PATH}`,
      },
    },
  );

  expect(result.status).not.toBe(0);
  expect(readFileSync(installCalls, 'utf8')).toBe('');
  expect(readFileSync(calls, 'utf8')).toBe('');
});

test.each([
  ['control', 'cli\tnext'],
  ['format', 'cli\u202enext'],
  ['line separator', 'cli\u2028next'],
  ['paragraph separator', 'cli\u2029next'],
  ['non-ASCII', 'cli-é'],
])(
  'rejects %s characters before every action side effect',
  (_name, workspace) => {
    const environment = createActionEnvironment();

    expect(getActionSteps()[0]?.name).toBe('Validate workspace');
    expect(
      runActionStep('Validate workspace', workspace, environment).status,
    ).toBe(1);
    expect(readFileSync(environment.gitCalls, 'utf8')).toBe('');
    expect(readFileSync(environment.craftCalls, 'utf8')).toBe('');
  },
);

test('rejects non-ASCII workspace input in a UTF-8 locale', () => {
  const environment = createActionEnvironment();

  expect(
    runActionStep('Validate workspace', 'cli-é', environment, '.', 'en_US.utf8')
      .status,
  ).toBe(1);
  expect(readFileSync(environment.gitCalls, 'utf8')).toBe('');
  expect(readFileSync(environment.craftCalls, 'utf8')).toBe('');
});

test.each(['', 'cli-v2', 'packages/cli', 'packages/CLI'])(
  'accepts safe workspace input %j',
  workspace => {
    const environment = createActionEnvironment();

    expect(
      runActionStep('Validate workspace', workspace, environment).status,
    ).toBe(0);
  },
);

test.each([
  '../outside',
  '/tmp',
  './packages/cli',
  'packages//cli',
  'packages/../cli',
])(
  'rejects unsafe checkout path %j before every action side effect',
  pathInput => {
    const environment = createActionEnvironment();

    expect(
      runActionStep('Validate workspace', '', environment, pathInput).status,
    ).toBe(1);
    expect(readFileSync(environment.gitCalls, 'utf8')).toBe('');
    expect(readFileSync(environment.craftCalls, 'utf8')).toBe('');
  },
);

test('rejects a path and workspace together before every action side effect', () => {
  const environment = createActionEnvironment();

  expect(
    runActionStep('Validate workspace', 'cli', environment, 'packages/cli')
      .status,
  ).toBe(1);
  expect(readFileSync(environment.gitCalls, 'utf8')).toBe('');
  expect(readFileSync(environment.craftCalls, 'utf8')).toBe('');
});

test.each(['cli\nnext', 'packages/*'])(
  'rejects workspace names outside the path workspace grammar',
  workspace => {
    const environment = createActionEnvironment();

    expect(
      runActionStep('Validate workspace', workspace, environment).status,
    ).toBe(1);
    expect(readFileSync(environment.gitCalls, 'utf8')).toBe('');
    expect(readFileSync(environment.craftCalls, 'utf8')).toBe('');
  },
);

test.each(['.', '..', '__proto__', '-foo', '--config'])(
  'rejects unsafe workspace name %j',
  workspace => {
    const environment = createActionEnvironment();

    expect(
      runActionStep('Validate workspace', workspace, environment).status,
    ).toBe(1);
    expect(readFileSync(environment.gitCalls, 'utf8')).toBe('');
    expect(readFileSync(environment.craftCalls, 'utf8')).toBe('');
  },
);

test.each([
  './packages/cli',
  'packages//cli',
  'packages/./cli',
  'packages/../cli',
  'packages/__proto__/cli',
  'packages/-cli',
])('rejects unsafe workspace path %j', workspace => {
  const environment = createActionEnvironment();

  expect(
    runActionStep('Validate workspace', workspace, environment).status,
  ).toBe(1);
  expect(readFileSync(environment.gitCalls, 'utf8')).toBe('');
  expect(readFileSync(environment.craftCalls, 'utf8')).toBe('');
});

test('uses the full workspace path in publish request titles', () => {
  const rootEnvironment = createActionEnvironment();
  const workspaceEnvironment = createActionEnvironment();

  expect(runRequestPublish('', rootEnvironment).status).toBe(0);
  expect(runRequestPublish('packages/cli', workspaceEnvironment).status).toBe(
    0,
  );

  expect(readFileSync(rootEnvironment.ghTitles, 'utf8')).toBe(
    'publish: getsentry/toolkit@1.2.3\n',
  );
  expect(readFileSync(workspaceEnvironment.ghTitles, 'utf8')).toBe(
    'publish: getsentry/toolkit/packages/cli@1.2.3\n',
  );
});

test('clears an inherited workspace before root Craft commands', () => {
  const environment = createActionEnvironment();
  const previousWorkspace = process.env.CRAFT_WORKSPACE;
  process.env.CRAFT_WORKSPACE = 'packages/cli';

  try {
    expect(runActionStep('Craft Prepare', '', environment).status).toBe(0);
    expect(runActionStep('Read Craft Targets', '', environment).status).toBe(0);
  } finally {
    if (previousWorkspace === undefined) {
      delete process.env.CRAFT_WORKSPACE;
    } else {
      process.env.CRAFT_WORKSPACE = previousWorkspace;
    }
  }

  expect(readFileSync(environment.craftCalls, 'utf8')).toBe(
    'prepare\ntargets\n',
  );
});
