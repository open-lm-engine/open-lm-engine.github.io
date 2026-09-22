// Rehype plugin: render footnote-style citations (`[^key]` ... `[^key]: Author, ... (Year).`)
// as inline citations instead of remark-gfm's default superscript numbers. Runs after
// remark-rehype has already built the footnote structure, so it reads each citation's
// own definition text (already written in the post's Markdown) rather than requiring
// any separate metadata. Adjacent citations, e.g. [^a][^b], merge into one bracket.
//
// Style is set per-post via frontmatter: `citationStyle: 'text'` (default) renders
// author-year, e.g. (Vaswani et al., 2017); `citationStyle: 'numeric'` renders the
// original footnote number instead, e.g. [1], reusing remark-gfm's own numbering so it
// always matches the References list; `citationStyle: 'superscript'` renders that same
// number as a bare superscript with no brackets, e.g. word¹ (adjacent ones as ¹˒²).
import { visit } from 'unist-util-visit';
import { toText } from 'hast-util-to-text';

const FN_HREF_PREFIX = '#user-content-fn-';

function isFootnoteAnchor(node) {
  return (
    node &&
    node.type === 'element' &&
    node.tagName === 'a' &&
    typeof node.properties?.href === 'string' &&
    node.properties.href.startsWith(FN_HREF_PREFIX)
  );
}

function isFootnoteRefSup(node) {
  return (
    node &&
    node.type === 'element' &&
    node.tagName === 'sup' &&
    node.children.length === 1 &&
    isFootnoteAnchor(node.children[0])
  );
}

// Extract a short "Author et al., Year" style label from a citation's full text.
function extractShortCite(citationText) {
  const parenYears = [...citationText.matchAll(/\((\d{4})\)/g)];
  let year = '';
  if (parenYears.length > 0) {
    year = parenYears[parenYears.length - 1][1];
  } else {
    const bare = citationText.match(/\b(19|20)\d{2}\b/);
    if (bare) year = bare[0];
  }

  // Astro's markdown pipeline turns straight quotes into curly ones before this
  // plugin runs, so the title's opening quote may be " or the curly “.
  const quoteMatch = citationText.match(/["“]/);
  const quoteIdx = quoteMatch ? quoteMatch.index : -1;
  let authorsSeg;
  if (quoteIdx !== -1) {
    authorsSeg = citationText.slice(0, quoteIdx);
  } else if (year) {
    authorsSeg = citationText.slice(0, citationText.indexOf(year));
  } else {
    authorsSeg = citationText;
  }
  authorsSeg = authorsSeg.trim().replace(/[.,]$/, '');

  // corporate authors ("Kimi Team", "DeepSeek-AI") have no surname to pull out
  const GROUP_RE = /\b(team|ai|labs?|research|group)$/i;
  const etAlMatch = authorsSeg.match(/^(.*?)\s*,?\s*et al\.?$/i);
  if (etAlMatch) {
    const before = etAlMatch[1].trim();
    const commaIdx = before.indexOf(',');
    const surname = commaIdx !== -1 ? before.slice(0, commaIdx).trim() : GROUP_RE.test(before) ? before : before.split(/\s+/).pop();
    return year ? `${surname} et al., ${year}` : `${surname} et al.`;
  }
  // "Granite Team, IBM": one corporate author written with a comma, kept whole
  if (GROUP_RE.test(authorsSeg.split(',')[0]) && authorsSeg.split(',').length === 2 && !/\s+and\s+/.test(authorsSeg)) {
    return year ? `${authorsSeg}, ${year}` : authorsSeg;
  }

  // Authors arrive in natural order ("Tri Dao and Albert Gu", "A, B, and C")
  // from remark-bibtex-refs, or hand-written inverted ("Vaswani, Ashish, and
  // Noam Shazeer"); split on both commas and "and" so the first unit is one
  // person's name either way.
  const parts = authorsSeg.split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return year || citationText.slice(0, 24);

  const firstUnit = parts[0];
  const firstIsInverted = firstUnit.split(/\s+/).length === 1;
  // corporate first authors ("Granite Team", "Kimi Team") keep their whole name
  const firstSurname = firstIsInverted || GROUP_RE.test(firstUnit) ? firstUnit : firstUnit.split(/\s+/).pop();
  const rest = firstIsInverted ? parts.slice(2) : parts.slice(1);

  if (rest.length === 0) {
    return year ? `${firstSurname}, ${year}` : firstSurname;
  }
  if (rest.length === 1) {
    const last = rest[0].replace(/^and\s+/i, '').trim();
    const lastSurname = last.split(/\s+/).pop();
    return year ? `${firstSurname} and ${lastSurname}, ${year}` : `${firstSurname} and ${lastSurname}`;
  }
  return year ? `${firstSurname} et al., ${year}` : `${firstSurname} et al.`;
}

const STYLES = {
  text: { open: ' (', close: ')', sep: '; ', tagName: 'span' },
  numeric: { open: ' [', close: ']', sep: ', ', tagName: 'span' },
  superscript: { open: '', close: '', sep: ',', tagName: 'sup' },
};

function buildCitationNode(run, footnoteText, style) {
  const { open, close, sep, tagName } = STYLES[style];
  const labels = run.map((sup) => {
    const href = sup.children[0].properties.href;
    if (style === 'numeric' || style === 'superscript') {
      return { label: toText(sup), href };
    }
    const key = href.slice(FN_HREF_PREFIX.length);
    const text = footnoteText.get(key) || '';
    return { label: text ? extractShortCite(text) : key, href };
  });

  const children = open ? [{ type: 'text', value: open }] : [];
  labels.forEach((l, idx) => {
    if (idx > 0) children.push({ type: 'text', value: sep });
    children.push({
      type: 'element',
      tagName: 'a',
      properties: { href: l.href, dataFootnoteRef: true, ariaDescribedBy: ['footnote-label'] },
      children: [{ type: 'text', value: l.label }],
    });
  });
  if (close) children.push({ type: 'text', value: close });

  return { type: 'element', tagName, properties: { className: ['citation-ref'] }, children };
}

export default function rehypeCitationStyle() {
  return (tree, file) => {
    const requested = file.data?.astro?.frontmatter?.citationStyle;
    const style = Object.hasOwn(STYLES, requested) ? requested : 'text';

    const footnoteText = new Map();
    visit(tree, 'element', (node) => {
      if (node.tagName === 'li' && typeof node.properties?.id === 'string' && node.properties.id.startsWith('user-content-fn-')) {
        footnoteText.set(node.properties.id.slice('user-content-fn-'.length), toText(node));
      }
    });
    if (footnoteText.size === 0) return;

    // footnote refs also sit inside MDX component slots (figure captions,
    // sidenotes), whose parents are JSX nodes rather than HTML elements
    const PARENTS = new Set(['element', 'mdxJsxFlowElement', 'mdxJsxTextElement']);
    visit(tree, (node) => {
      if (!PARENTS.has(node.type) || !node.children || node.children.length === 0) return;
      const kids = node.children;
      let changed = false;
      const out = [];
      let i = 0;
      while (i < kids.length) {
        if (isFootnoteRefSup(kids[i])) {
          const run = [kids[i]];
          let j = i + 1;
          while (j < kids.length && isFootnoteRefSup(kids[j])) {
            run.push(kids[j]);
            j++;
          }
          out.push(buildCitationNode(run, footnoteText, style));
          i = j;
          changed = true;
        } else {
          out.push(kids[i]);
          i++;
        }
      }
      if (changed) node.children = out;
    });
  };
}
