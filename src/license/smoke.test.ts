import test from 'node:test';
import assert from 'node:assert/strict';
import type {LegacyDep} from './types';
import {contentFingerprint} from './fingerprint';
import {currentPackages, currentVerdict, historyPackages} from './engine';
import {buildReport} from './report';
import {POLICY_V2} from './seed';
import {LicenseController, LEGACY_KEY, STORE_KEY, summarizeResults} from './store';
import {memoryStorage} from './test-utils';

function makeStorage(): Storage {
  return memoryStorage();
}

test('端到端：迁移 → A 批入库 → B 批失败/重试 → 策略升级 → 重裁 → 报告只含当前裁决', () => {
  const storage = makeStorage();

  // 预置真实旧版 App（v1）的 localStorage 数据
  const legacy: LegacyDep[] = [
    {id: 1, name: 'react', version: '18.3.1', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
    {id: 2, name: 'lodash', version: '4.17.21', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
    {id: 3, name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', source: 'npm', status: 'warn', note: '再发布需保留版权声明'},
    {id: 4, name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', source: '手动', status: 'risk', note: '可能与闭源分发冲突'},
  ];
  storage.setItem(LEGACY_KEY, JSON.stringify(legacy));

  // 首次打开：迁移
  const store = new LicenseController(storage);
  let db = store.db;
  assert.equal(db.schemaVersion, 2);
  assert.equal(db.legacyCount, 4);
  assert.equal(currentPackages(db).length, 4);
  assert.ok(store.logs.some(l => l.text.includes('旧数据迁移完成')));
  const reactFp = contentFingerprint({name: 'react', version: '18.3.1', license: 'MIT'});
  assert.equal(db.verdicts.find(v => v.fingerprint === reactFp)?.source, 'legacy-migrated');

  // A 批到达并提交
  store.receiveBatch('A');
  const batchA = store.db.batches.find(b => b.label === '离线扫描包 A')!;
  assert.equal(batchA.state, 'queued');
  assert.equal(store.commit(batchA.id), true);
  db = store.db;
  const afterA = currentPackages(db).length;
  assert.ok(afterA > 4, 'A 批应有新增包');
  // react 指纹相同 → 来源合并、无重复记录
  assert.deepEqual(db.packages[reactFp].sources.sort(), ['offline-scan', 'site-manifest'].sort());
  assert.equal(JSON.parse(storage.getItem(STORE_KEY)!).currentPolicyVersion, db.currentPolicyVersion, '已落库');

  // B 批到达；首次提交模拟写入失败
  store.receiveBatch('B');
  const batchB = store.db.batches.find(b => b.label === '离线扫描包 B')!;
  assert.equal(store.commit(batchB.id), false, 'B 批首次写入应失败');
  db = store.db;
  const failedB = db.batches.find(b => b.id === batchB.id)!;
  assert.equal(failedB.state, 'pending-retry');
  assert.equal(failedB.attempts, 1);
  assert.ok(failedB.lastError);
  assert.equal(currentPackages(db).length, afterA, '失败后 A 批已入库记录不受影响');
  assert.ok(store.logs.some(l => l.kind === 'error'), '失败写日志');

  // 重试（本批整体提交成功）
  assert.equal(store.commit(batchB.id), true);
  db = store.db;
  assert.equal(db.batches.find(b => b.id === batchB.id)!.state, 'committed');
  const stats = summarizeResults(db.batches.find(b => b.id === batchB.id)!.itemResults);
  assert.ok(stats.pendingChanged >= 2, 'highlight.js / legacy-parser 新包体应触发内容变化待复核');
  assert.equal(stats.updatedSame, 2, 'mime-types 批内重复 + 与 A 批同指纹 → 两次 updated-same');

  // 内容变化 → 新指纹待复核、旧包被替换
  const lpFp = db.coordIndex['legacy-parser@2.1.0'];
  const lpView = currentVerdict(db, db.packages[lpFp]);
  assert.equal(lpView.status, 'pending');
  assert.equal(lpView.pendingReason, 'content-changed');
  assert.equal(lpView.exception, undefined, '指纹变了，旧例外 EX-001 不能沿用');

  // 策略升级 → 旧裁决失效、回到待复核
  store.bumpPolicy();
  db = store.db;
  assert.equal(db.currentPolicyVersion, POLICY_V2.id);
  assert.ok(currentPackages(db).some(p => currentVerdict(db, p).pendingReason === 'policy-updated'));

  // 全部按新策略重裁；未知许可证的 fast-xml 仍待人工
  store.readjudicatePending();
  db = store.db;
  const fastXml = currentPackages(db).find(p => p.name === 'fast-xml')!;
  assert.equal(currentVerdict(db, fastXml).status, 'pending');
  assert.equal(currentVerdict(db, fastXml).pendingReason, 'unknown-license');

  // 新策略下 internal-crypto（SSPL）应为拒绝
  const crypto = currentPackages(db).find(p => p.name === 'internal-crypto' && p.version === '1.2.0')!;
  assert.equal(currentVerdict(db, crypto).status, 'risk');

  // 报告：只含当前有效裁决
  const report = buildReport(db);
  assert.match(report, new RegExp(`当前策略版本：\\*\\*${POLICY_V2.id}\\*\\*`));
  assert.match(report, /待复核明细[\s\S]*fast-xml/);
  const hlRows = report.split('\n').filter(l => l.startsWith('|') && l.includes('highlight.js@11.10.0'));
  assert.equal(hlRows.length, 1, '同坐标被替换旧包不进当前表');

  // 历史查询：被替换旧包 + 两类失效裁决 + 迁移结论都还在
  const hist = historyPackages(db);
  assert.ok(hist.some(p => !!p.supersededBy), '历史中保留被替换旧包');
  assert.ok(db.verdicts.some(v => v.source === 'legacy-migrated'), '迁移结论可查');
  assert.ok(db.verdicts.some(v => v.reasonSuperseded === 'policy-updated'), '策略失效裁决保留');
  assert.ok(db.verdicts.some(v => v.reasonSuperseded === 'content-changed'), '内容失效裁决保留');

  // 重置
  store.resetDemo();
  assert.equal(storage.getItem(STORE_KEY), null);
  assert.equal(storage.getItem(LEGACY_KEY), null);
});

test('已有 v2 库时直接打开，不再迁移', () => {
  const storage = makeStorage();
  const first = new LicenseController(storage);
  first.receiveBatch('A');
  const stored = JSON.parse(storage.getItem(STORE_KEY)!);

  const second = new LicenseController(storage);
  assert.equal(second.db.batches.length, 1);
  assert.equal(second.db.legacyCount, stored.legacyCount);
  assert.equal(second.logs.length, 0, '打开已有库不产生迁移日志');
});

test('新例外绑定当前指纹与策略版本后立即被沿用，内容变化后失效', () => {
  const storage = makeStorage();
  const store = new LicenseController(storage);

  // 接收并提交 B 批，使 legacy-parser 换成新包体、进入待复核（旧例外指纹不符）
  store.receiveBatch('A');
  store.commit(store.db.batches[0].id);
  store.receiveBatch('B');
  store.commit(store.db.batches[1].id); // 首次失败
  store.commit(store.db.batches[1].id); // 重试成功
  const lpFp = store.db.coordIndex['legacy-parser@2.1.0'];
  assert.equal(currentVerdict(store.db, store.db.packages[lpFp]).status, 'pending');

  // 对新指纹登记例外（绑定当前策略 v1）
  const lp = store.db.packages[lpFp];
  store.addException({
    name: lp.name,
    version: lp.version,
    fingerprint: lpFp,
    level: 'allow',
    approver: '测试审批人',
    ticket: 'SEC-2026-099',
    expiresAt: null,
    note: '新包体重新评审后放行',
  });
  const view = currentVerdict(store.db, store.db.packages[lpFp]);
  assert.equal(view.status, 'ok', '指纹+策略一致的新例外立即沿用');
  assert.equal(view.exception?.ticket, 'SEC-2026-099');

  // 策略升级后该例外因策略版本不一致而不再沿用，且包回到待复核
  store.bumpPolicy();
  const after = currentVerdict(store.db, store.db.packages[lpFp]);
  assert.equal(after.status, 'pending');
  assert.equal(after.exception, undefined);
});
