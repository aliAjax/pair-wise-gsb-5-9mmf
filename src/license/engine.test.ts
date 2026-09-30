import test from 'node:test';
import assert from 'node:assert/strict';
import type {DBShape, ScanItem} from './types';
import {contentFingerprint} from './fingerprint';
import {applicableException, currentVerdict, exceptionsFor, historyPackages, verdictsFor} from './engine';
import {commitBatch, manualReview, migrateLegacy, newBatchId, publishPolicy, readjudicate} from './ingest';
import {buildBatchA, buildBatchB, buildSeedExceptions, emptyDB, LEGACY_DEPS, POLICY_V2, SEED_NOW} from './seed';

const T = SEED_NOW;

function migratedDB(): DBShape {
  return migrateLegacy(LEGACY_DEPS, emptyDB(), T)!;
}

function scanItem(partial: Partial<ScanItem> & {name: string; version: string}): ScanItem {
  const license = 'license' in partial ? partial.license ?? null : 'MIT';
  return {
    source: partial.source ?? 'offline-scan',
    name: partial.name,
    version: partial.version,
    license,
    filesSignature: partial.filesSignature,
    scannedAt: T,
    fingerprint: contentFingerprint({name: partial.name, version: partial.version, license, filesSignature: partial.filesSignature}),
  };
}

function enqueue(db: DBShape, label: string, items: ScanItem[], opts: {failOnce?: boolean} = {}) {
  const id = newBatchId();
  db.batches.push({id, label, origin: `${label}.tar.gz`, arrivedAt: T, items, state: 'queued', attempts: 0, simulateFailureOnce: opts.failOnce});
  return id;
}

/* 1. 同一内容指纹只收一次（跨批 + 批内重复） */
test('指纹相同的包只收一次，只合并来源，不产生新裁决', () => {
  let db = migratedDB();
  const before = Object.keys(db.packages).length;
  const reactFp = contentFingerprint({name: 'react', version: '18.3.1', license: 'MIT'});
  const verdictCountBefore = db.verdicts.filter(v => v.fingerprint === reactFp).length;

  const id = enqueue(db, 'dup', [
    scanItem({name: 'react', version: '18.3.1', license: 'MIT'}),
    scanItem({name: 'react', version: '18.3.1', license: 'MIT'}), // 批内重复
  ]);
  const r = commitBatch(db, id, T);
  assert.equal(r.ok, true);
  db = r.db;

  assert.equal(Object.keys(db.packages).length, before, '不应新增包记录');
  assert.equal(db.verdicts.filter(v => v.fingerprint === reactFp).length, verdictCountBefore, '不应新增裁决');
  assert.deepEqual(db.packages[reactFp].sources.sort(), ['offline-scan', 'site-manifest'].sort());
  assert.equal(r.itemResults!.every(x => x.outcome === 'updated-same'), true);
});

