import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { ADMIN_USERNAME, configuredDataDirectory, setAdminPassword } from './admin-auth.js';

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('请在服务器的交互式终端中运行此命令。');
  // Let readline handle editing and Unicode, but never echo a password to the terminal.
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: stdin, output: silent, terminal: true });
  const abort = new AbortController();
  input.on('SIGINT', () => abort.abort());
  input.on('close', () => abort.abort());
  async function prompt(label) {
    stdout.write(label);
    const value = await input.question('', { signal: abort.signal });
    stdout.write('\n');
    return value;
  }
  try {
    const password = await prompt(`为 ${ADMIN_USERNAME} 输入新密码：`);
    const repeat = await prompt('请再次输入新密码：');
    if (password !== repeat) throw new Error('两次输入的密码不一致。');
    await setAdminPassword(configuredDataDirectory(), password);
    console.log('管理员密码已设置。请使用新密码登录，之前的登录已失效。');
  } finally {
    input.close();
  }
}

main().catch(error => {
  console.error(error.name === 'AbortError' ? '\n已取消设置密码。' : error.message);
  process.exitCode = 1;
});
