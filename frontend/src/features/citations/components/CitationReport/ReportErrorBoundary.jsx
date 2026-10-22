import React from 'react';
import { reportClientError } from '@/shared/api/clientErrorReporter';

/**
 * ReportErrorBoundary — prevents a render error in the citation report (e.g. an
 * unexpected/partial data shape in a popup or table) from white-screening the
 * entire SPA. Shows the error inline and lets the user recover.
 */
export default class ReportErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface to the console for debugging; never swallow silently.
    console.error('[CitationReport] render error:', error, info?.componentStack);
    reportClientError({ kind: 'render', flow: 'citation-report', error, details: { componentStack: String(info?.componentStack || '').slice(0, 1500) } });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: 24, margin: 24, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, fontFamily: "'DM Sans',sans-serif" }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, color: '#991B1B' }}>Something went wrong rendering this view</h3>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#B91C1C' }}>
          The report data triggered a display error. Your run was not lost — this is only a rendering issue.
        </p>
        <pre style={{ margin: '0 0 12px 0', fontSize: 12, color: '#7F1D1D', background: '#FFF', padding: 12, borderRadius: 8, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
          {String(error?.message || error)}
        </pre>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={this.reset} style={{ padding: '8px 14px', background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Try again</button>
          {this.props.onClose && (
            <button onClick={this.props.onClose} style={{ padding: '8px 14px', background: '#fff', color: '#334155', border: '1px solid #CBD5E1', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Go back</button>
          )}
        </div>
      </div>
    );
  }
}
