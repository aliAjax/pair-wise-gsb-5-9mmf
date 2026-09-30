import { AppState, Decision, EffectiveRuling } from './types';
import { allActivePackages, effectiveRuling } from './engine';

export interface RulingRow {
  key: string;
  name: string;
  version: string;
  license: string;
  ruling: EffectiveRuling;
}

/** 清单 / 统计 / 报告共用：仅取每个包当前这一代的“当前有效裁决” */
export function currentRulings(state: AppState, now: number): RulingRow[] {
  return allActivePackages(state.packages)
    .map((pkg) => ({
      key: pkg.key,
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      ruling: effectiveRuling(state, pkg.key, now),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Stats {
  total: number;
  allow: number;
  review: number;
  deny: number;
  pending: number;
  viaException: number;
}

export function stats(state: AppState, now: number): Stats {
  const rows = currentRulings(state, now);
  const s: Stats = {
    total: rows.length,
    allow: 0,
    review: 0,
    deny: 0,
    pending: 0,
    viaException: 0,
  };
  for (const r of rows) {
    const d: Decision | 'pending' = r.ruling.decision;
    if (d === 'pending') s.pending += 1;
    else s[d] += 1;
    if (r.ruling.source === 'exception') s.viaException += 1;
  }
  return s;
}

const decisionZh: Record<string, string> = {
  allow: '允许',
  review: '待复核',
  deny: '拒绝',
  pending: '待复核',
};

/** 报告只写当前有效裁决；失效的历史结论不出现在报告中 */
export function buildReport(state: AppState, now: number): string {
  const rows = currentRulings(state, now);
  const lines = [
    '# 依赖许可证合规报告',
    '',
    `- 生成时间：${new Date(now).toISOString()}`,
    `- 策略版本：${state.policy.version}`,
    `- 生效范围：仅包含当前有效裁决（内容变化 / 策略升级后失效的旧裁决已排除）`,
    '',
    '| 包 | 当前版本 | 许可证 | 当前有效裁决 | 依据 |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${r.version} | ${r.license} | ${decisionZh[r.ruling.decision]} | ${r.ruling.reason} |`,
    );
  }
  lines.push('');
  lines.push(`共 ${rows.length} 个有效包记录；同一内容指纹只计一次。`);
  return lines.join('\n');
}
