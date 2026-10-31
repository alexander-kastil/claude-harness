import { leafText } from './browser-hunt';
import type { CoworkSource } from './cowork-draw';
import type { BrowserCard } from './shared/browser-hunt';

// Draw with Claude on an Automation Hunter procedure card: drawn from the card as the host keeps it, the same text the leaf of the
// procedure is written from, so a step edited on the card makes the stored drawing stale like any other source.

export const CARD_PREFIX = 'bh-card:';

export function cardSource(id: string, cards: BrowserCard[]): CoworkSource | undefined {
  if (!id.startsWith(CARD_PREFIX)) return undefined;
  const card = cards.find(c => c.id === id.slice(CARD_PREFIX.length));
  if (!card || !card.steps.some(s => s.text.trim())) return undefined;
  return { kind: 'procedure', name: card.name.trim() || 'procedure', text: leafText(card), from: "the card's goal, how it is kept, its stage and its steps" };
}
