import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { handler } from '../validate';

// Mock config module to control config file location
vi.mock('../../config', async importOriginal => {
  const original = await importOriginal<typeof import('../../config')>();
  return {
    ...original,
    findConfigFile: vi.fn(),
    getConfigFileDir: vi.fn(),
  };
});

// Mock logger to suppress output during tests
vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('validate command', () => {
  let tmpDir: string;
  let configModule: typeof import('../../config');

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'craft-validate-test-'));
    configModule = await import('../../config');
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  test('reports error when no config file found', async () => {
    vi.mocked(configModule.findConfigFile).mockReturnValue(undefined);

    await handler({});

    expect(process.exitCode).toBe(1);
  });

  test('validates a minimal valid config', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
minVersion: "2.21.0"
targets:
  - name: github
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    // Create minimal workflow directory
    const workflowsDir = join(tmpDir, '.github', 'workflows');
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, 'release.yml'),
      `
name: Release
on:
  workflow_dispatch:
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: getsentry/craft@v2
`,
    );
    writeFileSync(
      join(workflowsDir, 'publish.yml'),
      `
name: Publish
on:
  push:
    branches: [release/**]
    paths:
      - 'CHANGELOG.md'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: getsentry/craft@v2
`,
    );

    await handler({});

    expect(process.exitCode).toBeUndefined();
  });

  test('reports error for invalid YAML', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(configPath, 'invalid: yaml: content: [');

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({ 'skip-workflows': true });

    expect(process.exitCode).toBe(1);
  });

  test('reports error for unknown target', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
targets:
  - name: unknown-target
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({ 'skip-workflows': true });

    expect(process.exitCode).toBe(1);
  });

  test('reports error for duplicate target IDs', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
targets:
  - name: npm
  - name: npm
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({ 'skip-workflows': true });

    expect(process.exitCode).toBe(1);
  });

  test('allows duplicate target names with different IDs', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
minVersion: "2.21.0"
targets:
  - name: npm
    id: npm-main
  - name: npm
    id: npm-secondary
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({ 'skip-workflows': true });

    // Should not have errors (only warnings about missing workflows)
    expect(process.exitCode).toBeUndefined();
  });

  test('reports error for invalid regex pattern', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
targets:
  - name: github
    includeNames: "[invalid-regex"
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({ 'skip-workflows': true });

    expect(process.exitCode).toBe(1);
  });

  test('warns about deprecated changelogPolicy field', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
minVersion: "2.21.0"
changelogPolicy: auto
targets:
  - name: github
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    // Create workflow directory to avoid workflow warnings
    const workflowsDir = join(tmpDir, '.github', 'workflows');
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, 'release.yml'),
      `
name: Release
on:
  workflow_dispatch:
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: getsentry/craft@v2
`,
    );
    writeFileSync(
      join(workflowsDir, 'publish.yml'),
      `
name: Publish
on:
  push:
    paths:
      - 'CHANGELOG.md'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: getsentry/craft@v2
`,
    );

    await handler({});

    // Deprecated fields generate warnings, not errors
    expect(process.exitCode).toBeUndefined();
  });

  test('warns about missing minVersion', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
targets:
  - name: github
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({ 'skip-workflows': true });

    // Missing minVersion is a warning, not an error
    expect(process.exitCode).toBeUndefined();
  });

  test('warns about missing workflows directory', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
minVersion: "2.21.0"
targets:
  - name: github
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({});

    // Missing workflows is a warning, not an error
    expect(process.exitCode).toBeUndefined();
  });

  test('skips workflow validation with --skip-workflows', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
minVersion: "2.21.0"
targets:
  - name: github
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    await handler({ 'skip-workflows': true });

    expect(process.exitCode).toBeUndefined();
  });

  test('warns about missing fetch-depth in release workflow', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
minVersion: "2.21.0"
targets:
  - name: github
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    const workflowsDir = join(tmpDir, '.github', 'workflows');
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, 'release.yml'),
      `
name: Release
on:
  workflow_dispatch:
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: getsentry/craft@v2
`,
    );
    writeFileSync(
      join(workflowsDir, 'publish.yml'),
      `
name: Publish
on:
  push:
    paths:
      - 'CHANGELOG.md'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: getsentry/craft@v2
`,
    );

    await handler({});

    // Missing fetch-depth is a warning
    expect(process.exitCode).toBeUndefined();
  });

  test('warns about workflow not using Craft action', async () => {
    const configPath = join(tmpDir, '.craft.yml');
    writeFileSync(
      configPath,
      `
github:
  owner: getsentry
  repo: craft
minVersion: "2.21.0"
targets:
  - name: github
`,
    );

    vi.mocked(configModule.findConfigFile).mockReturnValue(configPath);
    vi.mocked(configModule.getConfigFileDir).mockReturnValue(tmpDir);

    const workflowsDir = join(tmpDir, '.github', 'workflows');
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, 'release.yml'),
      `
name: Release
on:
  workflow_dispatch:
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm run release
`,
    );
    writeFileSync(
      join(workflowsDir, 'publish.yml'),
      `
name: Publish
on:
  push:
    paths:
      - 'CHANGELOG.md'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm run publish
`,
    );

    await handler({});

    // Not using Craft action is a warning
    expect(process.exitCode).toBeUndefined();
  });
});
