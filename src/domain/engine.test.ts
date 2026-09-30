import { describe, expect, it } from 'vitest';
import {
  BATCH_A,
  BATCH_B,
  CURRENT_POLICY_VERSION,
  LEGACY_DEPS,
  T0,
  buildSeedExceptions,
} from './seed';
import {
  BatchRejected,
  DEFAULT_POLICY_2026_09,
  activePackage,
  decide,
  effectiveRuling,
  exceptionStatus,
  fingerprintExists,
  grantException,
  ingestBatch,
  migrateLegacy,
  packageHistory,
  publishPolicy,
  reconcile,
  revokeException,
} from './engine';
import { contentFingerprint } from './fingerprint';
import { buildReport, currentRulings, stats } from './report';
import { AppState } from './types';

const DAY = 86400000;

function freshState(now = T0): AppState {
  return migrateLegacy(
    LEGACY_DEPS,
    CURRENT_POLICY_VERSION,
    now,
    [structuredClone(BATCH_A), structuredClone(BATCH_B)],
    buildSeedExceptions(),
  );
}

describe('旧数据首次打开迁移', () => {
  it('补算包指纹与策略版本，旧结论保留为 migrated 裁决', () => {
    const s = freshState();
    expect(s.schemaVersion).toBe(2);
    expect(s.migratedAt).toBe(T0);
    const react = activePackage(s.packages, 'react')!;
    expect(react.fingerprint).toMatch(/^cfp:/);
    expect(s.verdicts.every((v) => v.policyVersion === CURRENT_POLICY_VERSION)).toBe(true);
    expect(s.verdicts.every((v) => v.migrated)).toBe(true);
    // 历史结论仍可查询
    const hist = packageHistory(s, 'react');
    expect(hist.verdicts[0].reason).toContain('迁移自旧版结论');
  });

  it('迁移后清单/统计/报告只显示当前有效裁决', () => {
    const s = freshState();
    const rows = currentRulings(s, T0);
    expect(rows).toHaveLength(5);
    // react 的可沿用例外优先于迁移裁决
    const reactRow = rows.find((r) => r.key === 'react')!;
    expect(reactRow.ruling.source).toBe('exception');
    expect(reactRow.ruling.decision).toBe('allow');
    // 过期/旧策略例外不生效
    expect(currentRulings(s, T0).find((r) => r.key === 'legacy-parser')!.ruling.decision).toBe('deny');
    expect(stats(s, T0).total).toBe(5);
  });

  it('原数据备份保留', () => {
    const s = freshState();
    expect((s.legacyBackup as typeof LEGACY_DEPS)).toHaveLength(5);
  });
});

describe('例外沿用条件（指纹 + 策略版本 + 有效期）', () => {
  it('EX-001 指纹匹配、策略一致、未过期 → active', () => {
    const s = freshState();
    const ex = s.exceptions.find((e) => e.id === 'EX-001')!;
    expect(exceptionStatus(ex, activePackage(s.packages, 'react'), CURRENT_POLICY_VERSION, T0)).toBe('active');
  });

  it('包内容一变，原例外因指纹不一致不可沿用，回到待复核', () => {
    let s = freshState();
    s = ingestBatch(s, BATCH_A.id, T0);
    const ex = s.exceptions.find((e) => e.id === 'EX-001')!;
    const newReact = activePackage(s.packages, 'react')!;
    expect(newReact.version).toBe('18.3.2');
    expect(exceptionStatus(ex, newReact, CURRENT_POLICY_VERSION, T0)).toBe('fingerprint-mismatch');
    expect(effectiveRuling(s, 'react', T0).decision).toBe('pending');
    expect(effectiveRuling(s, 'react', T0).reason).toContain('包内容已变化');
  });

  it('EX-002 策略版本不一致 → 不可沿用', () => {
    const s = freshState();
    const ex = s.exceptions.find((e) => e.id === 'EX-002')!;
    expect(exceptionStatus(ex, activePackage(s.packages, 'legacy-parser'), CURRENT_POLICY_VERSION, T0)).toBe('policy-mismatch');
  });

  it('EX-003 已过期 → 不可沿用', () => {
    const s = freshState();
    const ex = s.exceptions.find((e) => e.id === 'EX-003')!;
    expect(exceptionStatus(ex, activePackage(s.packages, 'highlight.js'), CURRENT_POLICY_VERSION, T0)).toBe('expired');
  });

  it('撤销后例外立即失效', () => {
    let s = freshState();
    s = revokeException(s, 'EX-001');
    expect(effectiveRuling(s, 'react', T0).source).toBe('manual-verdict');
  });

  it('新审批的例外在新内容上生效，过期后自动回到原裁决口径', () => {
    let s = freshState();
    s = ingestBatch(s, BATCH_A.id, T0);
    // react 换代后处于待复核
    expect(effectiveRuling(s, 'react', T0).decision).toBe('pending');
    s = grantException(s, { key: 'react', reason: '新版本已复审', grantedBy: '合规委员会', ttlDays: 7 }, T0);
    expect(effectiveRuling(s, 'react', T0).source).toBe('exception');
    // 8 天后过期
    expect(effectiveRuling(s, 'react', T0 + 8 * DAY).decision).toBe('pending');
  });
});

