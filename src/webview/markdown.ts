// A small Markdown renderer for the detail pages' view mode. It builds DOM nodes and never sets innerHTML,
// so a plugin's file cannot inject markup. Headings, paragraphs, nested lists, fenced code, block quotes,
// tables and rules, with inline code, bold, italic, links and bare URLs. Hooks turn code spans and links
// into navigation.

export interface MdHooks {
  /** Replaces an inline code span, for example with a reference chip; return nothing to keep the code. */
  code?(text: string): Node | undefined;
  /** Handles a link click; return false to let the anchor navigate. */
  link?(href: string, event: MouseEvent): boolean;
}

export interface MdHeading {
  level: number;
  text: string;
  id: string;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+?)\*\*|__([^_]+?)__|(?<![\w*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![\w*])|(?<![\w])_([^_\s](?:[^_]*?[^_\s])?)_(?![\w])|!?\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  n.append(...children);
  return n;
}

const indentOf = (line: string) => (/^\s*/.exec(line) as RegExpExecArray)[0].replace(/\t/g, '  ').length;

export function renderMarkdown(src: string, hooks: MdHooks = {}): { node: HTMLElement; headings: MdHeading[] } {
  const headings: MdHeading[] = [];
  const slugs = new Map<string, number>();
  const slug = (text: string) => {
    const base = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
    const n = slugs.get(base) || 0;
    slugs.set(base, n + 1);
    return `md-${n ? `${base}-${n}` : base}`;
  };

  const inline = (text: string): (Node | string)[] => {
    const out: (Node | string)[] = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      const at = m.index ?? 0;
      if (at > last) out.push(text.slice(last, at));
      last = at + m[0].length;
      if (m[1]) {
        const code = m[2].trim();
        out.push(hooks.code?.(code) ?? node('code', 'md-code-span', code));
      } else if (m[3] || m[4]) out.push(node('strong', '', ...inline(m[3] || m[4])));
      else if (m[5] || m[6]) out.push(node('em', '', ...inline(m[5] || m[6])));
      else {
        const href = m[8] || m[9] || m[10];
        const a = node('a', 'md-link', ...(m[7] ? inline(m[7]) : [href]));
        a.href = href;
        if (/^https?:/i.test(href)) a.target = '_blank';
        a.addEventListener('click', e => {
          if (hooks.link && hooks.link(href, e)) e.preventDefault();
        });
        out.push(a);
      }
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  const startsBlock = (line: string, next?: string) =>
    FENCE.test(line) || HEADING.test(line) || RULE.test(line) || /^\s*>/.test(line) || LIST.test(line) || (line.includes('|') && next !== undefined && TABLE_SEP.test(next));

  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map(c => c.trim());

  // Items at one indent; deeper items become a nested list in the item above them.
  const parseList = (lines: string[], start: number): [HTMLElement, number] => {
    const first = LIST.exec(lines[start]) as RegExpExecArray;
    const base = indentOf(lines[start]);
    const list = node(/\d/.test(first[2]) ? 'ol' : 'ul', 'md-list');
    let item: HTMLElement | undefined;
    let text: string[] = [];
    const flush = () => {
      if (item && text.length) item.prepend(...inline(text.join(' ')));
      text = [];
    };
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const next = lines.slice(i + 1).find(l => l.trim());
        if (next !== undefined && indentOf(next) > base && !LIST.test(next)) {
          i++;
          continue;
        }
        if (next === undefined || !LIST.test(next) || indentOf(next) < base) break;
        i++;
        continue;
      }
      const m = LIST.exec(line);
      const indent = indentOf(line);
      if (m && indent === base) {
        flush();
        item = node('li');
        list.append(item);
        text = [m[3].replace(/^\[( |x|X)\]\s+/, '')];
        i++;
      } else if (m && indent > base && item) {
        flush();
        const [nested, next] = parseList(lines, i);
        item.append(nested);
        i = next;
      } else if (!m && indent > base && item && !FENCE.test(line)) {
        text.push(line.trim());
        i++;
      } else if (!m && indent > base && item && FENCE.test(line)) {
        flush();
        const [code, next] = parseFence(lines, i);
        item.append(code);
        i = next;
      } else break;
    }
    flush();
    return [list, i];
  };

  const parseFence = (lines: string[], start: number): [HTMLElement, number] => {
    const m = FENCE.exec(lines[start]) as RegExpExecArray;
    const indent = indentOf(lines[start]);
    const body: string[] = [];
    let i = start + 1;
    while (i < lines.length && !lines[i].trim().startsWith(m[1])) {
      const line = lines[i++];
      body.push(line.slice(Math.min(indent, indentOf(line))));
    }
    const pre = node('pre', 'md-pre', node('code', '', body.join('\n')));
    pre.tabIndex = 0;
    if (m[2]) pre.dataset.lang = m[2];
    return [pre, i + 1];
  };

  const blocks = (lines: string[], into: HTMLElement) => {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      if (/^\s*<!--/.test(line)) {
        while (i < lines.length && !lines[i].includes('-->')) i++;
        i++;
        continue;
      }
      if (FENCE.test(line)) {
        const [pre, next] = parseFence(lines, i);
        into.append(pre);
        i = next;
        continue;
      }
      const h = HEADING.exec(line);
      if (h) {
        const level = h[1].length;
        const text = h[2].replace(/[`*_]/g, '');
        const id = slug(text);
        const tag = `h${Math.min(6, level + 1)}` as 'h2';
        const head = node(tag, `md-h md-h${level}`, ...inline(h[2]));
        head.id = id;
        into.append(head);
        headings.push({ level, text, id });
        i++;
        continue;
      }
      if (RULE.test(line)) {
        into.append(node('hr', 'md-hr'));
        i++;
        continue;
      }
      if (/^\s*>/.test(line)) {
        const quote: string[] = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        const bq = node('blockquote', 'md-quote');
        blocks(quote, bq);
        into.append(bq);
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = cells(line);
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        into.append(
          node(
            'div',
            'md-table-wrap',
            node(
              'table',
              'md-table',
              node('thead', '', node('tr', '', ...head.map(c => node('th', '', ...inline(c))))),
              node('tbody', '', ...rows.map(r => node('tr', '', ...head.map((_, k) => node('td', '', ...inline(r[k] ?? ''))))))
            )
          )
        );
        continue;
      }
      if (LIST.test(line)) {
        const [list, next] = parseList(lines, i);
        into.append(list);
        i = next;
        continue;
      }
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++].trim());
      into.append(node('p', 'md-p', ...inline(para.join(' '))));
    }
  };

  const root = node('div', 'md');
  blocks(src.replace(/\r\n?/g, '\n').split('\n'), root);
  return { node: root, headings };
}