/* 2. 包内容一变，原裁决失效并回到待复核；历史仍可查 */
test('包体签名变化 → 指纹变化 → 旧裁决 content-changed 失效，新指纹待复核', () => {
  let db = migratedDB();
  const oldFp = contentFingerprint({name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0'});
  // 策略裁决为 deny(risk)，因旧例外 EX-001 放行而当前显示 ok
  const before = currentVerdict(db, db.packages[oldFp], T);
  assert.equal(before.verdict?.status, 'risk');
  assert.equal(before.status, 'ok');
  assert.equal(before.exception?.id, 'EX-001');

  const newFp = contentFingerprint({name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', filesSignature: 'sig-new'});
  const id = enqueue(db, 'change', [scanItem({name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', filesSignature: 'sig-new'})]);
  const r = commitBatch(db, id, T);
  db = r.db;
  assert.equal(r.itemResults![0].outcome, 'pending-changed');

  // 新包：待复核，原因 content-changed
  const view = currentVerdict(db, db.packages[newFp], T);
  assert.equal(view.status, 'pending');
  assert.equal(view.pendingReason, 'content-changed');

  // 旧包被替换、不进当前清单
  assert.equal(db.packages[oldFp].supersededBy, newFp);
  assert.ok(historyPackages(db).some(p => p.fingerprint === oldFp), '旧包仍可在历史中查到');

  // 旧裁决标记失效但不删除
  const oldVerdict = verdictsFor(db, oldFp)[0];
  assert.equal(oldVerdict.supersededAt, T);
  assert.equal(oldVerdict.reasonSuperseded, 'content-changed');
});

/* 3. 例外：指纹 + 策略版本 + 有效期 三条件 */
test('例外只有在指纹和策略版本一致且未过期时才能沿用', () => {
  let db = migratedDB();

  // 迁移后 legacy-parser 指纹与 EX-001 一致、策略一致、未过期 → 沿用（放行）
  const fp = contentFingerprint({name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0'});
  let view = currentVerdict(db, db.packages[fp], T);
  assert.equal(view.status, 'ok');
  assert.equal(view.exception?.id, 'EX-001');

  // 内容变了：新指纹上旧例外不再沿用
  const id = enqueue(db, 'c', [scanItem({name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', filesSignature: 'sig-x'})]);
  db = commitBatch(db, id, T).db;
  const newFp = db.coordIndex['legacy-parser@2.1.0'];
  view = currentVerdict(db, db.packages[newFp], T);
  assert.equal(view.status, 'pending', '指纹不一致时例外不可沿用');
  const states = exceptionsFor(db, db.packages[newFp]);
  assert.equal(states[0].applicable, false);
  if (!states[0].applicable) assert.ok(states[0].issues.includes('fingerprint-mismatch'));

  // lodash 的 EX-002 指纹一致，但策略升级后版本不一致 → 不可沿用
  db = publishPolicy(db, POLICY_V2, T);
  const lodashFp = contentFingerprint({name: 'lodash', version: '4.17.21', license: 'MIT'});
  const exState = exceptionsFor(db, db.packages[lodashFp]);
  const ex2 = exState.find(s => s.exception.id === 'EX-002')!;
  assert.equal(ex2.applicable, false);
  if (!ex2.applicable) assert.ok(ex2.issues.includes('policy-mismatch'));
  assert.equal(applicableException(db, db.packages[lodashFp]), undefined);

  // highlight.js 的 EX-003 已过期
  const hljsFp = contentFingerprint({name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause'});
  const ex3 = exceptionsFor(db, db.packages[hljsFp]).find(s => s.exception.id === 'EX-003')!;
  if (!ex3.applicable) assert.ok(ex3.issues.includes('expired'));
});

/* 4. 写入失败：只保留该批待重试，已入库记录不受影响 */
test('批次写入失败时整批回滚，只保留该批 pending-retry，已入库数据不动', () => {
  let db = migratedDB();
  const snapshotPkgs = Object.keys(db.packages).length;

  const idA = enqueue(db, 'A', buildBatchA().items);
  db = commitBatch(db, idA, T).db;
  const afterA = {pkgs: Object.keys(db.packages).length, verdicts: db.verdicts.length};
  assert.ok(afterA.pkgs > snapshotPkgs);

  const idB = enqueue(db, 'B', buildBatchB().items, {failOnce: true});
  const r = commitBatch(db, idB, T);
  assert.equal(r.ok, false);
  db = r.db;

  const batchB = db.batches.find(b => b.id === idB)!;
  assert.equal(batchB.state, 'pending-retry');
  assert.equal(batchB.attempts, 1);
  assert.ok(batchB.lastError);

  // A 批已入库的记录完全不受影响
  assert.equal(Object.keys(db.packages).length, afterA.pkgs);
  assert.equal(db.verdicts.length, afterA.verdicts);

  // 重试（这次写入成功）→ B 批整体提交
  const retry = commitBatch(db, idB, T);
  assert.equal(retry.ok, true);
  db = retry.db;
  assert.equal(db.batches.find(b => b.id === idB)!.state, 'committed');
  // 批内重复 mime-types 只收一次
  const mimeResults = retry.itemResults!.filter(x => x.coord === 'mime-types@2.1.35');
  assert.equal(mimeResults.length, 2);
});

/* 5. 迁移：补指纹 + 绑当前策略版本，历史结论可查 */
test('旧数据首次打开迁移，补全指纹与策略版本，历史结论仍可查询', () => {
  const db = migratedDB();
  assert.equal(db.migratedAt, T);
  assert.equal(db.legacyCount, LEGACY_DEPS.length);
  assert.equal(Object.keys(db.packages).length, LEGACY_DEPS.length);

  const fp = contentFingerprint({name: 'react', version: '18.3.1', license: 'MIT'});
  const pkg = db.packages[fp];
  assert.ok(pkg, '旧包按补算指纹可找到');
  const v = verdictsFor(db, fp)[0];
  assert.equal(v.source, 'legacy-migrated');
  assert.equal(v.policyVersion, db.currentPolicyVersion);
  assert.equal(v.status, 'ok');
  assert.equal(currentVerdict(db, pkg, T).status, 'ok', '迁移后历史结论在当前清单中正常显示');
});

/* 6. 策略升级：旧裁决失效、回到待复核，重新裁决后恢复 */
test('策略升级使旧结论失效；按新策略重新裁决后得到新结论', () => {
  let db = migratedDB();
  const cryptoFp = contentFingerprint({name: 'internal-crypto', version: '0.9.2', license: 'SSPL-1.0'});

  // v1 下 SSPL 未收录 → review(warn)
  const id = enqueue(db, 'ssp', [scanItem({name: 'internal-crypto', version: '0.9.2', license: 'SSPL-1.0'})]);
  db = commitBatch(db, id, T).db;
  assert.equal(currentVerdict(db, db.packages[cryptoFp], T).status, 'warn');

  db = publishPolicy(db, POLICY_V2, T);
  const view = currentVerdict(db, db.packages[cryptoFp], T);
  assert.equal(view.status, 'pending');
  assert.equal(view.pendingReason, 'policy-updated');
  assert.equal(verdictsFor(db, cryptoFp)[0].reasonSuperseded, 'policy-updated');

  db = readjudicate(db, cryptoFp, T);
  const after = currentVerdict(db, db.packages[cryptoFp], T);
  assert.equal(after.status, 'risk', 'v2 下 SSPL 应为拒绝');
  assert.equal(after.verdict?.policyVersion, POLICY_V2.id);
});

/* 7. 未知许可证新包 → 待复核，可人工裁决 */
test('许可证未识别的新包进入待复核，人工复核后生效', () => {
  let db = migratedDB();
  const id = enqueue(db, 'unk', [scanItem({name: 'mystery', version: '1.0.0', license: null})]);
  const r = commitBatch(db, id, T);
  db = r.db;
  assert.equal(r.itemResults![0].outcome, 'pending-unknown');
  const fp = db.coordIndex['mystery@1.0.0'];
  const view = currentVerdict(db, db.packages[fp], T);
  assert.equal(view.status, 'pending');
  assert.equal(view.pendingReason, 'unknown-license');

  db = manualReview(db, fp, 'review', '测试员', '确认为内部专有协议', T);
  assert.equal(currentVerdict(db, db.packages[fp], T).status, 'warn');
});

/* 8. 空批次/重复提交防护 */
test('已提交批次不能重复提交', () => {
  let db = migratedDB();
  const id = enqueue(db, 'once', [scanItem({name: 'once-pkg', version: '1.0.0', license: 'MIT'})]);
  db = commitBatch(db, id, T).db;
  const again = commitBatch(db, id, T);
  assert.equal(again.ok, false);
});

/* 9. 初始空库无旧数据时迁移返回 null */
test('无旧数据时迁移返回 null', () => {
  assert.equal(migrateLegacy([], emptyDB(), T), null);
});

/* 10. 种子例外存在 */
test('种子数据包含三条例外审批', () => {
  assert.equal(buildSeedExceptions().length, 3);
});
