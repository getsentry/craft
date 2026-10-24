import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  summarizeChangelog,
  formatSummaryText,
  summaryDescription,
} from '../ai-summary';
import { marked } from 'marked';
import { setGlobals } from '../helpers';
import { enableWorktreeMode, disableWorktreeMode } from '../dryRun';
import { logger } from '../../logger';
import type { SummaryRequest } from '../ai-provider';
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(request: SummaryRequest) => Promise<unknown>>(),
}));
vi.mock('../ai-provider', () => ({
  createSummaryProvider: () => ({
    request: requestMock,
    close: async () => {},
  }),
}));

const config = {
  llm: {
    endpoint: 'https://api.githubcopilot.com/responses',
    model: 'gpt-5.4-nano',
    apiKeyEnv: 'AI_SUMMARY_TOKEN',
  },
  minItems: 5,
  levels: ['release', 'category', 'scope'] as (
    | 'release'
    | 'category'
    | 'scope'
  )[],
};
const categories = [
  {
    id: 'features',
    title: 'Features',
    groups: [
      {
        id: 'api',
        title: 'API',
        scope: 'API',
        items: Array.from({ length: 6 }, (_, i) => `Feature ${i}`),
      },
      { id: 'small', title: 'Other', items: ['Small feature'] },
    ],
  },
  {
    id: 'fixes',
    title: 'Fixes',
    groups: [
      {
        id: 'api-fix',
        title: 'API',
        scope: 'API',
        items: Array.from({ length: 6 }, (_, i) => `Fix ${i}`),
      },
    ],
  },
];

