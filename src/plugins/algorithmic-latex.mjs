// Parses a small subset of the LaTeX `algorithmic` environment (as used by the
// `algorithm`/`algpseudocode` packages: \REQUIRE, \ENSURE, \STATE, \Statex,
// \FOR/\ENDFOR, \WHILE/\ENDWHILE, \IF/\ELSE/\ENDIF, \RETURN, trailing
// \COMMENT{...}) into the site's own algo-line/algo-num/algo-body/algo-io
// markup (see the "algorithm blocks" rules in global.css), with every $...$
// math span rendered through KaTeX server-side.
//
// This is intentionally not a LaTeX engine: each macro must start its own
// line (no two \STATE's sharing a line), and only the macros listed above are
// recognized — anything else throws a build-time error naming the line, so a
// typo in a post's .algo.tex file fails the build instead of silently
// rendering as literal text.
import katex from 'katex';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMath(expr) {
  return katex.renderToString(expr, { throwOnError: false });
}

// Finds the `{...}` argument starting at `text[openIdx] === '{'`, respecting
// nested braces (e.g. `\mathbb{R}^{C}` inside a math span inside the arg).
function readBraces(text, openIdx, context) {
  if (text[openIdx] !== '{') {
    throw new Error(`Expected "{" while parsing algorithmic source at: ${context}`);
  }
  let depth = 0;
  for (let j = openIdx; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') {
      depth--;
      if (depth === 0) return { content: text.slice(openIdx + 1, j), end: j + 1 };
    }
  }
  throw new Error(`Unbalanced braces in algorithmic source at: ${context}`);
}

// `\Exch{...}` is not a real LaTeX macro: it's this site's own convention for
// marking a quantity that gets communicated between accelerators, via colour
// (--code-accent) rather than boldface, since \mathbf is already spoken for
// as this doc's matrix/vector notation (see mamba2-cp-forward.algo.tex).
const INLINE_MACROS = {
  '\\textit{': { tag: 'i' },
  '\\textbf{': { tag: 'b' },
  '\\emph{': { tag: 'i' },
  '\\Exch{': { tag: 'span', className: 'algo-exchanged' },
};

// Renders one line's worth of mixed text/math/`\textit`/`\textbf`/`\Exch`
// content to HTML. Plain text is escaped; `$...$` runs through KaTeX untouched.
function renderInline(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '$') {
      const end = text.indexOf('$', i + 1);
      if (end === -1) throw new Error(`Unclosed "$" in: ${text}`);
      out += renderMath(text.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    const macro = Object.keys(INLINE_MACROS).find((m) => text.startsWith(m, i));
    if (macro) {
      const { tag, className } = INLINE_MACROS[macro];
      const { content, end } = readBraces(text, i + macro.length - 1, text);
      const classAttr = className ? ` class="${className}"` : '';
      out += `<${tag}${classAttr}>${renderInline(content)}</${tag}>`;
      i = end;
      continue;
    }
    if (text.startsWith('\\%', i)) {
      out += '%';
      i += 2;
      continue;
    }
    out += escapeHtml(text[i]);
    i += 1;
  }
  return out;
}

// Pulls a trailing `\COMMENT{...}` off a statement line, if present.
function splitTrailingComment(line) {
  const idx = line.indexOf('\\COMMENT{');
  if (idx === -1) return { body: line, comment: null };
  const { content, end } = readBraces(line, idx + '\\COMMENT'.length, line);
  if (line.slice(end).trim() !== '') {
    throw new Error(`Unexpected content after \\COMMENT in: ${line}`);
  }
  return { body: line.slice(0, idx).trim(), comment: content };
}

function indentClass(indent) {
  if (indent >= 2) return ' algo-indent-2';
  if (indent === 1) return ' algo-indent';
  return '';
}

function ioLine(label, content) {
  return `<div class="algo-line algo-io"><b>${label}:</b> ${renderInline(content)}</div>`;
}

function statexLine(content, indent) {
  return `<div class="algo-line algo-io${indentClass(indent)}"><i>${renderInline(content)}</i></div>`;
}

function numberedLine(num, content, indent) {
  const { body, comment } = splitTrailingComment(content);
  // algorithmic sets comments flush right after a ▷ (\triangleright)
  const commentHtml = comment ? `<span class="algo-comment">&#9655; ${renderInline(comment)}</span>` : '';
  return `<div class="algo-line"><span class="algo-num">${num}</span><span class="algo-body${indentClass(indent)}">${renderInline(body)}</span>${commentHtml}</div>`;
}

