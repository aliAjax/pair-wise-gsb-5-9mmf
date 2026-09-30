import type {DBShape, RiskLevel} from './types';
import {currentPackages, currentVerdict, pkgCoord} from './engine';

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  allow: '放行',
  review: '需复核',
  deny: '拒绝',
};

/** 生成合规报告：只统计当前有效裁决；失效旧结论不计入 */
export function buildReport(db: DBShape, now: string = new Date().toISOString()): string {
  const rows = currentPackages(db).map(p => ({pkg: p, view: currentVerdict(db, p, now)}));
  const counts = {ok: 0, warn: 0, risk: 0, pending: 0};
  for (const r of rows) counts[r.view.status] += 1;

  const lines: string[] = [];
  lines.push('# 依赖许可证合规报告');
  lines.push('');
  lines.push(`- 当前策略版本：**${db.currentPolicyVersion}**`);
  lines.push(`- 生成时间：${now}`);
  if (db.migratedAt) lines.push(`- 旧数据迁移：${db.migratedAt}（迁移 ${db.legacyCount ?? 0} 条，指纹与策略版本已补全）`);
  lines.push('');
  lines.push(`共 ${rows.length} 个包：放行 ${counts.ok}，需复核 ${counts.warn}，拒绝 ${counts.risk}，待复核 ${counts.pending}`);
  lines.push('');
  lines.push('## 当前有效裁决');
  lines.push('');
  lines.push('| 包 | 许可证 | 指纹 | 裁决 | 依据策略 | 例外 | 说明 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const {pkg, view} of rows) {
    const verdictCell = view.status === 'pending'
      ? '⏳ 待复核'
      : `${view.status === 'ok' ? '✅' : view.status === 'warn' ? '⚠️' : '⛔'} ${view.level ? LEVEL_LABEL[view.level] : ''}`;
    lines.push(
      `| ${pkgCoord(pkg)} | ${pkg.license ?? '未识别'} | ${pkg.fingerprint.slice(0, 10)}… | ${verdictCell} | ${view.verdict?.policyVersion ?? db.currentPolicyVersion} | ${view.exception ? view.exception.ticket : '—'} | ${view.note} |`,
    );
  }
  lines.push('');
  lines.push('## 待复核明细');
  lines.push('');
  const pendings = rows.filter(r => r.view.status === 'pending');
  if (pendings.length === 0) {
    lines.push('无。');
  } else {
    for (const {pkg, view} of pendings) {
      lines.push(`- ${pkgCoord(pkg)}（${pkg.fingerprint.slice(0, 10)}…）：${view.note}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function download(filename: string, text: string, type = 'text/markdown'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
