import { replaceOf } from './shared/hunt';
import type { HuntAsset, HuntCatalogItem, HuntProposal, HuntTurn } from './shared/hunt';
import { keyOf } from './hunt-catalog';

// The Plugin Hunter's conversation: the prompt Claude gets, its answer read back, and the plugin card that answer sets or changes.

export const HUNT_SYSTEM = 'You help a user build Claude Code plugins from the skills and agents they already have, in a conversation. Answer with one JSON object only.';

/** One turn of the conversation: the inventory, the card as it stands, the earlier turns and the owner's new message. */
export function chatPrompt(message: string, inventory: string, card: HuntProposal | undefined, history: HuntTurn[], onCard = false): string {
  const now = card
    ? JSON.stringify({ name: card.name, description: card.description, category: card.category, assets: card.assets.filter(a => a.include).map(a => ({ kind: a.kind, name: a.name, ...(a.as ? { rename: a.as } : {}) })) })
    : 'none yet';
  return [
    'The owner is building a new Claude Code plugin in a conversation with you. They may ask you to search their inventory, to put the plugin together, to change what is in it, or to create it.',
    '',
    '## Inventory (every skill and agent of Global and of all the owner\'s known repos, global first; the brackets say where each has a copy and which installed plugin already ships it)',
    inventory,
    '',
    '## The plugin card as it stands now',
    now,
    '',
    '## The conversation so far',
    ...(history.length ? history.map(t => `${t.role === 'owner' ? 'Owner' : 'Claude'}: ${t.text}`) : ['(this is the first message)']),
    '',
    onCard ? "## The owner's change comment on the card above" : "## The owner's new message",
    ...(onCard ? ['The comment is about the elements ticked on that card. Apply it to them and keep every other element as it is.', ''] : []),
    message.trim(),
    '',
    '## Answer',
    'One JSON object and nothing else, in this shape:',
    '{"reply":"at most two short sentences","proposal":{"name":"lowercase-kebab-case plugin name","description":"one sentence","category":"one lowercase folder name","assets":[{"kind":"skill" or "agent","name":"exactly as in the inventory","rename":"only when the plugin ships it under another name: lowercase-kebab-case","why":"one sentence","inPlugin":"name of the installed plugin that already ships it, only when the inventory shows one"}]},"create":true}',
    '"name" of an element is always its name in the inventory. When the owner asks to rename an element (for example "rename docker-images to hetzner-docker"), keep "name" and set "rename" to the new name; an element keeps the "rename" the card shows unless the owner changes it, and "rename" is left out when the element keeps its own name.',
    'When the owner asks you to search for or find elements (for example "search all dotnet related harness elements"), the elements you find are the plugin: set "proposal" with them in the same answer, so the owner gets a card to edit. In the "proposal", never call an element global when it also has repo copies.',
    '"reply" is always there and is at most two short sentences, in plain words: what you found or changed, as a count or a short summary. Never list the elements or where their copies live; the card lists every element with its copies. "proposal" only when this turn sets or changes what the plugin holds: it is then the whole plugin after this turn, so an element the owner took out is left out. "create" is true only when the owner asks you to create the plugin; the card as it stands is created, so set "proposal" in the same answer when it has none yet.',
    'Use only names from the inventory.',
  ].join('\n');
}

export interface Answered {
  name: string;
  description: string;
  category: string;
  assets: { kind: string; name: string; why: string; inPlugin?: string; rename?: string }[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A proposal object of Claude's answer in the shape the card needs; nothing without an assets list is a proposal. */
function shapeProposal(data: any): Answered | undefined {
  if (!data || typeof data !== 'object' || !Array.isArray(data.assets)) return undefined;
  return {
    name: str(data.name),
    description: str(data.description),
    category: str(data.category),
    assets: data.assets.filter((a: any) => a && typeof a.name === 'string').map((a: any) => ({ kind: str(a.kind), name: str(a.name), why: str(a.why), inPlugin: str(a.inPlugin) || undefined, rename: str(a.rename) || undefined })),
  };
}

/** A reply of at most two sentences and 240 characters, whatever Claude wrote. */
export function shortReply(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const two = (flat.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [flat]).slice(0, 2).join('').trim();
  return two.length > 240 ? `${two.slice(0, 237).trimEnd()}...` : two;
}

/** Claude's answer to one turn. Text that is not the JSON shape is taken as the reply itself, so a chat never dead-ends. */
export function parseTurn(text: string): { reply: string; proposal?: Answered; create: boolean } {
  let data: any;
  try {
    data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return { reply: text.trim(), create: false };
  }
  if (!data || typeof data !== 'object' || typeof data.reply !== 'string') return { reply: text.trim(), create: false };
  const proposal = data.proposal && typeof data.proposal === 'object' ? shapeProposal({ assets: [], ...data.proposal }) : undefined;
  return { reply: data.reply.trim(), proposal, create: data.create === true };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A card from Claude's answer: the extension fills paths, copies and defaults from its own scan, and drops names it does not have. */
export function proposalFrom(answer: Answered, prompt: string, catalog: HuntCatalogItem[], id: string, created: number): HuntProposal {
  const have = new Map(catalog.map(c => [keyOf(c.asset), c.asset]));
  const seen = new Set<string>();
  const assets: HuntAsset[] = [];
  for (const a of answer.assets) {
    const found = have.get(keyOf(a));
    if (!found || seen.has(keyOf(a))) continue;
    seen.add(keyOf(a));
    const as = a.rename ? slug(a.rename) : '';
    assets.push({ ...structuredClone(found), why: a.why, inPlugin: found.inPlugin ?? a.inPlugin, include: !(found.inPlugin ?? a.inPlugin), as: as && as !== found.name ? as : undefined });
  }
  return { id, prompt, created, name: slug(answer.name), description: answer.description, category: slug(answer.category), assets };
}

/**
 * Claude's proposal for this turn against the card it belongs to. A new card when there is none; otherwise the card is
 * updated in place: elements Claude left out are gone, ones still in keep the owner's ticks. A name, description or
 * category changes only when Claude changed it from what it was sent (`sent`, the card when the turn started): a value
 * it echoes back, or leaves empty, keeps what the owner has on the card now.
 */
export function applyProposal(card: HuntProposal | undefined, answer: Answered, prompt: string, catalog: HuntCatalogItem[], id: string, now: number, sent?: HuntProposal): HuntProposal {
  const next = proposalFrom(answer, prompt, catalog, id, now);
  if (!card) return next;
  const old = new Map(card.assets.map(o => [keyOf(o), o]));
  const assets = next.assets.map(a => {
    const o = old.get(keyOf(a));
    if (!o) return a;
    return { ...a, include: o.include, global: a.global && { path: a.global.path, replace: o.global?.path === a.global.path && replaceOf(o.global) }, repos: a.repos.map(r => ({ ...r, replace: replaceOf(o.repos.find(x => x.path === r.path)) })) };
  });
  const pick = (key: 'name' | 'description' | 'category') => (next[key] && next[key] !== sent?.[key] ? next[key] : card[key] || next[key]);
  return { ...card, name: pick('name'), description: pick('description'), category: pick('category'), assets };
}

/** The names of a proposal that are not skills or agents of Global or a repo, such as ones only a plugin ships. */
export function unknownNames(answer: Answered, catalog: HuntCatalogItem[]): string[] {
  const have = new Set(catalog.map(c => keyOf(c.asset)));
  return [...new Set(answer.assets.filter(a => !have.has(keyOf(a))).map(a => a.name))];
}
