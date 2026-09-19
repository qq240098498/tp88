// 依赖清单导出：预演时把符合条件的登记冻结成快照，导出只认快照，
// 所以同一次导出重复执行，得到的文件名与文件内容完全一样
const crypto = require('crypto');
const { load } = require('./store');
const { ApiError, pickText } = require('./errors');

// 页面上“未填许可”这个选项的取值；许可登记口径里不会出现这种写法，不会撞名
const LICENSE_NONE = '__none__';
// 快照只留在内存里，半小时有效；超时或服务重启后需要重新预演
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_LIMIT = 50;
const snapshots = new Map();

function gcSnapshots() {
  const now = Date.now();
  Array.from(snapshots.entries()).forEach(([id, snapshot]) => {
    if (now - snapshot.createdMs > SNAPSHOT_TTL_MS) snapshots.delete(id);
  });
  while (snapshots.size > SNAPSHOT_LIMIT) {
    snapshots.delete(snapshots.keys().next().value);
  }
}

// 条件数组：没给表示这一维不限制；给了（哪怕是空数组）就按成员关系过滤
function readStringList(value, field) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'EXPORT_CRITERIA_INVALID', '导出条件的格式不对，需要是数组', field);
  }
  return value.map((item) => pickText(item)).filter(Boolean);
}

