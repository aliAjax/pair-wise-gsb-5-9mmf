// 依赖合规裁决系统的领域模型

/** 策略规则给出的风险等级 */
export type RiskLevel = 'allow' | 'review' | 'deny';

/** 界面使用的裁决状态：pending 表示尚无有效裁决、回到待复核 */
export type VerdictStatus = 'ok' | 'warn' | 'risk';
export type CurrentStatus = VerdictStatus | 'pending';

export type PackageSource = 'site-manifest' | 'offline-scan' | 'manual';

export type VerdictSource = 'policy-auto' | 'manual' | 'legacy-migrated';

/** 旧裁决失效原因 */
export type SupersedeReason = 'content-changed' | 'policy-updated';

/** 待复核原因 */
export type PendingReason = 'no-verdict' | 'content-changed' | 'policy-updated' | 'unknown-license';

/** 例外不能沿用的原因 */
export type ExceptionIssue = 'fingerprint-mismatch' | 'policy-mismatch' | 'expired' | 'revoked';

export interface PolicyRule {
  level: RiskLevel;
  note: string;
}

export interface PolicyVersion {
  id: string;
  publishedAt: string;
  note: string;
  rules: Record<string, PolicyRule>;
  /** 许可证不在规则表中时采用的默认等级 */
  defaultLevel: RiskLevel;
}

/** 离线扫描包 / 站内清单中的一条原始输入 */
export interface ScanItem {
  source: PackageSource;
  name: string;
  version: string;
  license: string | null;
  /** 扫描器给出的包体签名（tarball 哈希等），内容一变就变 */
  filesSignature?: string;
  /** 扫描器直接给出的内容指纹；缺省时由本系统计算 */
  fingerprint?: string;
  scannedAt: string;
}

/** 已入库的包：同一内容指纹全局只有一条 */
export interface PackageRecord {
  fingerprint: string;
  name: string;
  version: string;
  license: string | null;
  filesSignature?: string;
  sources: PackageSource[];
  firstSeenAt: string;
  lastSeenAt: string;
  /** 当前有效裁决 id；null 表示待复核 */
  activeVerdictId: string | null;
  /** 内容被新版本替换时，指向新指纹；被替换的包不再出现在当前清单 */
  supersededBy?: string;
}

/** 裁决（结论）。永不物理删除，失效只置 supersededAt，供历史查询 */
export interface Verdict {
  id: string;
  fingerprint: string;
  name: string;
  version: string;
  license: string | null;
  policyVersion: string;
  status: VerdictStatus;
  level: RiskLevel;
  source: VerdictSource;
  reviewer?: string;
  note: string;
  createdAt: string;
  supersededAt: string | null;
  reasonSuperseded?: SupersedeReason;
}

/** 站内例外审批 */
export interface ExceptionApproval {
  id: string;
  ticket: string;
  name: string;
  version: string;
  /** 例外只对这一个内容指纹有效 */
  fingerprint: string;
  /** 例外只在这一版策略下有效 */
  policyVersion: string;
  grantedLevel: RiskLevel;
  approver: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt?: string | null;
  note: string;
}

export type ItemOutcome =
  | 'inserted' // 新包入库并按当前策略自动裁决
  | 'updated-same' // 同一指纹，只更新来源/发现时间
  | 'pending-changed' // 坐标相同但内容变了，旧裁决失效、回到待复核
  | 'pending-unknown'; // 新包但许可证未知，需人工复核

export interface BatchItemResult {
  fingerprint: string;
  coord: string;
  outcome: ItemOutcome;
}

export interface IngestBatch {
  id: string;
  label: string;
  origin: string;
  arrivedAt: string;
  items: ScanItem[];
  state: 'queued' | 'pending-retry' | 'committed';
  attempts: number;
  lastError?: string;
  committedAt?: string;
  itemResults?: BatchItemResult[];
  /** 演示用：下一次提交时模拟写入失败，失败后自动清除 */
  simulateFailureOnce?: boolean;
}

export interface DBShape {
  schemaVersion: 2;
  policies: PolicyVersion[];
  currentPolicyVersion: string;
  /** 指纹 -> 包记录 */
  packages: Record<string, PackageRecord>;
  /** name@version -> 当前指纹 */
  coordIndex: Record<string, string>;
  verdicts: Verdict[];
  exceptions: ExceptionApproval[];
  batches: IngestBatch[];
  migratedAt?: string;
  legacyCount?: number;
}

/** 旧版（v1）localStorage 里的扁平依赖结构 */
export interface LegacyDep {
  id: number;
  name: string;
  version: string;
  license: string;
  source: string;
  status: 'ok' | 'warn' | 'risk';
  note: string;
}
