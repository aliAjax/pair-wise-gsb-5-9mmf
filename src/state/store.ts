import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from '../domain/types';
import {
  DEFAULT_POLICY_2026_09,
  LegacyDep,
  decide as engineDecide,
  grantException as engineGrant,
  ingestBatch as engineIngest,
  migrateLegacy,
  publishPolicy as enginePublish,
  revokeException as engineRevoke,
  upsertManifest as engineUpsertManifest,
} from '../domain/engine';
import {
  BATCH_A,
  BATCH_B,
  CURRENT_POLICY_VERSION,
  LEGACY_DEPS,
  T0,
  buildSeedExceptions,
} from '../domain/seed';

const STORAGE_KEY = 'license-lens-v2';
const LEGACY_KEY = 'license-lens';

/** 演示时钟：从 T0(2026-09-30 10:00) 起，随真实时间线性推进，刷新后保持连续 */
export function simNow(state: AppState): number {
  return T0 + (Date.now() - state.bootReal);
}

function boot(): AppState {
  // 首次打开：若浏览器里有 v1 数据则迁移真实旧数据；否则迁移内置旧版演示数据
  let legacy: LegacyDep[] | null = null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) legacy = parsed;
    }
  } catch {
    legacy = null;
  }
  // 清掉旧键，迁移完成后以 v2 结构持久化（旧数据备份保留在 state.legacyBackup）
  localStorage.removeItem(LEGACY_KEY);
  return migrateLegacy(
    legacy ?? LEGACY_DEPS,
    CURRENT_POLICY_VERSION,
    T0,
    [structuredClone(BATCH_A), structuredClone(BATCH_B)],
    buildSeedExceptions(),
  );
}

export function useStore() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState;
        if (parsed.schemaVersion === 2) return parsed;
      }
    } catch {
      /* fall through to boot */
    }
    return boot();
  });

  // 每秒推进一次模拟时钟，驱动“已过期”等状态重算
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = useCallback(() => simNow(state), [state]);

  const update = useCallback((next: AppState) => {
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const actions = useMemo(
    () => ({
      ingest: (batchId: string, dropInvalid = false) =>
        update(engineIngest(state, batchId, simNow(state), { dropInvalid })),
      decide: (key: string, decision: 'allow' | 'review' | 'deny', reason: string, by: string) =>
        update(engineDecide(state, { key, decision, reason, by }, simNow(state))),
      grant: (key: string, reason: string, ttlDays: number) =>
        update(
          engineGrant(state, { key, reason, grantedBy: 'Zen Li', ttlDays }, simNow(state)),
        ),
      revoke: (exceptionId: string) => update(engineRevoke(state, exceptionId)),
      publishPolicy: (version: string, notes: string) =>
        update(
          enginePublish(
            state,
            { version, notes, defaults: DEFAULT_POLICY_2026_09 },
            simNow(state),
          ),
        ),
      upsertManifest: (name: string, version: string, license: AppState['manifest'][number]['license']) =>
        update(
          engineUpsertManifest(state, { name, version, license }, simNow(state)),
        ),
      reset: () => {
        localStorage.removeItem(STORAGE_KEY);
        setState(boot());
      },
    }),
    [state, update],
  );

  return { state, actions, now };
}
