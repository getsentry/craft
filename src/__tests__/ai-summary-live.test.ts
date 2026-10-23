// Opt-in full CLI replay of the inputs used to prepare Craft 2.35.1.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { load } from 'js-yaml';
import { parse } from 'valibot';
import { expect, test } from 'vitest';
import {
  AiSummaryConfigSchema,
  CraftProjectConfigSchema,
} from '../schemas/project_config';

const execute = promisify(execFile);
const root = resolve(__dirname, '../..');
const sourceHead = 'ddd9ad01cfbaa891260ab1c20df73e1141451d56';
const base = '2.35.0';

test
  .skipIf(process.env.CRAFT_TEST_LIVE_AI !== 'true')
  .each(['release', 'repository', 'default'])(
  'full CLI replay of 2.35.1 with %s settings preserves every original entry',
  async settings => {
    const directory = await mkdtemp(join(tmpdir(), 'craft live 2351 '));
    const checkout = join(directory, 'source');
    try {
      await execute('git', [
        'clone',
        '--quiet',
        '--no-checkout',
        root,
        checkout,
      ]);
      await execute('git', ['checkout', '--quiet', '--detach', sourceHead], {
        cwd: checkout,
      });
      await execute(
        'git',
        [
          'remote',
          'set-url',
          'origin',
          'https://github.com/getsentry/craft.git',
        ],
        { cwd: checkout },
      );
      const git = async (...args: string[]) =>
        (await execute('git', args, { cwd: checkout })).stdout.trim();
      expect(await git('rev-parse', 'HEAD')).toBe(sourceHead);
      const config = await readFile(join(checkout, '.craft.yml'), 'utf8');
      let connection =
        settings === 'default'
          ? JSON.stringify(parse(AiSummaryConfigSchema, {}).llm)
          : '';
      if (settings === 'repository') {
        const project = parse(
          CraftProjectConfigSchema,
          load(await readFile(join(root, '.craft.yml'), 'utf8')),
        );
        const summary =
          typeof project.changelog === 'object' && project.changelog.aiSummary;
        if (!summary)
          throw new Error('Repository AI summaries must be enabled');
        // Retain historical release inputs while also checking today's connection.
        connection = JSON.stringify(summary.llm);
      }
      const cli = async (dryRun: boolean) => {
        const args = [
          resolve(root, 'dist/craft'),
          'changelog',
          '--since',
          base,
          '--format',
          'json',
          '--no-input',
          '--ai-api-key-env',
          'AI_SUMMARY_TOKEN',
        ];
        if (dryRun) args.push('--dry-run');
        const result = await execute(process.execPath, args, {
          cwd: checkout,
          env: {
            ...process.env,
            CI: 'true',
            CRAFT_LOG_LEVEL: 'Warn',
            CRAFT_AI_LLM: connection,
            CRAFT_AI_ENDPOINT: '',
            CRAFT_AI_MODEL: '',
            CRAFT_AI_API_KEY_ENV: '',
            NODE_OPTIONS: '',
          },
          timeout: 150000,
          maxBuffer: 1024 * 1024,
        });
        // Production diagnostics contain only fixed reasons, stages and HTTP status.
        for (const line of result.stderr.split('\n'))
          if (line.includes('AI changelog summary failed;'))
            console.error(line);
        return JSON.parse(result.stdout);
      };
      const original = await cli(true);
      const generated = await cli(false);
      const originals = original.changelog
        .split('\n')
        .filter((line: string) => line.startsWith('- '));
      const overview = generated.changelog.split('### ')[0].trim();
      let passed = false;
      try {
        expect(
          generated.changelog !== original.changelog && Boolean(overview),
          'full summarizer returned fallback instead of summaries',
        ).toBe(true);
        expect(Array.from(overview).length).toBeLessThanOrEqual(400);
        expect(overview.split('\n\n')).toHaveLength(1);
        expect(generated.totalCommits).toBe(3);
        expect(generated.bumpType).toBe('patch');
        expect(generated.bumpType).toBe(original.bumpType);
        expect(originals).toHaveLength(3);
        for (const entry of originals)
          expect(generated.changelog.includes(entry)).toBe(true);
        expect((generated.changelog.match(/<details>/g) || []).length).toBe(2);
        expect(generated.changelog).toContain(
          '<summary>Show 2 items</summary>',
        );
        expect(generated.changelog).toContain('<summary>Show 1 item</summary>');
        expect(await readFile(join(checkout, '.craft.yml'), 'utf8')).toBe(
          config,
        );
        expect(await git('status', '--porcelain')).toBe('');
        passed = true;
      } finally {
        if (process.env.CRAFT_AI_E2E_OUTPUT) {
          await mkdir(process.env.CRAFT_AI_E2E_OUTPUT, { recursive: true });
          await writeFile(
            join(process.env.CRAFT_AI_E2E_OUTPUT, `${settings}.json`),
            JSON.stringify(
              {
                sourceHead,
                base,
                settings,
                passed,
                totalCommits: generated.totalCommits,
                bumpType: generated.bumpType,
                originalsRetained: originals.every((entry: string) =>
                  generated.changelog.includes(entry),
                ),
              },
              null,
              2,
            ),
          );
          await writeFile(
            join(process.env.CRAFT_AI_E2E_OUTPUT, `${settings}.md`),
            generated.changelog,
          );
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  180000,
);
