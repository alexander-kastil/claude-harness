import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { isTreeHash, originsOf } from '../../src/skill-lock';

// Temp folders only: the owner's ~/.claude and repos are never named.

test('a repo\'s skills-lock.json names the source of a skill installed there with npx skills add', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-lock-'));
  fs.writeFileSync(
    path.join(repo, 'skills-lock.json'),
    JSON.stringify({ version: 1, skills: { 'ai-avatar-video': { source: 'qu-skills/superpowers', sourceType: 'github', skillPath: 'tools/video/ai-avatar-video/SKILL.md', computedHash: 'a'.repeat(64), installMode: 'copy' } } })
  );
  const origin = originsOf(path.join(repo, '.claude')).get('ai-avatar-video');
  assert.equal(origin?.source, 'qu-skills/superpowers');
  assert.equal(origin?.path, 'tools/video/ai-avatar-video/SKILL.md');
  assert.equal(origin?.url, 'https://github.com/qu-skills/superpowers.git');
  assert.equal(isTreeHash(origin!.hash), false);
});

test('only a 40-character git tree SHA can be compared against a newer version', () => {
  assert.equal(isTreeHash('a0dfdc3562686d920900973b50289b36e2f7eafe'), true);
  assert.equal(isTreeHash('abc123'), false);
});
