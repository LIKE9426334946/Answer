import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, AppError, text, projectFields } from './store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDirectory = path.join(root, 'public');

export async function createApp({ dataDirectory = process.env.DATA_DIR || path.join(root, 'data') } = {}) {
  const store = await createStore(dataDirectory);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    });
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      let invalidOrigin = false;
      if (origin) {
        try { invalidOrigin = new URL(origin).host !== req.get('host'); }
        catch { invalidOrigin = true; }
      }
      if (invalidOrigin || req.get('sec-fetch-site') === 'cross-site') {
        return next(new AppError(403, '不允许跨站修改内容。'));
      }
      if (!req.is('application/json')) return next(new AppError(415, '请求需要使用 JSON 格式。'));
      const revision = req.get('if-match');
      if (revision === undefined) return next(new AppError(428, '缺少内容版本，请刷新页面后重试。'));
      if (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) {
        return next(new AppError(400, '内容版本无效。'));
      }
      req.revision = Number(revision);
    }
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Answer' }));
  app.get('/api/data', (_req, res) => res.json(store.read()));

  function directory(data, id) {
    const result = data.directories.find(entry => entry.id === id);
    if (!result) throw new AppError(404, '目录不存在或已被删除。');
    return result;
  }
  function project(data, id) {
    const result = data.projects.find(entry => entry.id === id);
    if (!result) throw new AppError(404, '项目不存在或已被删除。');
    return result;
  }
  function directoryName(data, value, currentId) {
    const name = text(value, '目录名称', 80);
    if (data.directories.some(entry => entry.id !== currentId && entry.name === name)) {
      throw new AppError(400, '已经有同名目录，请换一个名称。');
    }
    return name;
  }
  app.post('/api/directories', async (req, res) => {
    const result = await store.mutate(req.revision, data => {
      const entry = { id: randomUUID(), name: directoryName(data, req.body?.name), createdAt: new Date().toISOString() };
      data.directories.push(entry);
      return entry;
    });
    res.status(201).json(result);
  });
  app.patch('/api/directories/:id', async (req, res) => {
    res.json(await store.mutate(req.revision, data => {
      const entry = directory(data, req.params.id);
      entry.name = directoryName(data, req.body?.name, entry.id);
      return entry;
    }));
  });
  app.delete('/api/directories/:id', async (req, res) => {
    res.json(await store.mutate(req.revision, data => {
      directory(data, req.params.id);
      data.directories = data.directories.filter(entry => entry.id !== req.params.id);
      data.projects = data.projects.filter(entry => entry.directoryId !== req.params.id);
    }));
  });
  app.post('/api/projects', async (req, res) => {
    res.status(201).json(await store.mutate(req.revision, data => {
      directory(data, req.body?.directoryId);
      const now = new Date().toISOString();
      const entry = { id: randomUUID(), directoryId: req.body.directoryId, ...projectFields(req.body), createdAt: now, updatedAt: now };
      data.projects.push(entry);
      return entry;
    }));
  });
  app.put('/api/projects/:id', async (req, res) => {
    res.json(await store.mutate(req.revision, data => {
      const entry = project(data, req.params.id);
      directory(data, req.body?.directoryId);
      Object.assign(entry, projectFields(req.body), { directoryId: req.body.directoryId, updatedAt: new Date().toISOString() });
      return entry;
    }));
  });
  app.delete('/api/projects/:id', async (req, res) => {
    res.json(await store.mutate(req.revision, data => {
      project(data, req.params.id);
      data.projects = data.projects.filter(entry => entry.id !== req.params.id);
    }));
  });
  app.use('/api', (_req, _res, next) => next(new AppError(404, '接口不存在。')));

  app.use('/vendor/katex', express.static(path.join(root, 'node_modules/katex/dist'), { maxAge: '1d', index: false }));
  app.get(['/admin', '/admin/'], (_req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));
  app.use(express.static(publicDirectory, { maxAge: 0 }));
  app.use((_req, res) => res.status(404).type('text').send('页面不存在。请返回首页 / 。'));
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? '保存或读取失败，请检查服务器日志和磁盘空间。' :
      status === 413 ? '内容过大，请将项目拆分后保存。' : error.type === 'entity.parse.failed' ? 'JSON 格式不正确。' : error.message });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口。');
  const app = await createApp();
  const server = app.listen(port, host, () => console.log(`Answer listening on http://${host}:${port}`));
  server.on('error', error => { console.error(error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
  }
}