function unnumberedLine(content, indent) {
  return `<div class="algo-line"><span class="algo-num"></span><span class="algo-body${indentClass(indent)}">${renderInline(content)}</span></div>`;
}

function stripComments(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/(?<!\\)%.*$/, ''))
    .join('\n');
}

const BLOCK_ENDERS = new Set(['\\ENDFOR', '\\ENDWHILE', '\\ENDIF', '\\ELSE', '\\end{algorithmic}']);

function macroArg(line, macro) {
  const braceIdx = line.indexOf('{', macro.length - 1);
  if (line[macro.length - 1] !== '{' || braceIdx === -1) {
    throw new Error(`Expected "${macro}{...}" in: ${line}`);
  }
  return readBraces(line, braceIdx, line).content;
}

export function parseAlgorithmic(rawSource) {
  const lines = stripComments(rawSource)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let cursor = 0;
  let captionHtml = '';
  if (lines[cursor]?.startsWith('\\caption{')) {
    captionHtml = renderInline(macroArg(lines[cursor], '\\caption{'));
    cursor++;
  }
  if (lines[cursor] !== '\\begin{algorithmic}') {
    throw new Error('algorithmic source must start with \\begin{algorithmic} (after an optional \\caption{...})');
  }
  cursor++;

  let stepNum = 0;
  const html = [];

  // Recursively consumes statements until a block-ending macro (\ENDFOR,
  // \ELSE, \end{algorithmic}, ...) or end of input; returns after the last
  // consumed statement, leaving the ender for the caller to consume.
  function parseBlock(indent) {
    while (cursor < lines.length && !BLOCK_ENDERS.has(lines[cursor])) {
      const line = lines[cursor];

      if (line.startsWith('\\REQUIRE')) {
        html.push(ioLine('Input', line.slice('\\REQUIRE'.length).trim()));
        cursor++;
      } else if (line.startsWith('\\ENSURE')) {
        html.push(ioLine('Output', line.slice('\\ENSURE'.length).trim()));
        cursor++;
      } else if (line.startsWith('\\Statex')) {
        html.push(statexLine(line.slice('\\Statex'.length).trim(), indent));
        cursor++;
      } else if (line.startsWith('\\RETURN')) {
        stepNum++;
        html.push(numberedLine(stepNum, `\\textbf{return} ${line.slice('\\RETURN'.length).trim()}`, indent));
        cursor++;
      } else if (line.startsWith('\\STATE')) {
        stepNum++;
        html.push(numberedLine(stepNum, line.slice('\\STATE'.length).trim(), indent));
        cursor++;
      } else if (line.startsWith('\\FOR{')) {
        const cond = macroArg(line, '\\FOR{');
        stepNum++;
        html.push(numberedLine(stepNum, `\\textbf{for} ${cond} \\textbf{do}`, indent));
        cursor++;
        parseBlock(indent + 1);
        expect('\\ENDFOR', line);
        html.push(unnumberedLine('\\textbf{end for}', indent));
      } else if (line.startsWith('\\WHILE{')) {
        const cond = macroArg(line, '\\WHILE{');
        stepNum++;
        html.push(numberedLine(stepNum, `\\textbf{while} ${cond} \\textbf{do}`, indent));
        cursor++;
        parseBlock(indent + 1);
        expect('\\ENDWHILE', line);
        html.push(unnumberedLine('\\textbf{end while}', indent));
      } else if (line.startsWith('\\IF{')) {
        const cond = macroArg(line, '\\IF{');
        stepNum++;
        html.push(numberedLine(stepNum, `\\textbf{if} ${cond} \\textbf{then}`, indent));
        cursor++;
        parseBlock(indent + 1);
        if (lines[cursor] === '\\ELSE') {
          html.push(unnumberedLine('\\textbf{else}', indent));
          cursor++;
          parseBlock(indent + 1);
        }
        expect('\\ENDIF', line);
        html.push(unnumberedLine('\\textbf{end if}', indent));
      } else {
        throw new Error(`Unrecognized algorithmic line: ${line}`);
      }
    }
  }

  function expect(ender, openedBy) {
    if (lines[cursor] !== ender) {
      throw new Error(`Expected ${ender} to close "${openedBy}", got "${lines[cursor] ?? '<end of input>'}"`);
    }
    cursor++;
  }

  parseBlock(0);
  expect('\\end{algorithmic}', '\\begin{algorithmic}');

  return { captionHtml, bodyHtml: html.join('\n') };
}
