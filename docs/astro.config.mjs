import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sentryStarlightTheme, {
  monochromeCodeTheme,
  sentryAgentMarkdown,
} from '@sentry/starlight-theme';

// Allow base path override via environment variable for PR previews
const base = process.env.DOCS_BASE_PATH || '/';

export default defineConfig({
  site: 'https://craft.sentry.dev',
  base: base,
  integrations: [
    starlight({
      title: 'Craft',
      logo: {
        src: './src/assets/logo.svg',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/getsentry/craft',
        },
      ],
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Installation', slug: 'installation' },
            { label: 'Quick Start', slug: 'getting-started' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Release Workflow', slug: 'release-workflow' },
            { label: 'Versioning', slug: 'versioning' },
            { label: 'Changelogs', slug: 'changelogs' },
            { label: 'AI Changelog Summaries', slug: 'ai-summaries' },
            { label: 'Monorepos & Release Workspaces', slug: 'workspaces' },
            { label: 'GitHub Actions', slug: 'github-actions' },
          ],
        },
        {
          label: 'Targets',
          items: [{ autogenerate: { directory: 'targets' } }],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration', slug: 'configuration' },
            { label: 'CLI', slug: 'cli' },
          ],
        },
        {
          label: 'Resources',
          items: [{ label: 'Contributing', slug: 'contributing' }],
        },
      ],
      plugins: [sentryStarlightTheme(), sentryAgentMarkdown()],
    }),
  ],
  markdown: {
    shikiConfig: {
      theme: monochromeCodeTheme,
    },
  },
});
