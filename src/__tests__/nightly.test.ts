import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { pathToFileURL } from 'node:url';

import { load } from 'js-yaml';
import { afterEach, expect, test, vi } from 'vitest';

const script = pathToFileURL(
  join(__dirname, '../../.github/scripts/download-craft-nightly.mjs'),
).href;
const sha = 'a'.repeat(40);
const binary = Buffer.from('test Craft binary');
const digest = `sha256:${createHash('sha256').update(binary).digest('hex')}`;
const directories: string[] = [];

function fixture(overrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'craft-ghcr-nightly-'));
  directories.push(directory);
  const output = join(directory, 'craft');
  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: 'application/vnd.getsentry.craft.binary.v1',
    annotations: {
      'org.opencontainers.image.source': 'https://github.com/getsentry/craft',
      'org.opencontainers.image.revision': sha,
    },
    layers: [
      {
        digest,
        size: binary.length,
        mediaType: 'application/octet-stream',
        annotations: { 'org.opencontainers.image.title': 'craft' },
      },
    ],
    ...overrides,
  };
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/token?')) {
      return Response.json({ token: 'private-registry-token' });
    }
    if (url.includes('/manifests/')) {
      return Response.json(manifest);
    }
    if (url.includes('/blobs/')) {
      return new Response(null, {
        status: 307,
        headers: { location: 'https://blob.example/craft' },
      });
    }
    if (url === 'https://blob.example/craft') {
      expect(options?.headers).toBeUndefined();
      return new Response(binary);
    }
    throw new Error('Unexpected request');
  });
  return { output, request, manifest };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('downloads only the matching Craft layer and verifies its digest', async () => {
  const { downloadCraftNightly } = await import(script);
  const { output, request } = fixture();

  expect(await downloadCraftNightly(`nightly-${sha}`, output, request)).toBe(
    sha,
  );
  expect(readFileSync(output)).toEqual(binary);
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls[2]?.[1]).toMatchObject({ redirect: 'manual' });
  expect(request.mock.calls[3]?.[1]).toMatchObject({ redirect: 'error' });
});

test('accepts the rolling nightly only with a valid source and revision', async () => {
  const { downloadCraftNightly } = await import(script);
  const { output, request } = fixture();

  expect(await downloadCraftNightly('nightly', output, request)).toBe(sha);
});

test.each([
  'nightly-short',
  'nightly-../../master',
  'nightly-' + 'a'.repeat(39),
])(
  'rejects unsafe or truncated nightly tag %s before making requests',
  async tag => {
    const { downloadCraftNightly } = await import(script);
    const { output, request } = fixture();

    await expect(downloadCraftNightly(tag, output, request)).rejects.toThrow(
      'Invalid Craft nightly tag',
    );
    expect(request).not.toHaveBeenCalled();
    expect(existsSync(output)).toBe(false);
  },
);

