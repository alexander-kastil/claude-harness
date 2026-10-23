// @ts-nocheck
// The element editor: frontmatter, body, files, MCP details.
import { AGENT_COLORS, HEX_COLOR, MODELS, RENAMABLE, SOURCES, TOOL_FIELDS, agentColorClass, categoryOf, command, editable, isDirty, labelOf, metaOf, pluginOf, save, select, state, std, viewOf, vscode } from './core';
import { renderView, setMode } from './detail-view';
import { el, icon, iconBtn } from './dom';
import { hideHover } from './hover';
import { renderMain } from './main';
import { goBack, historyLabel } from './refs';

export function renderRuleInfo(a, withLabel = true) {
  const info = state.ruleInfo[a.id];
  if (info === undefined) {
    state.ruleInfo[a.id] = null;
    vscode.postMessage({ type: 'ruleInfo', id: a.id });
  }
  if (!info) return el('div', { className: 'empty flush' }, 'Matching paths...');
  return el(
    'div',
    {},
    withLabel ? el('div', { className: 'group-label' }, 'Paths') : null,
    info.base ? el('div', { className: 'empty flush' }, `Matched against ${info.base}`) : null,
    info.globs.length
      ? info.globs.map(g =>
          el(
            'div',
            { className: 'row', title: g.sample.join('\n') },
            icon(g.matches ? 'pass' : 'warning'),
            el('span', { className: 'name' }, g.glob),
            el('span', { className: 'desc' }, `${g.matches} ${g.matches === 1 ? 'file' : 'files'}${info.capped ? '+' : ''}${g.sample.length ? ` · ${g.sample.join(', ')}` : ''}`)
          )
        )
      : el('div', { className: 'empty flush' }, 'No paths: the rule loads in every session'),
    !std('owner')
      ? null
      : info.owner
      ? el(
          'div',
          { className: 'row' },
          icon(info.ownerFound ? 'pass' : 'error'),
          el('span', { className: 'name' }, `Owner agent: ${info.owner}`),
          el('span', { className: 'desc' }, info.ownerFound ? 'found on disk' : 'no agent with this name on disk')
        )
      : el('div', { className: 'empty flush' }, 'No Owner agent line')
  );
}

