import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summarizeChangelog, formatSummaryWithDetails } from '../ai-summary';
import { setGlobals } from '../helpers';
import { enableWorktreeMode, disableWorktreeMode } from '../dryRun';
import { logger } from '../../logger';
import { marked } from 'marked';

const config = {
  enabled: true,
  model: 'openai/gpt-6-luna',
  kickInThreshold: 5,
  topLevel: 'threshold',
} as const;
const sections = [
  {
    title: 'Features / CLI',
    items: [
      'Added alpha',
      'Added beta',
      'Added gamma',
      'Added delta',
      'Added epsilon',
      'Added sixth command',
    ],
  },
];
const summary = {
  topLevel: 'Added CLI commands.',
  sections: [{ id: 0, summary: 'Added six commands.' }],
};

function completion(content: unknown = summary) {
  return {
    choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify(content) } },
    ],
  };
}

describe('OpenRouter changelog summaries', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(Response.json(completion()));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    setGlobals({ 'dry-run': false });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setGlobals({ 'dry-run': false });
    disableWorktreeMode();
  });

  it('sends every item to Luna in one bounded, structured request', async () => {
    expect(await summarizeChangelog(sections, config)).toEqual(summary);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      },
    });
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({
      model: 'openai/gpt-6-luna',
      provider: { require_parameters: true },
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(body.messages[1].content).toContain('Added sixth command');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.max_tokens).toBeLessThanOrEqual(8192);
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([undefined, { ...config, enabled: false }])(
    'does not opt users in automatically (%j)',
    async settings => {
      expect(await summarizeChangelog(sections, settings)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('skips summaries at the threshold and for empty releases', async () => {
    expect(
      await summarizeChangelog(
        [{ title: 'Features', items: sections[0].items.slice(0, 5) }],
        config,
      ),
    ).toBeNull();
    expect(
      await summarizeChangelog([], { ...config, topLevel: 'always' }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can generate only an overview of small sections', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        completion({ topLevel: 'Added commands and fixes.', sections: [] }),
      ),
    );
    expect(
      await summarizeChangelog(
        [{ title: 'Features', items: ['Added one command'] }],
        { ...config, topLevel: 'always' },
      ),
    ).toEqual({ topLevel: 'Added commands and fixes.', sections: [] });
  });

  it('can generate only section summaries', async () => {
    fetchMock.mockResolvedValue(
      Response.json(completion({ ...summary, topLevel: null })),
    );
    expect(
      await summarizeChangelog(sections, { ...config, topLevel: 'never' }),
    ).toEqual({ ...summary, topLevel: null });
  });

  it('uses a configured model and section threshold', async () => {
    fetchMock.mockResolvedValue(
      Response.json(completion({ ...summary, topLevel: null })),
    );
    await summarizeChangelog(
      [{ title: 'Fixes', items: ['Fix one', 'Fix two'] }],
      {
        ...config,
        model: 'openai/gpt-6-luna',
        kickInThreshold: 1,
        topLevel: 'never',
      },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(JSON.parse(body.messages[1].content).sectionIds).toEqual([0]);
  });

  it('skips model calls during both strict and worktree dry runs', async () => {
    setGlobals({ 'dry-run': true });
    expect(await summarizeChangelog(sections, config)).toBeNull();
    enableWorktreeMode();
    expect(await summarizeChangelog(sections, config)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back without credentials and without logging secrets', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(await summarizeChangelog(sections, config)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips oversized inputs without silently truncating entries', async () => {
    expect(
      await summarizeChangelog(
        [{ title: 'Features', items: ['x'.repeat(120001)] }],
        { ...config, topLevel: 'always' },
      ),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 402, 429, 503])(
    'preserves original output on HTTP %s without retries',
    async status => {
      fetchMock.mockResolvedValue(
        new Response('secret test-key in provider error', { status }),
      );
      expect(await summarizeChangelog(sections, config)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
        'test-key',
      );
    },
  );

  it('handles an aborted request without exposing the error', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fetchMock.mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () =>
            reject(new Error('test-key: timeout')),
          );
        }),
    );
    const result = summarizeChangelog(sections, config);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await result).toBeNull();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      'test-key',
    );
  });

  it.each([
    {
      choices: [
        {
          finish_reason: 'length',
          message: { content: JSON.stringify(summary) },
        },
      ],
    },
    {
      choices: [
        {
          finish_reason: 'error',
          message: { content: JSON.stringify(summary) },
        },
      ],
    },
    { error: { message: 'failed' }, ...completion() },
    { choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] },
    completion({
      ...summary,
      sections: [{ id: 99, summary: 'Wrong section' }],
    }),
    completion({
      ...summary,
      sections: [summary.sections[0], summary.sections[0]],
    }),
    completion({ ...summary, sections: [] }),
    completion({ ...summary, sections: [{ id: 0, summary: '' }] }),
    completion({ ...summary, topLevel: 'x'.repeat(1201) }),
  ])('rejects invalid or incomplete responses (%j)', async response => {
    fetchMock.mockResolvedValue(Response.json(response));
    expect(await summarizeChangelog(sections, config)).toBeNull();
  });
});

describe('summary formatting', () => {
  it('preserves nested items, links and authors inside the details block', () => {
    const items = [
      '- Added CLI by @author in [#12](https://github.com/org/repo/pull/12)\n  - Nested detail',
      '- Fixed startup',
    ];
    expect(
      formatSummaryWithDetails('Added commands and fixed startup.', items),
    ).toBe(
      'Added commands and fixed startup.\n\n<details>\n<summary>Show 2 items</summary>\n\n- Added CLI by @author in [#12](https://github.com/org/repo/pull/12)\n  - Nested detail\n- Fixed startup\n\n</details>',
    );
  });

  it('renders generated HTML, markdown and mentions as plain text', () => {
    expect(
      formatSummaryWithDetails(
        '<img src=x> [click](https://evil.test) @everyone\n# heading',
        ['- Original'],
      ),
    ).toContain(
      '&lt;img src=x&gt; \\[click\\](https&#58;//evil.test) &#64;everyone \\# heading',
    );
  });

  it('does not turn generated URLs or email addresses into GFM links', () => {
    const markdown = formatSummaryWithDetails(
      'See https://evil.test, www.evil.test, and support@evil.test.',
      ['- Original'],
    );
    const html = marked.parse(markdown) as string;
    expect(html).not.toContain('<a ');
    expect(html).toContain('https&#58;//evil.test');
  });
});