test('the action script rejects invalid tags when invoked as a CLI', () => {
  const { output } = fixture();
  const result = spawnSync(
    process.execPath,
    [
      join(__dirname, '../../.github/scripts/download-craft-nightly.mjs'),
      'nightly-nope',
      output,
    ],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Invalid Craft nightly tag');
  expect(existsSync(output)).toBe(false);
});

test('rejects a tag whose manifest revision differs from the requested SHA', async () => {
  const { downloadCraftNightly } = await import(script);
  const { output, request } = fixture({
    annotations: {
      'org.opencontainers.image.source': 'https://github.com/getsentry/craft',
      'org.opencontainers.image.revision': 'b'.repeat(40),
    },
  });

  await expect(
    downloadCraftNightly(`nightly-${sha}`, output, request),
  ).rejects.toThrow('Invalid Craft nightly manifest');
  expect(request).toHaveBeenCalledTimes(2);
  expect(existsSync(output)).toBe(false);
});

test('rejects a corrupt blob without writing an executable', async () => {
  const { downloadCraftNightly } = await import(script);
  const { output, request, manifest } = fixture();
  manifest.layers[0].digest = 'sha256:' + 'f'.repeat(64);

  await expect(
    downloadCraftNightly(`nightly-${sha}`, output, request),
  ).rejects.toThrow('digest or size mismatch');
  expect(existsSync(output)).toBe(false);
});

test('rejects extra layers and never downloads them', async () => {
  const { downloadCraftNightly } = await import(script);
  const { output, request, manifest } = fixture();
  manifest.layers.push({
    ...manifest.layers[0],
    digest: 'sha256:' + 'b'.repeat(64),
  });

  await expect(
    downloadCraftNightly(`nightly-${sha}`, output, request),
  ).rejects.toThrow('Invalid Craft nightly manifest');
  expect(request).toHaveBeenCalledTimes(2);
  expect(existsSync(output)).toBe(false);
});

test('rejects an oversized layer before requesting the blob', async () => {
  const { downloadCraftNightly } = await import(script);
  const { output, request, manifest } = fixture();
  manifest.layers[0].size = 129 * 1024 * 1024;

  await expect(
    downloadCraftNightly(`nightly-${sha}`, output, request),
  ).rejects.toThrow('Invalid Craft nightly binary layer');
  expect(request).toHaveBeenCalledTimes(2);
  expect(existsSync(output)).toBe(false);
});

test('rejects another source repository before requesting the blob', async () => {
  const { downloadCraftNightly } = await import(script);
  const { output, request } = fixture({
    annotations: {
      'org.opencontainers.image.source': 'https://github.com/elsewhere/craft',
      'org.opencontainers.image.revision': sha,
    },
  });

  await expect(
    downloadCraftNightly(`nightly-${sha}`, output, request),
  ).rejects.toThrow('Invalid Craft nightly manifest');
  expect(request).toHaveBeenCalledTimes(2);
  expect(existsSync(output)).toBe(false);
});

test.each([
  ['the identical build exists', '200', false, 0, 0],
  ['another binary occupies the commit tag', '200', true, 1, 0],
  ['the tag is absent', '404', false, 0, 2],
  ['the registry preflight fails', '500', false, 1, 0],
])(
  'publishing when %s never overwrites an existing commit tag',
  (_case, status, changedDigest, expectedExit, expectedOrasCalls) => {
    const { output, manifest } = fixture();
    const directory = join(output, '..');
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    mkdirSync(join(directory, 'artifacts/dist'), { recursive: true });
    writeFileSync(join(directory, 'artifacts/dist/craft'), binary);
    if (changedDigest) {
      manifest.layers[0].digest = 'sha256:' + 'f'.repeat(64);
    }
    const manifestFile = join(directory, 'manifest.json');
    const orasCalls = join(directory, 'oras-calls');
    writeFileSync(manifestFile, JSON.stringify(manifest));
    writeFileSync(orasCalls, '');
    writeFileSync(
      join(bin, 'curl'),
      '#!/usr/bin/env bash\nif [[ "$*" == *"/token?"* ]]; then printf \'{"token":"test-token"}\'; exit 0; fi\nwhile (( $# )); do if [[ "$1" == -o ]]; then shift; cp "$MANIFEST_FILE" "$1"; break; fi; shift; done\nprintf "%s" "$MANIFEST_STATUS"\n',
    );
    writeFileSync(
      join(bin, 'oras'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$ORAS_CALLS"\n',
    );
    chmodSync(join(bin, 'curl'), 0o755);
    chmodSync(join(bin, 'oras'), 0o755);

    const workflow = load(
      readFileSync(
        join(__dirname, '../../.github/workflows/build.yml'),
        'utf8',
      ),
    ) as {
      jobs: {
        'publish-nightly': { steps: Array<{ name?: string; run?: string }> };
      };
    };
    const run = workflow.jobs['publish-nightly'].steps.find(step =>
      step.name?.startsWith('Publish the binary'),
    )?.run;
    expect(run).toBeDefined();
    const result = spawnSync('bash', ['-e', '-c', run!], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: sha,
        GITHUB_ACTOR: 'craft-test',
        GHCR_TOKEN: 'test-token',
        RUNNER_TEMP: directory,
        MANIFEST_FILE: manifestFile,
        MANIFEST_STATUS: status,
        ORAS_CALLS: orasCalls,
        PATH: `${bin}:${process.env.PATH}`,
      },
    });

    expect(result.status).toBe(expectedExit);
    expect(
      readFileSync(orasCalls, 'utf8').trim().split('\n').filter(Boolean),
    ).toHaveLength(expectedOrasCalls);
    if (changedDigest) {
      expect(result.stderr).toContain('refusing to overwrite');
    }
  },
);

