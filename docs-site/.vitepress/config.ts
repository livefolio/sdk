import { defineConfig, type DefaultTheme } from 'vitepress';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const typedocSidebarPath = `${here}../api/typedoc-sidebar.json`;
const typedocSidebar: DefaultTheme.SidebarItem[] = existsSync(typedocSidebarPath)
  ? (JSON.parse(readFileSync(typedocSidebarPath, 'utf-8')) as DefaultTheme.SidebarItem[])
  : [];

export default defineConfig({
  title: '@livefolio/sdk',
  description:
    'TypeScript SDK for building tactical allocation strategies — declarative TacticalSpec, pluggable runtime layers, content-addressed feature cache.',
  base: '/sdk/',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/install' },
      { text: 'Recipes', link: '/recipes/v3-replication' },
      { text: 'API', link: '/api/' },
      { text: 'Architecture', link: '/architecture/four-layer-stack' },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Install', link: '/getting-started/install' },
            { text: 'Your first strategy', link: '/getting-started/first-strategy' },
            { text: 'Concepts', link: '/getting-started/concepts' },
            { text: 'Glossary', link: '/getting-started/glossary' },
          ],
        },
      ],
      '/guides/': [
        {
          text: 'Authoring strategies',
          items: [
            { text: 'Anatomy of a TacticalSpec', link: '/guides/authoring/anatomy-of-a-tactical-spec' },
            { text: 'Rule trees', link: '/guides/authoring/rule-trees' },
            { text: 'Synthetics', link: '/guides/authoring/synthetics' },
            { text: 'Rebalance schedules', link: '/guides/authoring/rebalance-schedules' },
          ],
        },
        {
          text: 'Customizing the runtime',
          items: [
            { text: 'Custom DataFeed', link: '/guides/runtime/custom-data-feed' },
            { text: 'Custom Executor', link: '/guides/runtime/custom-executor' },
            { text: 'Custom Calendar', link: '/guides/runtime/custom-calendar' },
            { text: 'Custom FeatureCache', link: '/guides/runtime/custom-feature-cache' },
          ],
        },
        {
          text: 'Authoring a new dialect',
          items: [
            { text: 'When to write a dialect', link: '/guides/dialect/when-to-write-a-dialect' },
            { text: 'The dialect contract', link: '/guides/dialect/dialect-contract' },
            { text: 'Versioning and deprecation', link: '/guides/dialect/versioning' },
            { text: 'Worked example: strategic dialect', link: '/guides/dialect/worked-example-strategic' },
          ],
        },
      ],
      '/recipes/': [
        {
          text: 'Recipes',
          items: [
            { text: 'Replicating a v0.3 strategy', link: '/recipes/v3-replication' },
            { text: 'Multi-asset trend-following', link: '/recipes/multi-asset-trend' },
            { text: 'Mean-reversion with hysteresis', link: '/recipes/mean-reversion' },
            { text: 'Backtest with realistic slippage', link: '/recipes/realistic-slippage' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Four-layer stack', link: '/architecture/four-layer-stack' },
            { text: 'Feature cache', link: '/architecture/feature-cache-content-addressing' },
            { text: 'Parity guarantee', link: '/architecture/parity-guarantee' },
          ],
        },
      ],
      '/setup/': [
        {
          text: 'Setup',
          items: [{ text: 'Claude Code skills', link: '/setup/claude-skills' }],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: typedocSidebar,
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/livefolio/sdk' }],

    search: { provider: 'local' },

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© livefolio',
    },
  },
});
