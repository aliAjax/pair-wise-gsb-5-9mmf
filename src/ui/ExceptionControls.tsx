import { useState } from 'react';
import { ShieldPlus } from 'lucide-react';

interface Props {
  pkgKey: string;
  pkgName: string;
  onGrant: (key: string, reason: string, ttlDays: number) => void;
}

/** 为待复核包申请站内例外（审批时锁定当前内容指纹与策略版本） */
export function GrantExceptionButton({ pkgName, pkgKey, onGrant }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [ttl, setTtl] = useState(30);

  if (!open) {
    return (
      <button className="outline full-btn" onClick={() => setOpen(true)}>
        <ShieldPlus size={14}/> 申请站内例外审批
      </button>
    );
  }

  return (
    <div className="grant-box">
      <label>
        例外理由
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：法务已确认该版本分发条款" rows={2}/>
      </label>
      <label>
        有效期（天）
        <input type="number" min={1} value={ttl} onChange={(e) => setTtl(Number(e.target.value))}/>
      </label>
      <p className="grant-hint">例外将锁定该包<b>当前内容指纹</b>与<b>当前策略版本</b>；包内容一变或策略升级，例外自动失效。</p>
      <div className="grant-actions">
        <button className="outline" onClick={() => setOpen(false)}>取消</button>
        <button
          className="primary"
          onClick={() => {
            onGrant(pkgKey, reason, ttl);
            setOpen(false);
            setReason('');
          }}
        >
          提交审批（{pkgName}）
        </button>
      </div>
    </div>
  );
}
