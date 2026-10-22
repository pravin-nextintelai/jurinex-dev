import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, ChevronUp,
  AlignLeft, AlignCenter, AlignRight, Upload,
  FileText, Footprints,
} from 'lucide-react';
import { getProfile, saveProfile, newProfile, refreshProfiles } from '../utils/brandingStorage';
import { normalizeBrandingProfile } from '../utils/brandingProfileDefaults';
import { getUserIdForDrafting } from '@/config/apiConfig';
import {
  buildBrandedHtml,
  downloadBrandingProfilePreviewPdf,
  downloadBrandingProfilePreviewWord,
  downloadBrandedHtmlFile,
  getPageDimensions,
} from '../utils/brandingExport';

const FONT_OPTIONS = ['Times New Roman', 'Georgia', 'DM Sans', 'Lato', 'Roboto', 'Open Sans', 'Montserrat', 'Arial', 'Calibri'];

// ─── Reusable UI atoms (defined at module level — never inside render) ─────────

function Toggle({ value, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer flex-shrink-0 focus:outline-none ${value ? 'bg-teal-500' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function AlignBtn({ value, current, icon: Icon, onChange }) {
  return (
    <button type="button" onClick={() => onChange(value)}
      className={`flex-1 flex items-center justify-center py-2 border rounded-md transition-colors cursor-pointer focus:outline-none ${current === value ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
}

function PosBtn({ value, label, current, onSet }) {
  return (
    <button type="button" onClick={() => onSet(value)}
      className={`flex-1 py-2 text-sm font-medium rounded-md border transition-colors cursor-pointer focus:outline-none ${current === value ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
      {label}
    </button>
  );
}

function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer focus:outline-none">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-gray-500" />}
          <span className="text-xs font-semibold text-gray-600 tracking-wide uppercase">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', min, max, step }) {
  return (
    <input type={type} value={value ?? ''} min={min} max={max} step={step}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500" />
  );
}

function ColorInput({ value, onChange }) {
  const [text, setText] = useState(value || '#000000');
  const safeValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';

  // Keep text in sync when parent value changes (e.g. from color picker)
  useEffect(() => {
    setText(value || '#000000');
  }, [value]);

  const handleText = (e) => {
    const v = e.target.value;
    setText(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
  };

  return (
    <div className="flex items-center gap-2">
      <input type="color" value={safeValue}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0.5 flex-shrink-0" />
      <input type="text" value={text}
        onChange={handleText}
        placeholder="#000000"
        maxLength={7}
        className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500" />
    </div>
  );
}

// ─── Live Preview (same HTML template as export; scale is UI-only) ───────────
function TemplatePreview({ profile, containerRef }) {
  const [scale, setScale] = useState(0.75);
  const iframeRef = useRef(null);
  const n = useMemo(() => normalizeBrandingProfile(profile), [profile]);
  const { w: pageW, h: pageH } = getPageDimensions(n);

  const srcDoc = useMemo(
    () =>
      buildBrandedHtml('', n, {
        forPdf: false,
        pageWidthPx: pageW,
        pageHeightPx: pageH,
        previewShell: false,
      }),
    [n, pageW, pageH],
  );

  // React does not reliably patch <iframe srcDoc> after the initial render.
  // Imperatively writing to .srcdoc on every change guarantees the preview updates.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe) iframe.srcdoc = srcDoc;
  }, [srcDoc]);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth - 64;
      const h = el.clientHeight - 64;
      setScale(Math.max(Math.min(w / pageW, h / pageH, 1), 0.3));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, pageW, pageH]);

  return (
    <div className="preview-panel flex justify-center w-full">
      <div
        className="preview-scale"
        style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
      >
        <iframe
          ref={iframeRef}
          key={`${n.logoPosition}-${n.footerPosition}-${n.footerEnabled}-${n.logoWidth}-${(n.logo || '').length}`}
          title="Branded document preview"
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          style={{
            width: pageW,
            height: pageH,
            border: 0,
            display: 'block',
            borderRadius: 2,
            boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
            background: '#fff',
          }}
        />
      </div>
    </div>
  );
}

