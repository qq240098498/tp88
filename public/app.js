// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
  selectedDepIds: new Set(),
  exportExcluded: { projects: new Set(), statuses: new Set(), licenses: new Set() },
  exportSnapshot: null,
};

// 导出面板里“未填许可”这个选项的取值，与服务端约定的写法一致
const EXPORT_LICENSE_NONE = '__none__';

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：项目区与依赖区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' ? target : target.querySelector('input, select');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 操作者名字记在浏览器里，刷新之后还在，保存时随请求一起带上
const OPERATOR_KEY = 'dep-ledger-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadProjects() {
  const payload = await request('/api/projects');
  state.projects = payload.projects || [];
  renderProjects();
  renderProjectOptions();
  renderExportChoices();
}

async function loadDeps() {
  const params = new URLSearchParams();
  const projectId = el('filter-project').value;
  const status = el('filter-status').value;
  const license = el('filter-license').value;
  const keyword = el('filter-keyword').value.trim();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  if (license) params.set('license', license);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/deps${query ? `?${query}` : ''}`);
  state.deps = payload.deps || [];
  state.licenses = payload.licenses || [];
  state.statuses = payload.statuses || [];
  renderDepFilterOptions();
  renderDeps();
  renderExportChoices();
}

function renderProjects() {
  const body = el('project-body');
  body.innerHTML = state.projects.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.owner) || '<span class="missing">未指定</span>'}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td>${item.depCount} 条</td>
      <td class="mono">${escapeHtml(formatTime(item.createdAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-project-rename="${escapeHtml(item.id)}">改名</button>
        <button type="button" class="link" data-project-owner="${escapeHtml(item.id)}">改负责人</button>
        <button type="button" class="link danger" data-project-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('project-empty').classList.toggle('hidden', state.projects.length > 0);
}

function renderProjectOptions() {
  const select = el('dep-project');
  const current = select.value;
  select.innerHTML = state.projects
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
  if (state.projects.some((item) => item.id === current)) select.value = current;

  const filter = el('filter-project');
  const filterCurrent = filter.value;
  filter.innerHTML = '<option value="">全部项目</option>'
    + state.projects.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (state.projects.some((item) => item.id === filterCurrent)) filter.value = filterCurrent;
}

function renderDepFilterOptions() {
  const statusSelect = el('filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const licenseSelect = el('filter-license');
  const licenseCurrent = licenseSelect.value;
  licenseSelect.innerHTML = '<option value="">全部许可</option>'
    + state.licenses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.licenses.includes(licenseCurrent)) licenseSelect.value = licenseCurrent;

  const statusForm = el('dep-status');
  const statusFormCurrent = statusForm.value;
  statusForm.innerHTML = state.statuses
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join('');
  if (state.statuses.includes(statusFormCurrent)) statusForm.value = statusFormCurrent;
}

function projectName(projectId) {
  const found = state.projects.find((item) => item.id === projectId);
  return found ? found.name : projectId;
}

function renderDeps() {
  const body = el('dep-body');
  body.innerHTML = state.deps.map((item) => {
    const statusTag = item.status === '已弃用' ? 'off' : 'on';
    return `<tr>
      <td class="check-cell"><input type="checkbox" data-dep-check="${escapeHtml(item.id)}" ${state.selectedDepIds.has(item.id) ? 'checked' : ''} aria-label="选择 ${escapeHtml(item.name)}"></td>
      <td>${escapeHtml(projectName(item.projectId))}</td>
      <td class="mono">${escapeHtml(item.name)}</td>
      <td class="mono">${escapeHtml(item.version)}</td>
      <td>${item.license ? escapeHtml(item.license) : '<span class="missing">未填</span>'}</td>
      <td>${item.owner ? escapeHtml(item.owner) : '<span class="missing">未指定</span>'}</td>
      <td><span class="tag ${statusTag}">${escapeHtml(item.status)}</span></td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-dep-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-dep-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('dep-empty').classList.toggle('hidden', state.deps.length > 0);
  syncCheckAll();
}

