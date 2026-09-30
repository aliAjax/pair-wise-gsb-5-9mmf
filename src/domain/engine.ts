import {
  AppState,
  BatchItem,
  Decision,
  EffectiveRuling,
  ExceptionStatus,
  InvalidationReason,
  License,
  ManifestEntry,
  PackageRecord,
  ReconcileStatus,
  ScanBatch,
  SiteException,
  Verdict,
} from './types';
import { contentFingerprint, packageKey } from './fingerprint';

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// 读取 / 选择器
// ---------------------------------------------------------------------------

/** 某包当前这一代记录（最新入库、未被取代） */
export function activePackage(
  packages: PackageRecord[],
  key: string,
): PackageRecord | undefined {
  return packages
    .filter((p) => p.key === key && !p.superseded)
    .sort((a, b) => b.ingestedAt - a.ingestedAt)[0];
}

export function allActivePackages(packages: PackageRecord[]): PackageRecord[] {
  return packages.filter((p) => !p.superseded);
}

/** 该指纹是否曾经收入库（内容指纹全局唯一，只收一次） */
export function fingerprintExists(
  packages: PackageRecord[],
  fingerprint: string,
): boolean {
  return packages.some((p) => p.fingerprint === fingerprint);
}

function activeVerdictFor(
  verdicts: Verdict[],
  key: string,
): Verdict | undefined {
  return verdicts
    .filter((v) => v.key === key && v.active)
    .sort((a, b) => b.decidedAt - a.decidedAt)[0];
}

/**
 * 例外是否可沿用：包指纹一致 + 策略版本一致 + 未过期 + 未撤销，
 * 四个条件缺一不可。
 */
export function exceptionStatus(
  ex: SiteException,
  pkg: PackageRecord | undefined,
  policyVersion: string,
  now: number,
): ExceptionStatus {
  if (ex.revoked) return 'revoked';
  if (now >= ex.expiresAt) return 'expired';
  if (!pkg || pkg.fingerprint !== ex.fingerprint) return 'fingerprint-mismatch';
  if (ex.policyVersion !== policyVersion) return 'policy-mismatch';
  return 'active';
}

export function exceptionStatusLabel(s: ExceptionStatus): string {
  switch (s) {
    case 'active':
      return '可沿用';
    case 'expired':
      return '已过期';
    case 'revoked':
      return '已撤销';
    case 'fingerprint-mismatch':
      return '包指纹不一致';
    case 'policy-mismatch':
      return '策略版本不一致';
  }
}

/**
 * 当前有效裁决 —— 清单 / 统计 / 报告的唯一口径。
 * 顺序：可沿用的站内例外 > 与指纹和策略双匹配的站点裁决 > 待复核。
 */
export function effectiveRuling(
  state: Pick<AppState, 'packages' | 'verdicts' | 'exceptions' | 'policy'>,
  key: string,
  now: number,
): EffectiveRuling {
  const pkg = activePackage(state.packages, key);
  if (!pkg) {
    return { decision: 'pending', source: 'none', reason: '扫描包尚未入库' };
  }

  // 1) 站内例外：只有三条件全部满足才沿用
  const usableException = state.exceptions
    .filter((ex) => ex.key === key && !ex.revoked)
    .find(
      (ex) =>
        exceptionStatus(ex, pkg, state.policy.version, now) === 'active',
    );
  if (usableException) {
    return {
      decision: 'allow',
      source: 'exception',
      reason: `例外审批 ${usableException.id} 允许沿用（指纹与策略版本双匹配、未过期）`,
      exception: usableException,
    };
  }

  // 2) 站点裁决：active 仅是前提，指纹/策略仍须与当前一致
  const verdict = activeVerdictFor(state.verdicts, key);
  if (
    verdict &&
    verdict.fingerprint === pkg.fingerprint &&
    verdict.policyVersion === state.policy.version
  ) {
    return {
      decision: verdict.decision,
      source: verdict.auto ? 'auto-verdict' : 'manual-verdict',
      reason: verdict.reason,
      verdict,
    };
  }

  // 3) 回到待复核，并解释原裁决为何失效
  const stale = state.verdicts
    .filter((v) => v.key === key)
    .sort((a, b) => b.decidedAt - a.decidedAt)[0];
  if (stale && stale.fingerprint !== pkg.fingerprint) {
    return {
      decision: 'pending',
      source: 'none',
      reason: '包内容已变化，原裁决失效，回到待复核',
    };
  }
  if (stale && stale.policyVersion !== state.policy.version) {
    return {
      decision: 'pending',
      source: 'none',
      reason: `策略已升级到 ${state.policy.version}，原裁决失效，回到待复核`,
    };
  }
  return { decision: 'pending', source: 'none', reason: '等待站点复核' };
}

