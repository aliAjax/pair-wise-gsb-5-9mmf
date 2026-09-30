import { useMemo, useState } from 'react';
import { Archive } from 'lucide-react';
import { AppState } from '../domain/types';
import { exceptionStatus, exceptionStatusLabel } from '../domain/engine';
import { shortFp } from '../domain/fingerprint';
import { decisionMeta, fmtTime } from './format';

interface Props {
  state: AppState;
  now: number;
}

type Tab = 'verdicts' | 'exceptions' | 'packages';

export function HistoryArchive({ state, now }: Props) {
  const [tab, setTab] = useState<Tab>('verdicts');

  const deadVerdicts = useMemo(
    () =>
      [...state.verdicts]
        .filter((v) => !v.active)
        .sort((a, b) => b.decidedAt - a.decidedAt),
    [state.verdicts],
  );
  const deadExceptions = useMemo(
    () =>
      state.exceptions
        .map((ex) => ({
          ex,
          status: exceptionStatus(
            ex,
            state.packages.filter((p) => p.key === ex.key && !p.superseded)[0],
            state.policy.version,
            now,
          ),
        }))
        .filter((x) => x.status !== 'active')
        .sort((a, b) => b.ex.grantedAt - a.ex.grantedAt),
    [state.exceptions, state.packages, state.policy.version, now],
  );
  const oldPackages = useMemo(
    () => state.packages.filter((p) => p.superseded).sort((a, b) => b.ingestedAt - a.ingestedAt),
    [state.packages],
  );

  const invalidZh: Record<string, string> = {
    'content-changed': '包内容变化',
    'policy-updated': '策略版本升级',
    're-adjudicated': '被新裁决取代',
  };

  return (
    <section className="archive">
      <div className="section-head">
        <div>
          <h2><Archive size={17}/> 历史结论档案</h2>
          <p>失效不等于删除：旧裁决、旧例外、被换代的包内容记录全部保留；这些记录不进入清单、统计与报告。</p>
        </div>
      </div>

      <div className="archive-tabs">
        <button className={tab === 'verdicts' ? 'on' : ''} onClick={() => setTab('verdicts')}>失效裁决（{deadVerdicts.length}）</button>
        <button className={tab === 'exceptions' ? 'on' : ''} onClick={() => setTab('exceptions')}>不可沿用例外（{deadExceptions.length}）</button>
        <button className={tab === 'packages' ? 'on' : ''} onClick={() => setTab('packages')}>已换代包内容（{oldPackages.length}）</button>
      </div>

      {tab === 'verdicts' && (
        <div className="arch-list">
          {deadVerdicts.map((v) => (
            <div key={v.id} className="arch-row">
              <div className="arch-main">
                <b>{v.key}</b>
                <span className={'mini-dec ' + v.decision}>{decisionMeta[v.decision].zh}</span>
                {v.migrated && <i className="via-mig">旧版迁移</i>}
                {v.auto && <i className="via-auto">自动初判</i>}
              </div>
              <div className="arch-meta mono">指纹 {shortFp(v.fingerprint)} · 策略 {v.policyVersion}</div>
              <div className="arch-sub">{v.reason} —— {v.decidedBy}，{fmtTime(v.decidedAt)}</div>
              <span className="dead-tag">失效：{invalidZh[v.invalidated ?? 're-adjudicated']}</span>
            </div>
          ))}
          {deadVerdicts.length === 0 && <div className="big-empty">暂无失效裁决</div>}
        </div>
      )}

      {tab === 'exceptions' && (
        <div className="arch-list">
          {deadExceptions.map(({ ex, status }) => (
            <div key={ex.id} className="arch-row">
              <div className="arch-main">
                <b>{ex.id}</b> <span className="muted">{ex.key}</span>
                <span className={'ex-badge ' + status}>{exceptionStatusLabel(status)}</span>
              </div>
              <div className="arch-meta mono">指纹 {shortFp(ex.fingerprint)} · 策略 {ex.policyVersion}</div>
              <div className="arch-sub">{ex.reason} —— {ex.grantedBy}，{fmtTime(ex.grantedAt)} 至 {fmtTime(ex.expiresAt)}</div>
            </div>
          ))}
          {deadExceptions.length === 0 && <div className="big-empty">暂无不可沿用例外</div>}
        </div>
      )}

      {tab === 'packages' && (
        <div className="arch-list">
          {oldPackages.map((p) => (
            <div key={p.fingerprint} className="arch-row">
              <div className="arch-main"><b>{p.name}</b> <span className="muted">{p.version} · {p.license}</span></div>
              <div className="arch-meta mono">{p.fingerprint}</div>
              <div className="arch-sub">由 {p.batchId ?? '旧版迁移'} 入库，{fmtTime(p.ingestedAt)}；后被新内容取代</div>
            </div>
          ))}
          {oldPackages.length === 0 && <div className="big-empty">暂无换代记录</div>}
        </div>
      )}
    </section>
  );
}