// 表头全选框跟随当前列表的勾选情况：全勾、全没勾、勾了一部分三种样子
function syncCheckAll() {
  const box = el('dep-check-all');
  const total = state.deps.length;
  const checked = state.deps.filter((item) => state.selectedDepIds.has(item.id)).length;
  box.checked = total > 0 && checked === total;
  box.indeterminate = checked > 0 && checked < total;
}

function updateSelectedCount() {
  el('export-selected-count').textContent = String(state.selectedDepIds.size);
}

// 导出面板里的三组勾选项：默认全选，取消过的项记在 exportExcluded 里，列表刷新后保持
function renderChoiceGroup(id, options, group) {
  const excluded = state.exportExcluded[group];
  el(id).innerHTML = options
    .map((opt) => `<label class="chip"><input type="checkbox" data-export-exclude="${group}" value="${escapeHtml(opt.value)}" ${excluded.has(opt.value) ? '' : 'checked'}> ${escapeHtml(opt.label)}</label>`)
    .join('');
}

function renderExportChoices() {
  renderChoiceGroup('export-projects', state.projects.map((item) => ({ value: item.id, label: item.name })), 'projects');
  renderChoiceGroup('export-statuses', state.statuses.map((item) => ({ value: item, label: item })), 'statuses');
  const licenseOptions = state.licenses.map((item) => ({ value: item, label: item }));
  licenseOptions.push({ value: EXPORT_LICENSE_NONE, label: '未填' });
  renderChoiceGroup('export-licenses', licenseOptions, 'licenses');
}

// 条件或勾选一变，之前的预演就不能再确认了，避免导出的不是看到的
function invalidateExport() {
  const hadSnapshot = Boolean(state.exportSnapshot);
  state.exportSnapshot = null;
  el('export-confirm').disabled = true;
  if (hadSnapshot) {
    const box = el('export-result');
    box.className = 'export-result stale';
    box.textContent = '导出条件或勾选有变化，请重新预演';
  }
}

function checkedValues(id) {
  return Array.from(document.querySelectorAll(`#${id} input[type="checkbox"]:checked`)).map((node) => node.value);
}

function readExportCriteria() {
  const modeNode = document.querySelector('input[name="export-mode"]:checked');
  const mode = modeNode ? modeNode.value : 'filtered';
  if (mode === 'selected') return { depIds: Array.from(state.selectedDepIds) };
  return {
    projectIds: checkedValues('export-projects'),
    statuses: checkedValues('export-statuses'),
    licenses: checkedValues('export-licenses'),
  };
}

async function runExportPreview() {
  clearNotice();
  const criteria = readExportCriteria();
  if (criteria.depIds && !criteria.depIds.length) {
    notify('请先在列表里勾选要导出的登记', 'error');
    return;
  }
  try {
    const payload = await request('/api/deps/export/preview', {
      method: 'POST',
      body: JSON.stringify({ ...criteria, operator: currentOperator() }),
    });
    state.exportSnapshot = payload;
    renderExportPreview(payload);
    el('export-confirm').disabled = false;
  } catch (err) {
    state.exportSnapshot = null;
    el('export-confirm').disabled = true;
    notify(err.message, 'error');
  }
}

