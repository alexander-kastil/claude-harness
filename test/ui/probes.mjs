// Self-contained functions the tests run inside the webview (they are stringified, so they close over nothing).

export const contrast = (D, min = 4.5) => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } } let base = { r: 30, g: 30, b: 30, a: 1 }; const root = parse(getComputedStyle(D.body).backgroundColor); if (root && root.a === 1) base = root; for (const c of stack.reverse()) base = over(c, base); return base; };
  const out = [];
  const seen = new Set();
  for (const el of D.querySelectorAll('.main *, .sidebar *')) {
    if (!el.getClientRects().length) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const fg0 = parse(cs.color); if (!fg0) continue;
    const bg = bgOf(el);
    const fg = over({ ...fg0, a: fg0.a * op }, bg);
    const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize);
    if (ratio < min) { const key = el.className + '|' + own.slice(0, 20); if (seen.has(key)) continue; seen.add(key); out.push({ ratio: +ratio.toFixed(2), size, cls: String(el.className).slice(0, 40), text: own.slice(0, 40) }); }
  }
  return out.sort((a, b) => a.ratio - b.ratio).slice(0, 25);
};

// Elements that look clickable (pointer cursor) but cannot take focus.
export const unfocusable = D => {
  const out = new Map();
  for (const el of D.querySelectorAll('body *')) {
    if (!el.getClientRects().length) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    const focusable = el.matches('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role=treeitem]') || el.closest('button,a[href],[tabindex]:not([tabindex="-1"])');
    if (focusable) continue;
    // a child of a pointer parent that itself is unfocusable counts once
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
    const where = el.closest('.sidebar') ? 'sidebar' : el.closest('.main') ? 'main' : 'other';
    const key = where + '|' + el.className;
    const e = out.get(key) || { where, cls: String(el.className).slice(0, 50), n: 0, sample: (el.textContent || '').trim().slice(0, 30) };
    e.n++; out.set(key, e);
  }
  return [...out.values()];
};
