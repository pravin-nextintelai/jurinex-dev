import React from 'react';

/**
 * PipelineDetailModal — a read-only "data flow" inspector for a citation run.
 *
 * Renders, stage by stage, exactly what the pipeline did so a user can see WHERE a
 * run under-performed:
 *   1. what the AI read from the document (context + extracted facts/statutes)
 *   2. the case summary / issues it built
 *   3. the keyword combinations it searched on Indian Kanoon (+ per-query hit counts)
 *   4. the retrieval funnel (raw → deduped → filtered → fragments → scored → shortlisted)
 *   5. the ranked results and the candidates that were filtered out (with reasons)
 *
 * It is intentionally defensive: every field is optional, so a partial/old report
 * never throws.
 */

const C = {
  overlay: 'rgba(15,23,42,0.55)',
  card: '#FFFFFF',
  bg: '#F8FAFC',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  ink: '#0F172A',
  sub: '#475569',
  muted: '#64748B',
  primary: '#1D4ED8',
  green: '#059669',
  greenBg: '#ECFDF5',
  red: '#DC2626',
  redBg: '#FEF2F2',
  amber: '#D97706',
  amberBg: '#FFFBEB',
  chip: '#EFF6FF',
};

const arr = (x) => (Array.isArray(x) ? x : []);
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
const pct = (x) => `${Math.round(num(x) * 100)}%`;