// ---------------------------------------------------------------------------
// 清单对账
// ---------------------------------------------------------------------------

export function reconcile(
  state: Pick<AppState, 'packages' | 'manifest'>,
  entry: ManifestEntry,
): ReconcileStatus {
  const pkg = activePackage(state.packages, packageKey(entry.name));
  if (!pkg) return 'missing';
  if (pkg.version === entry.version) return 'matched';
  return 'drifted';
}

// ---------------------------------------------------------------------------
// 扫描批次：校验 + 原子写入
// ---------------------------------------------------------------------------

export function validateItem(item: BatchItem): string | null {
  if (item.corrupt) return '离线介质条目损坏，内容校验不通过';
  if (!item.name || !item.name.trim()) return '缺少包名';
  if (!item.contentCode || !item.contentCode.trim())
    return '缺少包内容代码（无法计算内容指纹）';
  if (
    !['MIT', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0', 'LGPL-2.1', 'GPL-3.0', 'AGPL-3.0', 'UNKNOWN'].includes(
      item.license,
    )
  )
    return `无法识别的许可证：${item.license}`;
  return null;
}

export class BatchRejected extends Error {}

interface IngestOptions {
  /** 修复后重试：剔除校验失败的条目（用于“剔除损坏条目并重试”） */
  dropInvalid?: boolean;
}

/**
 * 写入一个扫描批次。原子语义：
 *  - 任一条目不合法且未允许剔除 → 整批拒绝，state 中除“该批次标记为 failed、
 *    保留待重试”外不做任何改动；此前已入库记录不受影响；
 *  - 全部合法 → 同一批一次性提交（去重 / 换代 / 失效 / 自动初判 / 批次状态）。
 */
export function ingestBatch(
  prev: AppState,
  batchId: string,
  now: number,
  opts: IngestOptions = {},
): AppState {
  const batch = prev.batches.find((b) => b.id === batchId);
  if (!batch) throw new BatchRejected(`批次不存在：${batchId}`);
  if (batch.status === 'ingested')
    throw new BatchRejected('该批次已入库，不能重复写入');

  let items = batch.items.map((it) => ({ ...it }));
  const invalid: { item: BatchItem; error: string }[] = [];
  for (const it of items) {
    const err = validateItem(it);
    if (err) invalid.push({ item: it, error: err });
  }

  if (invalid.length > 0 && !opts.dropInvalid) {
    // 整批失败：只更新该批次自身，其余数据不动
    return {
      ...prev,
      batches: prev.batches.map((b) =>
        b.id === batchId
          ? {
              ...b,
              status: 'failed',
              attempts: b.attempts + 1,
              error: `整批写入失败（${invalid.length} 个条目异常）：${invalid
                .map((x) => `${x.item.name || '未命名包'} — ${x.error}`)
                .join('；')}。已入库记录不受影响，本批保留待重试。`,
            }
          : b,
      ),
    };
  }

  if (opts.dropInvalid && invalid.length > 0) {
    const bad = new Set(invalid.map((x) => x.item));
    items = items.filter((it) => !bad.has(it));
  }

  // ---- 以下为本批的原子提交，全部基于副本进行 ----
  let packages = prev.packages.map((p) => ({ ...p }));
  let verdicts = prev.verdicts.map((v) => ({ ...v }));
  const added: string[] = [];
  const duplicated: string[] = [];
  const changed: { key: string; name: string; fromVersion: string; toVersion: string }[] =
    [];
  const seenInBatch = new Set<string>();

  const invalidateVerdicts = (key: string, reason: InvalidationReason) => {
    verdicts = verdicts.map((v) =>
      v.key === key && v.active
        ? { ...v, active: false, invalidated: reason }
        : v,
    );
  };

  for (const item of items) {
    const key = packageKey(item.name);
    const fingerprint = contentFingerprint(item);

    // 规则一：同一包按内容指纹只收一次（跨批 + 批内去重）
    if (seenInBatch.has(fingerprint) || fingerprintExists(packages, fingerprint)) {
      duplicated.push(`${item.name}@${item.version}（${fingerprint.slice(0, 13)}…）`);
      continue;
    }
    seenInBatch.add(fingerprint);

    const previous = activePackage(packages, key);
    const record: PackageRecord = {
      key,
      name: item.name,
      version: item.version,
      license: item.license,
      contentCode: item.contentCode,
      fingerprint,
      batchId,
      ingestedAt: now,
      superseded: false,
    };

    if (previous) {
      // 规则二：包内容一变（指纹不同），旧记录换代、原裁决失效回到待复核
      packages = packages.map((p) =>
        p.fingerprint === previous.fingerprint
          ? { ...p, superseded: true }
          : p,
      );
      invalidateVerdicts(key, 'content-changed');
      changed.push({
        key,
        name: item.name,
        fromVersion: previous.version,
        toVersion: item.version,
      });
    } else {
      added.push(`${item.name}@${item.version}`);
    }
    packages.push(record);

    // 全新包：按当前策略默认结论自动初判；
    // 换代包不自动给结论 —— 已按规则回到待复核。
    if (!previous) {
      const decision = prev.policy.defaults[item.license];
      verdicts.push({
        id: uid('vd'),
        key,
        fingerprint,
        policyVersion: prev.policy.version,
        decision,
        auto: true,
        reason: `按策略 ${prev.policy.version} 默认规则自动初判：${defaultReason(
          item.license,
          decision,
        )}`,
        decidedAt: now,
        decidedBy: '策略引擎',
        active: true,
      });
    }
  }

  return {
    ...prev,
    packages,
    verdicts,
    batches: prev.batches.map((b) =>
      b.id === batchId
        ? {
            ...b,
            items,
            status: 'ingested',
            attempts: b.attempts + 1,
            error: null,
            ingestedAt: now,
            report: { added, duplicated, changed },
          }
        : b,
    ),
  };
}

