import type {
  CurrentStatus,
  DBShape,
  ExceptionApproval,
  ExceptionIssue,
  PackageRecord,
  PendingReason,
  PolicyRule,
  PolicyVersion,
  RiskLevel,
  Verdict,
  VerdictStatus,
} from './types';
import {coord} from './fingerprint';

/* ---------------- 策略 ---------------- */

export function currentPolicy(db: DBShape): PolicyVersion {
  const p = db.policies.find(x => x.id === db.currentPolicyVersion);
  if (!p) throw new Error(`策略版本 ${db.currentPolicyVersion} 不存在`);
  return p;
}

export function policyOf(db: DBShape, id: string): PolicyVersion | undefined {
  return db.policies.find(p => p.id === id);
}

export function matchRule(policy: PolicyVersion, license: string | null): PolicyRule {
  if (license && policy.rules[license]) return policy.rules[license];
  return {
    level: policy.defaultLevel,
    note: license ? `当前策略未收录许可证 ${license}，按默认规则处理` : '扫描未识别许可证，需人工确认',
  };
}

const LEVEL_STATUS: Record<RiskLevel, VerdictStatus> = {
  allow: 'ok',
  review: 'warn',
  deny: 'risk',
};

export function statusOfLevel(level: RiskLevel): VerdictStatus {
  return LEVEL_STATUS[level];
}

/* ---------------- 例外审批 ---------------- */

export interface ApplicableException {
  exception: ExceptionApproval;
  applicable: true;
}

export interface InapplicableException {
  exception: ExceptionApproval;
  applicable: false;
  issues: ExceptionIssue[];
}

export type ExceptionState = ApplicableException | InapplicableException;

/**
 * 站内例外只有在「包指纹一致 + 策略版本一致 + 未过期 + 未撤销」时才能沿用。
 * 任一条件不满足，逐项列出原因。
 */
export function exceptionStateFor(
  ex: ExceptionApproval,
  fp: PackageRecord,
  policyId: string,
  nowIso: string,
): ExceptionState {
  const issues: ExceptionIssue[] = [];
  if (ex.fingerprint !== fp.fingerprint) issues.push('fingerprint-mismatch');
  if (ex.policyVersion !== policyId) issues.push('policy-mismatch');
  if (ex.expiresAt && ex.expiresAt < nowIso) issues.push('expired');
  if (ex.revokedAt) issues.push('revoked');
  return issues.length === 0 ? {exception: ex, applicable: true} : {exception: ex, applicable: false, issues};
}

export const EXCEPTION_ISSUE_TEXT: Record<ExceptionIssue, string> = {
  'fingerprint-mismatch': '包内容指纹不一致（包已变化）',
  'policy-mismatch': '策略版本不一致',
  expired: '例外已过期',
  revoked: '例外已撤销',
};

/* ---------------- 裁决查询 ---------------- */

