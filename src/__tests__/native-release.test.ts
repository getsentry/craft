import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { describe, expect, test, vi } from 'vitest';
import { validateConfiguration } from '../config';
import { normalizeArtifactsConfig } from '../artifact_providers/github';
import { NoneArtifactProvider } from '../artifact_providers/none';
import { BaseTarget } from '../targets/base';
import { stringToRegexp } from '../utils/filters';

const config = validateConfiguration(
  load(readFileSync(join(__dirname, '../../.craft.yml'), 'utf8')) as Record<
    string,
    unknown
  >,
);
const binaries = [
  'craft-darwin-arm64.gz',
  'craft-darwin-x64.gz',
  'craft-linux-arm64.gz',
  'craft-linux-x64.gz',
  'craft-win-x64.exe',
];
const filenames = [
  'craft',
  'craft-install',
  'sentry-craft-2.35.0.tgz',
  'gh-pages.zip',
  ...binaries,
  ...binaries.map(name => `${name}.sha256`),
  'other.tgz',
];

describe('Craft native release configuration', () => {
  test('collects the cross-built native artifact from the release revision workflow', () => {
    const filters = normalizeArtifactsConfig(
      config.artifactProvider?.config?.artifacts,
    );
    expect(
      filters.some(
        filter =>
          filter.workflow?.test('Build & Test') &&
          filter.artifacts.some(pattern => pattern.test('craft-native')),
      ),
    ).toBe(true);
  });

  test('requires each native executable and checksum before publishing', () => {
    const required = (config.requireNames || []).map(stringToRegexp);
    for (const filename of [
      'craft-install',
      ...binaries,
      ...binaries.map(name => `${name}.sha256`),
    ]) {
      // Missing any one release file must leave an unsatisfied requirement.
      const remaining = filenames.filter(name => name !== filename);
      expect(
        required.some(
          pattern =>
            pattern.test(filename) &&
            !remaining.some(name => pattern.test(name)),
        ),
      ).toBe(true);
    }
  });

  test('publishes only the npm package to npm and archives native downloads in GCS', async () => {
    const provider = new NoneArtifactProvider();
    vi.spyOn(provider, 'listArtifactsForRevision').mockResolvedValue(
      filenames.map(filename => ({
        filename,
        storedFile: { filename, downloadFilepath: filename, size: 1 },
      })),
    );
    for (const [targetName, expected] of [
      ['npm', ['sentry-craft-2.35.0.tgz']],
      ['gcs', filenames.slice(0, -1)],
    ] as const) {
      const targetConfig = config.targets?.find(
        target => target.name === targetName,
      );
      expect(targetConfig).toBeDefined();
      const target = new BaseTarget(targetConfig!, provider);
      expect(
        (await target.getArtifactsForRevision('fixture-revision')).map(
          artifact => artifact.filename,
        ),
      ).toEqual(expected);
    }
  });
});