// Only the external provider is simulated; reductions and validation remain real.
function modelResponse(options: SummaryRequest) {
  const input = JSON.parse(options.input);
  return {
    summaries: Object.fromEntries(
      input.nodes
        .map((node: any) => ({
          id: node.id,
          ...(input.level === 'release'
            ? { coveredPartIds: node.parts.map((part: any) => part.id) }
            : {}),
          summary:
            input.level === 'scope'
              ? `${input.level}: ${node.title} (${node.parts
                  .map((part: any) => part.text)
                  .join('; ')
                  .slice(0, 700)})`
              : input.level === 'category'
                ? `Changes to ${node.title}.`
                : 'Release overview.',
          importantChanges: node.parts.flatMap((part: any) => [
            ...(part.importantChanges || []),
            ...(part.important
              ? [{ id: part.sourceId, summary: part.text.slice(0, 500) }]
              : []),
          ]),
        }))
        .map(({ id, ...digest }: any) => [id, digest]),
    ),
  };
}
describe('hierarchical HTTP changelog summaries', () => {
  beforeEach(() => {
    requestMock
      .mockReset()
      .mockImplementation(async options => modelResponse(options));
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    setGlobals({ 'dry-run': false });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    setGlobals({ 'dry-run': false });
    disableWorktreeMode();
  });

  it.each([
    [['release']],
    [['category']],
    [['scope']],
    [['release', 'category']],
    [['release', 'scope']],
    [['category', 'scope']],
    [['release', 'category', 'scope']],
  ])('returns only selected display levels (%j)', async levels => {
    const result = await summarizeChangelog(categories, {
      ...config,
      levels: levels as typeof config.levels,
    });
    expect(result).not.toBeNull();
    expect(Object.keys(result!.scopes)).toEqual(
      levels.includes('scope') ? ['api', 'api-fix'] : [],
    );
    expect(Object.keys(result!.categories)).toEqual(
      levels.includes('category') ? ['features', 'fixes'] : [],
    );
    expect(Boolean(result!.release)).toBe(levels.includes('release'));
  });

  it('synthesizes one release overview from every category digest', async () => {
    requestMock.mockImplementation(async request => {
      const input = JSON.parse(request.input);
      const output = modelResponse(request);
      if (input.level === 'category')
        Object.values(output.summaries).forEach((digest: any, i: number) => {
          digest.summary = `Category digest: ${input.nodes[i].title}`;
        });
      if (input.level === 'release')
        output.summaries = Object.fromEntries(
          input.nodes
            .map((node: any) => ({
              id: node.id,
              summary:
                'New capabilities and reliability improvements across the API.',
              importantChanges: [],
              coveredPartIds: node.parts.map((part: any) => part.id),
            }))
            .map(({ id, ...digest }: any) => [id, digest]),
        );
      return output;
    });
    const result = await summarizeChangelog(categories, config);
    expect(result?.release).toBe(
      'New capabilities and reliability improvements across the API.',
    );
    const releaseRequests = requestMock.mock.calls
      .map(([request]) => JSON.parse(request.input))
      .filter(input => input.level === 'release');
    expect(releaseRequests).toHaveLength(1);
    expect(releaseRequests[0].nodes).toHaveLength(1);
    expect(releaseRequests[0].nodes[0].parts).toMatchObject([
      { id: 'features', title: 'Features', text: 'Category digest: Features' },
      { id: 'fixes', title: 'Fixes', text: 'Category digest: Fixes' },
    ]);
  });

  it('renders model prose without appending a paraphrased critical fact', async () => {
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      Object.values(output.summaries).forEach((digest: any) => {
        digest.summary = 'Resolved dependency vulnerabilities.';
        digest.importantChanges = [
          { id: 'g:item:0', summary: 'Security: fix dependency CVE-1234.' },
        ];
      });
      return output;
    });
    const result = await summarizeChangelog(
      [
        {
          id: 'fix',
          title: 'Fixes',
          groups: [
            {
              id: 'g',
              title: 'Dependencies',
              scope: 'Deps',
              items: ['Security: fix dependency CVE-1234.'],
            },
          ],
        },
      ],
      { ...config, levels: ['scope'], minItems: 0 },
    );
    expect(result?.scopes.g).toBe('Resolved dependency vulnerabilities.');
  });

  it('rejects a release overview without verified category coverage', async () => {
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      Object.values(output.summaries).forEach((digest: any) => {
        delete digest.coveredPartIds;
      });
      return output;
    });
    expect(await summarizeChangelog(categories, config)).toBeNull();
  });

  it.each(['missing', 'duplicate', 'unknown'])(
    'rejects %s category coverage in a release synthesis',
    async mode => {
      requestMock.mockImplementation(async request => {
        const input = JSON.parse(request.input);
        const output = modelResponse(request);
        if (input.level === 'release') {
          const digest = Object.values(output.summaries)[0];
          if (mode === 'missing') digest.coveredPartIds.pop();
          if (mode === 'duplicate')
            digest.coveredPartIds[1] = digest.coveredPartIds[0];
          if (mode === 'unknown') digest.coveredPartIds[0] = 'private-source';
        }
        return output;
      });
      expect(await summarizeChangelog(categories, config)).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('stage=release; reason=part-coverage'),
      );
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
        'private-source',
      );
    },
  );

  it('reduces many categories into one bounded overview while checking every child batch', async () => {
    const input = Array.from({ length: 80 }, (_, i) => ({
      id: `category-${i}`,
      title: `Category ${i}`,
      groups: [{ id: `g${i}`, title: `Group ${i}`, items: [`Change ${i}`] }],
    }));
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      if (JSON.parse(request.input).level === 'scope')
        for (const digest of Object.values(output.summaries))
          digest.summary = 'abcdefghij'.repeat(110);
      if (JSON.parse(request.input).level === 'category')
        Object.values(output.summaries).forEach((digest: any) => {
          digest.summary = 'Category theme. '.repeat(35).trim();
        });
      return output;
    });
    const result = await summarizeChangelog(input, {
      ...config,
      minItems: 0,
      levels: ['release'],
    });
    expect(result?.release).toBeTruthy();
    expect(result?.release.length).toBeLessThanOrEqual(400);
    expect(result?.categories).toEqual({});
    expect(result?.scopes).toEqual({});
    const requests = requestMock.mock.calls.map(([request]) => ({
      request,
      input: JSON.parse(request.input),
    }));
    const release = requests.filter(({ input }) => input.level === 'release');
    expect(release.length).toBeGreaterThan(1);
    const initialParts = release
      .flatMap(({ input }) => input.nodes.flatMap((node: any) => node.parts))
      .filter((part: any) => part.id.startsWith('category-'));
    expect(initialParts.map((part: any) => part.id)).toEqual(
      input.map(category => category.id),
    );
    expect(release.at(-1)!.input.nodes).toHaveLength(1);
    for (const { request } of requests)
      expect(Buffer.byteLength(request.input)).toBeLessThanOrEqual(24000);
    expect(requests.length).toBeLessThanOrEqual(64);
  });

  it('batches critical category guidance separately from brief ordinary outcomes', async () => {
    const input = [
      ...categories.slice(0, 1),
      {
        id: 'breaking',
        title: 'Breaking',
        groups: [
          {
            id: 'g',
            title: 'Prepare',
            items: [
              'Breaking change: version discovery now requires explicit configuration.',
            ],
          },
        ],
      },
      ...categories.slice(1),
    ];
    expect(
      await summarizeChangelog(input, { ...config, minItems: 0 }),
    ).not.toBeNull();
    const requests = requestMock.mock.calls
      .map(([request]) => request)
      .filter(request => JSON.parse(request.input).level === 'category');
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const nodes = JSON.parse(request.input).nodes;
      const critical = nodes.map((node: any) =>
        node.parts.some((part: any) => part.importantChanges?.length),
      );
      expect(new Set(critical).size).toBe(1);
      if (critical[0]) {
        expect(request.system).toContain(
          'Display role: Detailed upgrade guidance',
        );
        expect(request.system).not.toContain('8-18 words');
      } else expect(request.system).toContain('8-18 words');
    }
  });

  it('keeps explicit upgrade actions in a detailed breaking category', async () => {
    const prose =
      'Tag-derived projects must set preReleaseCommand to an empty string when automatic version discovery cannot find a version.';
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      const level = JSON.parse(request.input).level;
      for (const digest of Object.values(output.summaries))
        digest.summary =
          level === 'release'
            ? 'Version preparation now checks project versions before releasing.'
            : prose;
      return output;
    });
    const input = [
      {
        id: 'breaking',
        title: 'Breaking',
        groups: [
          {
            id: 'g',
            title: 'Prepare',
            scope: 'Prepare',
            items: [
              'Breaking change: version preparation requires a version to bump.',
            ],
          },
        ],
      },
    ];
    const result = await summarizeChangelog(input, { ...config, minItems: 0 });
    expect(result?.categories.breaking).toBe(prose);
    expect(result?.scopes.g).toBe(prose);
    expect(requestMock).toHaveBeenCalledTimes(3);
    const categoryRequest = requestMock.mock.calls[1][0];
    const node = JSON.parse(categoryRequest.input).nodes[0];
    expect(
      (categoryRequest.schema as any).properties.summaries.properties[node.id]
        .properties.summary.maxLength,
    ).toBe(600);
    expect(node.parts[0].importantChanges).toHaveLength(1);
  });

  it.each(['category', 'release'] as const)(
    'falls back after one failed repair of copied %s prose',
    async level => {
      const scope =
        'Workspace owners can exclude unrelated paths from their release notes. ' +
        'Extra source context about package discovery and boundaries. '.repeat(
          5,
        );
      const category =
        'Teams get clearer release notes while workspace owners gain path controls, alongside concise summaries.';
      requestMock.mockImplementation(async request => {
        const output = modelResponse(request);
        const current = JSON.parse(request.input).level;
        for (const digest of Object.values(output.summaries))
          digest.summary =
            current === 'scope'
              ? scope
              : current === 'category'
                ? level === 'category'
                  ? 'WORKSPACE owners can exclude unrelated paths from their release notes!'
                  : category
                : 'Teams get clearer release notes while workspace owners.';
        return output;
      });
      const input = [
        {
          id: 'features',
          title: 'Features',
          groups: [
            {
              id: 'g',
              title: 'Changelog',
              scope: 'Changelog',
              items: ['Add workspace controls and PR context.'],
            },
          ],
        },
      ];
      expect(
        await summarizeChangelog(input, { ...config, minItems: 0 }),
      ).toBeNull();
      expect(
        requestMock.mock.calls.filter(
          ([request]) => JSON.parse(request.input).level === level,
        ),
      ).toHaveLength(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`stage=${level}; reason=response-repetition`),
      );
    },
  );

  it('requires a single-child category to compress its scope digest', async () => {
    const scope =
      'Workspaces can include, exclude, or own unowned paths, and first workspace releases inspect configuration history. AI summaries use condensed PR descriptions to explain concrete changes.';
    const paraphrase =
      'Workspaces gain include, exclude, and own modes for unowned paths; initial releases inspect configuration history, while AI summaries use PR descriptions for concrete explanations.';
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      const level = JSON.parse(request.input).level;
      for (const digest of Object.values(output.summaries))
        digest.summary = level === 'scope' ? scope : paraphrase;
      return output;
    });
    const input = [
      {
        id: 'features',
        title: 'Features',
        groups: [
          {
            id: 'g',
            title: 'Changelog',
            scope: 'Changelog',
            items: ['Add workspace controls and PR context.'],
          },
        ],
      },
    ];
    expect(
      await summarizeChangelog(input, {
        ...config,
        minItems: 0,
        levels: ['category', 'scope'],
      }),
    ).toBeNull();
    const requests = requestMock.mock.calls.filter(
      ([request]) => JSON.parse(request.input).level === 'category',
    );
    expect(requests).toHaveLength(2);
    for (const [request] of requests) {
      const node = JSON.parse(request.input).nodes[0];
      const schema = (request.schema as any).properties.summaries.properties[
        node.id
      ];
      expect(schema.properties.summary.maxLength).toBe(
        Math.floor(Array.from(scope).length * 0.55),
      );
    }
  });

  it('repairs copied child wording while preserving all selected levels', async () => {
    const copied =
      'Workspace owners can exclude unrelated paths from their release notes';
    const scope =
      `${copied}. ` +
      'Additional workspace history and AI description details. '.repeat(8);
    let categoryCalls = 0;
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      const level = JSON.parse(request.input).level;
      for (const digest of Object.values(output.summaries))
        digest.summary =
          level === 'scope'
            ? scope
            : level === 'category'
              ? ++categoryCalls === 1
                ? copied + '.'
                : 'Workspace releases gain focused history and richer change explanations.'
              : 'Releases provide clearer, more focused change information.';
      return output;
    });
    const input = [
      {
        id: 'features',
        title: 'Features',
        groups: [
          {
            id: 'g',
            title: 'Changelog',
            scope: 'Changelog',
            items: ['Add workspace controls and PR context.'],
          },
        ],
      },
    ];
    const result = await summarizeChangelog(input, { ...config, minItems: 0 });
    expect(categoryCalls).toBe(2);
    expect(result).toMatchObject({
      release: expect.any(String),
      categories: {
        features:
          'Workspace releases gain focused history and richer change explanations.',
      },
      scopes: { g: scope.trim() },
    });
  });

  it('rejects an overlong overview instead of displaying concatenated category prose', async () => {
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      if (JSON.parse(request.input).level === 'release')
        Object.values(output.summaries)[0].summary = 'x'.repeat(401);
      return output;
    });
    expect(await summarizeChangelog(categories, config)).toBeNull();
  });

  it.each([
    ['scope', 1200],
    ['category', 600],
    ['release', 400],
  ] as const)(
    'accepts %s prose at its Unicode character limit',
    async (level, limit) => {
      const prose = '🚀'.repeat(limit);
      requestMock.mockImplementation(async request => {
        const output = modelResponse(request);
        for (const digest of Object.values(output.summaries))
          digest.summary =
            JSON.parse(request.input).level === level
              ? prose
              : '🚀'.repeat(
                  JSON.parse(request.input).level === 'scope' ? 1200 : 600,
                );
        return output;
      });
      const result = await summarizeChangelog(categories, {
        ...config,
        minItems: 0,
        levels: [level],
      });
      expect(result).not.toBeNull();
      expect(
        result!.release || result!.categories.features || result!.scopes.api,
      ).toBe(prose);
    },
  );

  it.each([
    ['scope', 1200],
    ['category', 600],
    ['release', 400],
  ] as const)(
    'rejects %s prose exceeding its Unicode character limit',
    async (level, limit) => {
      requestMock.mockImplementation(async request => {
        const output = modelResponse(request);
        for (const digest of Object.values(output.summaries))
          digest.summary = '🚀'.repeat(
            JSON.parse(request.input).level === level
              ? limit + 1
              : JSON.parse(request.input).level === 'scope'
                ? 1200
                : 600,
          );
        return output;
      });
      expect(
        await summarizeChangelog(categories, {
          ...config,
          minItems: 0,
          levels: [level],
        }),
      ).toBeNull();
    },
  );

  it.each([1200, 1201])(
    'validates carried Unicode critical facts at %i characters',
    async length => {
      requestMock.mockImplementation(async request => {
        const output = modelResponse(request);
        Object.values(output.summaries).forEach((digest: any) => {
          digest.importantChanges.forEach((fact: any) => {
            fact.summary = '🚀'.repeat(length);
          });
        });
        return output;
      });
      const result = await summarizeChangelog(
        [
          {
            id: 'fixes',
            title: 'Fixes',
            groups: [
              { id: 'g', title: 'Dependencies', items: ['Security fix.'] },
            ],
          },
        ],
        { ...config, minItems: 0 },
      );
      if (length === 1201) expect(result).toBeNull();
      else {
        expect(result).not.toBeNull();
        const last = JSON.parse(requestMock.mock.calls.at(-1)![0].input);
        expect(last.nodes[0].parts[0].importantChanges[0].summary).toBe(
          '🚀'.repeat(1200),
        );
      }
    },
  );

  it('reuses digests and includes small unscoped groups in every parent', async () => {
    const result = await summarizeChangelog(categories, config);
    expect(result).not.toBeNull();
    const inputs = requestMock.mock.calls.map(([options]) =>
      JSON.parse(options.input),
    );
    expect(
      inputs.find(input => input.level === 'category').nodes[0].parts,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'small',
          text: expect.stringContaining('Small feature'),
        }),
      ]),
    );
    expect(
      inputs.find(input => input.level === 'category').nodes[0].parts[0].text,
    ).toBe(result!.scopes.api);
    expect(
      inputs.find(input => input.level === 'release').nodes[0].parts[0].text,
    ).toBe(result!.categories.features);
    expect(
      inputs
        .find(input => input.level === 'release')
        .nodes[0].parts.map((part: any) => part.count),
    ).toEqual([7, 6]);
  });

  it('retains child scope labels when reusing scope digests in a category', async () => {
    requestMock.mockImplementation(async request => ({
      summaries: Object.fromEntries(
        JSON.parse(request.input)
          .nodes.map((node: any) => ({
            id: node.id,
            ...(JSON.parse(request.input).level === 'release'
              ? { coveredPartIds: node.parts.map((part: any) => part.id) }
              : {}),
            summary: 'Added commands.',
            importantChanges: [],
          }))
          .map(({ id, ...digest }: any) => [id, digest]),
      ),
    }));
    expect(await summarizeChangelog(categories, config)).not.toBeNull();
    const categoryRequest = requestMock.mock.calls
      .map(([request]) => JSON.parse(request.input))
      .find(input => input.level === 'category');
    expect(categoryRequest.nodes[0].parts).toMatchObject([
      { title: 'API', text: 'Added commands.' },
      { title: 'Other', text: 'Added commands.' },
    ]);
  });

  it('applies writing style at every level while retaining the base constraints', async () => {
    await summarizeChangelog(categories, config);
    const base =
      requestMock.mock.calls[0][0].system.split('\nDisplay role:')[0];
    requestMock.mockClear();
    const style = 'Concise and friendly for developers.';
    expect(
      await summarizeChangelog(categories, { ...config, style }),
    ).not.toBeNull();
    for (const [request] of requestMock.mock.calls) {
      expect(request.system.startsWith(base)).toBe(true);
      expect(request.system).toContain(JSON.stringify(style));
      expect(request.system).toContain('requirements above still apply');
    }
  });

  it('constrains generated digest IDs and counts to the requested nodes at every level', async () => {
    expect(await summarizeChangelog(categories, config)).not.toBeNull();
    for (const [request] of requestMock.mock.calls) {
      const nodes = JSON.parse(request.input).nodes;
      const entries = (request.schema as any).properties.summaries;
      expect(entries.type).toBe('object');
      expect(entries.additionalProperties).toBe(false);
      expect(entries.required).toEqual(nodes.map((node: any) => node.id));
      expect(Object.keys(entries.properties)).toEqual(
        nodes.map((node: any) => node.id),
      );
      for (const part of nodes.flatMap((node: any) => node.parts))
        expect(Object.keys(entries.properties)).not.toContain(part.id);
    }
  });

  it('constrains critical fact IDs and minimum coverage separately for each node', async () => {
    const input = [
      {
        id: 'critical',
        title: 'Critical',
        groups: [
          {
            id: 'fix',
            title: 'Fix',
            items: ['Breaking change: remove legacy API.'],
          },
        ],
      },
    ];
    expect(
      await summarizeChangelog(input, { ...config, minItems: 0 }),
    ).not.toBeNull();
    for (const [request] of requestMock.mock.calls) {
      const nodes = JSON.parse(request.input).nodes;
      const branches = Object.values(
        (request.schema as any).properties.summaries.properties,
      ) as any[];
      expect(Array.isArray(branches)).toBe(true);
      for (const [index, node] of nodes.entries()) {
        const allowed = [
          ...new Set(
            node.parts.flatMap((part: any) => [
              ...(part.sourceId ? [part.sourceId] : []),
              ...(part.importantChanges || []).map((fact: any) => fact.id),
            ]),
          ),
        ];
        const required = new Set(
          node.parts.flatMap((part: any) => [
            ...(part.important && part.sourceId ? [part.sourceId] : []),
            ...(part.importantChanges || []).map((fact: any) => fact.id),
          ]),
        );
        const facts = branches[index].properties.importantChanges;
        expect(facts.minItems).toBe(required.size);
        expect(facts.maxItems).toBe(Math.min(100, allowed.length));
        expect(facts.items.properties.id.enum).toEqual(allowed);
      }
    }
  });

  it('does not emit an empty fact-ID enum for parents without critical facts', async () => {
    expect(await summarizeChangelog(categories, config)).not.toBeNull();
    const parents = requestMock.mock.calls.filter(
      ([request]) => JSON.parse(request.input).level !== 'scope',
    );
    expect(parents.length).toBeGreaterThan(0);
    for (const [request] of parents) {
      const branches = Object.values(
        (request.schema as any).properties.summaries.properties,
      ) as any[];
      for (const branch of branches) {
        const facts = branch.properties.importantChanges;
        expect(facts.minItems).toBe(0);
        expect(facts.maxItems).toBe(0);
        expect(facts.items.properties.id).toEqual({ type: 'string' });
      }
    }
  });

  it('preserves fallback without making a request when required facts exceed the response limit', async () => {
    const result = await summarizeChangelog(
      [
        {
          id: 'critical',
          title: 'Critical',
          groups: [
            {
              id: 'fix',
              title: 'Fix',
              items: Array.from({ length: 101 }, (_, i) => `Security fix ${i}`),
            },
          ],
        },
      ],
      { ...config, minItems: 0 },
    );
    expect(result).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stage=scope; reason=input-budget'),
    );
  });

  it('keeps strict structured-output and input bounds', async () => {
    await summarizeChangelog(categories, config);
    for (const [request] of requestMock.mock.calls) {
      expect(request.schema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['summaries'],
      });
      expect(Buffer.byteLength(request.input)).toBeLessThanOrEqual(24000);
    }
  });

  it('fragments oversized Unicode entries without losing text', async () => {
    const entry = '🙂'.repeat(16000);
    const result = await summarizeChangelog(
      [
        {
          id: 'big',
          title: 'Big',
          groups: [
            {
              id: 'unicode',
              title: 'Unicode',
              scope: 'Unicode',
              items: [entry],
            },
          ],
        },
      ],
      { ...config, minItems: 0 },
    );
    expect(result!.release).toBeTruthy();
    const atoms = requestMock.mock.calls
      .flatMap(([options]) => JSON.parse(options.input).nodes)
      .flatMap(node => node.parts)
      .filter(part => part.sourceId?.startsWith('unicode:item:0:part:'));
    expect(atoms.map(part => part.text).join('')).toBe(entry);
  });

  it('summarizes a large release instead of skipping the whole input', async () => {
    const groups = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`,
      title: `Scope ${i}`,
      scope: `Scope ${i}`,
      items: Array.from(
        { length: 6 },
        (_, j) => `Change ${i}-${j} ${'x'.repeat(800)}`,
      ),
    }));
    const result = await summarizeChangelog(
      [{ id: 'large', title: 'Large', groups }],
      config,
    );
    expect(Object.keys(result!.scopes)).toHaveLength(30);
    expect(result!.release).toBeTruthy();
  });

  it('carries source-linked security and breaking facts through reductions', async () => {
    const result = await summarizeChangelog(
      [
        {
          id: 'fix',
          title: 'Fixes',
          groups: [
            {
              id: 'security',
              title: 'Security',
              items: [
                'SECURITY: fix CVE-1234',
                'BREAKING CHANGE: remove old API',
              ],
            },
          ],
        },
      ],
      { ...config, minItems: 1 },
    );
    expect(result!.release).toBeTruthy();
    const input = JSON.parse(requestMock.mock.calls.at(-1)![0].input);
    expect(
      input.nodes[0].parts[0].importantChanges.map((fact: any) => fact.id),
    ).toEqual(['security:item:0', 'security:item:1']);
  });

  it('does not invent scope summaries for unscoped lists', async () => {
    expect(
      await summarizeChangelog(
        [
          {
            id: 'flat',
            title: 'Features',
            groups: [
              {
                id: 'g',
                title: 'Features',
                items: categories[0].groups[0].items,
              },
            ],
          },
        ],
        { ...config, levels: ['scope'] },
      ),
    ).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('carries critical facts internally without appending them to visible prose', async () => {
    requestMock.mockImplementation(async options => {
      const output = modelResponse(options!);
      Object.values(output.summaries).forEach((digest: any) => {
        digest.summary = 'General maintenance.';
      });
      return output;
    });
    const result = await summarizeChangelog(
      [
        {
          id: 'fix',
          title: 'Fixes',
          groups: [{ id: 'g', title: 'G', items: ['SECURITY: fix CVE-1234'] }],
        },
      ],
      { ...config, minItems: 0 },
    );
    expect(result!.release).toBe('General maintenance.');
    const last = JSON.parse(requestMock.mock.calls.at(-1)![0].input);
    expect(last.nodes[0].parts[0].importantChanges).toEqual([
      { id: 'g:item:0', summary: 'SECURITY: fix CVE-1234' },
    ]);
  });

  it('preserves different critical facts in separate fragments of one oversized entry', async () => {
    requestMock.mockImplementation(async options => {
      const output = modelResponse(options!);
      Object.values(output.summaries).forEach((digest: any) => {
        digest.summary = 'General maintenance.';
        digest.importantChanges = [
          ...new Map(
            digest.importantChanges.map((fact: any) => [fact.id, fact]),
          ).values(),
        ];
      });
      return output;
    });
    const entry = `SECURITY: fix CVE-A ${'x'.repeat(16000)} BREAKING CHANGE: remove API-B ${'y'.repeat(16000)}`;
    const result = await summarizeChangelog(
      [
        {
          id: 'a',
          title: 'A',
          groups: [{ id: 'g', title: 'G', items: [entry] }],
        },
      ],
      { ...config, minItems: 0 },
    );
    expect(result!.release).toBe('General maintenance.');
    const last = JSON.parse(requestMock.mock.calls.at(-1)![0].input);
    const facts = JSON.stringify(last.nodes[0].parts[0].importantChanges);
    expect(facts).toContain('CVE-A');
    expect(facts).toContain('API-B');
  });

  it.each(['scope', 'category', 'release'] as const)(
    'rejects a late final %s response before an overdue timer callback runs',
    async level => {
      vi.useFakeTimers();
      requestMock.mockImplementation(async request => {
        const output = modelResponse(request);
        if (JSON.parse(request.input).level === level)
          vi.setSystemTime(Date.now() + 30001);
        return output;
      });
      expect(
        await summarizeChangelog(
          [
            {
              id: 'fixes',
              title: 'Fixes',
              groups: [
                {
                  id: 'g',
                  title: 'Dependencies',
                  scope: 'Deps',
                  items: ['Dependency update.'],
                },
              ],
            },
          ],
          { ...config, minItems: 0, levels: [level] },
        ),
      ).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`stage=${level}; reason=deadline`),
      );
    },
  );

  it('rejects a response past the total deadline without making another model call', async () => {
    vi.useFakeTimers();
    requestMock.mockImplementation(async request => {
      const output = modelResponse(request);
      vi.setSystemTime(Date.now() + 120001);
      return output;
    });
    expect(
      await summarizeChangelog(
        [
          {
            id: 'fixes',
            title: 'Fixes',
            groups: [
              { id: 'g', title: 'Dependencies', items: ['Dependency update.'] },
            ],
          },
        ],
        { ...config, minItems: 0 },
      ),
    ).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stage=scope; reason=deadline'),
    );
  });

  it('enforces the total deadline across individually successful requests', async () => {
    vi.useFakeTimers();
    requestMock.mockImplementation(
      async options =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(modelResponse(options)),
            25000,
          );
          options!.signal!.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    );
    const groups = Array.from({ length: 50 }, (_, i) => ({
      id: `g${i}`,
      title: 'G',
      items: ['entry'],
    }));
    const pending = summarizeChangelog([{ id: 'a', title: 'A', groups }], {
      ...config,
      minItems: 0,
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect(await pending).toBeNull();
    expect(requestMock.mock.calls.at(-1)![0]!.signal!.aborted).toBe(true);
  });

  it.each([
    null,
    {},
    {
      summaries: {},
    },
    {
      summaries: Object.fromEntries(
        [{ id: 'unknown', summary: 'text', importantChanges: [] }].map(
          ({ id, ...digest }: any) => [id, digest],
        ),
      ),
    },
  ])('rejects incomplete structured responses (%j)', async payload => {
    requestMock.mockResolvedValue(payload);
    expect(await summarizeChangelog(categories, config)).toBeNull();
  });

  it.each([
    'response-schema',
    'response-repetition',
    'response-json',
    'important-missing',
    'important-duplicate',
  ] as const)(
    'repairs %s once using the same source and schema',
    async reason => {
      const { SummaryFailure } = await import('../ai-summary-error');
      requestMock.mockRejectedValueOnce(new SummaryFailure(reason));
      expect(await summarizeChangelog(categories, config)).not.toBeNull();
      const [first, repaired] = requestMock.mock.calls.map(
        ([request]) => request,
      );
      expect(repaired.input).toBe(first.input);
      expect(repaired.schema).toEqual(first.schema);
      expect(repaired.system).toContain('previous response failed validation');
      expect(repaired.signal).not.toBe(first.signal);
    },
  );

  it('stops after one failed repair and preserves original-output fallback', async () => {
    requestMock.mockResolvedValue({ summaries: {} });
    expect(await summarizeChangelog(categories, config)).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('counts structured-output repairs against the global request budget', async () => {
    requestMock.mockImplementation(async request => {
      if (!request.system.includes('previous response failed validation'))
        return {};
      const output = modelResponse(request);
      for (const digest of Object.values(output.summaries))
        digest.summary = 'Updated commands.';
      return output;
    });
    const groups = Array.from({ length: 248 }, (_, i) => ({
      id: `g${i}`,
      title: 'G',
      items: ['entry'],
    }));
    expect(
      await summarizeChangelog([{ id: 'a', title: 'A', groups }], {
        ...config,
        minItems: 0,
      }),
    ).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(64);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('reason=request-budget'),
    );
  });

  it('does not extend the overall deadline when repairing output', async () => {
    vi.useFakeTimers();
    const { SummaryFailure } = await import('../ai-summary-error');
    requestMock
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 119999);
        throw new SummaryFailure('response-schema');
      })
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 2);
        return {};
      });
    expect(await summarizeChangelog(categories, config)).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('reason=deadline'),
    );
  });

  it('uses release-only defaults, treats empty levels as release, and supports threshold zero', async () => {
    const small = [
      {
        id: 'a',
        title: 'A',
        groups: [{ id: 'g', title: 'G', scope: 'G', items: ['one'] }],
      },
    ];
    expect(await summarizeChangelog(small, config)).toBeNull();
    expect(
      await summarizeChangelog(small, {
        ...config,
        minItems: 0,
        levels: [],
      }),
    ).toMatchObject({
      release: expect.any(String),
      categories: {},
      scopes: {},
    });
    expect(
      await summarizeChangelog(small, { ...config, minItems: 0 }),
    ).toMatchObject({
      release: expect.any(String),
      categories: { a: expect.any(String) },
      scopes: { g: expect.any(String) },
    });
    expect(
      await summarizeChangelog(categories, { ...config, levels: ['category'] }),
    ).toMatchObject({ release: '' });
    expect(await summarizeChangelog([], { ...config, minItems: 0 })).toBeNull();
  });

  it('uses descendant counts and strictly exceeds the threshold at every level', async () => {
    const make = (n: number) => [
      {
        id: 'a',
        title: 'A',
        groups: [
          {
            id: 'g1',
            title: 'G1',
            scope: 'G1',
            items: ['one', 'two', 'three'],
          },
          {
            id: 'g2',
            title: 'G2',
            scope: 'G2',
            items: Array.from({ length: n }, (_, i) => `extra ${i}`),
          },
        ],
      },
    ];
    expect(await summarizeChangelog(make(2), config)).toBeNull();
    const result = await summarizeChangelog(make(3), config);
    expect(result).toMatchObject({
      categories: { a: expect.any(String) },
      scopes: {},
      release: expect.any(String),
    });
  });

  it('skips disabled, strict and worktree dry-run requests', async () => {
    expect(await summarizeChangelog(categories, undefined)).toBeNull();
    expect(await summarizeChangelog(categories, false)).toBeNull();
    setGlobals({ 'dry-run': true });
    expect(await summarizeChangelog(categories, config)).toBeNull();
    enableWorktreeMode();
    expect(await summarizeChangelog(categories, config)).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    'duplicate',
    'unknown',
    'missing-critical',
    'unlinked-critical',
    'negative-claim',
  ])('rejects %s output atomically', async mode => {
    requestMock.mockImplementation(async options => {
      const output = modelResponse(options!);
      if (mode === 'missing')
        delete output.summaries[Object.keys(output.summaries)[0]];
      if (mode === 'duplicate')
        return {
          summaries: [
            Object.values(output.summaries)[0],
            Object.values(output.summaries)[0],
          ],
        };
      if (mode === 'unknown') {
        output.summaries.invented = Object.values(output.summaries)[0];
        delete output.summaries[Object.keys(output.summaries)[0]];
      }
      if (mode === 'missing-critical')
        Object.values(output.summaries)[0].importantChanges = [];
      if (mode === 'unlinked-critical')
        Object.values(output.summaries)[0].importantChanges = [
          { id: 'invented', summary: 'invention' },
        ];
      if (mode === 'negative-claim')
        Object.values(output.summaries)[0].summary =
          'No security fixes are included.';
      return output;
    });
    expect(
      await summarizeChangelog(
        [
          {
            id: 'a',
            title: 'A',
            groups: [{ id: 'g', title: 'G', items: ['SECURITY: fix CVE-1'] }],
          },
        ],
        { ...config, minItems: 0 },
      ),
    ).toBeNull();
  });

  it.each([401, 402, 429, 503])(
    'falls back without retries or leaking provider errors (%s)',
    async status => {
      requestMock.mockRejectedValue(
        new Error(`Provider failure ${status}: private-token`),
      );
      expect(await summarizeChangelog(categories, config)).toBeNull();
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
        'private-token',
      );
    },
  );

  it('aborts outstanding requests when a concurrent batch fails', async () => {
    let aborted = false;
    requestMock.mockImplementation(async options => {
      if (requestMock.mock.calls.length === 1)
        throw new Error('Provider unavailable');
      return new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        }),
      );
    });
    const groups = Array.from({ length: 20 }, (_, i) => ({
      id: `g${i}`,
      title: 'G',
      scope: 'G',
      items: ['x'],
    }));
    expect(
      await summarizeChangelog([{ id: 'a', title: 'A', groups }], {
        ...config,
        minItems: 0,
      }),
    ).toBeNull();
    expect(aborted).toBe(true);
  });

  it.each([
    'No security fixes.',
    'No security changes.',
    'No breaking changes.',
  ])(
    'rejects misleading negative claims in important-change facts: %s',
    async claim => {
      requestMock.mockImplementation(async options => {
        const input = JSON.parse(options.input);
        return {
          summaries: Object.fromEntries(
            input.nodes
              .map((node: any) => ({
                id: node.id,
                summary: 'General maintenance.',
                importantChanges: node.parts
                  .filter((part: any) => part.important)
                  .map((part: any) => ({
                    id: part.sourceId,
                    summary: claim,
                  })),
              }))
              .map(({ id, ...digest }: any) => [id, digest]),
          ),
        };
      });
      const result = await summarizeChangelog(
        [
          {
            id: 'security',
            title: 'Security',
            groups: [
              {
                id: 'fix',
                title: 'Fixes',
                scope: 'Fixes',
                items: ['Security fix for a vulnerability'],
              },
            ],
          },
        ],
        { ...config, levels: ['scope'], minItems: 0 },
      );
      expect(requestMock).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    },
  );

  it('bounds concurrency and total requests for huge releases', async () => {
    let active = 0,
      peak = 0;
    requestMock.mockImplementation(async options => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return modelResponse(options);
    });
    const groups = Array.from({ length: 1000 }, (_, i) => ({
      id: `g${i}`,
      title: 'G',
      scope: 'G',
      items: ['x'],
    }));
    expect(
      await summarizeChangelog([{ id: 'a', title: 'A', groups }], {
        ...config,
        minItems: 0,
      }),
    ).toBeNull();
    expect(requestMock.mock.calls.length).toBeLessThanOrEqual(64);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('limits in-flight requests during a successful multi-batch release', async () => {
    let active = 0,
      peak = 0;
    requestMock.mockImplementation(async options => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return modelResponse(options);
    });
    const groups = Array.from({ length: 40 }, (_, i) => ({
      id: `g${i}`,
      title: 'G',
      items: ['entry'],
    }));
    const result = await summarizeChangelog([{ id: 'a', title: 'A', groups }], {
      ...config,
      levels: ['release'],
      minItems: 0,
    });
    expect(result!.release).toBeTruthy();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('aborts a stuck request at its deadline', async () => {
    vi.useFakeTimers();
    requestMock.mockImplementation(
      async options =>
        new Promise((_resolve, reject) =>
          options!.signal!.addEventListener('abort', () =>
            reject(new Error('test-key')),
          ),
        ),
    );
    const pending = summarizeChangelog(categories, config);
    await vi.advanceTimersByTimeAsync(30000);
    expect(await pending).toBeNull();
    expect(requestMock.mock.calls[0][0]!.signal!.aborted).toBe(true);
  });
});

it('neutralizes generated mentions, references, links and HTML', () => {
  const formatted = formatSummaryText(
    '@octocat @getsentry/engineering #688 https://example.com <script>',
  );
  expect(formatted).toContain('@\u200boctocat');
  expect(formatted).toContain('#\u200b688');
  expect(formatted).not.toContain('&#64;');
  expect(formatted).toContain('https&#58;//');
  expect(formatted).toContain('&lt;script&gt;');
});

it.each([
  'ftp://example.com',
  'https://example.com',
  'http://example.com',
  'www.example.com',
  'person@example.com',
  '<ftp://example.com>',
  '[download](ftp://example.com)',
])('generated prose stays inert when rendered: %s', text => {
  const html = marked.parse(formatSummaryText(text));
  expect(html).not.toContain('<a ');
});

it('condenses PR descriptions into bounded summary context', () => {
  expect(summaryDescription(undefined)).toBeUndefined();
  expect(summaryDescription('<!-- template only -->\n\n')).toBeUndefined();
  expect(
    summaryDescription(
      [
        '<!-- Describe your PR -->',
        '## Summary :rocket:',
        'Removes the  `foo` option 🚀 from [the config](https://example.com) <b>now</b>.',
        '',
        '```yaml',
        'foo: true',
        '```',
        '- Use **bar**  ',
        'instead 👍🏽',
        '  - nested',
        '',
        '| Old | New |',
        '| --- | --- |',
        '| foo | bar |',
        '',
        '![screenshot](https://example.com/a.png)',
        '<details><summary>Logs</summary>noise</details>',
      ].join('\n'),
    ),
  ).toBe(
    'Summary Removes the foo option from the config now. Use bar instead nested Old New foo bar',
  );
  expect(
    summaryDescription(
      'Breaking: `:memory:` is now required for isolated database tests :tada:',
    ),
  ).toBe('Breaking: :memory: is now required for isolated database tests');
  const long = summaryDescription('é'.repeat(1400))!;
  expect(Array.from(long)).toHaveLength(1200);
  expect(long.endsWith('…')).toBe(true);
});

it('retains migration instructions after a long introductory paragraph', () => {
  const context = summaryDescription(
    'Background about version detection. '.repeat(40) +
      '\n\n**Breaking: prepare now fails if no target bumps a version.** ' +
      "Tag-derived versions must set `preReleaseCommand: ''` to opt out.",
  )!;
  expect(context).toContain('prepare now fails');
  expect(context).toContain("preReleaseCommand: ''");
  expect(Array.from(context).length).toBeLessThanOrEqual(1200);
});

it('keeps migration sections together when prioritizing bounded context', () => {
  const context = summaryDescription(
    'Background. '.repeat(150) +
      '\n\n## Migration\n\nSet `preReleaseCommand` to an empty string for tag-derived versions.\n\n## Tests\n\n' +
      'Details. '.repeat(150),
  )!;
  expect(context).toContain(
    'Migration Set preReleaseCommand to an empty string for tag-derived versions.',
  );
  expect(context.indexOf('Migration')).toBeLessThan(
    context.indexOf('Background'),
  );
  expect(Array.from(context).length).toBeLessThanOrEqual(1200);
});