// 指定了具体登记就按登记走，项目、状态、许可条件不再参与
function selectDeps(data, input) {
  const depIds = readStringList(input.depIds, 'depIds');
  if (depIds && depIds.length) {
    const wanted = new Set(depIds);
    return data.deps.filter((item) => wanted.has(item.id));
  }
  const projectIds = readStringList(input.projectIds, 'projectIds');
  const statuses = readStringList(input.statuses, 'statuses');
  const licenses = readStringList(input.licenses, 'licenses');
  let list = data.deps;
  if (projectIds) list = list.filter((item) => projectIds.includes(item.projectId));
  if (statuses) list = list.filter((item) => statuses.includes(item.status));
  if (licenses) {
    const named = new Set(licenses.filter((item) => item !== LICENSE_NONE));
    const allowEmpty = licenses.includes(LICENSE_NONE);
    list = list.filter((item) => (item.license ? named.has(item.license) : allowEmpty));
  }
  return list;
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

// 文件名里的时刻，例如 20260918-143005，按本机时间
function formatStamp(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

// 文件内容里的时刻，例如 2026-09-18 14:30:05
function formatTime(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function sanitizeFilePart(text) {
  return String(text).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || '未命名';
}

// 文件名要能看出导出时刻与覆盖的项目；项目太多时只写前两个，其余折算成“等 N 个项目”
function buildFileName(snapshot) {
  const names = snapshot.projectsCovered.map(sanitizeFilePart);
  let scope = names.join('-');
  if (names.length > 3) scope = `${names.slice(0, 2).join('-')}-等${names.length}个项目`;
  if (scope.length > 60) scope = `${scope.slice(0, 60)}等${names.length}个项目`;
  return `deps-export-${formatStamp(snapshot.createdAt)}-${scope}.md`;
}

// 表格单元格里出现的竖线与换行要处理掉，不然 Markdown 表格会散架
function mdCell(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/\|/g, '\\|')
    .replace(/\s*\r?\n+\s*/g, ' ');
}

function renderMarkdown(snapshot) {
  const { summary } = snapshot;
  const lines = [];
  lines.push('# 依赖清单导出');
  lines.push('');
  lines.push(`- 导出时间：${formatTime(snapshot.createdAt)}`);
  if (snapshot.operator) lines.push(`- 导出人：${snapshot.operator}`);
  lines.push(`- 覆盖项目：${snapshot.projectsCovered.join('、')}`);
  lines.push(`- 依赖条数：共 ${summary.total} 条`);
  lines.push('');
  lines.push('## 按项目统计');
  lines.push('');
  summary.byProject.forEach((item) => lines.push(`- ${item.name}：${item.count} 条`));
  lines.push('');
  lines.push('## 按许可统计');
  lines.push('');
  summary.byLicense.forEach((item) => lines.push(`- ${item.license || '（未填）'}：${item.count} 条`));
  lines.push('');
  if (summary.missingLicense.length || summary.missingOwner.length) {
    lines.push('## 待补信息');
    lines.push('');
    if (summary.missingLicense.length) {
      lines.push(`- 未填许可 ${summary.missingLicense.length} 条：${summary.missingLicense.map((item) => `${item.name}（${item.project}）`).join('、')}`);
    }
    if (summary.missingOwner.length) {
      lines.push(`- 未填责任人 ${summary.missingOwner.length} 条：${summary.missingOwner.map((item) => `${item.name}（${item.project}）`).join('、')}`);
    }
    lines.push('');
  }
  lines.push('## 依赖明细');
  lines.push('');
  lines.push('| 项目 | 依赖名称 | 版本 | 许可 | 责任人 | 状态 | 备注 | 更新时间 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  snapshot.rows.forEach((row) => {
    lines.push(`| ${mdCell(row.projectName)} | ${mdCell(row.name)} | ${mdCell(row.version)} | ${mdCell(row.license || '（未填）')} | ${mdCell(row.owner || '（未指定）')} | ${mdCell(row.status)} | ${mdCell(row.note)} | ${mdCell(formatTime(row.updatedAt))} |`);
  });
  lines.push('');
  return lines.join('\n');
}

// 预演：按条件挑出登记，冻结成快照，返回条数统计与待补信息
function previewExport(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const projectById = new Map(data.projects.map((item) => [item.id, item]));
  const picked = selectDeps(data, input);
  if (!picked.length) {
    throw new ApiError(400, 'EXPORT_EMPTY', '当前条件下没有可导出的依赖登记', '');
  }

  const rows = picked
    .map((item) => ({
      id: item.id,
      projectId: item.projectId,
      projectName: (projectById.get(item.projectId) || {}).name || item.projectId,
      name: item.name,
      version: item.version,
      license: item.license,
      owner: item.owner,
      status: item.status,
      note: item.note,
      updatedAt: item.updatedAt,
    }))
    .sort((a, b) => {
      if (a.projectName !== b.projectName) return a.projectName < b.projectName ? -1 : 1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const projectCounts = new Map();
  const licenseCounts = new Map();
  const missingLicense = [];
  const missingOwner = [];
  rows.forEach((row) => {
    projectCounts.set(row.projectName, (projectCounts.get(row.projectName) || 0) + 1);
    licenseCounts.set(row.license, (licenseCounts.get(row.license) || 0) + 1);
    if (!row.license) missingLicense.push({ id: row.id, name: row.name, project: row.projectName });
    if (!row.owner) missingOwner.push({ id: row.id, name: row.name, project: row.projectName });
  });

  const byProject = Array.from(projectCounts, ([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const byLicense = Array.from(licenseCounts, ([license, count]) => ({ license, count }))
    .sort((a, b) => {
      if (!a.license) return 1;
      if (!b.license) return -1;
      return a.license < b.license ? -1 : 1;
    });

  const snapshot = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    createdMs: Date.now(),
    operator: pickText(input.operator).slice(0, 40),
    rows,
    projectsCovered: Array.from(new Set(rows.map((row) => row.projectName))),
    summary: { total: rows.length, byProject, byLicense, missingLicense, missingOwner },
  };
  gcSnapshots();
  snapshots.set(snapshot.id, snapshot);
  return { snapshotId: snapshot.id, ...snapshot.summary };
}

// 导出：只认预演留下的快照，同一快照重复导出，文件名与内容都一致
function exportDeps(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const snapshotId = pickText(input.snapshotId);
  if (!snapshotId) throw new ApiError(400, 'EXPORT_SNAPSHOT_REQUIRED', '请先预演，再确认导出', '');
  gcSnapshots();
  const snapshot = snapshots.get(snapshotId);
  if (!snapshot) {
    throw new ApiError(404, 'EXPORT_SNAPSHOT_NOT_FOUND', '这次预演已经过期，请重新预演后再导出', '');
  }
  return {
    fileName: buildFileName(snapshot),
    content: renderMarkdown(snapshot),
    exportedAt: snapshot.createdAt,
    ...snapshot.summary,
  };
}

module.exports = {
  previewExport,
  exportDeps,
};