export function verdictsFor(db: DBShape, fingerprint: string): Verdict[] {
  return db.verdicts
    .filter(v => v.fingerprint === fingerprint)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function exceptionsFor(db: DBShape, pkg: PackageRecord): ExceptionState[] {
  const now = new Date().toISOString();
  return db.exceptions
    .filter(e => e.name === pkg.name && e.version === pkg.version)
    .map(e => exceptionStateFor(e, pkg, db.currentPolicyVersion, now))
    .sort((a, b) => Number(b.applicable) - Number(a.applicable));
}

/** 可沿用的站内例外（指纹与策略版本一致且未过期） */
export function applicableException(db: DBShape, pkg: PackageRecord): ExceptionApproval | undefined {
  const now = new Date().toISOString();
  return db.exceptions
    .filter(e => e.name === pkg.name && e.version === pkg.version)
    .find(e => exceptionStateFor(e, pkg, db.currentPolicyVersion, now).applicable);
}

export interface CurrentVerdictView {
  pkg: PackageRecord;
  status: CurrentStatus;
  pendingReason?: PendingReason;
  /** 当前有效的裁决（未失效、策略版本与当前一致） */
  verdict?: Verdict;
  /** 沿用中的站内例外 */
  exception?: ExceptionApproval;
  level?: RiskLevel;
  note: string;
}

/**
 * 推导一个包的「当前有效裁决」。
 * 清单、统计、报告只允许使用本函数的结果；被内容变化/策略升级失效的旧结论一律显示为待复核。
 */
export function currentVerdict(db: DBShape, pkg: PackageRecord, nowIso = new Date().toISOString()): CurrentVerdictView {
  const verdict = pkg.activeVerdictId
    ? db.verdicts.find(v => v.id === pkg.activeVerdictId && v.supersededAt === null)
    : undefined;

  // 旧裁决绑定的策略版本已不是当前版本 → 旧结论不再有效，回到待复核
  if (verdict && verdict.policyVersion !== db.currentPolicyVersion) {
    return {
      pkg,
      status: 'pending',
      pendingReason: 'policy-updated',
      note: `策略已升级至 ${db.currentPolicyVersion}，该结论基于 ${verdict.policyVersion}，需按新策略复核`,
    };
  }

  const ex = applicableException(db, pkg);

  // 待复核：即使没有有效裁决，仍检查是否有可沿用的例外
  if (!verdict) {
    if (ex) {
      return {
        pkg,
        status: statusOfLevel(ex.grantedLevel),
        level: ex.grantedLevel,
        exception: ex,
        note: `沿用站内例外 ${ex.ticket}（审批人 ${ex.approver}）`,
      };
    }
    // 是否有被本内容替换掉的旧包 → 说明是「包内容变化」导致回到待复核
    const predecessor = Object.values(db.packages).find(p => p.supersededBy === pkg.fingerprint);
    // 该指纹上最近一条失效裁决（如策略升级导致）也用于区分待复核原因
    const lastSuperseded = db.verdicts
      .filter(v => v.fingerprint === pkg.fingerprint && v.supersededAt !== null)
      .sort((a, b) => (a.supersededAt! < b.supersededAt! ? 1 : -1))[0];
    const pendingReason: PendingReason = pkg.license === null
      ? 'unknown-license'
      : predecessor
        ? 'content-changed'
        : lastSuperseded?.reasonSuperseded === 'policy-updated'
          ? 'policy-updated'
          : 'no-verdict';
    return {
      pkg,
      status: 'pending',
      pendingReason,
      note: PENDING_REASON_TEXT[pendingReason],
    };
  }

  // 有有效裁决；例外（允许放行）优先于策略结论沿用
  if (ex && ex.grantedLevel === 'allow') {
    return {
      pkg,
      status: 'ok',
      level: 'allow',
      verdict,
      exception: ex,
      note: `策略结论为「${verdict.note}」，已由站内例外 ${ex.ticket} 放行`,
    };
  }

  return {
    pkg,
    status: verdict.status,
    level: verdict.level,
    verdict,
    note: verdict.note,
  };
}

export const PENDING_REASON_TEXT: Record<PendingReason, string> = {
  'no-verdict': '尚无裁决',
  'content-changed': '包内容已变化，原裁决失效',
  'policy-updated': '策略版本已更新，原结论失效',
  'unknown-license': '许可证未识别',
};

/** 当前清单：未被新内容替换的包（被替换的包只在历史中可见） */
export function currentPackages(db: DBShape): PackageRecord[] {
  return Object.values(db.packages)
    .filter(p => !p.supersededBy)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** 历史包记录（含被新内容替换的） */
export function historyPackages(db: DBShape, nameQuery = ''): PackageRecord[] {
  const q = nameQuery.trim().toLowerCase();
  return Object.values(db.packages)
    .filter(p => !q || p.name.toLowerCase().includes(q) || p.version.includes(q))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function pkgCoord(p: PackageRecord): string {
  return coord(p.name, p.version);
}
