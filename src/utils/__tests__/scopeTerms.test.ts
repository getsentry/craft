import { formatScopeTitle } from '../scopeTerms';

describe('formatScopeTitle', () => {
  it.each([
    ['core', 'Core'],
    ['cache-warming', 'Cache Warming'],
    ['my-component', 'My Component'],
    ['my_component', 'My Component'],
    ['multi-word-scope', 'Multi Word Scope'],
    ['multi_word_scope', 'Multi Word Scope'],
    ['mycomponent', 'Mycomponent'],
    ['constructor', 'Constructor'],
  ])('title-cases "%s" as "%s"', (scope, expected) => {
    expect(formatScopeTitle(scope)).toBe(expected);
  });

  it.each([
    ['api', 'API'],
    ['API', 'API'],
    ['ios', 'iOS'],
    ['ios-sdk', 'iOS SDK'],
    ['github', 'GitHub'],
    ['graphql', 'GraphQL'],
    ['typescript', 'TypeScript'],
    ['tvos', 'tvOS'],
  ])('uses the upstream spelling of "%s": "%s"', (scope, expected) => {
    expect(formatScopeTitle(scope)).toBe(expected);
  });

  it.each([
    ['gh', 'GH'],
    ['gh-actions', 'GH Actions'],
    ['ui', 'UI'],
    ['cli', 'CLI'],
    ['mcp', 'MCP'],
    ['http', 'HTTP'],
    ['npm', 'npm'],
    ['npm-target', 'npm Target'],
    ['visionos', 'visionOS'],
  ])('uses the Craft spelling of "%s": "%s"', (scope, expected) => {
    expect(formatScopeTitle(scope)).toBe(expected);
  });

  it.each([
    ['macos', 'macOS'],
    ['mac-os', 'macOS'],
    ['javascript', 'JavaScript'],
    ['nodejs', 'Node.js'],
    ['node-js', 'Node.js'],
    ['github-actions', 'GitHub Actions'],
    ['wifi', 'Wi-Fi'],
    ['ipv6', 'IPv6'],
    ['apis', 'APIs'],
  ])('applies upstream pattern rules to "%s": "%s"', (scope, expected) => {
    expect(formatScopeTitle(scope)).toBe(expected);
  });

  it.each([
    // Rules that rename a term
    ['repo', 'Repo'],
    ['golang', 'Golang'],
    ['e2e', 'E2e'],
    ['vscode', 'Vscode'],
    // Rules with an all-lowercase replacement
    ['readme', 'Readme'],
    ['built-in', 'Built In'],
  ])(
    'skips pattern rules that do more than fix casing: "%s"',
    (scope, expected) => {
      expect(formatScopeTitle(scope)).toBe(expected);
    },
  );
});
