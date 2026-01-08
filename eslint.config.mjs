import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['docs/**', 'dist/**', 'node_modules/**', 'coverage/**', '**/*.mjs', '**/*.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      // Make sure variables marked with _ are ignored (ex. _varName)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
        },
      ],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      // Dry-run safety: enforce using wrapped APIs that respect --dry-run flag
      // Block direct calls to simpleGit() - use getGitClient() or createGitClient() instead
      // Block direct instantiation of new Octokit() - use getGitHubClient() instead
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="simpleGit"]',
          message:
            'Use getGitClient() or createGitClient() from src/utils/git.ts for dry-run support. ' +
            'If this is the wrapper module, disable with: // eslint-disable-next-line no-restricted-syntax',
        },
        {
          selector: 'NewExpression[callee.name="Octokit"]',
          message:
            'Use getGitHubClient() from src/utils/githubApi.ts for dry-run support. ' +
            'If this is the wrapper module, disable with: // eslint-disable-next-line no-restricted-syntax',
        },
      ],
    },
  }
);
