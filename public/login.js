export function createLoginForm(onSuccess) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/api/auth/login';
  form.className = 'login-form';
  form.innerHTML = `
    <label class="field-label" for="login-username">用户名</label>
    <input id="login-username" name="username" autocomplete="username" value="noart" readonly>
    <label class="field-label" for="login-password">密码</label>
    <input id="login-password" name="password" type="password" autocomplete="current-password" required>
    <p class="inline-error" role="alert" hidden></p>
    <button class="button primary" type="submit">登录</button>`;

  const password = form.elements.namedItem('password');
  const submit = form.querySelector('button');
  const error = form.querySelector('[role="alert"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: form.elements.namedItem('username').value, password: password.value })
      });
      const result = await response.json();
      if (response.ok && result.ok) {
        password.value = '';
        onSuccess();
        return;
      }
      error.textContent = result.error || '登录失败，请重试。';
      password.select();
    } catch {
      error.textContent = '暂时无法登录，请检查连接后重试。';
    } finally {
      submit.disabled = false;
    }
    error.hidden = false;
    password.focus();
  });
  return form;
}

const container = document.querySelector('#login-form-container');
if (container) {
  container.append(createLoginForm(() => location.replace('/admin' + location.hash)));
  container.querySelector('input[type="password"]').focus();
}
