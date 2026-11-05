import { randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function text(value, label, max, required = true) {
  if (typeof value !== 'string') throw new AppError(400, `${label}必须是文字。`);
  const result = value.trim();
  if (required && !result) throw new AppError(400, `请填写${label}。`);
  if (result.length > max) throw new AppError(400, `${label}不能超过 ${max} 个字符。`);
  return result;
}

export function projectFields(body) {
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 200) {
    throw new AppError(400, '每个项目需要 1–200 组问答。');
  }
  return {
    title: text(body.title, '项目名称', 120),
    description: text(body.description, '问题描述', 20000, false),
    questions: body.questions.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new AppError(400, '问答格式不正确。');
      return {
        id: randomUUID(),
        question: text(entry.question, `第 ${index + 1} 个问题`, 20000),
        answer: text(entry.answer, `第 ${index + 1} 个答案`, 50000)
      };
    })
  };
}

function validateStoredData(data) {
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.directories) || !Array.isArray(data.projects)) {
    throw new Error('数据文件格式无效；请检查 data/content.json 或恢复备份。');
  }
  const ids = new Set();
  for (const directory of data.directories) {
    if (typeof directory.id !== 'string' || ids.has(directory.id)) throw new Error('目录 ID 无效或重复。');
    text(directory.name, '目录名称', 80);
    ids.add(directory.id);
  }
  const projectIds = new Set();
  for (const project of data.projects) {
    if (!ids.has(project.directoryId) || typeof project.id !== 'string' || projectIds.has(project.id)) {
      throw new Error('项目 ID 或所属目录无效。');
    }
    projectFields(project);
    projectIds.add(project.id);
  }
}

export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'content.json');
  let state;

  async function persist(value) {
    const temporary = path.join(directory, `.content-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  try {
    state = JSON.parse(await readFile(filename, 'utf8'));
    validateStoredData(state);
  } catch (error) {
    // Never silently replace an existing damaged file with an empty database.
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, revision: 0, directories: [], projects: [] };
    await persist(state);
  }

  let queue = Promise.resolve();
  return {
    read: () => structuredClone(state),
    mutate(revision, action) {
      const operation = queue.then(async () => {
        if (revision !== state.revision) {
          throw new AppError(409, '内容已在其他页面更新。请复制保留当前编辑内容，刷新后重新编辑。');
        }
        const next = structuredClone(state);
        const result = action(next);
        next.revision += 1;
        await persist(next);
        state = next;
        return { data: structuredClone(state), result };
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
