// Remark plugin: let footnote-style references ("[^key]", rendered by
// rehype-citation-style.mjs as inline (Author, Year) citations and listed
// under "References") be authored as real BibTeX entries instead of
// hand-typed prose — with NO "[^key]: ..." line needed anywhere in the post
// for a key that's in the .bib file. Just write "[^key]" in the text.
//
// Why this needs its own text-scanning pass instead of hooking remark-gfm's
// own footnote handling: micromark-extension-gfm-footnote only turns
// "[^key]" into a real footnoteReference node if it already saw a
// "[^key]: ..." definition somewhere in the raw document during its
// block-level pre-pass — with no definition at all, "[^key]" is left as
// plain literal text, and a remark plugin (which only runs on the tree
// *after* that parse has already happened) is too late to change that
// classification. So instead of trying to make remark-gfm recognize it,
// this plugin does the recognizing itself: it scans ordinary text nodes for
// "[^key]" where key is in the .bib file, splits them into a real
// footnoteReference node, and synthesizes the matching footnoteDefinition
// (appended to the document) from that entry. mdast-util-to-hast (via
// remark-rehype) numbers and lists footnotes purely from node type at
// hast-conversion time — it doesn't care whether a footnoteReference node
// came from remark-gfm's parser or was built by hand here, so numbering,
// ordering and rehype-citation-style's rendering all keep working.
//
// A citation that doesn't fit the .bib template (see references.bib's own
// header comment) still works the old way: write "[^key]" plus a real
// "[^key]: ..." line, same as any plain markdown footnote always has.
//
// Which .bib file: a post sets `bibliography: 'references.bib'`
// (a path relative to the .mdx file, same convention as its own `import`
// paths) in frontmatter; falls back to the site-wide default passed from
// astro.config.mjs if a post doesn't set one.
//
// The .bib file is re-read on every call rather than cached: it's a handful
// of KB, and a build-time fs.readFileSync of an import path Vite doesn't
// watch would otherwise need a dev-server restart to pick up edits (bit us
// once already with TikzFigure's raw-imported .tikz source).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { visit } from 'unist-util-visit';

