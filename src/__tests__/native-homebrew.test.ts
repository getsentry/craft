import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { spawnSync } from 'child_process';
import { load } from 'js-yaml';
import { validateConfiguration } from '../config';
import { NoneArtifactProvider } from '../artifact_providers/none';
import { BrewTarget } from '../targets/brew';

const saved = vi.hoisted(() => ({ formula: '' }));
vi.mock('../utils/githubApi', () => ({
  getGitHubClient: () => ({
    repos: {
      getContent: async () => {
        throw { status: 404 };
      },
      createOrUpdateFileContents: async (params: { content: string }) => {
        saved.formula = Buffer.from(params.content, 'base64').toString();
      },
    },
  }),
}));

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// Execute the rendered Ruby DSL for each OS/CPU without changing a real tap.
const evaluate = `
require 'json'
module OS
  def self.mac?; ARGV[1] == 'darwin'; end
  def self.linux?; ARGV[1] == 'linux'; end
end
module Hardware
  module CPU
    def self.arm?; ARGV[2] == 'arm64'; end
    def self.intel?; ARGV[2] == 'x64'; end
    def self.is_64_bit?; ['arm64', 'x64'].include?(ARGV[2]); end
  end
end
class Formula
  class << self
    attr_reader :download_url, :digest
    def desc(*); end
    def homepage(*); end
    def license(*); end
    def version(*); end
    def depends_on(*); end
    def url(value); @download_url = value; end
    def sha256(value); @digest = value; end
    def test(&block); end
  end
end
load ARGV[0]
puts JSON.generate({url: Craft.download_url, sha256: Craft.digest})
`;

describe('Craft Homebrew release', () => {
  test.skipIf(process.platform === 'win32')(
    'renders the platform archive URLs with checksums from the actual release files',
    async () => {
      const config = validateConfiguration(
        load(
          readFileSync(join(__dirname, '../../.craft.yml'), 'utf8'),
        ) as Record<string, unknown>,
      );
      const targetConfig = config.targets?.find(
        target => target.name === 'brew',
      );
      expect(targetConfig).toBeDefined();
      const directory = mkdtempSync(join(tmpdir(), 'craft-brew-'));
      directories.push(directory);
      const platforms = [
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64',
        'linux-x64',
      ];
      const artifacts = [
        ...platforms.map(platform => `craft-${platform}.gz`),
        'craft',
        'craft-win-x64.exe',
        'craft-linux-x64.gz.sha256',
      ];
      for (const filename of artifacts)
        writeFileSync(
          join(directory, filename),
          gzipSync(Buffer.from(filename)),
        );
      const provider = new NoneArtifactProvider();
      vi.spyOn(provider, 'listArtifactsForRevision').mockResolvedValue(
        artifacts.map(filename => ({
          filename,
          storedFile: { filename, downloadFilepath: filename, size: 1 },
        })),
      );
      vi.spyOn(provider, 'downloadArtifact').mockImplementation(
        async artifact => join(directory, artifact.filename),
      );
      const target = new BrewTarget(targetConfig!, provider, {
        owner: 'getsentry',
        repo: 'craft',
      });
      expect(
        (await target.getArtifactsForRevision('fixture')).map(
          artifact => artifact.filename,
        ),
      ).toEqual(platforms.map(platform => `craft-${platform}.gz`));
      await target.publish('2.35.0', 'fixture');
      const formula = join(directory, 'craft.rb');
      writeFileSync(formula, saved.formula);
      for (const platform of platforms) {
        const [os, arch] = platform.split('-');
        const result = spawnSync('ruby', ['-e', evaluate, formula, os, arch], {
          encoding: 'utf8',
        });
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          url: `https://github.com/getsentry/craft/releases/download/2.35.0/craft-${platform}.gz`,
          sha256: createHash('sha256')
            .update(readFileSync(join(directory, `craft-${platform}.gz`)))
            .digest('hex'),
        });
      }
      for (const [os, arch] of [
        ['linux', 'x86'],
        ['windows', 'x64'],
      ]) {
        expect(
          spawnSync('ruby', ['-e', evaluate, formula, os, arch]).status,
        ).not.toBe(0);
      }
    },
  );
});
