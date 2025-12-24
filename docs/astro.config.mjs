import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://getsentry.github.io',
  base: '/craft',
  integrations: [
    starlight({
      title: 'Craft',
      logo: {
        src: './src/assets/logo.svg',
      },
      social: {
        github: 'https://github.com/getsentry/craft',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: '' },
            { label: 'Installation', slug: 'getting-started' },
            { label: 'Configuration', slug: 'configuration' },
          ],
        },
        {
          label: 'Targets',
          autogenerate: { directory: 'targets' },
        },
        {
          label: 'Resources',
          items: [
            { label: 'Contributing', slug: 'contributing' },
          ],
        },
      ],
      customCss: [],
    }),
  ],
});
