/* All user-authored content enters the DOM as escaped text. Only KaTeX renders markup. */
const isAdmin = location.pathname.startsWith('/admin');
const main = document.querySelector('#main');
const sidebar = document.querySelector('#sidebar');
const state = { data: null, folder: null, project: null, draft: null, dirty: false, saving: false, search: '' };
let activeHash = location.hash;
let toastTimer;
let previewTimer;

const icons = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h14"/>',
  edit: '<path d="m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  book: '<path d="M12 6c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Zm0 0v15"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  up: '<path d="m5 15 7-7 7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="m6 6 12 12M18 6 6 12"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`; }
function esc(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function rich(value) { return `<div class="rich-text">${esc(value)}</div>`; }
function number(index) { return String(index + 1).padStart(2, '0'); }
function folderById(id) { return state.data.directories.find(entry => entry.id === id); }
function projectsIn(id) { return state.data.projects.filter(entry => entry.directoryId === id); }
function date(value) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)); }
function route(folder, project) {
  const params = new URLSearchParams();
  if (folder) params.set('folder', folder);
  if (project) params.set('project', project);
  return '#' + params.toString();
}
function math(container) {
  if (typeof window.renderMathInElement !== 'function') return;
  container.querySelectorAll('.rich-text').forEach(element => {
    window.renderMathInElement(element, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20,
      errorColor: '#b5453c'
    });
  });
}
function toast(message, error = false) {
  const box = document.querySelector('#toast');
  clearTimeout(toastTimer);
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; }, error ? 6500 : 3000);
}
async function api(url, method = 'GET', body) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.headers['If-Match'] = String(state.data.revision);
    options.body = JSON.stringify(body || {});
  }
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('无法连接服务器，请检查网络。当前编辑内容仍保留在页面中。'); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('服务器返回异常，请稍后重试。'); }
  if (!response.ok) throw new Error(result.error || '操作失败，请重试。');
  return result;
}
async function mutation(url, method, body) {
  const result = await api(url, method, body);
  state.data = result.data;
  return result.result;
}