// ─── Main Editor ───────────────────────────────────────────────────────────────
export default function BrandingProfileEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const previewContainerRef = useRef(null);

  useEffect(() => {
    if (isNew) setProfile(newProfile());
    else {
      const p = getProfile(id);
      if (p) setProfile(p);
      else {
        // Cache may be empty right after login — try the server before bailing.
        refreshProfiles().then(() => {
          const fresh = getProfile(id);
          if (fresh) setProfile(fresh);
          else navigate('/branding');
        });
      }
    }
  }, [id]);

  const set = useCallback((key, value) => {
    setProfile(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => set('logo', ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!profile.name?.trim()) { alert('Please enter a profile name.'); return; }
    setSaving(true);
    try { saveProfile(profile); navigate('/branding'); }
    finally { setSaving(false); }
  };

  const handleExportPdf = async () => {
    setPdfLoading(true);
    setPdfStatus('Generating…');
    try {
      await downloadBrandingProfilePreviewPdf(
        profile,
        `${profile.name || 'Branding_Preview'}.pdf`,
        { xUserId: getUserIdForDrafting(), profileId: profile.id },
      );
    } catch (err) {
      console.error(err);
      alert(err?.message || 'PDF export failed. Ensure the document service is running with Playwright.');
    } finally {
      setPdfLoading(false);
      setPdfStatus('');
    }
  };

  const handleExportDocx = () => {
    downloadBrandingProfilePreviewWord(profile, `${profile.name || 'Branding_Preview'}.doc`);
  };

  const handleExportHtml = () => {
    const base = profile.name || 'Branding_Preview';
    downloadBrandedHtmlFile('', `${base}.html`, profile, { module: 'branding-editor-preview' });
  };

  if (!profile) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const pageSizeLabel = profile.pageSize === 'letter' ? '216×279mm'
    : profile.pageSize === 'legal' ? '216×356mm' : '210×297mm';

  return (
    <div className="bg-gray-100 flex flex-col" style={{ height: '100vh' }}>
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/branding')}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-sm font-semibold text-gray-800">
            {isNew ? 'New Branding Profile' : 'Edit Branding Profile'}
          </h1>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <Toggle value={!!profile.isDefault} onChange={v => set('isDefault', v)} />
          Set as default
        </label>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left Form ── */}
        <div className="w-[440px] flex-shrink-0 flex flex-col bg-white border-r border-gray-200">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* Profile Name */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Profile Name <span className="text-red-500">*</span>
              </label>
              <Input value={profile.name} onChange={v => set('name', v)} placeholder="e.g. Main Office" />
            </div>

            {/* ── Letterhead & Branding ── */}
            <Section title="Letterhead & Branding" defaultOpen={true}>
              <Field label="Firm / Advocate Name">
                <Input value={profile.firmName} onChange={v => set('firmName', v)} placeholder="Your firm or advocate name" />
              </Field>
              <Field label="Advocate name (optional line)">
                <Input value={profile.advocateName ?? ''} onChange={v => set('advocateName', v)} placeholder="Shown with firm on letterhead" />
              </Field>

              <Field label="Logo">
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-3 text-center">
                  {profile.logo ? (
                    <div className="flex items-center justify-center gap-4">
                      <img src={profile.logo} alt="logo" className="h-16 object-contain" />
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-teal-600 hover:text-teal-700 cursor-pointer font-medium">
                          Replace
                          <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                        </label>
                        <button type="button" onClick={() => set('logo', null)} className="text-xs text-red-500 hover:text-red-600 cursor-pointer">Remove</button>
                      </div>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center gap-2 cursor-pointer py-2">
                      <Upload className="w-6 h-6 text-gray-400" />
                      <span className="text-xs text-gray-500">Click to upload logo</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </label>
                  )}
                </div>
              </Field>

              <Field label="Logo Position">
                <div className="flex gap-2">
                  <PosBtn value="left" label="Left" current={profile.logoPosition} onSet={v => set('logoPosition', v)} />
                  <PosBtn value="center" label="Center" current={profile.logoPosition} onSet={v => set('logoPosition', v)} />
                  <PosBtn value="right" label="Right" current={profile.logoPosition} onSet={v => set('logoPosition', v)} />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Logo Width (px)">
                  <Input type="number" value={profile.logoWidth} onChange={v => set('logoWidth', Number(v))} />
                </Field>
                <Field label="Logo Height (px)">
                  <Input type="number" value={profile.logoHeight} onChange={v => set('logoHeight', Number(v))} />
                </Field>
              </div>

              <Field label="Letterhead Alignment">
                <div className="flex gap-2">
                  <AlignBtn value="left" current={profile.letterheadAlignment} icon={AlignLeft} onChange={v => set('letterheadAlignment', v)} />
                  <AlignBtn value="center" current={profile.letterheadAlignment} icon={AlignCenter} onChange={v => set('letterheadAlignment', v)} />
                  <AlignBtn value="right" current={profile.letterheadAlignment} icon={AlignRight} onChange={v => set('letterheadAlignment', v)} />
                </div>
              </Field>

              <Field label="Tagline">
                <Input value={profile.tagline} onChange={v => set('tagline', v)} placeholder="Your tagline or motto" />
              </Field>
              <Field label="Bar Council No.">
                <Input value={profile.barCouncilNo} onChange={v => set('barCouncilNo', v)} placeholder="Bar Council registration number" />
              </Field>
              <Field label="Office Address">
                <Input value={profile.officeAddress} onChange={v => set('officeAddress', v)} placeholder="Office address" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <Input value={profile.phone} onChange={v => set('phone', v)} placeholder="+91 99999 99999" />
                </Field>
                <Field label="Email">
                  <Input value={profile.email} onChange={v => set('email', v)} placeholder="email@firm.com" />
                </Field>
              </div>
              <Field label="Accent Color">
                <div className="flex items-center gap-3">
                  <input type="color" value={profile.primaryColor || '#20b2aa'}
                    onChange={e => set('primaryColor', e.target.value)}
                    className="w-10 h-10 rounded border border-gray-200 cursor-pointer p-0.5" />
                  <span className="text-sm text-gray-600 font-mono">{profile.primaryColor || '#20b2aa'}</span>
                </div>
              </Field>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Show divider under letterhead</span>
                <Toggle value={profile.showDivider !== false} onChange={v => set('showDivider', v)} />
              </div>

              {/* ── Letterhead Text Styles ── */}
              <div className="border-t border-gray-100 pt-3 mt-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Text Styles</p>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Firm / Advocate Name</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Size (pt)">
                        <Input type="number" value={profile.firmNameFontSize ?? 16} onChange={v => set('firmNameFontSize', Number(v))} min={8} max={32} />
                      </Field>
                      <Field label="Color">
                        <ColorInput value={profile.firmNameColor || '#000000'} onChange={v => set('firmNameColor', v)} />
                      </Field>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Tagline</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Size (pt)">
                        <Input type="number" value={profile.taglineFontSize ?? 9} onChange={v => set('taglineFontSize', Number(v))} min={6} max={20} />
                      </Field>
                      <Field label="Color">
                        <ColorInput value={profile.taglineColor || '#000000'} onChange={v => set('taglineColor', v)} />
                      </Field>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">Address · Contact · Bar Council</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Size (pt)">
                        <Input type="number" value={profile.metaFontSize ?? 8.5} onChange={v => set('metaFontSize', Number(v))} min={6} max={16} step={0.5} />
                      </Field>
                      <Field label="Color">
                        <ColorInput value={profile.metaColor || '#000000'} onChange={v => set('metaColor', v)} />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            {/* ── Document Header ── */}
            <Section title="Document Header" icon={FileText} defaultOpen={false}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Enable document header</span>
                <Toggle value={!!profile.headerEnabled} onChange={v => set('headerEnabled', v)} />
              </div>
              {profile.headerEnabled && (
                <>
                  <Field label="Header Text">
                    <Input value={profile.headerText} onChange={v => set('headerText', v)} placeholder="e.g. {date} or IN THE SUPREME COURT OF INDIA" />
                  </Field>
                  <p className="text-xs text-gray-400 -mt-2">Use <code className="bg-gray-100 px-1 rounded">{'{date}'}</code> for today&apos;s date (e.g. 09 Jun 2026)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Alignment">
                      <div className="flex gap-2">
                        <AlignBtn value="left" current={profile.headerAlignment} icon={AlignLeft} onChange={v => set('headerAlignment', v)} />
                        <AlignBtn value="center" current={profile.headerAlignment} icon={AlignCenter} onChange={v => set('headerAlignment', v)} />
                        <AlignBtn value="right" current={profile.headerAlignment} icon={AlignRight} onChange={v => set('headerAlignment', v)} />
                      </div>
                    </Field>
                    <Field label="Font Size (pt)">
                      <Input type="number" value={profile.headerFontSize} onChange={v => set('headerFontSize', Number(v))} min={6} max={24} />
                    </Field>
                  </div>
                  <Field label="Color">
                    <ColorInput value={profile.headerColor || '#000000'} onChange={v => set('headerColor', v)} />
                  </Field>
                </>
              )}
            </Section>

            {/* ── Document Footer ── */}
            <Section title="Document Footer" icon={Footprints} defaultOpen={false}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Enable footer / page numbers</span>
                <Toggle value={!!profile.footerEnabled} onChange={v => set('footerEnabled', v)} />
              </div>
              {(profile.footerEnabled || (profile.footerText && String(profile.footerText).trim())) && (
                <>
                  <Field label="Footer note (optional)"
                    hint="Static line shown above page numbers">
                    <Input value={profile.footerText ?? ''} onChange={v => set('footerText', v)} placeholder="e.g. Privileged — confidential" />
                  </Field>
                  <Field label="Page Number Pattern"
                    hint="{n} = current page · {total} = total pages">
                    <Input value={profile.footerPattern} onChange={v => set('footerPattern', v)} placeholder="Page {n} of {total}" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Position">
                      <select value={profile.footerPosition || 'bottom-center'}
                        onChange={e => set('footerPosition', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                        <option value="bottom-left">Bottom Left</option>
                        <option value="bottom-center">Bottom Center</option>
                        <option value="bottom-right">Bottom Right</option>
                      </select>
                    </Field>
                    <Field label="Font Size (pt)">
                      <Input type="number" value={profile.footerFontSize} onChange={v => set('footerFontSize', Number(v))} min={6} max={16} />
                    </Field>
                  </div>
                  <Field label="Color">
                    <ColorInput value={profile.footerColor || '#000000'} onChange={v => set('footerColor', v)} />
                  </Field>
                </>
              )}
            </Section>

            {/* ── Watermark ── */}
            <Section title="Watermark" defaultOpen={false}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Enable watermark</span>
                <Toggle value={!!profile.watermark} onChange={v => set('watermark', v)} />
              </div>
              {profile.watermark && (
                <>
                  <Field label="Watermark Text">
                    <Input value={profile.watermarkText} onChange={v => set('watermarkText', v)} placeholder="e.g. CONFIDENTIAL" />
                  </Field>
                  <Field label="Watermark image URL (optional)">
                    <Input value={profile.watermarkImageUrl ?? ''} onChange={v => set('watermarkImageUrl', v)} placeholder="https://…" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Opacity">
                      <Input type="number" value={profile.watermarkOpacity ?? 0.12}
                        onChange={v => set('watermarkOpacity', Number(v))} min={0.01} max={0.5} step={0.01} />
                    </Field>
                    <Field label="Angle (°)">
                      <Input type="number" value={profile.watermarkAngle ?? profile.watermarkRotation ?? -45}
                        onChange={v => { set('watermarkAngle', Number(v)); set('watermarkRotation', Number(v)); }} min={-90} max={90} />
                    </Field>
                  </div>
                  <Field label="Watermark font size (px)">
                    <Input type="number" value={profile.watermarkFontSize ?? 48}
                      onChange={v => set('watermarkFontSize', Number(v))} min={12} max={120} />
                  </Field>
                </>
              )}
            </Section>

            {/* ── Typography ── */}
            <Section title="Typography" defaultOpen={false}>
              <Field label="Font Family">
                <select value={profile.fontFamily || 'Times New Roman'}
                  onChange={e => set('fontFamily', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Font Size (pt)">
                  <Input type="number" value={profile.fontSize} onChange={v => set('fontSize', Number(v))} min={8} max={24} />
                </Field>
                <Field label="Line Height">
                  <Input type="number" value={profile.lineHeight} onChange={v => set('lineHeight', Number(v))} min={1} max={3} step={0.1} />
                </Field>
              </div>
              <Field label="Body Text Color">
                <ColorInput value={profile.bodyTextColor || '#000000'} onChange={v => set('bodyTextColor', v)} />
              </Field>
            </Section>

            {/* ── Page Setup ── */}
            <Section title="Page Setup" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Page Size">
                  <select value={profile.pageSize || 'a4'}
                    onChange={e => set('pageSize', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="a4">A4 (210×297mm)</option>
                    <option value="letter">Letter (8.5×11in)</option>
                    <option value="legal">Legal (8.5×14in)</option>
                  </select>
                </Field>
                <Field label="Orientation">
                  <select value={profile.orientation || 'portrait'}
                    onChange={e => set('orientation', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </Field>
              </div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mt-2">Margins (mm)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Top"><Input type="number" value={profile.marginTop ?? 20} onChange={v => set('marginTop', Number(v))} min={0} max={80} /></Field>
                <Field label="Right"><Input type="number" value={profile.marginRight ?? 20} onChange={v => set('marginRight', Number(v))} min={0} max={80} /></Field>
                <Field label="Bottom"><Input type="number" value={profile.marginBottom ?? 20} onChange={v => set('marginBottom', Number(v))} min={0} max={80} /></Field>
                <Field label="Left"><Input type="number" value={profile.marginLeft ?? 20} onChange={v => set('marginLeft', Number(v))} min={0} max={80} /></Field>
              </div>
            </Section>
          </div>

          {/* Bottom action bar */}
          <div className="flex-shrink-0 bg-white border-t border-gray-200 px-5 py-3 flex items-center justify-between">
            <button type="button" onClick={() => navigate('/branding')}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 cursor-pointer transition-colors">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-2">
              {saving
                ? <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                : '✓'}
              Save & Apply
            </button>
          </div>
        </div>

        {/* ── Right Preview ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Live Document Preview</h2>
            <div className="flex items-center gap-2">
              {[
                `${profile.fontFamily || 'Times New Roman'} ${profile.fontSize ?? 15}pt`,
                `${profile.lineHeight ?? 1.5}× body`,
                pageSizeLabel,
                profile.orientation === 'landscape' ? 'Landscape' : 'Portrait',
              ].map(label => (
                <span key={label} className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs rounded-full font-medium">{label}</span>
              ))}
            </div>
          </div>

          <div ref={previewContainerRef}
            className="flex-1 overflow-auto bg-gray-300 flex items-start justify-center"
            style={{ padding: 32 }}>
            <TemplatePreview profile={profile} containerRef={previewContainerRef} />
          </div>

          <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center gap-3 justify-end">
            <button type="button" onClick={handleExportHtml}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
              ↓ Export HTML
            </button>
            <button type="button" onClick={handleExportPdf} disabled={pdfLoading}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-60 focus:outline-none min-w-[120px] justify-center">
              {pdfLoading
                ? <><span className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />{pdfStatus || 'Converting…'}</>
                : <><span>↓</span> Export PDF</>}
            </button>
            <button type="button" onClick={handleExportDocx}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
              ↓ Export DOCX
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
