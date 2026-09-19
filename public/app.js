// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
};

// 一次导出会话：弹层打开时把全量数据冻成快照，预演、成文、完成提示都只看这份快照。
// lastFile 按勾选范围缓存已经生成的文件，同一会话里同一范围点两次，拿到的是同一个产物。
const exportState = {
  snapshot: null,
  options: null,
  pageFilters: { projectId: '', status: '', license: '', keyword: '' },
  lastFile: null,
};

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
}

async function loadDeps() {
  const params = new URLSearchParams();
  const projectId = el('filter-project').value;
  const status = el('filter-status').value;
  const license = el('filter-license').value;
  const keyword = el('filter-keyword').value.trim();
  // 记下页面当前筛选，导出弹层打开时按这份勾选做默认值
  exportState.pageFilters = { projectId, status, license, keyword };
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

// ===== 导出清单 =====

const MISSING_LIST_CAP = 20;

function listMissing(items) {
  const shown = items.slice(0, MISSING_LIST_CAP)
    .map((item) => `<li>${escapeHtml(item.projectName)} / <span class="preview-name">${escapeHtml(item.name)}</span></li>`)
    .join('');
  const rest = items.length > MISSING_LIST_CAP
    ? `<li>……另有 ${items.length - MISSING_LIST_CAP} 条未列出</li>` : '';
  return `<ul>${shown}${rest}</ul>`;
}

function countBlock(title, entries) {
  const rows = entries.map(([name, count]) => `<li>${escapeHtml(name)}：${count} 条</li>`).join('');
  return `<div class="preview-col"><h4>${escapeHtml(title)}</h4><ul>${rows}</ul></div>`;
}

// 预演内容与最终文件出自同一份快照、同一组勾选，数字必然一致
function renderExportPreview() {
  const scope = readExportScope();
  const summary = DepExport.summarize(exportState.snapshot, scope);
  const box = el('export-preview');

  // 勾选一变，上一范围的导出完成提示就先收起来，免得和新预演对不上
  const result = el('export-result');
  if (!result.classList.contains('hidden')) {
    result.className = 'export-result hidden';
    result.textContent = '';
    exportState.lastFile = null;
  }

  if (!summary.total) {
    box.innerHTML = '<p class="preview-empty">当前勾选范围内没有任何条目，请调整勾选后再导出。</p>';
    return summary;
  }

  const warnLicense = summary.missingLicense.length
    ? `<div class="preview-warn"><b>${summary.missingLicense.length} 条还没写许可：</b>${listMissing(summary.missingLicense)}</div>`
    : '';
  const warnOwner = summary.missingOwner.length
    ? `<div class="preview-warn"><b>${summary.missingOwner.length} 条还没写责任人：</b>${listMissing(summary.missingOwner)}</div>`
    : '';

  box.innerHTML = `
    <div class="preview-total">本次将导出 ${summary.total} 条</div>
    <div class="preview-cols">
      ${countBlock('按项目', summary.projectCounts)}
      ${countBlock('按许可', summary.licenseCounts)}
    </div>
    ${warnLicense}
    ${warnOwner}`;
  return summary;
}

function renderExportChecks() {
  const options = exportState.options;

  el('export-projects').innerHTML = options.projects.map((item) => `
    <label><input type="checkbox" name="export-project" value="${escapeHtml(item.value)}">
      ${escapeHtml(item.name)} <span class="check-count">${item.count} 条</span></label>`).join('');

  const statusCounts = DepExport.summarize(exportState.snapshot, {}).statusCounts;
  el('export-statuses').innerHTML = options.statuses.map((name) => {
    const hit = statusCounts.find(([key]) => key === name);
    return `<label><input type="checkbox" name="export-status" value="${escapeHtml(name)}">
      ${escapeHtml(name)} <span class="check-count">${hit ? hit[1] : 0} 条</span></label>`;
  }).join('');

  el('export-licenses').innerHTML = options.licenses.map((item) => `
    <label><input type="checkbox" name="export-license" value="${escapeHtml(item.value)}">
      ${escapeHtml(item.name)} <span class="check-count">${item.count} 条</span></label>`).join('');
}

function checkedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((node) => node.value);
}

