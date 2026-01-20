import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Allow base path override via environment variable for PR previews
const base = process.env.DOCS_BASE_PATH || '/craft';

export default defineConfig({
  site: 'https://getsentry.github.io',
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
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: '' },
            { label: 'Installation', slug: 'getting-started' },
            { label: 'Configuration', slug: 'configuration' },
            { label: 'GitHub Actions', slug: 'github-actions' },
          ],
        },
        {
          label: 'Targets',
          autogenerate: { directory: 'targets' },
        },
        {
          label: 'Resources',
          items: [{ label: 'Contributing', slug: 'contributing' }],
        },
      ],
      customCss: [],
    }),
  ],
});
