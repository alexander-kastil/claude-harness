// @ts-nocheck
// Sync: the facts that decide where a sync is offered. The host asks the question and carries the sync out.
import { command, state } from './core';

// A repo skill or agent whose Global copy differs from it. A skill linked to Global is the Global version already.
export const syncableFromGlobal = a =>
  (a.kind === 'skill' || a.kind === 'agent') && a.scope !== 'global' && !String(a.scope).startsWith('plugin:') && !a.link && (a.copies || []).some(c => c.scope === 'global' && !c.same);

// The MCP servers of this name that live in a file, in Global or in a repo. Two or more are copies to bring in step.
export const mcpFileCopies = a =>
  a.kind !== 'mcp' || !a.file || !a.jsonPath
    ? []
    : state.views.flatMap(v => (v.categories.find(c => c.kind === 'mcp') || { items: [] }).items).filter(b => b.name === a.name && b.file && b.jsonPath);

export const syncableMcp = a => mcpFileCopies(a).length > 1;

// A plugin in Marketplace health whose marketplace source is ahead of the installed copy.
export const syncPlugin = key => command('syncPlugin', { plugin: key });