function defaultReason(license: License, decision: Decision): string {
  switch (decision) {
    case 'allow':
      return `${license} 为宽松许可`;
    case 'review':
      return `${license} 存在保留/弱著佐权义务，需人工确认`;
    default:
      return `${license} 与闭源分发存在冲突风险`;
  }
}

// ---------------------------------------------------------------------------
// 人工裁决 / 例外审批
// ---------------------------------------------------------------------------

export function decide(
  prev: AppState,
  args: { key: string; decision: Decision; reason: string; by: string },
  now: number,
): AppState {
  const pkg = activePackage(prev.packages, args.key);
  if (!pkg) throw new Error('包尚未入库，无法裁决');
  const verdicts = prev.verdicts.map((v) =>
    v.key === args.key && v.active
      ? { ...v, active: false, invalidated: 're-adjudicated' as const }
      : v,
  );
  const verdict: Verdict = {
    id: uid('vd'),
    key: args.key,
    fingerprint: pkg.fingerprint, // 裁决锁定当前内容指纹
    policyVersion: prev.policy.version, // 裁决锁定当前策略版本
    decision: args.decision,
    reason: args.reason.trim() || '人工复核结论',
    decidedAt: now,
    decidedBy: args.by,
    active: true,
  };
  return { ...prev, verdicts: [...verdicts, verdict] };
}

export function grantException(
  prev: AppState,
  args: {
    key: string;
    reason: string;
    grantedBy: string;
    ttlDays: number;
  },
  now: number,
): AppState {
  const pkg = activePackage(prev.packages, args.key);
  if (!pkg) throw new Error('包尚未入库，不能审批例外');
  const ex: SiteException = {
    id: uid('ex'),
    key: args.key,
    fingerprint: pkg.fingerprint,
    policyVersion: prev.policy.version,
    grantedBy: args.grantedBy,
    reason: args.reason.trim() || '站内例外审批',
    grantedAt: now,
    expiresAt: now + args.ttlDays * 86400000,
  };
  return { ...prev, exceptions: [...prev.exceptions, ex] };
}

export function revokeException(prev: AppState, exceptionId: string): AppState {
  return {
    ...prev,
    exceptions: prev.exceptions.map((ex) =>
      ex.id === exceptionId ? { ...ex, revoked: true } : ex,
    ),
  };
}

// ---------------------------------------------------------------------------
// 策略版本发布：旧裁决一律失效，回到待复核（记录保留可查）
// ---------------------------------------------------------------------------

export function publishPolicy(
  prev: AppState,
  args: { version: string; notes: string; defaults: Record<License, Decision> },
  now: number,
): AppState {
  const verdicts = prev.verdicts.map((v) =>
    v.active
      ? { ...v, active: false, invalidated: 'policy-updated' as const }
      : v,
  );
  return {
    ...prev,
    policy: { version: args.version, publishedAt: now, defaults: args.defaults, notes: args.notes },
    verdicts,
  };
}

// ---------------------------------------------------------------------------
// 站内清单维护
// ---------------------------------------------------------------------------

export function upsertManifest(
  prev: AppState,
  entry: Omit<ManifestEntry, 'declaredAt'>,
  now: number,
): AppState {
  const key = packageKey(entry.name);
  const others = prev.manifest.filter((m) => packageKey(m.name) !== key);
  return {
    ...prev,
    manifest: [...others, { ...entry, declaredAt: now }],
  };
}

// ---------------------------------------------------------------------------
// 历史结论查询（含已换代包记录、失效裁决、失效例外）
// ---------------------------------------------------------------------------

