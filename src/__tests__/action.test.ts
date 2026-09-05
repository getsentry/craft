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
  name?: string;
  run?: string;
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