function setCheckedValues(name, values) {
  const wanted = new Set(values);
  document.querySelectorAll(`input[name="${name}"]`).forEach((node) => {
    node.checked = wanted.has(node.value);
  });
}

function readExportScope() {
  return {
    projectIds: checkedValues('export-project'),
    statuses: checkedValues('export-status'),
    licenses: checkedValues('export-license'),
    keyword: el('export-keyword').value.trim(),
  };
}

function applyPageFiltersToChecks() {
  const filters = exportState.pageFilters;
  setCheckedValues('export-project', filters.projectId ? [filters.projectId] : []);
  setCheckedValues('export-status', filters.status ? [filters.status] : []);
  // 页面筛选没有“未填许可”这一项，许可下拉选到具体值时才勾选
  setCheckedValues('export-license', filters.license ? [filters.license] : []);
  el('export-keyword').value = filters.keyword;
}

function triggerDownload(file) {
  const blob = new Blob([file.bytes], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 浏览器接住下载后再回收地址，避免某些浏览器下到一半地址失效
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 打开弹层时重新拉一份不带任何筛选的全量数据冻成快照，这次导出的预演与文件都以它为准
async function openExportModal() {
  clearNotice();
  try {
    const payload = await request('/api/deps');
    exportState.snapshot = DepExport.normalizeSnapshot({
      projects: payload.projects || [],
      deps: payload.deps || [],
    });
    exportState.options = DepExport.snapshotOptions(exportState.snapshot);
    exportState.lastFile = null;
  } catch (err) {
    notify(err.message, 'error');
    return;
  }

  el('export-result').className = 'export-result hidden';
  el('export-result').textContent = '';
  renderExportChecks();
  applyPageFiltersToChecks();
  renderExportPreview();
  el('export-modal').classList.remove('hidden');
}

function closeExportModal() {
  el('export-modal').classList.add('hidden');
  exportState.lastFile = null;
}

function confirmExport() {
  const scope = readExportScope();
  const summary = DepExport.summarize(exportState.snapshot, scope);
  if (!summary.total) {
    renderExportPreview();
    return;
  }

  // 同一范围在本次会话里只生成一次：第二次点击直接重发同一个文件，
  // 文件名里的时刻与文件内容都不会变
  const cacheKey = JSON.stringify(DepExport.normalizeScope(scope));
  if (!exportState.lastFile || exportState.lastFile.key !== cacheKey) {
    const moment = new Date(); // 时刻在首次确认时冻结，之后重复点击不再变化
    exportState.lastFile = {
      key: cacheKey,
      scope,
      summary,
      file: DepExport.buildFile(exportState.snapshot, scope, moment),
    };
  }
  const cached = exportState.lastFile;
  triggerDownload(cached.file);

  // 完成提示的数字直接取自同一份汇总，和预演、文件三处对齐
  const perProject = cached.summary.projectCounts
    .map(([name, count]) => `${name} ${count} 条`).join('、');
  const result = el('export-result');
  result.className = 'export-result ok';
  result.innerHTML = `已导出 <b>${cached.summary.total}</b> 条，文件 <span class="preview-name">${escapeHtml(cached.file.fileName)}</span> 已开始下载。<br>按项目：${escapeHtml(perProject)}。`;
}

el('dep-export').addEventListener('click', openExportModal);
el('export-close').addEventListener('click', closeExportModal);
el('export-cancel').addEventListener('click', closeExportModal);
el('export-modal').addEventListener('click', (event) => {
  if (event.target === el('export-modal')) closeExportModal();
});
el('export-apply-page').addEventListener('click', () => {
  applyPageFiltersToChecks();
  renderExportPreview();
});
el('export-clear-all').addEventListener('click', () => {
  setCheckedValues('export-project', []);
  setCheckedValues('export-status', []);
  setCheckedValues('export-license', []);
  el('export-keyword').value = '';
  renderExportPreview();
});
el('export-modal').addEventListener('change', (event) => {
  if (event.target.matches('input[name^="export-"]')) renderExportPreview();
});
el('export-keyword').addEventListener('input', renderExportPreview);
el('export-confirm').addEventListener('click', confirmExport);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el('export-modal').classList.contains('hidden')) closeExportModal();
});

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .catch((err) => notify(err.message, 'error'));
