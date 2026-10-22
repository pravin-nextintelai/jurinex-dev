import React from 'react';
import { X, CheckCircle2, Loader2, Circle } from 'lucide-react';

/**
 * Right panel for agentic mode — shows agent execution steps.
 */
export default function AgentStepsPanel({ steps = [], onClose, title = 'Agent Execution' }) {
  const statusConfig = (status) => {
    if (status === 'done')    return { icon: <CheckCircle2 size={16} />, color: '#10b981', bg: '#f0fdf4', border: '#bbf7d0' };
    if (status === 'running') return { icon: <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />, color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' };
    return                           { icon: <Circle size={16} />,       color: '#d1d5db', bg: '#f9fafb', border: '#f3f4f6' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid #e5e7eb', flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
          {title}
        </span>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
            <X size={16} />
          </button>
        )}
      </div>

      {/* Steps */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {steps.length === 0 && (
            <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', paddingTop: '40px' }}>
              No steps yet.
            </p>
          )}
          {steps.map((step, i) => {
            const { icon, color, bg, border } = statusConfig(step.status);
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '12px 16px', borderRadius: '10px',
                background: bg, border: `1px solid ${border}`,
              }}>
                <span style={{ color, marginTop: '1px', flexShrink: 0 }}>{icon}</span>
                <div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: '#111827' }}>{step.title}</p>
                  {step.detail && (
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280', lineHeight: '1.5' }}>{step.detail}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
