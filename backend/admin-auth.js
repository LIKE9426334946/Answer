import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AppError, writePrivateJson } from './store.js';

export const ADMIN_USERNAME = 'noart';
export const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
const loginWindow = 10 * 60 * 1000;
const deriveKey = promisify(scrypt);

export function configuredDataDirectory() {
  return process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url));
}

function validPassword(password) {
  return typeof password === 'string' && password.length > 0 && Buffer.byteLength(password) <= 1024;
}

function passwordHash(password, salt) {
  return deriveKey(password, Buffer.from(salt, 'hex'), 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
}

export async function setAdminPassword(directory, password) {
  if (!validPassword(password)) throw new Error('请输入非空密码，长度不能超过 1024 字节。');
  const salt = randomBytes(16).toString('hex');
  const hash = await passwordHash(password, salt);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateJson(path.join(directory, 'admin-credentials.json'), { version: 1, salt, hash: hash.toString('hex') });
}

async function readJsonIfPresent(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sessionId(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createAdminAuth(directory, now = Date.now) {
  const credentialFile = path.join(directory, 'admin-credentials.json');
  const sessionFile = path.join(directory, 'admin-sessions.json');
  const attempts = new Map();
  let pendingLogins = 0;
  let sessionQueue = Promise.resolve();

  async function credentials() {
    const record = await readJsonIfPresent(credentialFile);
    if (record && (record.version !== 1 || !/^[a-f0-9]{32}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.hash))) {
      throw new Error('管理员凭据文件格式无效。');
    }
    return record;
  }

  // The server owns this file. The password command only replaces the separate credential file.
  function changeSessions(change) {
    const operation = sessionQueue.then(async () => {
      const sessions = await readJsonIfPresent(sessionFile) ?? {};
      if (!change(sessions)) return;
      for (const [id, session] of Object.entries(sessions)) {
        if (session.expiresAt <= now()) delete sessions[id];
      }
      await writePrivateJson(sessionFile, sessions);
    });
    sessionQueue = operation.catch(() => {});
    return operation;
  }

  return {
    async login(username, password, client) {
      const startedAt = now();
      for (const [key, attempt] of attempts) {
        if (attempt.until <= startedAt) attempts.delete(key);
      }
      const attempt = attempts.get(client) ?? { count: 0, until: startedAt + loginWindow };
      if (attempt.count >= 10 || pendingLogins >= 4) throw new AppError(429, '登录尝试过于频繁，请稍后再试。');
      attempt.count++;
      attempts.set(client, attempt);
      pendingLogins++;
      try {
        const record = await credentials();
        if (!record) throw new AppError(503, '管理员密码尚未设置，请先在服务器上设置密码。');
        if (username !== ADMIN_USERNAME || !validPassword(password) ||
            !timingSafeEqual(await passwordHash(password, record.salt), Buffer.from(record.hash, 'hex'))) {
          throw new AppError(401, '用户名或密码错误。');
        }
        const token = randomBytes(32).toString('hex');
        await changeSessions(sessions => {
          sessions[sessionId(token)] = { passwordVersion: record.salt, expiresAt: now() + SESSION_DURATION };
          return true;
        });
        attempts.delete(client);
        return token;
      } finally {
        pendingLogins--;
      }
    },

    async authenticated(token) {
      if (!token) return false;
      const sessions = await readJsonIfPresent(sessionFile);
      const session = sessions?.[sessionId(token)];
      if (!session || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now()) return false;
      const record = await credentials();
      return Boolean(record && session.passwordVersion === record.salt);
    },

    async logout(token) {
      if (!token) return;
      const id = sessionId(token);
      await changeSessions(sessions => {
        if (!Object.hasOwn(sessions, id)) return false;
        delete sessions[id];
        return true;
      });
    }
  };
}
