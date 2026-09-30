// 端到端冒烟脚本（不进 vitest，直接走一遍用户故事）
import {
  migrateLegacy, ingestBatch, effectiveRuling, activePackage,
  publishPolicy, packageHistory, decide, DEFAULT_POLICY_2026_09,
} from './src/domain/engine.ts';
import { LEGACY_DEPS, BATCH_A, BATCH_B, CURRENT_POLICY_VERSION, T0, buildSeedExceptions } from './src/domain/seed.ts';
import { stats, currentRulings, buildReport } from './src/domain/report.ts';

let s = migrateLegacy(LEGACY_DEPS, CURRENT_POLICY_VERSION, T0,
  [structuredClone(BATCH_A), structuredClone(BATCH_B)], buildSeedExceptions());
const log = (...a) => console.log(...a);

log('① 迁移后：', s.packages.length, '个包，全部补登指纹+策略版本', s.policy.version);
log('   react 有效裁决来源 =', effectiveRuling(s, 'react', T0).source, '(EX-001 三条件满足)');

s = ingestBatch(s, BATCH_A.id, T0 + 1000);
log('② A 批写入：', JSON.stringify(s.batches.find(b=>b.id===BATCH_A.id).report));
log('   react 现版本', activePackage(s.packages,'react').version, '→ 裁决', effectiveRuling(s,'react',T0+1000).decision,
    '/', effectiveRuling(s,'react',T0+1000).reason);

const beforeB = JSON.stringify({p:s.packages.length,v:s.verdicts.length});
s = ingestBatch(s, BATCH_B.id, T0 + 2000);
log('③ B 批首次写入 →', s.batches.find(b=>b.id===BATCH_B.id).status, '（整批失败，保留待重试）');
log('   已入库记录未受影响 p/v =', s.packages.length, s.verdicts.length, '（写入前', beforeB, ')');

s = ingestBatch(s, BATCH_B.id, T0 + 3000, { dropInvalid: true });
log('④ B 批剔除损坏条目重试 →', s.batches.find(b=>b.id===BATCH_B.id).status,
    JSON.stringify(s.batches.find(b=>b.id===BATCH_B.id).report));
log('   readline-sync(GPL) 裁决 =', effectiveRuling(s,'readline-sync',T0+3000).decision);

log('⑤ 当前有效裁决统计 =', stats(s, T0 + 3000));

s = publishPolicy(s, { version:'2026.09', notes:'收紧', defaults:DEFAULT_POLICY_2026_09 }, T0 + 86400000);
log('⑥ 策略升级后 pending 数 =', stats(s, T0 + 86400000).pending, '/ 总', stats(s, T0 + 86400000).total);
s = decide(s, { key:'react', decision:'allow', reason:'新策略复审通过', by:'Zen Li' }, T0 + 86400000);
log('   react 重审后 =', effectiveRuling(s,'react',T0+86400000).decision,
    '@策略', effectiveRuling(s,'react',T0+86400000).verdict.policyVersion);

const h = packageHistory(s, 'react');
log('⑦ react 历史：', h.packages.length, '代内容,', h.verdicts.length, '条裁决（失效',
    h.verdicts.filter(v=>!v.active).length, '条仍可查）');
log('⑧ 报告只含当前裁决，行数 =', currentRulings(s, T0 + 86400000).length);
log(buildReport(s, T0 + 86400000).split('\n').slice(0, 4).join('\n'));
