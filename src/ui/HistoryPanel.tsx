import { useMemo, useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import { AppState } from '../domain/types';
import {
  exceptionStatus,
  exceptionStatusLabel,
  packageHistory,
} from '../domain/engine';
import { shortFp } from '../domain/fingerprint';
import { decisionMeta, fmtTime } from './format';

interface Props {
  state: AppState;
  pkgKey: string;
  now: number;
}

/** 历史结论查询：旧代包记录、失效裁决、失效例外全部保留可查 */
export function HistoryPanel({ state, pkgKey, now }: Props) {
  const [open, setOpen] = useState(false);
  const hist = useMemo(() => packageHistory(state, pkgKey), [state, pkgKey]);
  const pkg = hist.packages.find((p) => !p.superseded);

  return (
    <div className="history">
      <button className="history-toggle" onClick={() => setOpen((o) => !o)}>
        <History size={14}/> 历史结论与内容代际（{hist.verdicts.length} 条裁决 / {hist.exceptions.length} 条例外）
        <ChevronDown size={14} className={open ? 'rot up' : 'rot'}/>
      </button>
      {open && (
        <div className="history-body">
          <div className="hist-cols">
            <div>
              <label>包内容代际</label>
              {hist.packages.map((p) => (
                <div key={p.fingerprint} className={p.superseded ? 'hist-item dead' : 'hist-item live'}>
                  <b>{p.name}@{p.version}</b>
                  <span className="mono">{shortFp(p.fingerprint)}</span>
                  <small>{p.superseded ? '已换代' : '当前'} · {fmtTime(p.ingestedAt)}</small>
                </div>
              ))}
            </div>
            <div>
              <label>裁决记录</label>
              {hist.verdicts.map((v) => (
                <div key={v.id} className={v.active ? 'hist-item live' : 'hist-item dead'}>
                  <b>{decisionMeta[v.decision].zh}
                    {v.migrated && <i className="via-mig">迁移</i>}
                    {v.auto && <i className="via-auto">自动</i>}
                  </b>
                  <span className="mono">{shortFp(v.fingerprint)} · 策略 {v.policyVersion}</span>
                  <small>
                    {v.active ? '有效' : `已失效（${v.invalidated === 'content-changed' ? '包内容变化' : v.invalidated === 'policy-updated' ? '策略版本升级' : '被新裁决取代'}）`}
                    {' · '}{v.decidedBy} · {fmtTime(v.decidedAt)}
                  </small>
                  <small className="hist-reason">{v.reason}</small>
                </div>
              ))}
              {hist.verdicts.length === 0 && <small className="muted">无</small>}
            </div>
            <div>
              <label>例外审批</label>
              {hist.exceptions.map((ex) => {
                const st = exceptionStatus(ex, pkg, state.policy.version, now);
                return (
                  <div key={ex.id} className={st === 'active' ? 'hist-item live' : 'hist-item dead'}>
                    <b>{ex.id} <i className={'ex-status ' + st}>{exceptionStatusLabel(st)}</i></b>
                    <span className="mono">{shortFp(ex.fingerprint)} · 策略 {ex.policyVersion}</span>
                    <small>{fmtTime(ex.grantedAt)} → {fmtTime(ex.expiresAt)} · {ex.grantedBy}</small>
                    <small className="hist-reason">{ex.reason}</small>
                  </div>
                );
              })}
              {hist.exceptions.length === 0 && <small className="muted">无</small>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
