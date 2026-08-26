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
  const gitCalls = join(directory, 'git-calls');
  const output = join(directory, 'github-output');
  mkdirSync(binDirectory);
  writeFileSync(craftCalls, '');
  writeFileSync(gitCalls, '');
  writeFileSync(output, '');
  writeFileSync(
    join(binDirectory, 'craft'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CRAFT_CALLS"\nif [[ "$1" == "targets" ]]; then\n  printf \'["github"]\'\nfi\n',
  );
  writeFileSync(
    join(binDirectory, 'git'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$GIT_CALLS"\n',
  );
  chmodSync(join(binDirectory, 'craft'), 0o755);
  chmodSync(join(binDirectory, 'git'), 0o755);

  return { binDirectory, craftCalls, directory, gitCalls, output };
}

function runActionStep(
  stepName: string,
  workspace: string,
  environment: ReturnType<typeof createActionEnvironment>,
) {
  return spawnSync('bash', ['-e', '-c', getActionStep(stepName).run!], {
    cwd: environment.directory,
    env: {
      ...process.env,
      CRAFT_CALLS: environment.craftCalls,
      CRAFT_CONFIG_FROM_MERGE_TARGET: '',
      GITHUB_OUTPUT: environment.output,
      GIT_CALLS: environment.gitCalls,
      MERGE_TARGET: '',
      PATH: `${environment.binDirectory}:${process.env.PATH}`,
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

test('passes option-looking workspace names inline to Craft', () => {
  const environment = createActionEnvironment();
  const workspace = '--config-from=untrusted';

  expect(runActionStep('Craft Prepare', workspace, environment).status).toBe(0);
  expect(
    runActionStep('Read Craft Targets', workspace, environment).status,
  ).toBe(0);

  expect(readFileSync(environment.craftCalls, 'utf8')).toBe(
    'prepare --workspace=--config-from=untrusted\ntargets --workspace=--config-from=untrusted\n',
  );
});

test('forwards workspace input to every Craft command', () => {
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

test.each(['', 'cli-\u65e5\u672c\u8a9e'])(
  'accepts safe workspace input %j',
  workspace => {
    const environment = createActionEnvironment();

    expect(
      runActionStep('Validate workspace', workspace, environment).status,
    ).toBe(0);
  },
);
