// @ts-nocheck
// The Plugin Hunter's marketplace picker: a listbox of the marketplaces Claude Code knows, of which only the owner's own can be picked.
import { app } from './core';
import { el, icon } from './dom';
import { SOURCE_ICONS } from './pages';
import { hunt, marketOf, repaint, saveNow } from './hunt-state';

const HOSTED = 'Claude Code overwrites its copies of GitHub, git and URL marketplaces when it updates them, so a plugin written there would be lost.';

const closeMenu = refocus => {
  hunt.menu = false;
  repaint();
  if (refocus) app.querySelector('.hunt-picker > button')?.focus();
};

export function marketPicker() {
  const markets = hunt.info ? hunt.info.markets : [];
  const cur = marketOf();
  const choose = k => {
    if (!k.owned) return;
    hunt.picked = k.name;
    saveNow();
    closeMenu(true);
  };
  const menu = hunt.menu
    ? el(
        'div',
        {
          className: 'hunt-menu',
          role: 'listbox',
          'aria-label': 'Marketplace',
          onkeydown: e => {
            const items = [...e.currentTarget.querySelectorAll('.hunt-market')];
            const at = items.indexOf(document.activeElement);
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closeMenu(true);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
            }
          },
        },
        markets.map(k =>
          el(
            'div',
            {
              className: `hunt-market${k.owned ? '' : ' off'}${k.name === hunt.picked ? ' on' : ''}`,
              role: 'option',
              tabindex: '-1',
              'aria-selected': String(k.name === hunt.picked),
              'aria-disabled': String(!k.owned),
              title: k.owned ? `${k.name}\n${k.location}` : `${k.name}\n${k.kind === 'directory' ? k.note : HOSTED}`,
              onclick: e => {
                e.stopPropagation();
                choose(k);
              },
              onkeydown: e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  choose(k);
                }
              },
            },
            icon(SOURCE_ICONS[k.kind] || 'package'),
            el('span', { className: 'hunt-market-text' }, el('span', { className: 'hunt-market-name' }, k.name), k.owned ? null : el('span', { className: 'hunt-market-note' }, k.note || ''))
          )
        )
      )
    : null;
  return el(
    'div',
    { className: 'hunt-picker' },
    el(
      'button',
      {
        className: 'secondary',
        title: 'Marketplace\nThe plugin is created in this marketplace. Only folders you own on disk (with a .claude-plugin/marketplace.json) that Claude Code knows can be picked.',
        'aria-haspopup': 'listbox',
        'aria-expanded': String(hunt.menu),
        onclick: e => {
          e.stopPropagation();
          hunt.menu = !hunt.menu;
          hunt.focusMenu = hunt.menu;
          repaint();
        },
        onkeydown: e => {
          if (e.key === 'ArrowDown' && !hunt.menu) {
            e.preventDefault();
            hunt.menu = true;
            hunt.focusMenu = true;
            repaint();
          }
        },
      },
      icon('package'),
      el('span', { className: 'hunt-picker-name' }, cur ? cur.name : markets.length ? 'No marketplace of yours' : 'Reading...'),
      icon('chevron-down')
    ),
    menu
  );
}

document.addEventListener('click', () => {
  if (hunt.menu) closeMenu(false);
});