function modal({ title, message = '', value, confirm = '确定', danger = false }) {
  const dialog = document.querySelector('#modal');
  return new Promise(resolve => {
    dialog.innerHTML = `<form method="dialog" class="modal-form"><div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-button modal-cancel" aria-label="关闭">${icon('close')}</button></div>
      ${message ? `<p class="modal-message">${esc(message)}</p>` : ''}
      ${value !== undefined ? `<label class="field-label" for="directory-name">目录名称</label><input id="directory-name" name="name" required maxlength="80" value="${esc(value)}" placeholder="例如：线性代数" autocomplete="off">` : ''}
      <div class="modal-actions"><button class="button secondary modal-cancel" type="button">取消</button><button class="button ${danger ? 'danger' : 'primary'}" type="submit">${esc(confirm)}</button></div></form>`;
    let result = null;
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const input = dialog.querySelector('input');
      if (input && !input.value.trim()) { input.setCustomValidity('请输入目录名称。'); input.reportValidity(); return; }
      result = input ? input.value.trim() : true;
      dialog.close();
    });
    dialog.querySelector('input')?.addEventListener('input', event => event.target.setCustomValidity(''));
    dialog.querySelectorAll('.modal-cancel').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => resolve(result), { once: true });
    dialog.showModal();
    const focusTarget = dialog.querySelector('input') || dialog.querySelector('.modal-cancel');
    focusTarget.focus();
    focusTarget.select?.();
  });
}
async function canLeave() {
  if (state.saving) return false;
  if (!state.dirty) return true;
  return Boolean(await modal({ title: '编辑内容还没有保存', message: '离开后，本次未保存的修改将丢失。', confirm: '放弃修改', danger: true }));
}
async function navigate(folder, project) {
  if (!(await canLeave())) return;
  state.dirty = false;
  state.draft = null;
  state.search = '';
  const hash = route(folder, project);
  if (location.hash === hash || (!location.hash && hash === '#')) renderRoute();
  else location.hash = hash;
}
function readRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.folder = params.get('folder');
  state.project = params.get('project');
  if (state.project) {
    const project = state.data.projects.find(entry => entry.id === state.project);
    if (project) state.folder = project.directoryId;
  }
}
function renderSidebar() {
  sidebar.innerHTML = `<button class="sidebar-home ${!state.folder ? 'active' : ''}" data-action="home">${icon('grid')}<span>学习空间</span><span class="count">${state.data.directories.length}</span></button>
    <div class="sidebar-section"><span>我的目录</span>${isAdmin ? `<button class="icon-button" data-action="add-folder" aria-label="新建目录">${icon('plus')}</button>` : `<span>${String(state.data.directories.length).padStart(2, '0')}</span>`}</div>
    <div class="folder-nav">${state.data.directories.map(entry => `<button class="folder-nav-item ${state.folder === entry.id ? 'active' : ''}" data-action="folder" data-id="${entry.id}">${icon('folder')}<span>${esc(entry.name)}</span><small>${projectsIn(entry.id).length}</small></button>`).join('') || '<p class="sidebar-empty">你的知识，从一个目录开始。</p>'}</div>
    ${isAdmin ? `<button class="new-folder-link" data-action="add-folder">${icon('plus')}新建目录</button>` : ''}`;
}
function breadcrumb() {
  const folder = folderById(state.folder);
  return `<nav class="breadcrumb" aria-label="当前位置"><button data-action="home">学习空间</button>${folder ? `<span>/</span><button data-action="folder" data-id="${folder.id}" ${!state.project && !state.draft ? 'aria-current="page"' : ''}>${esc(folder.name)}</button>` : ''}${state.project || state.draft ? '<span>/</span><span>学习项目</span>' : ''}</nav>`;
}
function empty(title, message, action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon('book')}</div><h2>${esc(title)}</h2><p>${esc(message)}</p>${action}</div>`;
}
function renderOverview() {
  const questions = state.data.projects.reduce((sum, entry) => sum + entry.questions.length, 0);
  main.innerHTML = `<div class="stats-row"><span><strong>${state.data.directories.length}</strong> 个目录</span><i></i><span><strong>${state.data.projects.length}</strong> 个项目</span><i></i><span><strong>${questions}</strong> 组问答</span></div>
    <section class="directory-section"><div class="section-heading"><h1>我的目录 <span>${String(state.data.directories.length).padStart(2, '0')}</span></h1>${isAdmin ? `<button class="button primary" data-action="add-folder">${icon('plus')}新建目录</button>` : ''}</div>
    ${state.data.directories.length ? `<div class="directory-grid">${state.data.directories.map((entry, index) => {
      const projects = projectsIn(entry.id);
      const total = projects.reduce((sum, project) => sum + project.questions.length, 0);
      return `<button type="button" class="directory-card tone-${index % 3}" data-action="folder" data-id="${entry.id}">
        <span class="folder-symbol">${icon('folder')}</span>
        <span class="directory-summary"><strong>${esc(entry.name)}</strong><small>${projects.length} 个项目 · ${total} 组问答</small></span>
        <span class="directory-action">${isAdmin ? '管理目录' : '开始学习'}${icon('arrow')}</span>
      </button>`;
    }).join('')}${isAdmin ? `<button type="button" class="directory-card add-directory-card" data-action="add-folder">${icon('plus')}创建新目录</button>` : ''}</div>` : empty('从第一个目录开始', isAdmin ? '创建目录，再添加学习项目和问答。' : '还没有学习内容，请先在电脑端的「内容管理」中添加。', isAdmin ? `<button class="button primary" data-action="add-folder">${icon('plus')}新建目录</button>` : '<a class="button secondary desktop-only" href="/admin">前往内容管理</a>')}
    </section>`;
}
function renderFolder() {
  const folder = folderById(state.folder);
  if (!folder) { renderMissing('这个目录不存在或已被删除。'); return; }
  const projects = projectsIn(folder.id);
  main.innerHTML = `${breadcrumb()}<section class="page-heading"><div><span class="eyebrow">${isAdmin ? 'YOUR COLLECTION' : 'TIME TO LEARN'}</span><h1>${esc(folder.name)}</h1><p>${projects.length} 个学习项目，${projects.reduce((sum, project) => sum + project.questions.length, 0)} 组值得思考的问答。</p></div>
    ${isAdmin ? `<div class="heading-actions"><button class="icon-button outlined" data-action="rename-folder" aria-label="重命名目录" title="重命名目录">${icon('edit')}</button><button class="icon-button outlined" data-action="delete-folder" aria-label="删除目录" title="删除目录">${icon('trash')}</button><button class="button primary" data-action="new-project">${icon('plus')}新建项目</button></div>` : ''}</section>
    <div class="section-heading project-list-heading"><h2>学习项目 <span>${String(projects.length).padStart(2, '0')}</span></h2>${projects.length ? `<label class="search-box">${icon('search')}<input id="project-search" type="search" placeholder="搜索本目录项目" aria-label="搜索本目录项目" value="${esc(state.search)}"></label>` : ''}</div><div id="project-list"></div>`;
  renderProjectList();
}
function renderProjectList() {
  const all = projectsIn(state.folder);
  const query = state.search.trim().toLocaleLowerCase();
  const projects = all.filter(entry => [entry.title, entry.description, ...entry.questions.map(q => q.question)].some(text => text.toLocaleLowerCase().includes(query)));
  const container = document.querySelector('#project-list');
  if (!projects.length) {
    container.innerHTML = all.length ? empty('没有找到匹配项目', '试试其他关键词。') : empty('这里还没有学习项目', isAdmin ? '添加一段问题描述，再围绕它编写多组问答。' : '这个目录的内容正在等待整理。', isAdmin ? `<button class="button primary" data-action="new-project">${icon('plus')}添加第一个项目</button>` : '');
    return;
  }
  container.innerHTML = `<div class="project-list">${projects.map(project => `<button class="project-row" data-action="project" data-id="${project.id}"><span class="project-number">${number(all.indexOf(project))}</span><span class="project-summary"><strong>${esc(project.title)}</strong><span class="project-description">${rich(project.description || project.questions[0]?.question || '')}</span><span class="project-meta"><span>${project.questions.length} 组问答</span><span>更新于 ${esc(date(project.updatedAt))}</span></span></span><span class="row-action">${isAdmin ? '编辑项目' : '开始学习'}${icon('arrow')}</span></button>`).join('')}</div>`;
  math(container);
}
function questionsMarkup(questions, preview = false) {
  return questions.map((entry, index) => `<article class="question-card"><div class="question-top"><span class="question-label">问题 ${number(index)}</span><span class="question-dot"></span></div><div class="question-text">${rich(entry.question || (preview ? '在左侧输入问题…' : ''))}</div>
    <details class="answer-disclosure"><summary><span class="show-answer">${icon('eye')}点击查看答案</span><span class="hide-answer">${icon('check')}答案已展开 · 点击收起</span>${icon('down')}</summary><div class="answer-content"><span class="answer-label">参考答案</span>${rich(entry.answer || (preview ? '在左侧输入答案…' : ''))}</div></details></article>`).join('');
}
function renderStudy(project) {
  main.innerHTML = `${breadcrumb()}<div class="study-layout"><div class="study-content"><header class="study-heading"><span class="eyebrow">LEARN · THINK · UNDERSTAND</span><h1>${esc(project.title)}</h1><div class="study-meta"><span>${icon('book')}${project.questions.length} 组问答</span><span>更新于 ${esc(date(project.updatedAt))}</span></div></header>
    ${project.description ? `<section class="description-card"><div class="description-label"><span></span>问题描述</div>${rich(project.description)}</section>` : ''}
    <div class="questions-heading"><h2>思考与回答</h2><span id="revealed-count" aria-live="polite">已查看 0 / ${project.questions.length}</span></div><div class="questions-list">${questionsMarkup(project.questions)}</div>
    <div class="study-end"><span>— 每一次回忆，都让理解更深一点 —</span><button class="button secondary" data-action="folder" data-id="${project.directoryId}">${icon('back')}返回目录</button></div></div><aside class="study-aside"><span class="small-spark">✳</span><h3>先想一想，<br>再揭晓答案。</h3><p>不急着往下翻。<br>试着在心里说出答案，<br>再看看自己的理解。</p><div class="aside-divider"></div><span class="aside-small">一次一个问题<br>一点一滴积累</span></aside></div>`;
  math(main);
}
function blankQuestion() { return { question: '', answer: '' }; }
function markDirty() {
  state.dirty = true;
  const status = document.querySelector('#save-status');
  if (status) { status.textContent = '有未保存的修改'; status.classList.add('unsaved'); }
}
function renderEditor() {
  const draft = state.draft;
  main.innerHTML = `${breadcrumb()}<div class="editor-heading"><div><span class="eyebrow">MAKE KNOWLEDGE YOUR OWN</span><h1>${draft.id ? '编辑学习项目' : '新建学习项目'}</h1></div><div class="editor-heading-actions">${draft.id ? `<button class="icon-button outlined" data-action="delete-project" aria-label="删除项目" title="删除项目">${icon('trash')}</button>` : ''}<button class="button secondary" data-action="close-editor">返回目录</button></div></div>
    <form id="project-form"><div class="editor-layout"><div class="editor-fields"><section class="editor-card"><div class="editor-section-title"><span>01</span><h2>项目内容</h2></div>
      <label class="field-label" for="project-title">项目名称 <span class="required">*</span></label><input id="project-title" data-field="title" maxlength="120" required placeholder="给这个学习项目起一个名字" value="${esc(draft.title)}">
      <label class="field-label" for="project-directory">所属目录</label><select id="project-directory" data-field="directoryId">${state.data.directories.map(entry => `<option value="${entry.id}" ${entry.id === draft.directoryId ? 'selected' : ''}>${esc(entry.name)}</option>`).join('')}</select>
      <label class="field-label" for="project-description">问题描述 <span class="optional">选填</span></label><textarea id="project-description" data-field="description" rows="5" maxlength="20000" placeholder="介绍背景、已知条件或需要思考的内容，显示在所有问答上方。">${esc(draft.description)}</textarea>
      <p class="field-hint">${icon('edit')}用一对 <code>$</code> 包裹公式，例如 <code>$x^2 + y^2 = 1$</code>。</p></section>
      <div class="editor-questions-heading"><div class="editor-section-title"><span>02</span><h2>问题与答案</h2></div><span id="question-count" class="muted">${draft.questions.length} 组问答</span></div>
      <div id="question-editors"></div><button class="add-question" type="button" data-action="add-question">${icon('plus')}添加一组问答</button>
      <div class="editor-save-bar"><span id="save-status" class="${state.dirty ? 'unsaved' : ''}">${state.dirty ? '有未保存的修改' : draft.id ? '已保存' : '填写后保存到学习空间'}</span><button class="button primary" type="submit" id="save-project">${icon('check')}保存项目</button></div><p id="save-error" class="inline-error" role="alert" hidden></p></div>
      <aside class="preview-panel"><div class="preview-heading"><span>${icon('eye')}学习预览</span><span class="preview-dot">实时更新</span></div><div id="live-preview"></div><p class="preview-footnote">手机端默认隐藏答案，点击后展开。</p></aside></div></form>`;
  renderQuestionEditors();
  renderPreview();
}
function renderQuestionEditors() {
  document.querySelector('#question-editors').innerHTML = state.draft.questions.map((entry, index) => `<section class="editor-card question-editor" data-index="${index}"><div class="question-editor-heading"><span class="question-label">问答 ${number(index)}</span><div class="question-tools"><button type="button" class="icon-button" data-action="move-question-up" data-index="${index}" aria-label="上移第 ${index + 1} 组问答" ${index === 0 ? 'disabled' : ''}>${icon('up')}</button><button type="button" class="icon-button" data-action="move-question-down" data-index="${index}" aria-label="下移第 ${index + 1} 组问答" ${index === state.draft.questions.length - 1 ? 'disabled' : ''}>${icon('down')}</button><button type="button" class="icon-button" data-action="delete-question" data-index="${index}" aria-label="删除第 ${index + 1} 组问答" ${state.draft.questions.length === 1 ? 'disabled' : ''}>${icon('trash')}</button></div></div>
      <label class="field-label" for="question-${index}">问题 <span class="required">*</span></label><textarea id="question-${index}" data-question="${index}" data-key="question" rows="3" maxlength="20000" required placeholder="写下一个值得思考的问题…">${esc(entry.question)}</textarea>
      <label class="field-label" for="answer-${index}">答案 <span class="required">*</span></label><textarea id="answer-${index}" data-question="${index}" data-key="answer" rows="4" maxlength="50000" required placeholder="写下答案、推导过程或你的理解…">${esc(entry.answer)}</textarea></section>`).join('');
  document.querySelector('#question-count').textContent = `${state.draft.questions.length} 组问答`;
  const add = document.querySelector('[data-action="add-question"]');
  if (add) add.disabled = state.draft.questions.length >= 200;
}
function renderPreview() {
  const container = document.querySelector('#live-preview');
  if (!container || !state.draft) return;
  const opened = new Set([...container.querySelectorAll('details')].flatMap((element, index) => element.open ? [index] : []));
  const draft = state.draft;
  container.innerHTML = `<div class="preview-project-title">${esc(draft.title || '学习项目名称')}</div>${draft.description ? `<div class="preview-description"><span class="description-label">问题描述</span>${rich(draft.description)}</div>` : '<p class="preview-placeholder">问题描述会显示在这里。</p>'}<div class="preview-questions">${questionsMarkup(draft.questions, true)}</div>`;
  container.querySelectorAll('details').forEach((element, index) => { element.open = opened.has(index); });
  math(container);
}
function renderMissing(message) {
  main.innerHTML = empty('暂时找不到这份内容', message, '<button class="button primary" data-action="home">返回学习空间</button>');
}
function renderRoute() {
  if (!state.data) return;
  readRoute();
  state.draft = null;
  state.dirty = false;
  renderSidebar();
  if (state.project) {
    const project = state.data.projects.find(entry => entry.id === state.project);
    if (!project) renderMissing('这个项目不存在或已被删除。');
    else if (isAdmin) { state.draft = structuredClone(project); renderEditor(); }
    else renderStudy(project);
  } else if (state.folder) renderFolder();
  else renderOverview();
  const title = state.data.projects.find(entry => entry.id === state.project)?.title || folderById(state.folder)?.name;
  document.title = title ? `${title} · Answer` : `Answer · ${isAdmin ? '内容管理' : '学习空间'}`;
  window.scrollTo({ top: 0, behavior: 'instant' });
}
async function handleAction(button) {
  const action = button.dataset.action;
  if (action === 'home') return navigate(null, null);
  if (action === 'folder') return navigate(button.dataset.id, null);
  if (action === 'project') return navigate(state.folder, button.dataset.id);
  if (!isAdmin || state.saving) return;
  if (action === 'add-folder') {
    if (!(await canLeave())) return;
    const name = await modal({ title: '创建一个新目录', value: '', confirm: '创建目录' });
    if (!name) return;
    const folder = await mutation('/api/directories', 'POST', { name });
    state.dirty = false;
    await navigate(folder.id, null);
    toast('目录已创建');
  } else if (action === 'rename-folder') {
    const folder = folderById(state.folder);
    const name = await modal({ title: '重命名目录', value: folder.name, confirm: '保存名称' });
    if (!name || name === folder.name) return;
    await mutation(`/api/directories/${folder.id}`, 'PATCH', { name });
    renderRoute();
    toast('目录名称已更新');
  } else if (action === 'delete-folder') {
    const folder = folderById(state.folder);
    const count = projectsIn(folder.id).length;
    if (!(await modal({ title: '删除这个目录？', message: `「${folder.name}」${count ? `及其中的 ${count} 个项目和全部问答` : ''}将被删除，无法撤销。`, confirm: '删除目录', danger: true }))) return;
    await mutation(`/api/directories/${folder.id}`, 'DELETE');
    await navigate(null, null);
    toast('目录已删除');
  } else if (action === 'new-project') {
    if (!(await canLeave())) return;
    state.project = null;
    state.draft = { directoryId: state.folder, title: '', description: '', questions: [blankQuestion()] };
    state.dirty = false;
    renderEditor();
    document.querySelector('#project-title').focus();
  } else if (action === 'close-editor') {
    await navigate(state.folder, null);
  } else if (action === 'delete-project') {
    const draft = state.draft;
    if (!(await modal({ title: '删除这个学习项目？', message: `「${draft.title}」及其中全部问答将被删除，无法撤销。`, confirm: '删除项目', danger: true }))) return;
    await mutation(`/api/projects/${draft.id}`, 'DELETE');
    state.dirty = false;
    await navigate(state.folder, null);
    toast('项目已删除');
  } else if (action === 'add-question') {
    if (state.draft.questions.length >= 200) return;
    state.draft.questions.push(blankQuestion());
    markDirty();
    renderQuestionEditors();
    renderPreview();
    document.querySelector(`#question-${state.draft.questions.length - 1}`).focus();
  } else if (action === 'delete-question') {
    if (state.draft.questions.length <= 1) return;
    const index = Number(button.dataset.index);
    const question = state.draft.questions[index];
    if ((question.question || question.answer) && !(await modal({ title: '移除这组问答？', message: '保存项目后，这组问题和答案会从学习页面中移除。', confirm: '移除问答', danger: true }))) return;
    state.draft.questions.splice(index, 1);
    markDirty(); renderQuestionEditors(); renderPreview();
  } else if (action === 'move-question-up' || action === 'move-question-down') {
    const index = Number(button.dataset.index);
    const target = index + (action.endsWith('up') ? -1 : 1);
    if (target < 0 || target >= state.draft.questions.length) return;
    [state.draft.questions[index], state.draft.questions[target]] = [state.draft.questions[target], state.draft.questions[index]];
    markDirty(); renderQuestionEditors(); renderPreview();
    document.querySelector(`#question-${target}`).focus();
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  event.preventDefault();
  if (button.dataset.busy) return;
  button.dataset.busy = 'true';
  try { await handleAction(button); }
  catch (error) { toast(error.message, true); }
  finally { delete button.dataset.busy; }
});
document.addEventListener('click', async event => {
  const link = event.target.closest('a[href]');
  if (!link || !state.dirty || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  if (await canLeave()) { state.dirty = false; location.href = link.href; }
});
main.addEventListener('input', event => {
  const element = event.target;
  if (element.id === 'project-search') { state.search = element.value; renderProjectList(); return; }
  if (!state.draft || state.saving) return;
  if (element.dataset.field) state.draft[element.dataset.field] = element.value;
  else if (element.dataset.question !== undefined) state.draft.questions[Number(element.dataset.question)][element.dataset.key] = element.value;
  else return;
  markDirty();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 180);
});
main.addEventListener('submit', async event => {
  if (event.target.id !== 'project-form') return;
  event.preventDefault();
  if (state.saving) return;
  const draft = structuredClone(state.draft);
  const form = event.target;
  const errorBox = document.querySelector('#save-error');
  const saveButton = document.querySelector('#save-project');
  errorBox.hidden = true;
  state.saving = true;
  const controls = [...form.querySelectorAll('input, select, textarea, button')].map(element => ({ element, disabled: element.disabled }));
  controls.forEach(({ element }) => { element.disabled = true; });
  saveButton.textContent = '正在保存…';
  try {
    const saved = await mutation(draft.id ? `/api/projects/${draft.id}` : '/api/projects', draft.id ? 'PUT' : 'POST', draft);
    state.dirty = false;
    state.draft = structuredClone(saved);
    state.project = saved.id;
    state.folder = saved.directoryId;
    activeHash = route(saved.directoryId, saved.id);
    history.replaceState(null, '', activeHash);
    document.title = `${saved.title} · Answer`;
    renderSidebar();
    renderEditor();
    toast('项目已保存，手机端刷新即可查看');
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    toast(error.message, true);
    controls.forEach(({ element, disabled }) => { element.disabled = disabled; });
    saveButton.innerHTML = `${icon('check')}保存项目`;
  } finally { state.saving = false; }
});
main.addEventListener('toggle', event => {
  if (!event.target.matches('.answer-disclosure')) return;
  const count = document.querySelector('#revealed-count');
  if (count) count.textContent = `已查看 ${main.querySelectorAll('.answer-disclosure[open]').length} / ${main.querySelectorAll('.answer-disclosure').length}`;
}, true);
window.addEventListener('hashchange', async () => {
  if (!(await canLeave())) { history.replaceState(null, '', activeHash || location.pathname); return; }
  activeHash = location.hash;
  state.search = '';
  renderRoute();
});
window.addEventListener('beforeunload', event => {
  if (state.dirty || state.saving) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.draft) {
    event.preventDefault();
    if (!state.saving) document.querySelector('#project-form')?.requestSubmit();
  }
});

async function initialize() {
  document.body.classList.toggle('admin-mode', isAdmin);
  document.querySelector(isAdmin ? '#admin-link' : '#study-link').setAttribute('aria-current', 'page');
  document.querySelector('#workspace-label').textContent = isAdmin ? '内容管理工作台' : '个人学习空间';
  document.querySelector('#topbar-note').textContent = isAdmin ? '写下问题，留下思考' : '慢慢来，理解比记住更重要';
  try {
    state.data = await api('/api/data');
    renderRoute();
    if (typeof window.renderMathInElement !== 'function') toast('公式组件未加载，请刷新页面；当前显示公式原文。', true);
  } catch (error) {
    main.innerHTML = empty('暂时无法打开学习空间', error.message, '<button class="button primary" id="retry-load">重新加载</button>');
    document.querySelector('#retry-load').addEventListener('click', initialize);
  }
}
initialize();
