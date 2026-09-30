// 领域模型：依赖清单 × 离线扫描包 × 策略版本 × 站内例外审批
// 所有合并/裁决规则都在 engine.ts 中以纯函数实现，UI 只负责调用与展示。

export type License =
  | 'MIT'
  | 'BSD-3-Clause'
  | 'Apache-2.0'
  | 'MPL-2.0'
  | 'LGPL-2.1'
  | 'GPL-3.0'
  | 'AGPL-3.0'
  | 'UNKNOWN';

export const LICENSES: License[] = [
  'MIT',
  'BSD-3-Clause',
  'Apache-2.0',
  'MPL-2.0',
  'LGPL-2.1',
  'GPL-3.0',
  'AGPL-3.0',
  'UNKNOWN',
];

/** 裁决结论 */
export type Decision = 'allow' | 'review' | 'deny';

/** 旧裁决失效原因 */
export type InvalidationReason =
  | 'content-changed' // 包内容指纹变化
  | 'policy-updated' // 策略版本升级
  | 're-adjudicated'; // 被更新的裁决取代

/**
 * 离线扫描包中的一个条目。contentCode 代表包内容（对应真实场景下
 * tarball 的文件清单与逐文件哈希），是内容指纹的输入。
 */
export interface PkgContent {
  name: string;
  version: string;
  license: License;
  contentCode: string;
}

/**
 * 已入库包记录。同一逻辑包（key=name）可存在多条记录，
 * 但任意时刻只有最新一条 superseded=false；内容指纹则全局唯一、只收一次。
 */
export interface PackageRecord extends PkgContent {
  key: string;
  fingerprint: string;
  batchId: string | null; // 迁移而来的历史数据为 null
  ingestedAt: number;
  superseded: boolean;
}

/** 站内清单（声明依赖）条目 */
export interface ManifestEntry {
  name: string;
  version: string;
  license: License;
  declaredAt: number;
}

/**
 * 站点裁决。裁决作出时同时锁定包指纹与策略版本；
 * 任一条件不再匹配，该裁决即不再有效（但记录保留可查）。
 */
export interface Verdict {
  id: string;
  key: string;
  fingerprint: string;
  policyVersion: string;
  decision: Decision;
  reason: string;
  decidedAt: number;
  decidedBy: string;
  auto?: boolean; // 由策略默认规则自动给出
  migrated?: boolean; // 旧版数据迁移补录
  active: boolean;
  invalidated?: InvalidationReason;
}

/** 站内例外审批：仅在指纹、策略版本双匹配且未过期时可沿用 */
export interface SiteException {
  id: string;
  key: string;
  fingerprint: string;
  policyVersion: string;
  grantedBy: string;
  reason: string;
  grantedAt: number;
  expiresAt: number;
  revoked?: boolean;
}

export type ExceptionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'fingerprint-mismatch'
  | 'policy-mismatch';

/** 离线扫描包条目；corrupt 表示该条目离线介质损坏、校验不通过 */
export interface BatchItem extends PkgContent {
  corrupt?: boolean;
}

export interface IngestionReport {
  added: string[]; // 新收入库的包
  duplicated: string[]; // 内容指纹一致，按指纹只收一次
  changed: { key: string; name: string; fromVersion: string; toVersion: string }[]; // 同包内容变化
}

export interface ScanBatch {
  id: string;
  label: string;
  arrivedAt: number;
  items: BatchItem[];
  status: 'pending' | 'ingested' | 'failed';
  error: string | null;
  attempts: number;
  report?: IngestionReport;
  ingestedAt?: number;
}

export interface Policy {
  version: string;
  publishedAt: number;
  /** 许可证 → 策略默认裁决（新包首次入库时自动套用） */
  defaults: Record<License, Decision>;
  notes: string;
}

export interface AppState {
  schemaVersion: 2;
  policy: Policy;
  packages: PackageRecord[];
  manifest: ManifestEntry[];
  verdicts: Verdict[];
  exceptions: SiteException[];
  batches: ScanBatch[];
  migratedAt: number | null;
  legacyBackup: unknown;
  /** 演示时钟锚点：模拟时间 = T0 + (真实时间 - bootReal) */
  bootReal: number;
}

/** 清单条目与已入库包的对账结果 */
export type ReconcileStatus =
  | 'matched' // 清单版本 == 当前入库版本
  | 'drifted' // 同包已入库但版本（内容）已变化
  | 'missing'; // 清单有声明，尚无扫描包入库

/** 当前有效裁决（清单/统计/报告唯一使用的口径） */
export interface EffectiveRuling {
  decision: Decision | 'pending';
  source: 'manual-verdict' | 'auto-verdict' | 'exception' | 'none';
  reason: string;
  verdict?: Verdict;
  exception?: SiteException;
}
