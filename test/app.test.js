import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../backend/server.js';
import { createStore } from '../backend/store.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'answer-test-'));
  const app = await createApp({ dataDirectory: directory });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { directory, base, async request(url, method = 'GET', body, revision = 0, headers = {}) {
    const response = await fetch(base + url, {
      method, headers: method === 'GET' ? headers : { 'Content-Type': 'application/json', 'If-Match': String(revision), ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) })
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  } };
}
const sample = directoryId => ({
  directoryId, title: '卷积与反向传播', description: '给定 $x \\in \\mathbb{R}^{3\\times10\\times10}$。\n第二行。',
  questions: [
    { question: '均值如何计算？', answer: '$\\mu=\\frac{1}{n}\\sum_i x_i$' },
    { question: '链式法则是什么？', answer: '$$\\frac{\\partial L}{\\partial x}=\\frac{\\partial L}{\\partial y}\\frac{\\partial y}{\\partial x}$$' }
  ]
});

test('directory/project CRUD, order, LaTeX, movement, durable reload and cascade deletion', async t => {
  const { request, directory } = await fixture(t);
  let response = await request('/api/data');
  assert.deepEqual(response.body.directories, []);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  response = await request('/api/directories', 'POST', { name: '深度学习' });
  assert.equal(response.status, 201);
  const folder = response.body.result;
  let revision = response.body.data.revision;
  response = await request('/api/projects', 'POST', sample(folder.id), revision);
  assert.equal(response.status, 201);
  const project = response.body.result;
  revision = response.body.data.revision;
  assert.deepEqual(project.questions.map(q => q.answer), sample(folder.id).questions.map(q => q.answer));
  assert.equal(project.description, sample(folder.id).description);
  const restarted = await createStore(directory);
  assert.deepEqual(restarted.read(), response.body.data);
  const second = await request('/api/directories', 'POST', { name: '数学基础' }, revision);
  revision = second.body.data.revision;
  const edited = { ...project, title: '梯度计算', directoryId: second.body.result.id, questions: [...project.questions].reverse() };
  response = await request(`/api/projects/${project.id}`, 'PUT', edited, revision);
  assert.equal(response.status, 200);
  assert.equal(response.body.result.questions[0].question, '链式法则是什么？');
  assert.equal(response.body.result.directoryId, second.body.result.id);
  revision = response.body.data.revision;
  response = await request(`/api/directories/${folder.id}`, 'PATCH', { name: '计算机视觉' }, revision);
  assert.equal(response.body.result.name, '计算机视觉');
  revision = response.body.data.revision;
  response = await request(`/api/directories/${folder.id}`, 'DELETE', {}, revision);
  assert.equal(response.body.data.projects.length, 1, 'moving a project preserves it when the old folder is deleted');
  revision = response.body.data.revision;
  response = await request(`/api/projects/${project.id}`, 'DELETE', {}, revision);
  assert.equal(response.body.data.projects.length, 0);
  revision = response.body.data.revision;
  response = await request('/api/projects', 'POST', sample(second.body.result.id), revision);
  revision = response.body.data.revision;
  response = await request(`/api/directories/${second.body.result.id}`, 'DELETE', {}, revision);
  assert.equal(response.body.data.projects.length, 0);
  assert.equal(response.body.data.directories.length, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'content.json'), 'utf8')), response.body.data);
});

test('concurrent saves and stale clients cannot overwrite each other; queue recovers after errors', async t => {
  const { request } = await fixture(t);
  const results = await Promise.all([
    request('/api/directories', 'POST', { name: 'A' }, 0),
    request('/api/directories', 'POST', { name: 'B' }, 0)
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const data = (await request('/api/data')).body;
  assert.equal(data.directories.length, 1);
  assert.equal(data.revision, 1);
  assert.equal((await request('/api/directories', 'POST', { name: 'C' }, 1)).status, 201);
});

test('invalid inputs, unknown IDs, missing versions and cross-site writes are rejected', async t => {
  const { request, base } = await fixture(t);
  for (const name of ['', '   ', 'x'.repeat(81), 123]) {
    assert.equal((await request('/api/directories', 'POST', { name })).status, 400);
  }
  assert.equal((await request('/api/projects', 'POST', sample('missing'))).status, 404);
  const folder = (await request('/api/directories', 'POST', { name: '数学' })).body.result;
  assert.equal((await request('/api/directories', 'POST', { name: '数学' }, 1)).status, 400);
  assert.equal((await request('/api/projects', 'POST', { ...sample(folder.id), questions: [] }, 1)).status, 400);
  assert.equal((await request('/api/projects', 'POST', { ...sample(folder.id), questions: [{ question: '问题', answer: ' ' }] }, 1)).status, 400);
  assert.equal((await request(`/api/projects/missing`, 'PUT', sample(folder.id), 1)).status, 404);
  assert.equal((await request('/api/directories', 'POST', { name: '别的目录' }, 1, { Origin: 'https://example.org' })).status, 403);
  assert.equal((await request('/api/directories', 'POST', { name: '别的目录' }, 1, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await fetch(base + '/api/directories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 428);
  assert.equal((await request('/api/directories', 'POST', { name: '别的目录' }, 'invalid')).status, 400);
  assert.equal((await request('/api/directories', 'POST', { name: '别的目录' }, 1, { Origin: base })).status, 201);
});

test('serves desktop/mobile UI and local math assets, keeps user data private from static routes', async t => {
  const { base } = await fixture(t);
  for (const url of ['/', '/admin', '/admin/', '/styles.css', '/app.js', '/favicon.svg', '/vendor/katex/katex.min.css', '/vendor/katex/katex.min.js', '/vendor/katex/contrib/auto-render.min.js', '/vendor/katex/fonts/KaTeX_Main-Regular.woff2']) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get('content-security-policy')?.includes("script-src 'self'"));
  }
  for (const url of ['/data/content.json', '/backend/server.js', '/package.json', '/.git/config']) {
    assert.equal((await fetch(base + url)).status, 404, url);
  }
});

test('damaged data is never silently reset', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'answer-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'content.json');
  await writeFile(filename, '{broken JSON');
  await assert.rejects(createStore(directory));
  assert.equal(await readFile(filename, 'utf8'), '{broken JSON');
});
