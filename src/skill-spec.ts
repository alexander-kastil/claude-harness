// The Agent Skills spec (https://agentskills.io/specification) for a SKILL.md's frontmatter: what the skills CLI's other agents
// (Copilot, Codex, Cursor, Gemini CLI, OpenCode) expect of a skill that sits in .agents/skills.

export interface SpecIssue {
  /** The frontmatter field the issue is about. */
  field: string;
  message: string;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The ways a skill's frontmatter breaks the spec; `folder` is the skill's folder name, which `name` must equal. */
export function specIssues(folder: string, data: Record<string, unknown>): SpecIssue[] {
  const out: SpecIssue[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  const name = data.name;
  if (name === undefined || name === null || name === '') add('name', 'name is required');
  else if (typeof name !== 'string') add('name', 'name must be text');
  else {
    if (name.length > 64) add('name', `name is ${name.length} characters, the limit is 64`);
    if (!NAME.test(name)) add('name', 'name may use only lowercase a-z, 0-9 and single hyphens, not at the start or end');
    if (name !== folder) add('name', `name "${name}" must match the folder "${folder}"`);
  }
  const description = data.description;
  if (description === undefined || description === null || description === '') add('description', 'description is required');
  else if (typeof description !== 'string') add('description', 'description must be text');
  else if (description.trim().length < 1) add('description', 'description is empty');
  else if (description.length > 1024) add('description', `description is ${description.length} characters, the limit is 1024`);
  if (data.license !== undefined && typeof data.license !== 'string') add('license', 'license must be text');
  const compatibility = data.compatibility;
  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string') add('compatibility', 'compatibility must be text');
    else if (compatibility.length > 500) add('compatibility', `compatibility is ${compatibility.length} characters, the limit is 500`);
  }
  const metadata = data.metadata;
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) add('metadata', 'metadata must be a map of text to text');
    else if (Object.values(metadata).some(v => typeof v !== 'string')) add('metadata', 'metadata values must all be text');
  }
  const tools = data['allowed-tools'];
  if (tools !== undefined && typeof tools !== 'string' && !(Array.isArray(tools) && tools.every(t => typeof t === 'string'))) add('allowed-tools', 'allowed-tools must be a space-separated list of tools');
  return out;
}