function Section({ index, title, subtitle, children, tone }) {
  const accent = tone === 'bad' ? C.red : tone === 'warn' ? C.amber : C.primary;
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span style={{
          flexShrink: 0, width: 24, height: 24, borderRadius: 6, background: accent, color: '#fff',
          fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{index}</span>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: C.ink, fontWeight: 700 }}>{title}</h3>
          {subtitle && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Chips({ items, tone }) {
  const list = arr(items).filter((t) => t != null && String(t).trim() !== '');
  if (!list.length) return <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>none</span>;
  const bg = tone === 'warn' ? C.amberBg : C.chip;
  const fg = tone === 'warn' ? C.amber : C.primary;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {list.map((t, i) => (
        <span key={i} style={{ background: bg, color: fg, fontSize: 12, padding: '3px 8px', borderRadius: 6, fontWeight: 500 }}>{String(t)}</span>
      ))}
    </div>
  );
}

export default function PipelineDetailModal({ report, onClose }) {
  const rf = report?.report_format || {};
  const diag = rf.pipeline_diagnostics || {};
  const profile = rf.case_profile || {};
  const issues = arr(rf.issue_cards);
  // Prefer detailed queries (with per-query hit counts) from diagnostics; fall back to rf.queries.
  const queries = arr(diag.queries_detailed).length ? arr(diag.queries_detailed) : arr(rf.queries);
  const citations = arr(rf.citations).length ? arr(rf.citations) : [
    ...arr(rf.recommended_citations), ...arr(rf.adverse_citations), ...arr(rf.use_with_caution),
  ];
  const rejected = arr(diag.rejected);

  // ── Retrieval funnel (in pipeline order) ──
  const funnel = [
    { key: 'context', label: 'Context chars', value: num(diag.case_context_chars) },
    { key: 'issues', label: 'Issues', value: num(diag.issues_count ?? issues.length) },
    { key: 'queries', label: 'Queries', value: num(diag.queries_count ?? queries.length) },
    { key: 'raw', label: 'Raw candidates', value: num(diag.raw_candidates_count) },
    { key: 'deduped', label: 'Deduped', value: num(diag.deduped_candidates_count) },
    { key: 'filtered', label: 'Filtered', value: num(diag.cheap_filtered_count) },
    { key: 'fragments', label: 'Fragments', value: num(diag.fragment_checked_count) },
    { key: 'scored', label: 'Scored', value: num(diag.scored_count) },
    { key: 'shortlist', label: 'Shortlisted', value: num(diag.shortlisted_count) },
    { key: 'fulldocs', label: 'Full docs', value: num(diag.full_docs_fetched_count) },
    { key: 'recommended', label: 'Recommended', value: num(diag.recommended_count ?? rf.recommended_count) },
  ];
  // Bottleneck = first stage that collapses to 0 while the previous stage had results.
  let bottleneckIdx = -1;
  for (let i = 1; i < funnel.length; i += 1) {
    if (funnel[i].value === 0 && funnel[i - 1].value > 0) { bottleneckIdx = i; break; }
  }

  const stop = (e) => e.stopPropagation();

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: C.overlay, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={stop} style={{ background: C.card, borderRadius: 14, width: 980, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontFamily: "'DM Sans',sans-serif" }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, color: C.ink, fontWeight: 800 }}>Pipeline Data Flow</h2>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              How this report was built — read → summarise → search → retrieve → rank. Run ID: {rf.run_id || report?.run_id || '—'}
            </div>
          </div>
          <button onClick={onClose} style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.sub }}>Close ✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, overflowY: 'auto' }}>
          {/* Funnel */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
              {funnel.map((s, i) => {
                const isBottleneck = i === bottleneckIdx;
                const dropped = s.value === 0;
                return (
                  <React.Fragment key={s.key}>
                    <div style={{
                      minWidth: 86, padding: '8px 10px', borderRadius: 8, textAlign: 'center',
                      background: isBottleneck ? C.redBg : dropped ? '#F1F5F9' : '#fff',
                      border: `1px solid ${isBottleneck ? '#FCA5A5' : C.border}`,
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: isBottleneck ? C.red : dropped ? C.muted : C.ink }}>{s.value}</div>
                      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{s.label}</div>
                    </div>
                    {i < funnel.length - 1 && <div style={{ alignSelf: 'center', color: C.borderStrong, fontSize: 13 }}>→</div>}
                  </React.Fragment>
                );
              })}
            </div>
            {bottleneckIdx > -1 && (
              <div style={{ marginTop: 10, background: C.redBg, border: '1px solid #FCA5A5', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.red }}>
                <strong>Bottleneck:</strong> results collapse to 0 at <strong>{funnel[bottleneckIdx].label}</strong>.
                {diag.no_result_reason ? <> Reason: {diag.no_result_reason}.</> : null}
              </div>
            )}
          </div>

          {/* 1. Document read */}
          <Section index="1" title="What the AI read (document context)" subtitle={`${num(diag.case_context_chars)} characters of case context`} tone={num(diag.case_context_chars) === 0 ? 'bad' : 'ok'}>
            {num(diag.case_context_chars) === 0 ? (
              <div style={{ fontSize: 13, color: C.red }}>No document context was loaded — the run had nothing to extract issues from.</div>
            ) : (
              <>
                {diag.case_context_preview && (
                  <div style={{ fontSize: 12.5, color: C.sub, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 12, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto' }}>
                    {diag.case_context_preview}{num(diag.case_context_chars) > String(diag.case_context_preview).length ? ' …' : ''}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Statutes detected</div>
                    <Chips items={profile.statutes} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Represented side</div>
                    <Chips items={[profile.represented_side, profile.court].filter(Boolean)} />
                  </div>
                </div>
                {arr(profile.important_facts).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Key facts extracted</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.sub, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {arr(profile.important_facts).slice(0, 8).map((f, i) => <li key={i}>{String(f)}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Section>

          {/* 2. Issues / summary */}
          <Section index="2" title="Issues & search terms the AI created" subtitle={`${issues.length} issue card(s)`} tone={issues.length === 0 ? 'bad' : 'ok'}>
            {issues.length === 0 ? (
              <div style={{ fontSize: 13, color: C.muted }}>No issue cards available.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {issues.map((iss, i) => (
                  <div key={iss.issue_id || i} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                      <span style={{ color: C.muted, fontWeight: 600 }}>{iss.issue_id || `issue-${i + 1}`}: </span>{iss.legal_issue || '—'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div><div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Phrase terms (quoted search)</div><Chips items={iss.phrase_terms} /></div>
                      <div><div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Must-have terms</div><Chips items={iss.must_have_terms} /></div>
                      <div><div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Statutes</div><Chips items={iss.statutes} /></div>
                      <div><div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Synonyms</div><Chips items={iss.optional_synonyms} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 3. Queries searched */}
          <Section index="3" title="Keyword combinations searched on Indian Kanoon" subtitle={`${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} sent`} tone={queries.length && num(diag.raw_candidates_count) === 0 ? 'bad' : 'ok'}>
            {queries.length === 0 ? (
              <div style={{ fontSize: 13, color: C.muted }}>No queries were generated.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>#</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>Type</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>Query (formInput)</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>Hits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map((q, i) => {
                      const qStr = q.query_string || q.formInput || q.query || (typeof q === 'string' ? q : '');
                      const hits = q.result_count;
                      const zero = hits === 0;
                      return (
                        <tr key={q.query_id || i} style={{ borderBottom: `1px solid ${C.bg}`, background: zero ? C.redBg : 'transparent' }}>
                          <td style={{ padding: '6px 8px', color: C.muted }}>{q.query_id || i + 1}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{ color: q.is_fallback ? C.amber : C.sub, fontWeight: 600 }}>{q.query_type || '—'}{q.is_fallback ? ' (fallback)' : ''}</span>
                          </td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: C.ink, wordBreak: 'break-word' }}>{qStr || '—'}{q.error ? <span style={{ color: C.red }}> · error: {String(q.error)}</span> : null}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: hits == null ? C.muted : zero ? C.red : C.green }}>{hits == null ? '—' : hits}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* 4. Ranked results */}
          <Section index="4" title="Ranked results (re-ranking)" subtitle={`${citations.length} citation(s) after scoring`} tone={citations.length === 0 ? 'warn' : 'ok'}>
            {citations.length === 0 ? (
              <div style={{ fontSize: 13, color: C.muted }}>No citations passed scoring/classification.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>Case</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>Class</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>Relevance</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>Authority</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {citations
                      .slice()
                      .sort((a, b) => num(b.relevanceScore ?? b.relevance_score) - num(a.relevanceScore ?? a.relevance_score))
                      .map((c, i) => (
                        <tr key={c.canonicalId || c.canonical_id || i} style={{ borderBottom: `1px solid ${C.bg}` }}>
                          <td style={{ padding: '6px 8px', color: C.ink }}>
                            <div style={{ fontWeight: 600 }}>{c.caseName || c.case_name || '—'}</div>
                            <div style={{ fontSize: 11, color: C.muted }}>{c.court || ''}{c.matched_issue_id ? ` · ${c.matched_issue_id}` : ''}</div>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: c.adverse_to_selected_side ? C.red : c.supports_selected_side ? C.green : C.amber }}>
                              {c.classification || (c.supports_selected_side ? 'supporting' : c.adverse_to_selected_side ? 'adverse' : 'neutral')}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(c.relevanceScore ?? c.relevance_score)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(c.authority_score)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{pct(c.confidence)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* 5. Rejected */}
          <Section index="5" title="Filtered out" subtitle={`${num(diag.rejected_count ?? rejected.length)} candidate(s) rejected before the final report`} tone="warn">
            {rejected.length === 0 ? (
              <div style={{ fontSize: 13, color: C.muted }}>
                {num(diag.rejected_count) > 0 ? 'Rejection details were not recorded for this run.' : 'Nothing was rejected.'}
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.sub, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {rejected.map((r, i) => (
                  <li key={r.doc_id || i}>
                    <span style={{ color: C.ink, fontWeight: 600 }}>{r.title || r.doc_id}</span>
                    {r.reason ? <span style={{ color: C.red }}> — {r.reason}</span> : null}
                    {r.matched_query ? <span style={{ color: C.muted, fontFamily: 'monospace' }}> · {r.matched_query}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
