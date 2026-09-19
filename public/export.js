// 导出功能的全部纯逻辑：范围归一化、筛选、排序、汇总、成文与文件名都在这里。
// 页面预演、真正下载与命令行测试共用这一份，保证三处看到的数字与内容必然一致。
//
// 关键约定：一次导出对应一份调用方冻结好的快照（全部项目与全部依赖登记），
// 同一份快照、同一组范围，无论调用多少次，结果都完全相同。

(function initExportModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // 给 Node 下的测试用
  }
  if (root) {
    root.DepExport = api; // 给页面用
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createExportModule() {
  'use strict';

  // 许可在登记里留空时统一用这个名字展示与参与筛选
  const NO_LICENSE = '未填许可';
  const NO_LICENSE_VALUE = '__NONE__';
  // 状态统计按业务口径固定顺序，其余没见过的状态排在后面
  const STATUS_ORDER = ['在用', '待升', '已弃用'];
  const CRLF = '\r\n';
  const BOM = '\uFEFF'; // UTF-8 文件头，让记事本/Excel 打开不乱码

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function sortText(list) {
    return list.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function countBy(list, pick) {
    const counts = new Map();
    list.forEach((item) => {
      const key = pick(item);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function sortedCountEntries(counts) {
    return Array.from(counts.entries()).sort((a, b) => (
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  // 状态计数按在用、待升、已弃用的固定顺序呈现
  function sortedStatusEntries(counts) {
    return Array.from(counts.entries()).sort((a, b) => {
      const ia = STATUS_ORDER.indexOf(a[0]);
      const ib = STATUS_ORDER.indexOf(b[0]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
  }

  // 快照只取成文与统计需要的字段，排好固定顺序，避免输入数组顺序影响结果
  function normalizeSnapshot(input) {
    const source = input && typeof input === 'object' ? input : {};
    const projects = asArray(source.projects)
      .map((item) => ({
        id: asText(item && item.id),
        name: asText(item && item.name) || asText(item && item.id) || '未命名项目',
        owner: asText(item && item.owner),
      }))
      .filter((item) => item.id);

    const projectIds = new Set(projects.map((item) => item.id));
    const sortedProjects = sortProjects(projects);
    const projectNameById = new Map(sortedProjects.map((item) => [item.id, item.name]));
    const deps = asArray(source.deps)
      .map((item) => ({
        id: asText(item && item.id),
        projectId: asText(item && item.projectId),
        name: asText(item && item.name),
        version: asText(item && item.version),
        license: asText(item && item.license),
        owner: asText(item && item.owner),
        status: asText(item && item.status),
        note: asText(item && item.note),
        updatedAt: asText(item && item.updatedAt),
      }))
      .filter((item) => item.id && item.name && projectIds.has(item.projectId))
      .sort((a, b) => compareDep(a, b, (id) => projectNameById.get(id) || id));

    return { projects: sortedProjects, deps };
  }

  function sortProjects(list) {
    return list.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  }

  // 与项目清单一样按项目名排序，同一项目内再按依赖名，id 兜底保证顺序稳定
  function compareDep(a, b, nameOf) {
    const pa = nameOf(a.projectId);
    const pb = nameOf(b.projectId);
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  // 快照里可供选择的项目、状态、许可，勾选项就来自这份清单
  function snapshotOptions(snapshot) {
    const statusCounts = countBy(snapshot.deps, (item) => item.status);
    const statuses = sortedStatusEntries(statusCounts)
      .filter(([name]) => name)
      .map(([name]) => name);

    const namedLicenses = sortText(Array.from(new Set(
      snapshot.deps.map((item) => item.license).filter(Boolean),
    )));
    const licenses = namedLicenses.map((name) => ({ value: name, name, count: 0 }));
    if (snapshot.deps.some((item) => !item.license)) {
      licenses.push({ value: NO_LICENSE_VALUE, name: NO_LICENSE, count: 0 });
    }
    const licenseCounts = countBy(
      snapshot.deps,
      (item) => (item.license || NO_LICENSE_VALUE),
    );
    licenses.forEach((item) => {
      item.count = licenseCounts.get(item.value) || 0;
    });

    const projects = snapshot.projects.map((item) => ({
      value: item.id,
      name: item.name,
      count: snapshot.deps.filter((dep) => dep.projectId === item.id).length,
    }));

    return { projects, statuses, licenses };
  }

  // 把页面勾选的范围整理成固定结构；没有勾的维度视作不限（整个维度都带走）
  function normalizeScope(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const clean = (list) => Array.from(new Set(asArray(list).map(asText).filter(Boolean))).sort();
    return {
      projectIds: clean(input.projectIds),
      statuses: clean(input.statuses),
      licenses: clean(input.licenses),
      keyword: asText(input.keyword).toLowerCase(),
    };
  }

  function scopeIsEmpty(snapshot, scope) {
    if (scope.projectIds.some((id) => !snapshot.projects.some((item) => item.id === id))) return true;
    if (scope.licenses.some((value) => value !== NO_LICENSE_VALUE
      && !snapshot.deps.some((item) => item.license === value))) return true;
    if (scope.statuses.some((value) => !snapshot.deps.some((item) => item.status === value))) return true;
    return false;
  }

  // 按范围从快照里挑条目，顺序在 normalizeSnapshot 时已经固定
  function selectDeps(snapshot, rawScope) {
    const scope = normalizeScope(rawScope);
    if (scopeIsEmpty(snapshot, scope)) return [];
    return snapshot.deps.filter((item) => {
      if (scope.projectIds.length && !scope.projectIds.includes(item.projectId)) return false;
      if (scope.statuses.length && !scope.statuses.includes(item.status)) return false;
      if (scope.licenses.length) {
        const licenseKey = item.license || NO_LICENSE_VALUE;
        if (!scope.licenses.includes(licenseKey)) return false;
      }
      if (scope.keyword) {
        const haystack = `${item.name}\n${item.owner}\n${item.note}`.toLowerCase();
        if (!haystack.includes(scope.keyword)) return false;
      }
      return true;
    });
  }

  // 预演与导出完成提示都用这份汇总：总数、按项目、按许可，外加缺许可与缺责任人的条目
  function summarize(snapshot, rawScope) {
    const deps = selectDeps(snapshot, rawScope);
    const projectNameById = new Map(snapshot.projects.map((item) => [item.id, item.name]));

    const projectCounts = sortedCountEntries(countBy(deps, (item) => projectNameById.get(item.projectId) || item.projectId));
    const licenseCounts = sortedCountEntries(countBy(
      deps,
      (item) => item.license || NO_LICENSE,
    ));
    const statusCounts = sortedStatusEntries(countBy(deps, (item) => item.status || '未知状态'));

    const missingLicense = deps
      .filter((item) => !item.license)
      .map((item) => ({ id: item.id, projectName: projectNameById.get(item.projectId) || item.projectId, name: item.name }));
    const missingOwner = deps
      .filter((item) => !item.owner)
      .map((item) => ({ id: item.id, projectName: projectNameById.get(item.projectId) || item.projectId, name: item.name, owner: '' }));

    return {
      total: deps.length,
      projectCounts,
      licenseCounts,
      statusCounts,
      missingLicense,
      missingOwner,
    };
  }

  function scopeDescription(snapshot, rawScope) {
    const scope = normalizeScope(rawScope);
    const nameById = new Map(snapshot.projects.map((item) => [item.id, item.name]));
    const parts = [];
    parts.push(scope.projectIds.length
      ? scope.projectIds.map((id) => nameById.get(id) || id).join('、')
      : `全部项目（${snapshot.projects.length} 个）`);
    if (scope.statuses.length) parts.push(`状态：${scope.statuses.join('、')}`);
    if (scope.licenses.length) {
      parts.push(`许可：${scope.licenses.map((value) => (value === NO_LICENSE_VALUE ? NO_LICENSE : value)).join('、')}`);
    }
    if (scope.keyword) parts.push(`关键词：${scope.keyword}`);
    return parts.join('；');
  }

  // 导出时刻用「东八区」呈现，与页面上的登记时间口径一致；没有传时刻时取当前时间
  function resolveMoment(now) {
    const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const view = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const text = view.toISOString();
    return {
      date,
      stamp: text.slice(0, 16).replace('T', '-').replace(':', ''),
      label: `${text.slice(0, 10)} ${text.slice(11, 16)}（北京时间）`,
    };
  }

  function safeFilePart(text) {
    return text
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || '全部项目';
  }

  // 文件名里要看得出来导出时刻与覆盖的项目
  function buildFileName(snapshot, rawScope, now) {
    const scope = normalizeScope(rawScope);
    const moment = resolveMoment(now);
    const nameById = new Map(snapshot.projects.map((item) => [item.id, item.name]));
    const projectPart = scope.projectIds.length
      ? scope.projectIds.map((id) => nameById.get(id) || id).join('_')
      : '全部项目';
    return `依赖清单_${safeFilePart(projectPart)}_${moment.stamp}.txt`;
  }

  // 中文与全角字符在等宽字体里占两列，按常见东亚文字区间估算显示宽度
  function charWidth(ch) {
    const code = ch.codePointAt(0);
    const wide = (code >= 0x1100 && code <= 0x115F)
      || (code >= 0x2E80 && code <= 0x303E)
      || (code >= 0x3041 && code <= 0x33FF)
      || (code >= 0x3400 && code <= 0x4DBF)
      || (code >= 0x4E00 && code <= 0x9FFF)
      || (code >= 0xA000 && code <= 0xA4CF)
      || (code >= 0xAC00 && code <= 0xD7A3)
      || (code >= 0xF900 && code <= 0xFAFF)
      || (code >= 0xFE30 && code <= 0xFE4F)
      || (code >= 0xFF00 && code <= 0xFF60)
      || (code >= 0xFFE0 && code <= 0xFFE6)
      || (code >= 0x20000 && code <= 0x3FFFD);
    return wide ? 2 : 1;
  }

  // 把条目整理成等宽表格：中文按两个宽度计算，超出列宽截断并补省略号
  function fitCell(text, width) {
    const value = text === undefined || text === null ? '' : String(text);
    const chars = Array.from(value);
    let used = 0;
    let cut = chars.length;
    for (let i = 0; i < chars.length; i += 1) {
      const w = charWidth(chars[i]);
      if (used + w > width) {
        cut = i;
        break;
      }
      used += w;
    }
    let shown = chars.slice(0, cut).join('');
    if (cut < chars.length) {
      const ellipsis = '…';
      shown = used + 1 <= width ? `${shown}${ellipsis}` : shown;
      used = Math.min(width, used + charWidth(ellipsis));
    }
    return `${shown}${' '.repeat(Math.max(0, width - used))}`;
  }

  function renderTable(rows) {
    const columns = [
      { key: 'project', title: '项目', width: 14 },
      { key: 'name', title: '依赖名称', width: 26 },
      { key: 'version', title: '版本', width: 16 },
      { key: 'license', title: '许可', width: 16 },
      { key: 'owner', title: '责任人', width: 12 },
      { key: 'status', title: '状态', width: 8 },
    ];
    const lines = rows.map((row) => columns.map((col) => fitCell(row[col.key], col.width)).join('  '));
    const header = columns.map((col) => fitCell(col.title, col.width)).join('  ');
    return [header, columns.map((col) => '-'.repeat(col.width)).join('  ')].concat(lines).join(CRLF);
  }

  // 一份可读的文本报告：头部写清范围与时刻，然后是统计，最后逐条列出
  function buildReport(snapshot, rawScope, now) {
    const moment = resolveMoment(now);
    const deps = selectDeps(snapshot, rawScope);
    const summary = summarize(snapshot, rawScope);
    const projectNameById = new Map(snapshot.projects.map((item) => [item.id, item.name]));

    const out = [];
    out.push('依赖清单导出');
    out.push('================');
    out.push(`导出时刻：${moment.label}`);
    out.push(`导出范围：${scopeDescription(snapshot, rawScope)}`);
    out.push(`条目总数：${summary.total} 条`);
    out.push('');

    out.push('按项目统计：');
    if (summary.projectCounts.length) {
      summary.projectCounts.forEach(([name, count]) => out.push(`  - ${name}：${count} 条`));
    } else {
      out.push('  - （没有条目）');
    }
    out.push('');

    out.push('按许可统计：');
    if (summary.licenseCounts.length) {
      summary.licenseCounts.forEach(([name, count]) => out.push(`  - ${name}：${count} 条`));
    } else {
      out.push('  - （没有条目）');
    }
    out.push('');

    out.push('按状态统计：');
    if (summary.statusCounts.length) {
      summary.statusCounts.forEach(([name, count]) => out.push(`  - ${name}：${count} 条`));
    } else {
      out.push('  - （没有条目）');
    }
    out.push('');

    out.push(`还没写许可的条目（${summary.missingLicense.length} 条）：`);
    if (summary.missingLicense.length) {
      summary.missingLicense.forEach((item) => out.push(`  - ${item.projectName} / ${item.name}`));
    } else {
      out.push('  - 无');
    }
    out.push('');

    out.push(`还没写责任人的条目（${summary.missingOwner.length} 条）：`);
    if (summary.missingOwner.length) {
      summary.missingOwner.forEach((item) => out.push(`  - ${item.projectName} / ${item.name}`));
    } else {
      out.push('  - 无');
    }
    out.push('');

    out.push('条目明细：');
    if (deps.length) {
      out.push(renderTable(deps.map((item) => ({
        project: projectNameById.get(item.projectId) || item.projectId,
        name: item.name,
        version: item.version,
        license: item.license || NO_LICENSE,
        owner: item.owner || '未指定',
        status: item.status,
      }))));
      out.push('');
      out.push('备注：');
      deps.forEach((item) => {
        out.push(`  [${projectNameById.get(item.projectId) || item.projectId} / ${item.name}] ${item.note || '（无）'}`);
      });
    } else {
      out.push('  （所选范围内没有条目）');
    }
    out.push('');

    return out.join(CRLF);
  }

  // 浏览器下载用：带 BOM，记事本、Excel 打开都不会把中文读成乱码
  function buildFile(snapshot, rawScope, now) {
    return {
      fileName: buildFileName(snapshot, rawScope, now),
      mimeType: 'text/plain;charset=utf-8',
      bytes: new TextEncoder().encode(BOM + buildReport(snapshot, rawScope, now)),
    };
  }

  return {
    NO_LICENSE,
    NO_LICENSE_VALUE,
    normalizeSnapshot,
    snapshotOptions,
    normalizeScope,
    selectDeps,
    summarize,
    scopeDescription,
    buildReport,
    buildFileName,
    buildFile,
    resolveMoment,
  };
});
