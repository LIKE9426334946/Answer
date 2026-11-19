export function showSortDialog({ title, items, icon, save }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'sort-dialog';
  dialog.setAttribute('aria-labelledby', 'sort-title');
  dialog.innerHTML = `<form>
    <div class="modal-heading"><h2 id="sort-title"></h2><button type="button" class="icon-button" data-close aria-label="关闭">${icon('close')}</button></div>
    <p class="modal-message">拖动条目或点击上下箭头调整顺序。</p>
    <ol class="sort-list" aria-labelledby="sort-title"></ol>
    <p class="inline-error" role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="button secondary" data-close>取消</button><button type="submit" class="button primary" disabled>保存顺序</button></div>
  </form>`;
  dialog.querySelector('h2').textContent = title;
  const form = dialog.querySelector('form');
  const list = dialog.querySelector('ol');
  const submit = dialog.querySelector('[type="submit"]');
  const errorBox = dialog.querySelector('[role="alert"]');

  for (const item of items) {
    const row = document.createElement('li');
    row.draggable = true;
    row.dataset.id = item.id;
    row.innerHTML = `<span class="sort-grip">${icon('grip')}</span><span class="sort-label"></span>
      <button type="button" class="icon-button" data-move="up" title="上移">${icon('up')}</button>
      <button type="button" class="icon-button" data-move="down" title="下移">${icon('down')}</button>`;
    row.querySelector('.sort-label').textContent = item.label;
    for (const button of row.querySelectorAll('[data-move]')) {
      button.setAttribute('aria-label', `${button.title}「${item.label}」`);
    }
    list.append(row);
  }
  function updateControls() {
    const rows = Array.from(list.children);
    rows.forEach((row, index) => {
      row.querySelector('[data-move="up"]').disabled = index === 0;
      row.querySelector('[data-move="down"]').disabled = index === rows.length - 1;
    });
    submit.disabled = rows.every((row, index) => row.dataset.id === items[index].id);
  }
  function isMovingDown(row, target) {
    return Boolean(row.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  function moveRow(row, target) {
    if (isMovingDown(row, target)) target.after(row);
    else target.before(row);
    updateControls();
  }
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-move]');
    if (!button || button.disabled) return;
    const row = button.closest('li');
    const target = button.dataset.move === 'up' ? row.previousElementSibling : row.nextElementSibling;
    moveRow(row, target);
    (button.disabled ? row.querySelector('button:enabled') : button).focus();
  });

  let dragged = null;
  function clearDropMark() {
    list.querySelector('[data-drop]')?.removeAttribute('data-drop');
  }
  function finishDrag() {
    dragged?.classList.remove('dragging');
    dragged = null;
    clearDropMark();
  }
  list.addEventListener('dragstart', event => {
    dragged = event.target.closest('li');
    if (!dragged) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.dataset.id);
    dragged.classList.add('dragging');
  });
  list.addEventListener('dragover', event => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest('li');
    clearDropMark();
    if (target && target !== dragged) {
      target.dataset.drop = isMovingDown(dragged, target) ? 'after' : 'before';
    }
  });
  list.addEventListener('dragleave', event => {
    if (!list.contains(event.relatedTarget)) clearDropMark();
  });
  list.addEventListener('drop', event => {
    if (!dragged) return;
    event.preventDefault();
    const target = event.target.closest('li');
    if (target && target !== dragged) moveRow(dragged, target);
    finishDrag();
  });
  list.addEventListener('dragend', finishDrag);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.inert || submit.disabled) return;
    form.inert = true;
    errorBox.hidden = true;
    submit.textContent = '正在保存…';
    try {
      await save(Array.from(list.children, row => row.dataset.id));
      dialog.close('saved');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      form.inert = false;
      submit.textContent = '保存顺序';
    }
  });
  function dismiss() {
    if (!form.inert) dialog.close();
  }
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', dismiss));
  dialog.addEventListener('cancel', event => { if (form.inert) event.preventDefault(); });
  window.addEventListener('hashchange', dismiss);
  updateControls();
  document.body.append(dialog);
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => {
    window.removeEventListener('hashchange', dismiss);
    dialog.remove();
    resolve(dialog.returnValue === 'saved');
  }, { once: true }));
}
