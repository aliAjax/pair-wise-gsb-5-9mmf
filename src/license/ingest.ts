import type {
  BatchItemResult,
  DBShape,
  ItemOutcome,
  LegacyDep,
  RiskLevel,
  Verdict,
} from './types';
import {coord, fingerprintOf} from './fingerprint';
import {currentPolicy, currentVerdict, matchRule, statusOfLevel} from './engine';

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function newBatchId(): string {
  return uid('batch');
}

/* ---------------- 单包裁决 ---------------- */

function buildAutoVerdict(db: DBShape, fp: string, name: string, version: string, license: string | null, now: string): Verdict {
  const policy = currentPolicy(db);
  const rule = matchRule(policy, license);
  return {
    id: uid('v'),
    fingerprint: fp,
    name,
    version,
    license,
    policyVersion: policy.id,
    status: statusOfLevel(rule.level),
    level: rule.level,
    source: 'policy-auto',
    note: rule.note,
    createdAt: now,
    supersededAt: null,
  };
}

/* ---------------- 批次原子提交 ---------------- */

export interface CommitResult {
  ok: boolean;
  db: DBShape;
  itemResults?: BatchItemResult[];
  error?: string;
}

/**
 * 原子地提交一个批次：
 * 1) 先在副本上把整批跑完（去重 / 失效 / 入库 / 自动裁决）；
 * 2) 再模拟一次「持久化写入」。写入失败时返回原库 + 批次标记 pending-retry，
 *    已提交记录完全不受影响，只有该批保留待重试。
 */
export function commitBatch(dbInput: DBShape, batchId: string, now: string = new Date().toISOString()): CommitResult {
  const batch = dbInput.batches.find(b => b.id === batchId);
  if (!batch) return {ok: false, db: dbInput, error: `批次 ${batchId} 不存在`};
  if (batch.state === 'committed') return {ok: false, db: dbInput, error: '该批次已提交，不能重复提交'};

  // 第一步：在副本上构建提交后的完整状态
  const db: DBShape = structuredClone(dbInput);
  const working = db.batches.find(b => b.id === batchId)!;
  const results: BatchItemResult[] = [];
  const seen = new Set<string>();

  for (const item of working.items) {
    const fp = fingerprintOf(item);
    const c = coord(item.name, item.version);
    if (seen.has(fp)) {
      // 同一批内的重复内容：只收一次
      results.push({fingerprint: fp, coord: c, outcome: 'updated-same'});
      continue;
    }
    seen.add(fp);

    const existing = db.packages[fp];
    const currentFp = db.coordIndex[c];

    if (existing) {
      // 同一内容指纹 —— 只收一次：更新来源与发现时间，不产生任何新裁决
      existing.sources = Array.from(new Set([...existing.sources, item.source]));
      existing.lastSeenAt = now;
      results.push({fingerprint: fp, coord: c, outcome: 'updated-same'});
      continue;
    }

    if (currentFp && currentFp !== fp) {
      // 同名同版本但指纹不同 = 包内容变了：旧裁决失效，新内容回到待复核
      const oldPkg = db.packages[currentFp];
      if (oldPkg) {
        oldPkg.supersededBy = fp;
        for (const v of db.verdicts) {
          if (v.fingerprint === currentFp && v.supersededAt === null) {
            v.supersededAt = now;
            v.reasonSuperseded = 'content-changed';
          }
        }
      }
      db.packages[fp] = {
        fingerprint: fp,
        name: item.name,
        version: item.version,
        license: item.license,
        filesSignature: item.filesSignature,
        sources: [item.source],
        firstSeenAt: now,
        lastSeenAt: now,
        activeVerdictId: null, // 原裁决不沿用，回到待复核
      };
      db.coordIndex[c] = fp;
      results.push({fingerprint: fp, coord: c, outcome: 'pending-changed'});
      continue;
    }

    // 全新坐标 + 全新指纹：入库
    const outcome: ItemOutcome = item.license === null ? 'pending-unknown' : 'inserted';
    const verdict = item.license === null ? undefined : buildAutoVerdict(db, fp, item.name, item.version, item.license, now);
    if (verdict) db.verdicts.push(verdict);
    db.packages[fp] = {
      fingerprint: fp,
      name: item.name,
      version: item.version,
      license: item.license,
      filesSignature: item.filesSignature,
      sources: [item.source],
      firstSeenAt: now,
      lastSeenAt: now,
      activeVerdictId: verdict ? verdict.id : null,
    };
    db.coordIndex[c] = fp;
    results.push({fingerprint: fp, coord: c, outcome});
  }

  // 第二步：模拟持久化写入。包/裁决的改动整批回滚，
  // 但该批次自身的队列状态（待重试/尝试次数/错误）必须保留
  const inputBatch = dbInput.batches.find(b => b.id === batchId)!;
  inputBatch.attempts += 1;
  if (working.simulateFailureOnce) {
    inputBatch.simulateFailureOnce = false;
    inputBatch.state = 'pending-retry';
    inputBatch.lastError = '写入存储失败（设备离线 / 磁盘错误），本批保留待重试，已入库记录不受影响';
    // 返回原库：副本上的全部包/裁决改动被丢弃；已提交记录不受影响
    return {ok: false, db: dbInput, error: inputBatch.lastError, itemResults: results};
  }
  inputBatch.simulateFailureOnce = false;

  working.state = 'committed';
  working.committedAt = now;
  working.lastError = undefined;
  working.itemResults = results;
  return {ok: true, db, itemResults: results};
}