test('immutable and rolling publishers are gated to main pushes with scoped write access', () => {
  const workflow = load(
    readFileSync(join(__dirname, '../../.github/workflows/build.yml'), 'utf8'),
  ) as {
    concurrency: { group: string; 'cancel-in-progress': string };
    jobs: Record<
      string,
      {
        if?: string;
        needs?: string;
        concurrency?: { group: string; 'cancel-in-progress': boolean };
        permissions?: Record<string, string>;
        steps?: Array<{ name?: string; run?: string }>;
      }
    >;
  };
  const publish = workflow.jobs['publish-nightly'];
  const advance = workflow.jobs['advance-nightly'];

  expect(publish.if).toContain("github.event_name == 'push'");
  expect(publish.if).toContain("github.ref == 'refs/heads/master'");
  expect(publish.needs).toBe('build');
  expect(publish.permissions?.packages).toBe('write');
  expect(advance.if).toBe(publish.if);
  expect(advance.needs).toBe('publish-nightly');
  expect(advance.permissions?.packages).toBe('write');
  expect(advance.concurrency?.group).toBe('craft-nightly-rolling');
  expect(advance.concurrency?.['cancel-in-progress']).toBe(false);
  const advanceScript = advance.steps?.find(step =>
    step.name?.startsWith('Advance the rolling tag'),
  )?.run;
  expect(advanceScript).toContain(
    'current=$(gh api repos/getsentry/craft/git/ref/heads/master',
  );
  expect(advanceScript).toContain('if [[ "$current" == "$GITHUB_SHA" ]]');
  expect(advanceScript).toContain(
    'oras tag "ghcr.io/getsentry/craft:nightly-$GITHUB_SHA" nightly',
  );
  expect(workflow.jobs.build.permissions?.packages).toBeUndefined();
  expect(workflow.concurrency.group).toContain('github.sha');
  expect(workflow.concurrency['cancel-in-progress']).toContain(
    "github.ref != 'refs/heads/master'",
  );
});

test('release workflow passes the requested Craft build to both action paths', () => {
  const workflow = load(
    readFileSync(
      join(__dirname, '../../.github/workflows/release.yml'),
      'utf8',
    ),
  ) as {
    on: {
      workflow_call: { inputs: Record<string, unknown> };
      workflow_dispatch: { inputs: Record<string, unknown> };
    };
    jobs: {
      release: {
        steps: Array<{ id?: string; with?: Record<string, string> }>;
      };
    };
  };
  const steps = workflow.jobs.release.steps;

  expect(workflow.on.workflow_dispatch.inputs.craft_version).toBeDefined();
  expect(workflow.on.workflow_call.inputs.craft_version).toBeDefined();
  expect(
    steps.find(step => step.id === 'craft-local')?.with?.craft_version,
  ).toBe('${{ github.event.inputs.craft_version }}');
  expect(
    steps.find(step => step.id === 'craft-action')?.with?.craft_version,
  ).toBe('${{ inputs.craft_version }}');
});

test('release delegates nightly publication permissions without granting them to its release job', () => {
  const release = load(
    readFileSync(
      join(__dirname, '../../.github/workflows/release.yml'),
      'utf8',
    ),
  ) as {
    jobs: {
      build: { if: string; permissions: Record<string, string> };
      release: { permissions: Record<string, string> };
    };
  };
  const build = load(
    readFileSync(join(__dirname, '../../.github/workflows/build.yml'), 'utf8'),
  ) as {
    jobs: Record<string, { if: string; permissions: Record<string, string> }>;
  };

  expect(release.jobs.build.if).toBe("github.repository == 'getsentry/craft'");
  expect(release.jobs.build.permissions).toEqual({
    contents: 'read',
    packages: 'write',
  });
  expect(release.jobs.release.permissions).toEqual({ contents: 'write' });
  for (const job of ['publish-nightly', 'advance-nightly']) {
    expect(build.jobs[job].permissions.packages).toBe('write');
    expect(build.jobs[job].if).toContain("github.event_name == 'push'");
  }
});
