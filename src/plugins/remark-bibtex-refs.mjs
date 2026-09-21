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
function parseBibtex(source) {
  const entries = new Map();
  const entryRe = /@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g;
  const fieldRe = /(\w+)\s*=\s*\{([^}]*)\}/g;
  let m;
  while ((m = entryRe.exec(source))) {
    const [, key, body] = m;
    const fields = {};
    let fm;
    while ((fm = fieldRe.exec(body))) {
      fields[fm[1].toLowerCase()] = fm[2].trim().replace(/\s+/g, ' ');
    }
    entries.set(key, fields);
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

// "Last, First and Last2, First2 and others" — "others" as the final author
// means et al., and matches how this post already elides long author lists
// ("Ainslie, Joshua, et al.").
function formatAuthors(field) {
  if (!field) return '';
  const parts = field.split(/\s+and\s+/);
  const etAl = parts[parts.length - 1].trim().toLowerCase() === 'others';
  const named = (etAl ? parts.slice(0, -1) : parts).map(splitName);
  if (etAl || named.length === 1) {
    const { last, first } = named[0];
    return etAl ? `${last}, ${first}, et al.` : `${last}, ${first}.`;
  }
  const [first, ...rest] = named;
  const restNames = rest.map((a) => `${a.first} ${a.last}`);
  return `${first.last}, ${first.first}, ${restNames.slice(0, -1).map((n) => `${n}, `).join('')}and ${restNames[restNames.length - 1]}.`;
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
