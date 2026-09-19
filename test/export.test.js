// 导出功能的命令行自测：计数必须对得上，同一份快照连续导出两次必须完全一致。
// 运行：node --test（见 package.json 的 test 脚本）
const test = require('node:test');
const assert = require('node:assert');
const { seedData } = require('../server/store');
const DepExport = require('../public/export.js');

const snapshot = DepExport.normalizeSnapshot(seedData());
const fixedMoment = new Date('2026-09-19T03:05:07.000Z');

test('快照整理出全部三个项目与十八条登记，且按固定顺序排列', () => {
  assert.strictEqual(snapshot.projects.length, 3);
  assert.strictEqual(snapshot.deps.length, 18);
  // 顺序固定为：项目名（会员中心、支付网关、订单服务），同一项目内按依赖名
  assert.deepStrictEqual(snapshot.deps.map((item) => item.id), [
    'dep-2012', 'dep-2015', 'dep-2013', 'dep-2014', 'dep-2011', 'dep-2016', 'dep-2017', 'dep-2018',
    'dep-2008', 'dep-2007', 'dep-2009', 'dep-2010', 'dep-2006',
    'dep-2005', 'dep-2004', 'dep-2002', 'dep-2003', 'dep-2001',
  ]);
});

test('可选项里项目、状态与许可（含未填许可）都带计数', () => {
  const options = DepExport.snapshotOptions(snapshot);
  assert.deepStrictEqual(options.projects.map((item) => item.value), ['proj-1003', 'proj-1002', 'proj-1001']);
  assert.deepStrictEqual(options.projects.map((item) => item.count), [8, 5, 5]);
  assert.deepStrictEqual(options.statuses, ['在用', '待升', '已弃用']);
  const noLicense = options.licenses.find((item) => item.value === DepExport.NO_LICENSE_VALUE);
  assert.ok(noLicense, '没有许可的条目要单独给出可选项');
  assert.strictEqual(noLicense.count, 1);
});

test('全量范围：总数十八条，按项目与按许可的计数正确', () => {
  const summary = DepExport.summarize(snapshot, {});
  assert.strictEqual(summary.total, 18);
  assert.deepStrictEqual(summary.projectCounts, [
    ['会员中心', 8], ['支付网关', 5], ['订单服务', 5],
  ]);
  assert.deepStrictEqual(summary.licenseCounts, [
    ['Apache-2.0', 5],
    ['BSD-2-Clause', 2],
    ['BSD-3-Clause', 1],
    ['GPL-3.0', 1],
    ['MIT', 8],
    ['未填许可', 1],
  ]);
  assert.deepStrictEqual(summary.statusCounts, [['在用', 14], ['待升', 3], ['已弃用', 1]]);
  // 各组计数之和必须与总数对得上
  assert.strictEqual(summary.projectCounts.reduce((sum, [, count]) => sum + count, 0), summary.total);
  assert.strictEqual(summary.licenseCounts.reduce((sum, [, count]) => sum + count, 0), summary.total);
});

test('预演能指出还没写许可与还没写责任人的条目', () => {
  const summary = DepExport.summarize(snapshot, {});
  assert.deepStrictEqual(summary.missingLicense.map((item) => item.name), ['internal-sdk']);
  assert.deepStrictEqual(
    summary.missingOwner.map((item) => item.name).sort(),
    ['lodash', 'protobuf-java', 'redis-client', 'xml-parser'],
  );
});

test('只勾一个项目加一种状态时，只带走这四条在用登记', () => {
  const summary = DepExport.summarize(snapshot, { projectIds: ['proj-1001'], statuses: ['在用'] });
  assert.strictEqual(summary.total, 4);
  assert.deepStrictEqual(summary.projectCounts, [['订单服务', 4]]);
  assert.deepStrictEqual(
    DepExport.selectDeps(snapshot, { projectIds: ['proj-1001'], statuses: ['在用'] })
      .map((item) => item.id).sort(),
    ['dep-2001', 'dep-2002', 'dep-2004', 'dep-2005'],
  );
});

test('只勾“未填许可”时带走 internal-sdk 一条', () => {
  const selected = DepExport.selectDeps(snapshot, { licenses: [DepExport.NO_LICENSE_VALUE] });
  assert.deepStrictEqual(selected.map((item) => item.id), ['dep-2005']);
});

test('关键词只在依赖名、责任人、备注里匹配', () => {
  assert.strictEqual(DepExport.selectDeps(snapshot, { keyword: 'redis' }).length, 1);
  assert.strictEqual(DepExport.selectDeps(snapshot, { keyword: '陈晓' }).length, 4);
  assert.strictEqual(DepExport.selectDeps(snapshot, { keyword: '不存在的词' }).length, 0);
});

test('勾了已经不存在的项目或许可时，结果为空而不是报错', () => {
  assert.deepStrictEqual(DepExport.selectDeps(snapshot, { projectIds: ['proj-gone'] }), []);
  assert.strictEqual(DepExport.summarize(snapshot, { statuses: ['不存在的状态'] }).total, 0);
});

test('同一份快照、同一范围、同一时刻连续导出两次，文件名与文件内容字节级一致', () => {
  const scope = { projectIds: ['proj-1001', 'proj-1003'], statuses: ['在用', '待升'] };
  const first = DepExport.buildFile(snapshot, scope, fixedMoment);
  const second = DepExport.buildFile(snapshot, scope, fixedMoment);
  assert.strictEqual(first.fileName, second.fileName);
  assert.deepStrictEqual(first.bytes, second.bytes);
  assert.strictEqual(first.fileName, '依赖清单_订单服务_会员中心_2026-09-19-1105.txt');
});

test('不传固定时刻时两次成文也一致（时刻被外部冻结后内容不受调用次序影响）', () => {
  const reportA = DepExport.buildReport(snapshot, {}, fixedMoment);
  const reportB = DepExport.buildReport(snapshot, {}, fixedMoment);
  assert.strictEqual(reportA, reportB);
  assert.match(reportA, /条目总数：18 条/);
  assert.match(reportA, /订单服务：5 条/);
  assert.match(reportA, /会员中心：8 条/);
  assert.match(reportA, /还没写许可的条目（1 条）/);
  assert.match(reportA, /internal-sdk/);
  assert.match(reportA, /还没写责任人的条目（4 条）/);
});

test('全量导出的文件名看得出时刻与“全部项目”，范围说明写清勾选的维度', () => {
  assert.strictEqual(DepExport.buildFileName(snapshot, {}, fixedMoment), '依赖清单_全部项目_2026-09-19-1105.txt');
  const description = DepExport.scopeDescription(snapshot, { statuses: ['待升'], licenses: ['MIT'] });
  assert.match(description, /全部项目（3 个）/);
  assert.match(description, /状态：待升/);
  assert.match(description, /许可：MIT/);
});

test('报告里写的各项目计数与汇总完全一致，避免预演与文件对不上', () => {
  const scope = { projectIds: ['proj-1002'] };
  const summary = DepExport.summarize(snapshot, scope);
  const report = DepExport.buildReport(snapshot, scope, fixedMoment);
  assert.strictEqual(summary.total, 5);
  assert.match(report, new RegExp(`条目总数：${summary.total} 条`));
  summary.projectCounts.forEach(([name, count]) => {
    assert.match(report, new RegExp(`${name}：${count} 条`));
  });
});