/* ---------------- 策略升级 ---------------- */

/**
 * 发布新版策略：所有基于旧策略的当前裁决立即失效（policy-updated），
 * 对应包回到待复核。旧裁决保留不删，历史结论仍可查询。
 * 指纹绑定的例外因策略版本不一致，自动不再沿用（见 engine.exceptionStateFor）。
 */
export function publishPolicy(dbInput: DBShape, policy: typeof dbInput.policies[number], now: string = new Date().toISOString()): DBShape {
  const db: DBShape = structuredClone(dbInput);
  db.policies.push(policy);
  db.currentPolicyVersion = policy.id;
  for (const v of db.verdicts) {
    if (v.supersededAt === null && v.policyVersion !== policy.id) {
      v.supersededAt = now;
      v.reasonSuperseded = 'policy-updated';
    }
  }
  for (const p of Object.values(db.packages)) {
    if (p.activeVerdictId) {
      const v = db.verdicts.find(x => x.id === p.activeVerdictId);
      if (v && v.supersededAt) p.activeVerdictId = null;
    }
  }
  return db;
}

/** 按当前策略，对一个待复核包重新裁决（自动套用策略规则）。许可证未识别的包需人工，不自动裁决 */
export function readjudicate(dbInput: DBShape, fingerprint: string, now: string = new Date().toISOString()): DBShape {
  const pkg = dbInput.packages[fingerprint];
  if (!pkg || pkg.license === null) return dbInput;
  const view = currentVerdict(dbInput, pkg, now);
  if (view.status !== 'pending') return dbInput;

  const db: DBShape = structuredClone(dbInput);
  const p = db.packages[fingerprint];
  const verdict = buildAutoVerdict(db, fingerprint, p.name, p.version, p.license, now);
  db.verdicts.push(verdict);
  p.activeVerdictId = verdict.id;
  return db;
}

/** 一键：所有待复核包按当前策略重新裁决 */
export function readjudicateAllPending(dbInput: DBShape, now: string = new Date().toISOString()): DBShape {
  let db = dbInput;
  for (const pkg of Object.values(dbInput.packages).filter(p => !p.supersededBy)) {
    if (currentVerdict(db, pkg, now).status === 'pending') {
      db = readjudicate(db, pkg.fingerprint, now);
    }
  }
  return db;
}

/** 人工复核结论 */
export function manualReview(
  dbInput: DBShape,
  fingerprint: string,
  level: RiskLevel,
  reviewer: string,
  note: string,
  now: string = new Date().toISOString(),
): DBShape {
  const pkg = dbInput.packages[fingerprint];
  if (!pkg) return dbInput;
  const db: DBShape = structuredClone(dbInput);
  const p = db.packages[fingerprint];
  const policy = currentPolicy(db);
  const verdict: Verdict = {
    id: uid('v'),
    fingerprint,
    name: p.name,
    version: p.version,
    license: p.license,
    policyVersion: policy.id,
    status: statusOfLevel(level),
    level,
    source: 'manual',
    reviewer,
    note: note || `人工复核结论：${level}`,
    createdAt: now,
    supersededAt: null,
  };
  db.verdicts.push(verdict);
  p.activeVerdictId = verdict.id;
  return db;
}

/* ---------------- 旧数据迁移 ---------------- */

const LEGACY_LEVEL: Record<LegacyDep['status'], RiskLevel> = {ok: 'allow', warn: 'review', risk: 'deny'};

/**
 * 首次打开迁移：旧版扁平依赖 → v2 库。
 * - 为每个旧包补算内容指纹（无包体签名时基于名称/版本/许可证，稳定可复现）
 * - 旧结论迁移为绑定「当前策略版本」的 legacy-migrated 裁决，历史结论仍可查询
 * 不存在旧数据时返回 null。
 */
export function migrateLegacy(
  legacy: LegacyDep[],
  db: DBShape,
  now: string = new Date().toISOString(),
): DBShape | null {
  if (!legacy.length) return null;
  const out: DBShape = structuredClone(db);

  for (const dep of legacy) {
    const fp = fingerprintOf({name: dep.name, version: dep.version, license: dep.license});
    const c = coord(dep.name, dep.version);
    if (out.packages[fp]) continue;

    const verdict: Verdict = {
      id: uid('v'),
      fingerprint: fp,
      name: dep.name,
      version: dep.version,
      license: dep.license,
      policyVersion: out.currentPolicyVersion,
      status: dep.status,
      level: LEGACY_LEVEL[dep.status],
      source: 'legacy-migrated',
      note: `历史结论（迁移）：${dep.note}`,
      createdAt: now,
      supersededAt: null,
    };
    out.verdicts.push(verdict);
    out.packages[fp] = {
      fingerprint: fp,
      name: dep.name,
      version: dep.version,
      license: dep.license,
      sources: ['site-manifest'],
      firstSeenAt: now,
      lastSeenAt: now,
      activeVerdictId: verdict.id,
    };
    out.coordIndex[c] = fp;
  }

  out.migratedAt = now;
  out.legacyCount = legacy.length;
  return out;
}