describe('扫描批次原子写入', () => {
  it('A 批：换代包旧记录 superseded、旧裁决失效；全新包自动初判；批内指纹去重', () => {
    let s = freshState();
    const before = structuredClone(s);
    s = ingestBatch(s, BATCH_A.id, T0);

    const batch = s.batches.find((b) => b.id === BATCH_A.id)!;
    expect(batch.status).toBe('ingested');

    // react 换代
    const react = activePackage(s.packages, 'react')!;
    expect(react.version).toBe('18.3.2');
    const oldReact = s.packages.find((p) => p.version === '18.3.1')!;
    expect(oldReact.superseded).toBe(true);
    // 旧迁移裁决失效
    const oldVerdict = s.verdicts.find((v) => v.fingerprint === oldReact.fingerprint)!;
    expect(oldVerdict.active).toBe(false);
    expect(oldVerdict.invalidated).toBe('content-changed');
    expect(effectiveRuling(s, 'react', T0).decision).toBe('pending');

    // lodash 同样换代
    expect(activePackage(s.packages, 'lodash')!.version).toBe('4.17.22');
    expect(effectiveRuling(s, 'lodash', T0).decision).toBe('pending');

    // 全新 MIT 包自动放行
    expect(effectiveRuling(s, 'dayjs', T0).decision).toBe('allow');
    expect(effectiveRuling(s, 'ajv', T0).decision).toBe('allow');

    // 批内重复：react 18.3.1 / chart.js 4.4.4 指纹已在迁移库中
    expect(batch.report!.duplicated).toHaveLength(2);
    expect(s.packages.filter((p) => p.key === 'chart.js')).toHaveLength(1);
    // 全新有效包数量：5 旧 + 4 新内容（react/lodash 换代 + dayjs/ajv）
    expect(currentRulings(s, T0)).toHaveLength(7);
    // 旧数据未被改动（与写入前对应记录一致）
    expect(s.packages.find((p) => p.key === 'chart.js')!.fingerprint)
      .toBe(before.packages.find((p) => p.key === 'chart.js')!.fingerprint);
  });

  it('B 批：损坏条目导致整批失败，仅本批标记 failed 待重试，已入库记录不受影响', () => {
    let s = freshState();
    s = ingestBatch(s, BATCH_A.id, T0); // A 先成功
    const snapshot = structuredClone(s);
    s = ingestBatch(s, BATCH_B.id, T0);

    const b = s.batches.find((x) => x.id === BATCH_B.id)!;
    expect(b.status).toBe('failed');
    expect(b.attempts).toBe(1);
    expect(b.error).toContain('broken-pkg');
    // 除批次自身外，其余状态与写入前完全一致
    expect(s.packages).toEqual(snapshot.packages);
    expect(s.verdicts).toEqual(snapshot.verdicts);
    expect(s.exceptions).toEqual(snapshot.exceptions);
    // A 批仍是 ingested
    expect(s.batches.find((x) => x.id === BATCH_A.id)!.status).toBe('ingested');
  });

  it('失败批次保留待重试；剔除损坏条目后重试成功，跨批同指纹仍去重', () => {
    let s = freshState();
    s = ingestBatch(s, BATCH_A.id, T0);
    s = ingestBatch(s, BATCH_B.id, T0); // 失败
    s = ingestBatch(s, BATCH_B.id, T0, { dropInvalid: true }); // 修复重试

    const b = s.batches.find((x) => x.id === BATCH_B.id)!;
    expect(b.status).toBe('ingested');
    expect(b.items).toHaveLength(4); // 损坏条目已剔除
    // micromatch/chalk 全新入库；dayjs 与 A 批同指纹 → 去重；GPL 自动拒绝
    expect(activePackage(s.packages, 'micromatch')).toBeTruthy();
    expect(activePackage(s.packages, 'chalk')).toBeTruthy();
    expect(b.report!.duplicated).toHaveLength(1);
    expect(effectiveRuling(s, 'readline-sync', T0).decision).toBe('deny');
    // 指纹全局唯一
    const fps = s.packages.map((p) => p.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
  });

  it('已入库批次不能重复写入', () => {
    let s = freshState();
    s = ingestBatch(s, BATCH_A.id, T0);
    expect(() => ingestBatch(s, BATCH_A.id, T0)).toThrow(BatchRejected);
  });
});

describe('同一内容指纹全局只收一次', () => {
  it('新指纹入库后可被跨批检出', () => {
    let s = freshState();
    expect(fingerprintExists(s.packages, contentFingerprint({
      name: 'dayjs', version: '1.11.13', license: 'MIT', contentCode: 'dayjs-1.11.13#src',
    }))).toBe(false);
    s = ingestBatch(s, BATCH_A.id, T0);
    expect(fingerprintExists(s.packages, contentFingerprint({
      name: 'dayjs', version: '1.11.13', license: 'MIT', contentCode: 'dayjs-1.11.13#src',
    }))).toBe(true);
  });
});

describe('策略版本升级', () => {
  it('发布新策略后所有现行裁决失效，全部回到待复核，历史记录保留', () => {
    let s = freshState();
    s = ingestBatch(s, BATCH_A.id, T0);
    const verdictCount = s.verdicts.length;
    s = publishPolicy(
      s,
      { version: '2026.09', notes: '收紧 BSD/Apache', defaults: DEFAULT_POLICY_2026_09 },
      T0 + DAY,
    );
    expect(s.policy.version).toBe('2026.09');
    expect(s.verdicts.every((v) => !v.active)).toBe(true);
    expect(s.verdicts).toHaveLength(verdictCount); // 记录一条不丢
    const activeFail = s.verdicts.filter((v) => v.invalidated === 'policy-updated').length;
    expect(activeFail).toBeGreaterThan(0);
    // 当前有效裁决全部 pending
    expect(currentRulings(s, T0 + DAY).every((r) => r.ruling.decision === 'pending')).toBe(true);
    // 内容未变的包（chart.js）：指纹仍匹配但策略版本已变
    expect(effectiveRuling(s, 'chart.js', T0 + DAY).reason).toContain('策略已升级');
    // react 既换了内容又换了策略，同样回到待复核；EX-001 因策略版本不一致无法沿用
    expect(effectiveRuling(s, 'react', T0 + DAY).decision).toBe('pending');
    // 历史仍可查询
    expect(packageHistory(s, 'dayjs').verdicts[0].policyVersion).toBe(CURRENT_POLICY_VERSION);
  });

  it('新策略下重新人工裁决后恢复有效', () => {
    let s = freshState();
    s = publishPolicy(s, { version: '2026.09', notes: 'n', defaults: DEFAULT_POLICY_2026_09 }, T0 + DAY);
    s = decide(s, { key: 'react', decision: 'allow', reason: '新策略下复审通过', by: 'Zen Li' }, T0 + DAY);
    const r = effectiveRuling(s, 'react', T0 + DAY);
    expect(r.decision).toBe('allow');
    expect(r.verdict!.policyVersion).toBe('2026.09');
    // 旧裁决被新裁决取代
    const reactVerdicts = s.verdicts.filter((v) => v.key === 'react');
    expect(reactVerdicts.filter((v) => v.active)).toHaveLength(1);
  });
});

describe('清单对账', () => {
  it('matched / drifted / missing 三态', () => {
    let s = freshState();
    expect(reconcile(s, s.manifest.find((m) => m.name === 'lodash')!)).toBe('matched');
    s = ingestBatch(s, BATCH_A.id, T0);
    expect(reconcile(s, s.manifest.find((m) => m.name === 'lodash')!)).toBe('drifted');
    expect(reconcile(s, { name: 'not-yet-scanned', version: '1.0.0', license: 'MIT', declaredAt: T0 })).toBe('missing');
  });
});

describe('统计与报告口径', () => {
  it('换代包不重复计数；报告排除失效裁决', () => {
    let s = freshState();
    s = ingestBatch(s, BATCH_A.id, T0);
    const st = stats(s, T0);
    expect(st.total).toBe(7); // 5 旧包（react/lodash 换代）+ dayjs + ajv
    expect(st.pending).toBe(2); // react、lodash
    expect(st.viaException).toBe(0); // react 已换代 → EX-001 指纹不匹配，无例外生效
    const report = buildReport(s, T0);
    expect(report).toContain('策略版本：' + CURRENT_POLICY_VERSION);
    expect(report).not.toContain('18.3.1'); // 旧版本不进报告
    expect(report).toContain('18.3.2');
  });
});
