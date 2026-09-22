// Renders a short Markdown string (frontmatter fields such as the abstract)
// to HTML with the same math support as the post body: remark-math + KaTeX.
// The processor is built once per module and reused across renders.
import { createMarkdownProcessor, type MarkdownRenderer } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

let processor: Promise<MarkdownRenderer> | undefined;

export function renderMarkdown(source: string): Promise<string> {
  processor ??= createMarkdownProcessor({
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    syntaxHighlight: false,
  });
  return processor.then((p) => p.render(source)).then((r) => r.code);
}