export const fit = box => {
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight + 2}px`;
};

// The eight swatches of the picker: first the colors the owner's agents use (a name, a hex code, a CSS color name), from
// every agent the harness loads (global, every repo, plugins), case-insensitive, most used first; then Claude Code's own
// names, in their order, until eight are on the row. More than eight used colors show the eight most used.
function usedColors() {
  const count = new Map();
  for (const v of state.views)
    for (const c of v.categories)
      if (c.kind === 'agent')
        for (const a of c.items) {
          const color = String(metaOf(a).color || '').trim().toLowerCase();
          if (color && agentColorClass(color)) count.set(color, (count.get(color) || 0) + 1);
        }
  const row = [...count].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(e => e[0]).slice(0, AGENT_COLORS.length);
  for (const name of AGENT_COLORS) if (row.length < AGENT_COLORS.length && !row.includes(name)) row.push(name);
  return row;
}

// An agent's color: None, eight swatches (see usedColors), and a field for a hex code with a preview that also holds the
// current color when no swatch shows it. Each swatch is drawn in its own tone. The choice goes into the draft's `color` field
// (added on the first pick, removed by None) and is written by the form's Save like any field; the file writer quotes a
// hex code, which YAML would read as a comment. A code that is no hex color is marked and never put into the draft.
function colorPicker() {
  const at = () => state.draft.fields.findIndex(f => f.key === 'color');
  const current = () => (at() < 0 ? '' : String(state.draft.fields[at()].value).trim().toLowerCase());
  const row = usedColors();
  const values = ['', ...row];
  const name = el('span', { className: 'color-name' });
  const buttons = [];
  const code = el('input', { type: 'text', className: 'color-code', placeholder: '#rrggbb', maxlength: '7', spellcheck: false, 'aria-label': 'Color code', title: 'A hex color code: #rgb or #rrggbb' });
  const preview = el('span', { className: 'swatch color-preview empty', 'aria-hidden': 'true' });
  const typed = () => code.value.trim().toLowerCase();
  const showCode = () => {
    const v = typed();
    // A hex code, or the color the file already has when no swatch shows it.
    const ok = HEX_COLOR.test(v) || (!!v && v === current() && !!agentColorClass(v));
    preview.className = `swatch color-preview${ok ? ` ${agentColorClass(v)}` : ' empty'}`;
    code.classList.toggle('invalid', !!v && !ok);
    code.setAttribute('aria-invalid', v && !ok ? 'true' : 'false');
    return !v || ok;
  };
  const paint = () => {
    const now = current();
    // One tab stop for the group: the picked swatch, or None while no swatch is picked; arrows move inside it.
    const stop = row.includes(now) ? now : '';
    buttons.forEach(([value, b]) => {
      b.setAttribute('aria-checked', value === now ? 'true' : 'false');
      b.tabIndex = value === stop ? 0 : -1;
    });
    if (document.activeElement !== code) code.value = now && !row.includes(now) ? now : '';
    const ok = showCode();
    name.textContent = ok ? now || 'none' : 'Not a color code: the last valid color stays';
  };
  const pick = value => {
    const i = at();
    if (!value) {
      if (i >= 0) state.draft.fields.splice(i, 1);
    } else if (i >= 0) state.draft.fields[i] = Object.assign({}, state.draft.fields[i], { value });
    else state.draft.fields.push({ key: 'color', type: 'string', value });
    paint();
    refreshHead();
  };
  const move = (value, step) => {
    const next = values[(values.indexOf(value) + step + values.length) % values.length];
    pick(next);
    buttons.find(([v]) => v === next)[1].focus();
  };
  code.addEventListener('input', () => {
    if (showCode() && typed()) pick(typed());
    else paint();
  });
  const group = el('div', { className: 'color-picker', role: 'radiogroup', 'aria-label': 'Color' });
  for (const value of values) {
    const b = el(
      'button',
      {
        type: 'button',
        role: 'radio',
        className: value ? `swatch color-pick ${agentColorClass(value)}` : 'color-pick none',
        title: value || 'None',
        'aria-label': value || 'None',
        onclick: () => pick(value),
        onkeydown: e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(value, 1));
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(value, -1));
        },
      },
      value ? null : icon('circle-slash')
    );
    buttons.push([value, b]);
    group.append(b);
  }
  group.append(el('span', { className: 'color-code-box' }, preview, code), name);
  paint();
  return group;
}

export function fieldInput(f, i) {
  if (f.key === 'color' && state.detail.asset.kind === 'agent') return colorPicker();
  const update = value => {
    state.draft.fields[i] = Object.assign({}, f, { value });
    refreshHead();
  };
  if (f.type === 'boolean') return el('input', { type: 'checkbox', checked: f.value === true, onchange: e => update(e.target.checked) });
  if (TOOL_FIELDS.includes(f.key)) {
    const box = el('textarea', { className: 'tools', rows: 1, value: f.value, spellcheck: false, placeholder: 'comma separated', oninput: e => (update(e.target.value), fit(box)) });
    requestAnimationFrame(() => fit(box));
    return el(
      'div',
      { className: 'tools-field' },
      box,
      el('button', { className: 'link', onclick: () => vscode.postMessage({ type: 'configureTools', id: state.detail.asset.id, key: f.key, value: String(state.draft.fields[i].value) }) }, 'Configure Tools...')
    );
  }
  if (f.type === 'text' || f.type === 'yaml')
    return el('textarea', { className: f.type, rows: f.type === 'text' ? 4 : 3, value: f.value, oninput: e => update(e.target.value), spellcheck: f.type === 'text' });
  const input = el('input', { type: 'text', value: f.value, oninput: e => update(e.target.value) });
  if (f.key === 'model') {
    input.setAttribute('list', 'models');
    return el('div', {}, input, el('datalist', { id: 'models' }, MODELS.map(m => el('option', { value: m }))));
  }
  if (f.type === 'list') input.placeholder = 'comma separated';
  return input;
}

export function renderFields() {
  const d = state.detail;
  const grid = el('div', { className: 'fields' });
  state.draft.fields.forEach((f, i) => {
    grid.append(
      el('span', { className: 'key', title: f.key }, f.key),
      fieldInput(f, i),
      iconBtn('close', `Remove ${f.key}`, () => {
        state.draft.fields.splice(i, 1);
        renderMain();
      })
    );
  });
  // An agent always shows its color; without the key, the picker adds it on the first pick and writes nothing until then.
  if (d.asset.kind === 'agent' && !state.draft.fields.some(f => f.key === 'color')) grid.append(el('span', { className: 'key', title: 'color' }, 'color'), colorPicker(), el('span'));
  const present = new Set(state.draft.fields.map(f => f.key));
  const options = d.knownFields.filter(k => !present.has(k));
  const keyInput = el('input', { type: 'text', placeholder: 'field name', list: 'known-fields' });
  const add = () => {
    const key = keyInput.value.trim();
    if (!key || present.has(key)) return;
    const type = key === 'description' ? 'text' : ['disable-model-invocation', 'user-invocable', 'keep-coding-instructions'].includes(key) ? 'boolean' : 'string';
    state.draft.fields.push({ key, type, value: type === 'boolean' ? false : '' });
    renderMain();
  };
  keyInput.addEventListener('keydown', e => e.key === 'Enter' && add());
  return el(
    'div',
    {},
    el('div', { className: 'group-label' }, 'Frontmatter'),
    grid.childElementCount ? grid : el('div', { className: 'empty flush' }, 'No frontmatter'),
    el(
      'div',
      { className: 'add-field' },
      keyInput,
      el('datalist', { id: 'known-fields' }, options.map(k => el('option', { value: k }))),
      el('button', { className: 'secondary', onclick: add }, icon('add'), 'Add field')
    )
  );
}

export function renderFiles() {
  const files = (state.detail.asset.files || []).filter(f => f !== 'SKILL.md');
  if (!files.length) return null;
  return el(
    'div',
    {},
    el('div', { className: 'group-label' }, `Files (${files.length})`),
    el(
      'div',
      { className: 'files' },
      files.map(f =>
        el('div', { className: 'file', onclick: () => command('openFile', { id: state.detail.asset.id, rel: f }) }, icon(/\.md$/i.test(f) ? 'markdown' : 'file'), f)
      )
    )
  );
}

export const retirable = a =>
  (a.kind === 'skill' || a.kind === 'agent') && a.scope !== 'global' && (a.copies || []).some(c => c.same && (c.scope === 'global' || c.scope.startsWith('plugin:')));

export let headNode;

// The file path with the home folder shortened to ~, the full path in the hover card.
const shortPath = file => String(file || '').replace(/^[a-z]:\\users\\[^\\]+|^\/(?:home|Users)\/[^/]+/i, '~');

// View shows the element as a page, Edit shows the form; a dirty draft keeps both available.
function modeSwitch() {
  const button = (mode, glyph, label) =>
    el(
      'button',
      { type: 'button', className: `mode-btn${state.detailMode === mode ? ' active' : ''}`, 'aria-pressed': state.detailMode === mode ? 'true' : 'false', onclick: () => setMode(mode) },
      icon(glyph),
      el('span', {}, label)
    );
  return el('div', { className: 'mode-switch', role: 'group', 'aria-label': 'Mode' }, button('view', 'eye', 'View'), button('edit', 'edit', 'Edit'));
}

export function renderHead() {
  const d = state.detail;
  const cat = categoryOf(d.asset.kind);
  const dirty = isDirty();
  const canRename = RENAMABLE.includes(d.asset.kind);
  return el(
    'header',
    { className: 'main-head' },
    el('span', { className: 'big' }, icon(d.asset.kind === 'mcp' && SOURCES[d.asset.source] ? SOURCES[d.asset.source].icon : cat ? cat.icon : 'file')),
    el(
      'div',
      { className: 'title' },
      el('h1', {}, labelOf(d.asset), el('span', { className: 'tag' }, cat ? cat.label.replace(/s$/, '') : d.asset.kind), d.asset.scope !== 'global' && viewOf(d.asset.scope) ? el('span', { className: 'tag scope', title: viewOf(d.asset.scope).path }, icon('repo'), viewOf(d.asset.scope).label) : null, dirty ? el('span', { className: 'dirty', title: 'Unsaved changes' }) : null),
      el('div', { className: 'path', title: d.asset.file }, shortPath(d.asset.file))
    ),
    editable() ? modeSwitch() : null,
    el(
      'div',
      { className: 'toolbar' },
      state.history.length
        ? iconBtn('arrow-left', `Back to ${historyLabel()}`, goBack)
        : state.page === 'kind' && state.kindPage
          ? iconBtn('arrow-left', `Back to ${categoryOf(state.kindPage.kind) ? categoryOf(state.kindPage.kind).label : 'the list'}`, () => select(undefined))
          : null,
      d.asset.kind === 'mcp' && d.asset.source !== 'claude.ai' && d.asset.source !== 'plugin' ? iconBtn('copy', 'Copy as claude mcp add command', () => command('copyMcpAdd', { id: d.asset.id })) : null,
      canRename ? iconBtn('whole-word', 'Rename', () => command('rename', { id: d.asset.id })) : null,
      canRename ? iconBtn('copy', 'Duplicate', () => command('duplicate', { id: d.asset.id })) : null,
      iconBtn('go-to-file', 'Open in editor', () => command('openFile', { id: d.asset.id })),
      iconBtn('folder-opened', 'Reveal in File Explorer', () => command('reveal', { id: d.asset.id })),
      retirable(d.asset) ? iconBtn('archive', 'Retire this copy: back it up, then delete it', () => command('retire', { id: d.asset.id })) : null,
      canRename || (d.asset.kind === 'mcp' && d.asset.file && d.asset.jsonPath) ? iconBtn('trash', 'Delete', () => command('delete', { id: d.asset.id })) : null,
      d.asset.kind === 'plugin' ? iconBtn('trash', 'Uninstall plugin', () => command('uninstallPlugin', { id: d.asset.id })) : null
    ),
    editable() && (dirty || state.detailMode === 'edit')
      ? el(
          'div',
          { className: 'toolbar' },
          el(
            'button',
            {
              className: 'secondary',
              disabled: !dirty,
              onclick: () => {
                state.draft = clone(state.detail);
                renderMain();
              },
            },
            'Revert'
          ),
          el('button', { className: 'primary', disabled: !dirty, onclick: save, title: 'Ctrl+S' }, icon('save'), 'Save')
        )
      : null
  );
}

export function refreshHead() {
  const next = renderHead();
  headNode.replaceWith(next);
  headNode = next;
}

export function renderDetail() {
  const d = state.detail;
  const body = el('div', { className: 'main-body', onscroll: hideHover });
  if (!editable() || state.detailMode !== 'edit') {
    body.append(el('div', { className: 'dv' }, renderView(d, state.draft)));
  } else if (d.mode === 'markdown') {
    body.append(renderFields());
    if (d.asset.kind === 'rule') body.append(renderRuleInfo(d.asset));
    body.append(
      el(
        'div',
        { className: 'editor' },
        el('div', { className: 'group-label' }, 'Instructions'),
        el('textarea', {
          value: state.draft.body,
          spellcheck: false,
          oninput: e => {
            state.draft.body = e.target.value;
            refreshHead();
          },
        })
      )
    );
    const files = renderFiles();
    if (files) body.append(files);
  } else if (d.mode === 'code' || d.mode === 'settings') {
    body.append(
      el(
        'div',
        { className: 'editor' },
        el('div', { className: 'group-label' }, d.mode === 'settings' ? 'JSON' : 'Script'),
        el('textarea', {
          value: state.draft.body,
          spellcheck: false,
          oninput: e => {
            state.draft.body = e.target.value;
            refreshHead();
          },
        })
      )
    );
  } else if (d.mode === 'mcp') {
    body.append(renderMcp(d));
  } else if (d.mode === 'plugin') {
    body.append(
      el(
        'div',
        { className: 'switch' },
        el('input', { type: 'checkbox', id: 'plugin-enabled', checked: d.asset.enabled, onchange: () => command('togglePlugin', { id: d.asset.id }) }),
        el('label', { for: 'plugin-enabled' }, 'Enabled'),
        el('span', { className: 'desc' }, d.asset.description)
      )
    );
  } else {
    body.append(el('pre', { className: 'json' }, d.body));
  }
  headNode = renderHead();
  return el('section', { className: 'main' }, headNode, body);
}

export function renderMcp(d) {
  const a = d.asset;
  const repo = a.scope !== 'global' && viewOf(a.scope);
  const info = state.mcpInfo[a.id];
  const facts = [
    ['Source', el('span', {}, icon(SOURCES[a.source] ? SOURCES[a.source].icon : 'server'), ' ', SOURCES[a.source] ? SOURCES[a.source].label : 'Config')],
    pluginOf(a) ? ['Plugin', pluginOf(a)] : null,
    ['Name in Claude', a.name],
    a.target ? ['Address', a.target] : null,
    a.status ? ['Status', a.status] : null,
  ].filter(Boolean);
  const box = el('div', { className: 'mcp' });
  box.append(
    el(
      'div',
      { className: 'switch' },
      el('input', { type: 'checkbox', id: 'mcp-enabled', checked: a.enabled !== false, onchange: () => command('toggleMcp', { id: a.id }) }),
      el('label', { for: 'mcp-enabled' }, repo ? `Enabled in ${repo.label}` : 'Enabled in every folder'),
      !repo && a.offIn ? el('span', { className: 'desc' }, `Off in ${a.offIn} of ${a.folders} folders. Switch on to enable it everywhere.`) : null
    ),
    el('div', { className: 'facts' }, facts.flatMap(([k, v]) => [el('span', { className: 'key' }, k), el('span', { className: 'value' }, v)]))
  );
  if (a.about) box.append(el('p', { className: 'about' }, a.about));
  if (!info) box.append(el('div', { className: 'empty flush' }, 'Asking the server for its tools...'));
  else if (info.error)
    box.append(
      el('div', { className: 'empty flush' }, info.error),
      el(
        'div',
        { className: 'toolbar' },
        info.signIn ? el('button', { className: 'primary', onclick: () => vscode.postMessage({ type: 'mcpSignIn', id: a.id }) }, icon('sign-in'), 'Sign in') : null,
        el('button', { className: 'secondary', onclick: () => vscode.postMessage({ type: 'mcpRetry', id: a.id }) }, icon('refresh'), 'Retry')
      )
    );
  else {
    box.append(
      el('div', { className: 'group-label' }, `Tools (${(info.tools || []).length})`),
      el(
        'div',
        { className: 'tool-list' },
        (info.tools || []).map(t => el('div', { className: 'tool' }, el('span', { className: 'name' }, t.name)))
      )
    );
  }
  if (d.body) box.append(el('div', { className: 'group-label' }, 'Config'), el('pre', { className: 'json' }, d.body));
  return box;
}

export const clone = d => ({ fields: d.fields.map(f => Object.assign({}, f)), body: d.body });
