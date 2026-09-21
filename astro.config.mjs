// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeCitationStyle from './src/plugins/rehype-citation-style.mjs';
import remarkBibtexRefs from './src/plugins/remark-bibtex-refs.mjs';
import { fileURLToPath } from 'node:url';

const bibPath = fileURLToPath(new URL('./src/content/blog/references.bib', import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: 'https://open-lm-engine.github.io',
  integrations: [react(), mdx()],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, remarkGfm, () => remarkBibtexRefs(bibPath)],
      rehypePlugins: [rehypeKatex, rehypeCitationStyle],
      remarkRehype: {
        footnoteLabel: 'References',
        footnoteLabelProperties: { className: ['footnote-heading'] },
        footnoteBackLabel: 'Back to reference',
        footnoteBackContent: () => [],
      },
    }),
  },
});
