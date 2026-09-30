import { useMemo, useState } from 'react';
import { Check, Gavel, ThumbsDown, ThumbsUp } from 'lucide-react';
import { AppState, Decision } from '../domain/types';
import { activePackage, effectiveRuling } from '../domain/engine';
import { currentRulings } from '../domain/report';
import { shortFp } from '../domain/fingerprint';
import { fmtTime } from './format';
import { GrantExceptionButton } from './ExceptionControls';

interface Props {
  state: AppState;
  now: number;
  actions: {
    decide: (key: string, decision: Decision, reason: string, by: string) => void;
    grant: (key: string, reason: string, ttlDays: number) => void;
  };
}

export function Adjudication({ state, now, actions }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rows = useMemo(
    () => currentRulings(state, now).filter((r) => r.ruling.decision === 'pending'),
    [state, now],
  );

  return (
    <section className="adjudication">
      <div className="section-head">
        <div>
          <h2><Gavel size={17}/> 待复核队列</h2>
          <p>包内容变化或策略版本升级后，原裁决自动失效并回到此队列。人工裁决将锁定当前包指纹与当前策略版本。</p>
        </div>
        <span className="queue-count">{rows.length} 项</span>
      </div>

      {rows.length === 0 && (
        <div className="big-empty"><Check size={22}/> 当前没有待复核项，所有裁决均有效。</div>
      )}

      <div className="adj-list">
        {rows.map((r) => {
          const pkg = activePackage(state.packages, r.key)!;
          const reason = drafts[r.key] ?? '';
          return (
            <div key={r.key} className="adj-card">
              <div className="adj-main">
                <div className="adj-title">
                  <b>{r.name}</b>
                  <em>{r.version}</em>
                  <span className="lic-tag">{r.license}</span>
                </div>
                <div className="adj-stamps mono" title={pkg.fingerprint}>
                  指纹 {shortFp(pkg.fingerprint)} · 策略 {state.policy.version} · 入库 {fmtTime(pkg.ingestedAt)}
                </div>
                <div className="adj-reason">{r.ruling.reason}</div>
                <input
                  className="adj-input"
                  placeholder="复核意见（将记录在裁决中）"
                  value={reason}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                />
              </div>
              <div className="adj-actions">
                <button className="btn-allow" onClick={() => actions.decide(r.key, 'allow', reason, 'Zen Li')}>
                  <ThumbsUp size={14}/> 允许
                </button>
                <button className="btn-review" onClick={() => actions.decide(r.key, 'review', reason, 'Zen Li')}>
                  <Gavel size={14}/> 保持复核
                </button>
                <button className="btn-deny" onClick={() => actions.decide(r.key, 'deny', reason, 'Zen Li')}>
                  <ThumbsDown size={14}/> 拒绝
                </button>
                <GrantExceptionButton pkgKey={r.key} pkgName={r.name} onGrant={actions.grant}/>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