function renderExportPreview(preview) {
  const box = el('export-result');
  const byProject = preview.byProject.map((item) => `${escapeHtml(item.name)} ${item.count} 条`).join('、');
  const byLicense = preview.byLicense.map((item) => `${escapeHtml(item.license || '未填')} ${item.count} 条`).join('、');
  const missingLicense = preview.missingLicense.length
    ? `未填许可 ${preview.missingLicense.length} 条：${preview.missingLicense.map((item) => `${escapeHtml(item.name)}（${escapeHtml(item.project)}）`).join('、')}`
    : '许可都已填写';
  const missingOwner = preview.missingOwner.length
    ? `未填责任人 ${preview.missingOwner.length} 条：${preview.missingOwner.map((item) => `${escapeHtml(item.name)}（${escapeHtml(item.project)}）`).join('、')}`
    : '责任人都已填写';
  box.className = 'export-result';
  box.innerHTML = `<p><strong>预演结果：共 ${preview.total} 条</strong></p>
    <p>按项目：${byProject}</p>
    <p>按许可：${byLicense}</p>
    <p>${missingLicense}</p>
    <p>${missingOwner}</p>
    <p class="export-hint">确认无误后点「确认导出」生成文件</p>`;
}

async function runExportConfirm() {
  const snapshot = state.exportSnapshot;
  if (!snapshot) {
    notify('请先预演，核对数量后再导出', 'error');
    return;
  }
  const button = el('export-confirm');
  button.disabled = true;
  try {
    const payload = await request('/api/deps/export', {
      method: 'POST',
      body: JSON.stringify({ snapshotId: snapshot.snapshotId }),
    });
    downloadTextFile(payload.fileName, payload.content);
    renderExportDone(payload);
    notify(`已导出 ${payload.total} 条依赖登记`, 'ok');
  } catch (err) {
    notify(err.message, 'error');
    if (err.code === 'EXPORT_SNAPSHOT_NOT_FOUND') state.exportSnapshot = null;
  } finally {
    button.disabled = !state.exportSnapshot;
  }
}

