import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../backend/server.js';
import { createStore } from '../backend/store.js';
import { setAdminPassword, SESSION_DURATION } from '../backend/admin-auth.js';

async function fixture(t, { configured = true, now = Date.now } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'answer-test-'));
  const app = await createApp({ dataDirectory: directory, now });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const password = randomUUID();
  let cookie = '';
  if (configured) {
    await setAdminPassword(directory, password);
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'noart', password })
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
  }
  return { directory, base, password, cookie, async request(url, method = 'GET', body, revision = 0, headers = {}) {
    const requestHeaders = { Cookie: cookie, ...headers };
    const response = await fetch(base + url, {
      method, headers: method === 'GET' ? requestHeaders : { 'Content-Type': 'application/json', 'If-Match': String(revision), ...requestHeaders },
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
  const { request, base, cookie } = await fixture(t);
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
  assert.equal((await fetch(base + '/api/directories', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })).status, 428);
  assert.equal((await request('/api/directories', 'POST', { name: '别的目录' }, 'invalid')).status, 400);
  assert.equal((await request('/api/directories', 'POST', { name: '别的目录' }, 1, { Origin: base })).status, 201);
});

test('serves desktop/mobile UI and local math assets, keeps user data private from static routes', async t => {
  const { base, cookie } = await fixture(t);
  for (const url of ['/', '/admin', '/admin/', '/styles.css', '/app.js', '/favicon.svg', '/vendor/katex/katex.min.css', '/vendor/katex/katex.min.js', '/vendor/katex/contrib/auto-render.min.js', '/vendor/katex/fonts/KaTeX_Main-Regular.woff2']) {
    const response = await fetch(base + url, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get('content-security-policy')?.includes("script-src 'self'"));
  }
  for (const url of ['/data/content.json', '/data/admin-credentials.json', '/data/admin-sessions.json', '/backend/server.js', '/package.json', '/.git/config']) {
    assert.equal((await fetch(base + url)).status, 404, url);
  }
});

test('anonymous study stays public, admin pages and every content mutation require login even before setup', async t => {
  const { base, request, directory, password } = await fixture(t, { configured: false });
  for (const page of ['/admin', '/admin/']) {
    const r = await fetch(base + page, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await fetch(base + '/')).status, 200);
  assert.match(await (await fetch(base + '/login')).text(), /管理端登录/);
  const unconfigured = await request('/api/auth/login', 'POST', { username: 'noart', password });
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.headers.get('set-cookie'), null);
  await setAdminPassword(directory, password);
  assert.equal((await request('/api/admin/data')).status, 401);
  for (const [method, url] of [
    ['POST', '/api/directories'], ['PATCH', '/api/directories/test'], ['DELETE', '/api/directories/test'],
    ['POST', '/api/projects'], ['PUT', '/api/projects/test'], ['DELETE', '/api/projects/test']
  ]) {
    assert.equal((await request(url, method, { name: '未登录' })).status, 401);
  }
  assert.equal((await request('/api/data')).body.revision, 0);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'other', password })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'noart', password: password + '!' })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'noart', password }, 0, { Origin: 'https://example.org' })).status, 403);
  assert.equal((await request('/api/auth/register', 'POST', { username: 'other', password })).status, 401);
});

test('sessions survive a server restart and expire exactly 30 days after login', async t => {
  let time = Date.now();
  const now = () => time;
  const { base, directory, cookie, request, password } = await fixture(t, { now });
  const secondApp = await createApp({ dataDirectory: directory, now });
  const secondServer = secondApp.listen(0, '127.0.0.1');
  await once(secondServer, 'listening');
  t.after(() => new Promise(resolve => secondServer.close(resolve)));
  const restarted = 'http://127.0.0.1:' + secondServer.address().port;
  const headers = { Cookie: cookie };
  assert.equal((await fetch(restarted + '/admin', { headers, redirect: 'manual' })).status, 200);
  assert.equal((await request('/api/admin/data', 'GET', undefined, 0, { Cookie: 'answer_admin_session=' + 'a'.repeat(64) })).status, 401);
  const login = await request('/api/auth/login', 'POST', { username: 'noart', password }, 0, { 'X-Forwarded-Proto': 'https' });
  const setCookie = login.headers.get('set-cookie');
  for (const attribute of ['Max-Age=2592000', 'HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/']) assert.ok(setCookie.includes(attribute));
  assert.ok(!(await readFile(path.join(directory, 'admin-credentials.json'), 'utf8')).includes(password));
  assert.ok(!(await readFile(path.join(directory, 'admin-sessions.json'), 'utf8')).includes(cookie.split('=')[1]));
  time += SESSION_DURATION - 1;
  assert.equal((await fetch(restarted + '/api/admin/data', { headers })).status, 200);
  time++;
  assert.equal((await fetch(restarted + '/api/admin/data', { headers })).status, 401);
  assert.equal((await request('/api/directories', 'POST', { name: '过期' })).status, 401);
  assert.equal((await fetch(base + '/admin', { headers, redirect: 'manual' })).status, 302);
  assert.equal((await request('/api/data')).status, 200);
});

test('logout revokes only the presented session and changing the password revokes all existing sessions', async t => {
  const { directory, request, password } = await fixture(t);
  const [second, third] = await Promise.all([
    request('/api/auth/login', 'POST', { username: 'noart', password }),
    request('/api/auth/login', 'POST', { username: 'noart', password })
  ]);
  const secondCookie = { Cookie: second.headers.get('set-cookie').split(';')[0] };
  const thirdCookie = { Cookie: third.headers.get('set-cookie').split(';')[0] };
  assert.equal((await request('/api/auth/logout', 'POST', {}, 0, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/admin/data')).status, 200);
  assert.equal((await request('/api/auth/logout', 'POST')).status, 200);
  assert.equal((await request('/api/admin/data')).status, 401);
  assert.equal((await request('/api/admin/data', 'GET', undefined, 0, secondCookie)).status, 200);
  assert.equal((await request('/api/admin/data', 'GET', undefined, 0, thirdCookie)).status, 200);
  await setAdminPassword(directory, password + 'new');
  assert.equal((await request('/api/admin/data', 'GET', undefined, 0, secondCookie)).status, 401);
  assert.equal((await request('/api/admin/data', 'GET', undefined, 0, thirdCookie)).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'noart', password })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { username: 'noart', password: password + 'new' })).status, 200);
});

test('repeated invalid logins are throttled for the client and recover after the cooldown', async t => {
  let time = Date.now();
  const { request, password } = await fixture(t, { now: () => time });
  for (let index = 0; index < 10; index++) {
    assert.equal((await request('/api/auth/login', 'POST', { username: 'other', password })).status, 401);
  }
  assert.equal((await request('/api/auth/login', 'POST', { username: 'noart', password })).status, 429);
  time += 10 * 60 * 1000;
  assert.equal((await request('/api/auth/login', 'POST', { username: 'noart', password })).status, 200);
});

test('damaged data is never silently reset', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'answer-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'content.json');
  await writeFile(filename, '{broken JSON');
  await assert.rejects(createStore(directory));
  assert.equal(await readFile(filename, 'utf8'), '{broken JSON');
});
