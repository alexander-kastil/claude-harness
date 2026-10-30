import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Stop, parse } from '../../src/cli-core';
import { Tools, doctorCommand, kindOf } from '../../src/cli-media';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `media-${what}-`));
const write = (root: string, rel: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const failed = (code = 1) => ({ code, stdout: '', stderr: '' });

/** A film folder under assets/films with a script naming a missing file, misnamed outputs and a changelog without its output. */
function film(name = 'demo') {
  const root = tmp('root');
  const dir = path.join(root, 'assets', 'films', name);
  write(dir, 'scripts/build.py', ['import os', 'CLIP = "media/clips/missing.mp4"', 'OK = "media/clips/present.mp4"', 'OLD = "C:/does-not-exist-xyz/assets/film-demo"', 'TMP = "C:/Users/x/AppData/Local/Temp/claude/abc/scratch.txt"', ''].join('\n'));
  write(dir, 'scripts/__pycache__/cached.py', 'X = "media/clips/nope.mp4"\n');
  write(dir, 'media/clips/present.mp4', 'clip');
  write(dir, 'changelog/v1.md', 'Output `demo-v1.mp4`: 12 s at 1920x1080, 30 fps. Logo `media/icon.png` lives at the repo root. The other stem is `other-v1.mp4`.\n');
  write(root, 'media/icon.png', 'icon');
  write(dir, 'changelog/v4.md', 'Output `demo-v4.mp4`, not rendered yet.\n');
  write(dir, 'media/output/demo-v1.mp4', 'v1');
  write(dir, 'media/output/demo-v2-silent.mp4', 'v2');
  write(dir, 'media/output/demo-v3.wav', 'audio');
  write(dir, 'media/output/other-v1.mp4', 'stem');
  write(dir, 'media/output/notes.txt', 'text');
  return { root, dir };
}

const layoutJson = JSON.stringify({
  moves: [{ from: 'assets/films/demo/clip.mp4', to: 'assets/films/demo/media/clips/clip.mp4', reason: 'clip' }],
  unplaced: [{ path: 'assets/films/demo/notes', reason: 'unknown folder' }],
});

/** Stub tools: the plugin, Python and ffprobe are present; git is a repo with one LFS pointer, one unpulled file and one ignored output. */
function tools(over: Partial<Tools> = {}): Tools {
  return {
    python: async () => ['python'],
    plugin: (name, rel) => `/plugins/${name}/${rel}`,
    script: async () => ok(layoutJson),
    probe: async file => (file.endsWith('demo-v1.mp4') ? { seconds: 14, size: '1920x1080', fps: 30 } : undefined),
    git: async (args, cwd) => {
      if (args[0] === 'rev-parse') return ok(`${path.resolve(cwd, '..', '..', '..')}\n`);
      if (args[0] === 'check-attr') {
        const paths = args.slice(args.indexOf('--') + 1);
        return ok(paths.map(p => `${p}\0filter\0${p.endsWith('.lfs.mp4') ? 'lfs' : 'unspecified'}\0`).join(''));
      }
      if (args[0] === 'check-ignore' && args.includes('-q')) {
        const target = args[args.length - 1];
        return failed(target === 'media/output/demo-v1.mp4' || target === 'assets/films/ignored-film' ? 0 : 1);
      }
      if (args[0] === 'check-ignore') return ok(args.slice(args.indexOf('--') + 1).filter(p => p.includes('ignored')).map(p => `${p}\n`).join(''));
      return failed();
    },
    ...over,
  };
}

const doctor = async (dir: string, t: Tools) => {
  const out: string[] = [];
  const code = await doctorCommand(parse(['media', 'doctor', dir, '--json']), { out: s => out.push(s), err: () => {} }, t);
  return { code, out: out.join('\n') };
};

test('the text output is a headline and a problem table, with the stem problem summarized and an output table once probed', async () => {
  const { dir } = film();
  const out: string[] = [];
  const code = await doctorCommand(parse(['media', 'doctor', dir]), { out: s => out.push(s), err: () => {} }, tools());
  const text = out.join('\n');
  assert.equal(code, 1);
  assert.match(text, /^\*\*Media doctor · demo · film · \d+ problems\*\*/);
  assert.match(text, /\| Check\s+\| Path\s+\| Line \| Problem\s+\|/);
  assert.match(text, /1 output uses the stem other, not demo\s+\|/);
  assert.doesNotMatch(text, /other-v1\.mp4/, 'the stem file list stays in the JSON only');
  assert.match(text, /\| Output\s+\| Version\s+\| Seconds\s+\|\s+Size\s+\|\s+FPS\s+\| Changelog/);
  assert.match(text, /demo-v1\.mp4\s+\|\s+1 \|\s+14 \|/);
});

test('a folder with no problems and no probed outputs prints the headline and No problems', async () => {
  const root = tmp('quiet');
  const dir = path.join(root, 'assets', 'images', 'set');
  write(dir, 'media/hero.png', 'png');
  const out: string[] = [];
  const code = await doctorCommand(parse(['media', 'doctor', dir]), { out: s => out.push(s), err: () => {} }, tools({ script: async () => ok(JSON.stringify({ moves: [], unplaced: [] })), git: async () => failed(128) }));
  assert.equal(code, 0);
  assert.equal(out.join('\n'), '**Media doctor · set · images · 0 problems**\n\nNo problems.');
});

test('kindOf reads the parent folder: assets/films is a film, assets/images is an images set', () => {
  assert.equal(kindOf(path.join('x', 'assets', 'films', 'demo')), 'film');
  assert.equal(kindOf(path.join('x', 'assets', 'images', 'set')), 'images');
  assert.equal(kindOf(path.join(tmp('elsewhere'), 'demo')), undefined);
});

test('media doctor without a folder, or outside assets, is bad arguments (exit 2)', async () => {
  await assert.rejects(doctorCommand(parse(['media', 'doctor']), { out: () => {}, err: () => {} }, tools()), (e: unknown) => e instanceof Stop && e.code === 2);
  const elsewhere = tmp('elsewhere');
  await assert.rejects(doctorCommand(parse(['media', 'doctor', elsewhere]), { out: () => {}, err: () => {} }, tools()), (e: unknown) => e instanceof Stop && e.code === 2);
});

test('the doctor reports layout moves, broken references, misnamed outputs and changelog gaps', async () => {
  const { dir } = film();
  const r = await doctor(dir, tools());
  assert.equal(r.code, 1);
  const json = JSON.parse(r.out);
  const problems = json.problems as { check: string; path: string; line?: number; detail: string }[];
  const has = (check: string, p: string, detail: RegExp, line?: number) =>
    problems.some(x => x.check === check && x.path === p && detail.test(x.detail) && (line === undefined || x.line === line));

  assert.ok(has('layout', 'assets/films/demo/clip.mp4', /media\/clip/));
  assert.ok(has('layout', 'assets/films/demo/notes', /unknown folder/));
  assert.ok(has('references', 'scripts/build.py', /media\/clips\/missing\.mp4/, 2));
  assert.ok(has('references', 'scripts/build.py', /C:\/does-not-exist-xyz/, 4));
  assert.ok(!problems.some(x => x.detail.includes('present.mp4') || x.detail.includes('scratch.txt') || x.detail.includes('nope.mp4') || x.detail.includes('icon.png')));
  assert.ok(has('outputs', 'media/output/demo-v3.wav', /audio work file/));
  assert.ok(has('outputs', 'media/output', /1 output uses the stem other, not demo: other-v1\.mp4/));
  assert.ok(!problems.some(x => x.detail.includes('notes.txt')), 'a text file in the output folder is not an output');
  assert.ok(has('outputs', 'media/output/demo-v2-silent.mp4', /no changelog\/v2\.md/));
  assert.ok(has('outputs', 'media/output/demo-v1.mp4', /changelog says 12 s, the file is 14 s/));
  assert.ok(has('outputs', 'changelog/v4.md', /names media\/output\/demo-v4\.mp4, which does not exist/));
  assert.ok(!problems.some(x => x.check === 'outputs' && x.path === 'changelog/v1.md'), 'a changelog naming an existing output of its version, whatever its stem, is not a problem');
  assert.ok(has('storage', 'media/output/demo-v1.mp4', /git ignores it/));
  assert.deepEqual(json.outputs.map((o: { file: string }) => o.file).sort(), ['demo-v1.mp4', 'demo-v2-silent.mp4'].sort());
  assert.equal(json.outputs.find((o: { file: string }) => o.file === 'demo-v1.mp4').seconds, 14);
  assert.equal(json.kind, 'film');
  assert.equal(json.applied, false);
});

test('the files of the production contract are part of a film\'s layout, an unknown file next to them is not', async () => {
  const { dir } = film();
  const contract = ['grounding.md', 'story.md', 'storyboard.json', 'storyboard.md', 'look.md', 'prompt.md', 'verdict.json', 'publish.md', 'ledger.jsonl', 'takes', 'evidence'];
  const layout = JSON.stringify({
    moves: [{ from: 'assets/films/demo/story.md', to: 'assets/films/demo/story/story.md', reason: 'story' }],
    unplaced: [
      ...contract.map(p => ({ path: `assets/films/demo/${p}`, reason: 'loose file' })),
      { path: 'assets/films/demo/takes/2.1-t1/events.jsonl', reason: 'unknown file' },
      { path: 'assets/films/demo/evidence/3.png', reason: 'unknown file' },
      { path: 'assets/films/demo/draft.md', reason: 'loose file' },
    ],
  });
  const problems = JSON.parse((await doctor(dir, tools({ script: async () => ok(layout) }))).out).problems as { check: string; path: string }[];
  assert.deepEqual(problems.filter(p => p.check === 'layout').map(p => p.path), ['assets/films/demo/draft.md']);
});

test('a missing plugin or Python is one problem, and the other checks still run', async () => {
  const { dir } = film();
  const noPlugin = JSON.parse((await doctor(dir, tools({ plugin: () => undefined }))).out);
  assert.ok(noPlugin.problems.some((p: { check: string; detail: string }) => p.check === 'layout' && /film-producer/.test(p.detail)));
  assert.ok(noPlugin.problems.some((p: { check: string }) => p.check === 'references'));

  const noPython = JSON.parse((await doctor(dir, tools({ python: async () => undefined }))).out);
  assert.ok(noPython.problems.some((p: { check: string; detail: string }) => p.check === 'layout' && /Python 3/.test(p.detail)));
  assert.ok(noPython.problems.some((p: { check: string }) => p.check === 'outputs'));
});

test('ffprobe missing leaves the output numbers empty and raises no problem about them', async () => {
  const { dir } = film();
  const json = JSON.parse((await doctor(dir, tools({ probe: async () => undefined }))).out);
  assert.ok(!json.problems.some((p: { detail: string }) => /changelog says/.test(p.detail)));
  assert.equal(json.outputs.find((o: { file: string }) => o.file === 'demo-v1.mp4').seconds, null);
});

test('outside a git repo the storage checks do not run', async () => {
  const { dir } = film();
  const json = JSON.parse((await doctor(dir, tools({ git: async () => failed(128) }))).out);
  assert.ok(!json.problems.some((p: { check: string }) => p.check === 'storage'));
});

test('with an LFS rule, an unpulled pointer and a file git does not keep in LFS are storage problems; ignored files are skipped', async () => {
  const { root, dir } = film();
  write(root, '.gitattributes', 'assets/** filter=lfs\n');
  write(dir, 'media/clips/pointer.lfs.mp4', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n');
  write(dir, 'media/clips/plain.mp4', 'data');
  write(dir, 'media/clips/ignored.mp4', 'version https://git-lfs.github.com/spec/v1\n');
  const json = JSON.parse((await doctor(dir, tools())).out);
  const storage = json.problems.filter((p: { check: string }) => p.check === 'storage');
  assert.ok(storage.some((p: { path: string; detail: string }) => p.path === 'media/clips/pointer.lfs.mp4' && /never pulled/.test(p.detail)));
  assert.ok(storage.some((p: { path: string; detail: string }) => p.path === 'media/clips/plain.mp4' && /not stored in Git LFS/.test(p.detail)));
  assert.ok(!storage.some((p: { path: string; detail: string }) => p.path === 'media/clips/pointer.lfs.mp4' && /not stored/.test(p.detail)));
  assert.ok(!storage.some((p: { path: string }) => p.path.includes('ignored')));
});

test('SVG and HTML files are not video: no naming problem, and only LFS types get the LFS and pointer checks', async () => {
  const { root, dir } = film();
  write(root, '.gitattributes', 'assets/** filter=lfs\n');
  write(dir, 'media/output/diagram.svg', '<svg/>');
  write(dir, 'media/output/page.html', '<html/>');
  write(dir, 'media/clips/pointer.svg', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\n');
  write(dir, 'media/clips/hero.png', 'png');
  const json = JSON.parse((await doctor(dir, tools())).out);
  const problems = json.problems as { check: string; path: string; detail: string }[];
  assert.ok(!problems.some(x => /diagram\.svg|page\.html|pointer\.svg/.test(x.path) || /diagram\.svg|page\.html|pointer\.svg/.test(x.detail)));
  assert.ok(problems.some(x => x.check === 'storage' && x.path === 'media/clips/hero.png' && /not stored in Git LFS/.test(x.detail)), 'a PNG is an LFS type');
});

test('a film folder git ignores as a whole gets no storage checks at all', async () => {
  const { dir } = film('ignored-film');
  write(dir, 'media/clips/pointer.mp4', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\n');
  const json = JSON.parse((await doctor(dir, tools())).out);
  assert.ok(!json.problems.some((p: { check: string }) => p.check === 'storage'));
  assert.ok(json.problems.some((p: { check: string }) => p.check === 'layout' || p.check === 'outputs' || p.check === 'references'), 'the other checks still run');
});

test('without an LFS rule in .gitattributes the storage check reports that once', async () => {
  const { dir } = film();
  write(dir, 'media/clips/one.mp4', 'a');
  write(dir, 'media/clips/two.mp4', 'b');
  const json = JSON.parse((await doctor(dir, tools())).out);
  const storage = json.problems.filter((p: { check: string; path: string }) => p.check === 'storage' && !p.path.startsWith('media/output'));
  assert.equal(storage.length, 1);
  assert.equal(storage[0].path, '.gitattributes');
  assert.match(storage[0].detail, /no Git LFS rule/);
});

test('a clean images folder exits 0 with no problems', async () => {
  const root = tmp('clean');
  const dir = path.join(root, 'assets', 'images', 'set');
  write(dir, 'media/hero.png', 'png');
  const r = await doctor(dir, tools({ script: async () => ok(JSON.stringify({ moves: [], unplaced: [] })), git: async () => failed(128) }));
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out).problems, []);
});