// 导出完成后把条数与按项目的分布贴出来，数字与预演出自同一个快照，一定对得上
function renderExportDone(payload) {
  const box = el('export-result');
  const byProject = payload.byProject.map((item) => `${item.name} ${item.count} 条`).join('、');
  const line = document.createElement('p');
  line.className = 'export-done';
  line.textContent = `已导出 ${payload.total} 条（按项目：${byProject}），文件：${payload.fileName}`;
  box.appendChild(line);
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function openDepForm(dep) {
  state.editingId = dep ? dep.id : '';
  el('dep-form-title').textContent = dep ? `编辑登记：${dep.name}` : '新建登记';
  if (state.projects.length) {
    el('dep-project').value = dep ? dep.projectId : state.projects[0].id;
  }
  el('dep-name').value = dep ? dep.name : '';
  el('dep-version').value = dep ? dep.version : '';
  el('dep-license').value = dep ? dep.license : '';
  el('dep-owner').value = dep ? dep.owner : currentOperator();
  el('dep-status').value = dep ? dep.status : (state.statuses[0] || '在用');
  el('dep-note').value = dep ? dep.note : '';
  el('dep-form').classList.remove('hidden');
  el('dep-name').focus();
}

function closeDepForm() {
  state.editingId = '';
  el('dep-form').classList.add('hidden');
  clearFieldMarks();
}

async function submitProject(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    name: el('project-name').value,
    owner: el('project-owner').value,
    note: el('project-note').value,
  };
  try {
    await request('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
    el('project-name').value = '';
    el('project-owner').value = '';
    el('project-note').value = '';
    notify('项目已新增', 'ok');
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitDep(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    projectId: el('dep-project').value,
    name: el('dep-name').value,
    version: el('dep-version').value,
    license: el('dep-license').value,
    owner: el('dep-owner').value,
    status: el('dep-status').value,
    note: el('dep-note').value,
  };
  const editing = state.editingId;
  try {
    if (editing) {
      await request(`/api/deps/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('依赖登记已保存', 'ok');
    } else {
      await request('/api/deps', { method: 'POST', body: JSON.stringify(payload) });
      notify('依赖登记已新增', 'ok');
    }
    closeDepForm();
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  const projectId = node.dataset.projectRename || node.dataset.projectOwner || node.dataset.projectDelete;
  if (projectId) {
    clearNotice();
    const found = state.projects.find((item) => item.id === projectId);
    if (!found) return;
    try {
      if (node.dataset.projectRename) {
        const next = window.prompt(`把 ${found.name} 的名称改成`, found.name);
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
        notify('项目名称已更新', 'ok');
      } else if (node.dataset.projectOwner) {
        const next = window.prompt(`把 ${found.name} 的负责人改成`, found.owner || '');
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ owner: next }) });
        notify('项目负责人已更新', 'ok');
      } else {
        if (!window.confirm(`确定删除项目 ${found.name} 吗？`)) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        notify('项目已删除', 'ok');
      }
      await loadProjects();
      await loadDeps();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.depEdit) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depEdit);
    if (found) openDepForm(found);
    return;
  }

  if (node.dataset.depDelete) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depDelete);
    if (!window.confirm(`确定删除登记 ${found ? found.name : ''} 吗？`)) return;
    try {
      await request(`/api/deps/${encodeURIComponent(node.dataset.depDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.depDelete) closeDepForm();
      notify('登记已删除', 'ok');
      await loadProjects();
      await loadDeps();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// 勾选与导出条件的变化统一在这里处理：行勾选决定“只带其中几条”，条件一变预演就作废
document.addEventListener('change', (event) => {
  const node = event.target;

  if (node.id === 'dep-check-all') {
    state.deps.forEach((item) => {
      if (node.checked) state.selectedDepIds.add(item.id);
      else state.selectedDepIds.delete(item.id);
    });
    renderDeps();
    afterSelectionChange();
    return;
  }

  if (node.matches('[data-dep-check]')) {
    if (node.checked) state.selectedDepIds.add(node.dataset.depCheck);
    else state.selectedDepIds.delete(node.dataset.depCheck);
    syncCheckAll();
    afterSelectionChange();
    return;
  }

  if (node.closest('#export-panel')) {
    const group = node.dataset.exportExclude;
    if (group && state.exportExcluded[group]) {
      if (node.checked) state.exportExcluded[group].delete(node.value);
      else state.exportExcluded[group].add(node.value);
    }
    invalidateExport();
  }
});

// 勾选了条目就默认切到“只导出勾选的条目”，勾选数同步到面板上
function afterSelectionChange() {
  updateSelectedCount();
  if (state.selectedDepIds.size) {
    const radio = document.querySelector('input[name="export-mode"][value="selected"]');
    if (radio) radio.checked = true;
  }
  invalidateExport();
}

el('project-form').addEventListener('submit', submitProject);
el('dep-form').addEventListener('submit', submitDep);
el('dep-new').addEventListener('click', () => {
  clearNotice();
  if (!state.projects.length) {
    notify('请先登记一个项目，再登记依赖', 'error');
    return;
  }
  openDepForm(null);
});
el('dep-cancel').addEventListener('click', closeDepForm);
el('dep-export').addEventListener('click', () => {
  clearNotice();
  el('export-panel').classList.toggle('hidden');
});
el('export-close').addEventListener('click', () => {
  el('export-panel').classList.add('hidden');
});
el('export-preview').addEventListener('click', runExportPreview);
el('export-confirm').addEventListener('click', runExportConfirm);
el('export-clear').addEventListener('click', () => {
  state.selectedDepIds.clear();
  renderDeps();
  updateSelectedCount();
  invalidateExport();
});
el('filter-apply').addEventListener('click', () => {
  clearNotice();
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-reset').addEventListener('click', () => {
  el('filter-project').value = '';
  el('filter-status').value = '';
  el('filter-license').value = '';
  el('filter-keyword').value = '';
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('dep-refresh').addEventListener('click', () => {
  clearNotice();
  loadProjects()
    .then(loadDeps)
    .catch((err) => notify(err.message, 'error'));
});
el('filter-project').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-status').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-license').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .catch((err) => notify(err.message, 'error'));