// Splits "@type{key, field = {value}, ...}" entries. Values are a single
// {...} run with no nested braces — every field in this site's .bib files is
// plain text, so this stays a couple of regexes instead of a real parser.
// LaTeX in field values → Unicode: accent commands ({\'\i}, {\v{c}}, \"o),
// special letters (\ss, \o, \ae), \url{}, dash ligatures, and the grouping
// braces themselves.
const COMBINING = {
  '`': '̀', "'": '́', '^': '̂', '"': '̈', '~': '̃',
  '=': '̄', '.': '̇', v: '̌', c: '̧', u: '̆',
  H: '̋', k: '̨', r: '̊', d: '̣', b: '̱',
};
const SPECIAL = { ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', oe: 'œ', OE: 'Œ', i: 'i', j: 'j' };
function decodeLatex(value) {
  return value
    .replace(/\\url\{([^}]*)\}/g, '$1')
    // \'{\i} / \'\i / \'{e} / \'e → letter + combining mark
    .replace(/\\([`'^"~=.vcuHkrdb])\s*\{?\\?([A-Za-z])\}?/g, (_, cmd, letter) => letter + COMBINING[cmd])
    .replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (m, cmd) => SPECIAL[cmd] ?? m)
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/[{}]/g, '')
    .normalize('NFC');
}

// Field values are brace-delimited and may nest ({\'\i}), so walk to the
// matching brace instead of stopping at the first one. Quoted and bare
// (numeric) values are accepted too.
function parseFields(body) {
  const fields = {};
  const keyRe = /(\w+)\s*=\s*/g;
  let m;
  while ((m = keyRe.exec(body))) {
    let i = m.index + m[0].length;
    let value;
    if (body[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < body.length; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}' && --depth === 0) break;
      }
      value = body.slice(i + 1, j);
      i = j + 1;
    } else if (body[i] === '"') {
      const j = body.indexOf('"', i + 1);
      value = body.slice(i + 1, j < 0 ? body.length : j);
      i = j < 0 ? body.length : j + 1;
    } else {
      const j = body.slice(i).search(/[,\n]/);
      value = j < 0 ? body.slice(i) : body.slice(i, i + j);
      i = j < 0 ? body.length : i + j;
    }
    fields[m[1].toLowerCase()] = decodeLatex(value.trim().replace(/\s+/g, ' '));
    keyRe.lastIndex = i;
  }
  return fields;
}

function parseBibtex(source) {
  const entries = new Map();
  const entryRe = /@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g;
  let m;
  while ((m = entryRe.exec(source))) {
    const [, key, body] = m;
    entries.set(key, parseFields(body));
  }
  return entries;
}

// bibtex names come as either "Last, First" or plain "First Last" (e.g.
// arXiv's own "Export BibTeX" button uses "First Last and First2 Last2",
// comma-free) — bibtex itself disambiguates on the comma, so this does too:
// with one, split on it; without, the final word is the surname.
function splitName(raw) {
  const trimmed = raw.trim();
  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',').map((s) => s.trim());
    return { last, first };
  }
  const words = trimmed.split(/\s+/);
  return { last: words.pop(), first: words.join(' ') };
}

// Lists longer than this collapse to "First Author, et al." — the same
// treatment BibTeX's "and others" gets below.
const MAX_LISTED_AUTHORS = 10;

// Every author is written in natural order ("Hynek Kydlíček"), so a name
// only needs care when it has no given name ("NVIDIA") or is a comma-separated
// corporate name ("Granite Team, IBM"), which is kept as written. BibTeX
// protects these with {braces}, which the parser strips, so guess from shape.
const GROUP_RE = /\b(team|ai|labs?|research|inc\.?|corp\.?|group)$/i;
function displayName({ last, first, inverted }) {
  if (!first) return last;
  if (inverted && GROUP_RE.test(last)) return `${last}, ${first}`;
  return `${first} ${last}`;
}

// "Last, First and Last2, First2 and others" — "others" as the final author
// means et al., and matches how this post already elides long author lists
// ("Joshua Ainslie, et al."). More than MAX_LISTED_AUTHORS names collapse the
// same way.
function formatAuthors(field) {
  if (!field) return '';
  // arXiv exports of corporate papers include junk authors such as a lone ":"
  const parts = field.split(/\s+and\s+/).filter((p) => /[\p{L}\d]/u.test(p));
  if (parts.length === 0) return '';
  const others = parts[parts.length - 1].trim().toLowerCase() === 'others';
  const names = (others ? parts.slice(0, -1) : parts).map((raw) => displayName({ ...splitName(raw), inverted: raw.includes(',') }));
  if (others || names.length > MAX_LISTED_AUTHORS) return `${names[0]}, et al.`;
  if (names.length === 1) return `${names[0]}.`;
  if (names.length === 2) return `${names[0]} and ${names[1]}.`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}.`;
}

// Builds the inline mdast children for one citation — a "[title](url)" link
// embedded in plain text, matching what remark itself produces for a
// hand-written citation (so rehype-citation-style, which reads the rendered
// text back out, can't tell the difference).
function citationNodes(entry) {
  const authors = formatAuthors(entry.author);
  // arXiv's own "Export BibTeX" gives eprint/archivePrefix instead of a
  // journal string, and no url — fall back to constructing both from the
  // eprint id (only meaningful when archivePrefix is arXiv, the only case
  // this site cites this way).
  const isArxiv = entry.eprint && (!entry.archiveprefix || /arxiv/i.test(entry.archiveprefix));
  const venue = entry.journal || entry.booktitle || (isArxiv ? `arXiv preprint arXiv:${entry.eprint}` : '');
  const url = entry.url || (isArxiv ? `https://arxiv.org/abs/${entry.eprint}` : undefined);
  let tail = venue;
  if (entry.year) tail = tail ? `${tail} (${entry.year})` : `(${entry.year})`;
  if (entry.pages) tail += `: ${entry.pages}`;
  // curly quotes to match the rest of the site's typography — Astro's
  // smartypants pass runs before this plugin, so a plain " here would render
  // as a straight quote instead of picking up the usual "..." styling.
  const nodes = [{ type: 'text', value: `${authors} “` }];
  if (url) {
    nodes.push({ type: 'link', url, children: [{ type: 'text', value: entry.title || '' }] });
  } else {
    nodes.push({ type: 'text', value: entry.title || '' });
  }
  nodes.push({ type: 'text', value: `.” ${tail}.` });
  return nodes;
}

const REF_RE = /\[\^([^\]\s]+)\]/g;

export default function remarkBibtexRefs(defaultBibPath) {
  return (tree, file) => {
    const override = file.data?.astro?.frontmatter?.bibliography;
    const bibPath = override ? path.resolve(path.dirname(file.path), override) : defaultBibPath;

    let entries;
    try {
      entries = parseBibtex(readFileSync(bibPath, 'utf8'));
    } catch {
      return; // no .bib file for this build — every footnote stays hand-written
    }

    // a hand-written "[^key]: ..." line already parsed into a real
    // footnoteDefinition — override its body when the .bib file also has
    // that key, same as before.
    const alreadyDefined = new Set();
    visit(tree, 'footnoteDefinition', (node) => {
      alreadyDefined.add(node.identifier);
      const entry = entries.get(node.identifier);
      if (entry) node.children = [{ type: 'paragraph', children: citationNodes(entry) }];
    });

    // "[^key]" with no definition anywhere — remark-gfm left it as literal
    // text. Turn every occurrence whose key is in the .bib file into a real
    // footnoteReference; anything else (a typo, or a citation that isn't in
    // the .bib file and never got a "[^key]: ..." line) is left untouched.
    const used = new Set();
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index == null) return;
      REF_RE.lastIndex = 0;
      const pieces = [];
      let last = 0;
      let match;
      let changed = false;
      while ((match = REF_RE.exec(node.value))) {
        const identifier = match[1];
        if (!entries.has(identifier)) continue;
        changed = true;
        used.add(identifier);
        if (match.index > last) pieces.push({ type: 'text', value: node.value.slice(last, match.index) });
        pieces.push({ type: 'footnoteReference', identifier, label: identifier });
        last = match.index + match[0].length;
      }
      if (!changed) return;
      if (last < node.value.length) pieces.push({ type: 'text', value: node.value.slice(last) });
      parent.children.splice(index, 1, ...pieces);
      return index + pieces.length; // resume after the nodes just inserted
    });

    for (const identifier of used) {
      if (alreadyDefined.has(identifier)) continue;
      tree.children.push({
        type: 'footnoteDefinition',
        identifier,
        label: identifier,
        children: [{ type: 'paragraph', children: citationNodes(entries.get(identifier)) }],
      });
    }
  };
}