export interface PackageHistory {
  packages: PackageRecord[]; // 旧 → 新
  verdicts: Verdict[]; // 旧 → 新
  exceptions: SiteException[]; // 旧 → 新
}

export function packageHistory(state: AppState, key: string): PackageHistory {
  return {
    packages: state.packages
      .filter((p) => p.key === key)
      .sort((a, b) => a.ingestedAt - b.ingestedAt),
    verdicts: state.verdicts
      .filter((v) => v.key === key)
      .sort((a, b) => a.decidedAt - b.decidedAt),
    exceptions: state.exceptions
      .filter((ex) => ex.key === key)
      .sort((a, b) => a.grantedAt - b.grantedAt),
  };
}

// ---------------------------------------------------------------------------
// 旧数据首次打开迁移
// ---------------------------------------------------------------------------

/** v1（旧版 License Lens）持久化结构 */
export interface LegacyDep {
  id: number;
  name: string;
  version: string;
  license: string;
  source: string;
  status: 'ok' | 'warn' | 'risk';
  note: string;
}

/**
 * 首次打开迁移：
 *  - 为旧记录补算内容指纹、补登策略版本；
 *  - 旧结论迁移为历史裁决（migrated 标记），仍可在历史中查询；
 *  - 清单/统计/报告只取与当前指纹、当前策略双匹配的有效裁决。
 */
export function migrateLegacy(
  legacy: LegacyDep[],
  policyVersion: string,
  now: number,
  seedBatches: ScanBatch[],
  seedExceptions: SiteException[],
): AppState {
  const packages: PackageRecord[] = [];
  const verdicts: Verdict[] = [];
  const manifest: ManifestEntry[] = [];

  legacy.forEach((dep, i) => {
    const key = packageKey(dep.name);
    const license = normalizeLicense(dep.license);
    const contentCode = `legacy-content@${dep.version}`;
    const fingerprint = contentFingerprint({
      name: key,
      version: dep.version,
      license,
      contentCode,
    });
    packages.push({
      key,
      name: dep.name,
      version: dep.version,
      license,
      contentCode,
      fingerprint,
      batchId: null,
      ingestedAt: now - (legacy.length - i) * 3600000,
      superseded: false,
    });
    manifest.push({
      name: dep.name,
      version: dep.version,
      license,
      declaredAt: now - (legacy.length - i) * 3600000,
    });
    verdicts.push({
      id: uid('vd'),
      key,
      fingerprint,
      policyVersion, // 补登策略版本
      decision: dep.status === 'ok' ? 'allow' : dep.status === 'warn' ? 'review' : 'deny',
      reason: `迁移自旧版结论：${dep.note}`,
      decidedAt: now - (legacy.length - i) * 3600000,
      decidedBy: dep.source ? `旧版扫描（${dep.source}）` : '旧版扫描',
      active: true,
      migrated: true,
    });
  });

  return {
    schemaVersion: 2,
    policy: {
      version: policyVersion,
      publishedAt: now - 30 * 86400000,
      defaults: DEFAULT_POLICY_2026_03,
      notes: '当前策略：宽松许可自动放行；弱著佐权/保留声明类需复核；强著佐权拒绝。',
    },
    packages,
    manifest,
    verdicts,
    exceptions: seedExceptions,
    batches: seedBatches,
    migratedAt: now,
    legacyBackup: legacy,
    bootReal: now,
  };
}

export function normalizeLicense(raw: string): License {
  const map: Record<string, License> = {
    MIT: 'MIT',
    'BSD-3-Clause': 'BSD-3-Clause',
    'Apache-2.0': 'Apache-2.0',
    'MPL-2.0': 'MPL-2.0',
    'LGPL-2.1': 'LGPL-2.1',
    'GPL-3.0': 'GPL-3.0',
    'AGPL-3.0': 'AGPL-3.0',
  };
  return map[raw] ?? 'UNKNOWN';
}

export const DEFAULT_POLICY_2026_03: Record<License, Decision> = {
  MIT: 'allow',
  'BSD-3-Clause': 'allow',
  'Apache-2.0': 'allow',
  'MPL-2.0': 'review',
  'LGPL-2.1': 'review',
  'GPL-3.0': 'deny',
  'AGPL-3.0': 'deny',
  UNKNOWN: 'review',
};

export const DEFAULT_POLICY_2026_09: Record<License, Decision> = {
  // 新策略收紧：BSD/Apache 也需要复核（展示策略升级后原裁决批量失效）
  MIT: 'allow',
  'BSD-3-Clause': 'review',
  'Apache-2.0': 'review',
  'MPL-2.0': 'review',
  'LGPL-2.1': 'deny',
  'GPL-3.0': 'deny',
  'AGPL-3.0': 'deny',
  UNKNOWN: 'review',
};
