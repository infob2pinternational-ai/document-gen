import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CompanyProfile, Document, DocumentItem } from '../types';
import { dbService } from '../services/db';
import { ArrowLeft, Printer, AlertTriangle, Download } from 'lucide-react';
import { calculateDocumentTotals } from '../utils/calculations';
import { shareDocumentViaWhatsApp } from '../utils/whatsappShare';
import { resolveProfileLogo } from '../utils/resolveProfileLogo';

interface DocumentPreviewProps {
  activeProfile: CompanyProfile | null;
  document: Document;
  onClose: () => void;
  isPublicShare?: boolean;
  // Additive, defaults false - every existing caller (desktop's
  // Documents.tsx, the public share page) renders exactly as before.
  // The B2P ONE mobile app's DocumentView.tsx is the only caller that
  // sets this: it shows its own unified toolbar (Back/Approve/Reject/
  // Edit/WhatsApp/Print) above this component instead, so this
  // component's own "Back to List" / WhatsApp / Print action row would
  // otherwise duplicate it.
  hideToolbar?: boolean;
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  activeProfile: propProfile,
  document,
  onClose,
  isPublicShare = false,
  hideToolbar = false
}) => {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeProfile, setActiveProfile] = useState<CompanyProfile | null>(propProfile);
  const [scale, setScale] = useState(1);

  // Sync local activeProfile state if propProfile updates from settings/parent
  useEffect(() => {
    if (propProfile) {
      setActiveProfile(propProfile);
    }
  }, [propProfile]);

  const getAddressLines = (address: string) => {
    if (!address) return [];
    if (address.includes('\n')) {
      return address.split('\n').map(line => line.trim()).filter(Boolean);
    }
    if (address.includes(',')) {
      return address.split(',').map(line => line.trim()).filter(Boolean);
    }
    return [address];
  };

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasHeight, setCanvasHeight] = useState(1050);

  // Pinch-to-zoom - mobile only (hideToolbar), entirely additive on
  // top of the fit-to-width `scale` above rather than replacing it:
  // pinchScale is a multiplier applied to the already-scaled wrapper,
  // so zooming in/out never touches the 800px print-fidelity canvas
  // itself. Desktop callers never set hideToolbar, so none of this
  // effect's listeners are ever attached - no behavior change, same as
  // before this existed.
  //
  // The touchmove listener is attached manually via addEventListener
  // rather than React's onTouchMove prop: React registers touch
  // listeners as passive by default (for scroll performance), and a
  // passive listener's preventDefault() is a no-op that also throws
  // inside the handler - silently aborting everything after it,
  // including the actual zoom state update. { passive: false } here is
  // what makes preventDefault (needed to stop the page's own scroll
  // from fighting the pinch) actually take effect.
  const [pinchScale, setPinchScale] = useState(1);
  const pinchScaleRef = useRef(1); // mirrors pinchScale, read inside the
  // listeners below so they don't need to be re-attached on every zoom
  // frame just to see a fresh value.
  const pinchState = useRef<{ startDist: number; startScale: number } | null>(null);
  const pinchCleanup = useRef<(() => void) | null>(null);

  // Callback ref, not useRef+useEffect: this component shows a loading
  // placeholder before the real canvas/wrapper mounts (see the
  // isPublicShare/loading branches below), so a plain ref would still
  // be null on the effect's first run and never gets attached once the
  // wrapper actually appears (an effect with a stable dependency array
  // doesn't re-run just because a ref's target changed). A callback
  // ref fires exactly when the DOM node itself is attached/detached,
  // regardless of when that happens across renders - which is what
  // this needs. Wrapped in useCallback so its identity only changes
  // with hideToolbar (practically never) rather than on every render -
  // an inline (non-memoized) ref function makes React detach/reattach
  // on every single re-render, including the ones this listener itself
  // triggers via setPinchScale on each pinch frame.
  const setWrapperRef = useCallback((el: HTMLDivElement | null) => {
    pinchCleanup.current?.();
    pinchCleanup.current = null;
    if (!el || !hideToolbar) return;

    const distance = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchState.current = { startDist: distance(e.touches), startScale: pinchScaleRef.current };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchState.current) {
        e.preventDefault();
        const dist = distance(e.touches);
        const next = Math.min(3, Math.max(1, pinchState.current.startScale * (dist / pinchState.current.startDist)));
        pinchScaleRef.current = next;
        setPinchScale(next);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchState.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    pinchCleanup.current = () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [hideToolbar]);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 840) {
        // Margin subtracted here must match whatever horizontal padding
        // the caller's scroll container actually has, or the scaled
        // canvas either overflows or leaves excess unused space. B2P
        // ONE's DocumentView.tsx (hideToolbar=true path) uses a tight
        // 16px total side padding specifically so the preview "feels
        // like a real document" rather than a small floating card;
        // desktop's own narrow-viewport fallback (hideToolbar=false,
        // e.g. Documents.tsx in a narrow window) keeps a bit more
        // breathing room at 36px. Same formula either way, just tuned
        // to each caller's actual available width.
        const margin = hideToolbar ? 8 : 36;
        setScale(Math.min(1, (width - margin) / 800));
      } else {
        setScale(1);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [hideToolbar]);

  // Dynamically observe and measure canvas height to avoid vertical clipping
  useEffect(() => {
    if (canvasRef.current) {
      setCanvasHeight(canvasRef.current.offsetHeight);
      
      const observer = new ResizeObserver((entries) => {
        for (let entry of entries) {
          if (entry.target) {
            setCanvasHeight(entry.target.clientHeight);
          }
        }
      });
      observer.observe(canvasRef.current);
      return () => observer.disconnect();
    }
  }, [items, loading]);

  useEffect(() => {
    const fetchDocDetails = async () => {
      try {
        console.log('DocumentPreview: Fetching details for document ID:', document.id);

        if (isPublicShare) {
          // Public share view: route through the get_public_document RPC
          // (Phase 1/2 of the RLS hardening work) instead of the raw
          // table queries below - one call returns both the whitelisted
          // profile fields and the items together. The authenticated
          // in-app preview path (isPublicShare === false) is completely
          // untouched and still uses the full-detail queries, since it
          // needs the full row and isn't affected by the anon RLS
          // lockdown this work is building toward.
          const publicRes = await dbService.getPublicDocument({ id: document.id });
          console.log('DocumentPreview: getPublicDocument returned:', publicRes);

          if (publicRes) {
            let profileToUse = activeProfile;
            if (!profileToUse && publicRes.profile) {
              const prof = publicRes.profile;
              const mappedProf = { ...prof, logo_url: resolveProfileLogo(prof) } as CompanyProfile;
              setActiveProfile(mappedProf);
              profileToUse = mappedProf;
            }
            console.log('DocumentPreview: Active profile branding details:', { name: profileToUse?.name });
            setItems(publicRes.items);
          } else {
            setError(true);
          }
          setLoading(false);
          return;
        }

        let profileToUse = activeProfile;
        if (!profileToUse) {
          const prof = await dbService.getProfileById(document.company_id);
          if (prof) {
            const mappedProf = { ...prof, logo_url: resolveProfileLogo(prof) };
            setActiveProfile(mappedProf);
            profileToUse = mappedProf;
          }
        }

        console.log('DocumentPreview: Active profile branding details:', {
          name: profileToUse?.name
        });

        const res = await dbService.getDocumentById(document.id);
        console.log('DocumentPreview: dbService returned:', res);
        
        if (res) {
          setItems(res.items);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('Error fetching doc items for preview:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchDocDetails();
  }, [document, activeProfile, isPublicShare]);

  useEffect(() => {
    const originalTitle = window.document.title;
    // Replace slashes with underscores for valid OS file naming
    const safeTitle = document.document_number.replace(/[\/\\]/g, '_');
    window.document.title = safeTitle;
    return () => {
      window.document.title = originalTitle;
    };
  }, [document.document_number]);

  const handlePrint = () => {
    window.print();
  };

  // Reuses the shared WhatsApp-share utility (also used by Documents.tsx
  // and the owner mobile app) instead of its own separate copy of this
  // logic - this also fixes a pre-existing gap where this button never
  // called dbService.logWhatsAppSend, unlike the Documents.tsx version.
  const handleWhatsAppSend = () => {
    const userStr = localStorage.getItem('supabase_user');
    const storedUser = userStr ? JSON.parse(userStr) : null;
    const userEmail = storedUser ? storedUser.email : '';
    const companyName = activeProfile?.name || 'B2P International';
    shareDocumentViaWhatsApp(document, companyName, userEmail);
  };

  const getDocTitle = (type: string) => {
    switch (type) {
      case 'invoice': return 'TAX INVOICE';
      case 'non_tax_invoice': return 'INVOICE';
      case 'proforma_invoice': return 'PROFORMA INVOICE';
      case 'quotation': return 'QUOTATION';
      case 'work_order': return 'WORK ORDER';
      default: return 'DOCUMENT';
    }
  };

  // Same resolution ProfileSwitcher.tsx uses for its own logo, so both
  // screens always render the identical asset - see resolveProfileLogo's
  // own comment for why activeProfile.logo_url can't be rendered as-is
  // (it may hold a legacy desktop-only /billing/... path that 404s here
  // on mobile).
  const logoSrc = resolveProfileLogo(activeProfile);


  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p>Loading document preview...</p>
      </div>
    );
  }

  if (error || !activeProfile) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center', maxWidth: '500px', margin: '2rem auto' }}>
        <AlertTriangle size={48} style={{ color: 'var(--accent-danger)', margin: '0 auto 1rem auto' }} />
        <h3>Failed to load document</h3>
        <p style={{ color: 'var(--text-secondary)' }}>The document details could not be retrieved from storage.</p>
        <button onClick={onClose} className="btn-secondary" style={{ marginTop: '1.5rem' }}>
          Back to list
        </button>
      </div>
    );
  }

  const totals = calculateDocumentTotals(items, document.discount_total, document.document_type);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Action Header - suppressed when the caller (B2P ONE mobile app)
          renders its own unified toolbar instead; see hideToolbar. */}
      {!hideToolbar && (
        <div className="no-print" style={{
          display: 'flex',
          justifyContent: isPublicShare ? 'center' : 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          background: 'var(--bg-card)',
          padding: '1rem 1.5rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          width: '100%',
          gap: '0.75rem'
        }}>
          {!isPublicShare && (
            <button onClick={onClose} className="btn-secondary">
              <ArrowLeft size={16} />
              <span>Back to List</span>
            </button>
          )}
          <div className="preview-actions" style={{ width: isPublicShare ? '100%' : 'auto', justifyContent: 'center' }}>
            {document.customer_phone && !isPublicShare && document.status === 'approved' && (
              <button onClick={handleWhatsAppSend} className="btn-secondary" style={{ color: '#25D366', borderColor: '#25D366' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px' }}>
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.49-4.22c1.7.994 3.551 1.54 5.46 1.545 5.867 0 10.639-4.76 10.643-10.627.002-2.842-1.096-5.513-3.093-7.514S14.86 3.1 12.016 3.1C6.15 3.1 1.38 7.86 1.377 13.728c-.001 1.955.513 3.868 1.49 5.58l-.995 3.637 3.733-.979zm11.168-5.32c-.305-.152-1.802-.888-2.082-.99-.28-.102-.484-.152-.688.152-.204.305-.79.99-.969 1.2-.178.204-.356.229-.66.076-.305-.152-1.289-.475-2.455-1.515-.908-.81-1.52-1.81-1.698-2.115-.178-.305-.019-.47.133-.621.137-.136.305-.356.457-.534.152-.178.204-.305.305-.508.102-.204.051-.381-.025-.533-.076-.152-.688-1.659-.942-2.27-.248-.596-.5-.515-.688-.525-.178-.01-.382-.01-.586-.01-.204 0-.535.076-.814.381-.28.305-1.069 1.042-1.069 2.54 0 1.498 1.09 2.946 1.242 3.149.152.204 2.146 3.277 5.198 4.59.726.313 1.293.5 1.734.64.73.232 1.394.2 1.918.12.584-.087 1.802-.737 2.057-1.448.255-.71.255-1.321.178-1.448-.076-.127-.28-.203-.585-.355z"/>
                </svg>
                <span>Send via WhatsApp</span>
              </button>
            )}
            <button onClick={handlePrint} className="btn-primary" style={{ flexGrow: isPublicShare ? 1 : 0, justifyContent: 'center' }}>
              {isPublicShare ? <Download size={16} /> : <Printer size={16} />}
              <span>{isPublicShare ? 'Download / Print PDF' : 'Print / Export PDF'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Scaling Wrapper for Mobile Responsiveness. pinchScale (mobile
          only, see the touch-listener effect above) is a plain CSS
          transform on top of this already fit-to-width box - the
          browser accounts for transformed bounds in the ancestor's
          scrollable area, so once zoomed in past the viewport, normal
          single-finger drag within .owner-preview-screen's existing
          scroll container pans around it with no extra pan logic
          needed here. touchAction disables the browser's own native
          pinch-zoom only on mobile, so it can't double-apply against
          our own transform. */}
      <div
        ref={setWrapperRef}
        className="document-canvas-wrapper"
        style={{
          width: scale < 1 ? `${800 * scale}px` : '100%',
          overflow: hideToolbar ? 'visible' : 'hidden',
          display: 'flex',
          justifyContent: 'flex-start',
          height: scale < 1 ? `${canvasHeight * scale}px` : 'auto',
          margin: '0 auto',
          transform: pinchScale !== 1 ? `scale(${pinchScale})` : undefined,
          transformOrigin: 'top center',
          touchAction: hideToolbar ? 'pan-x pan-y' : undefined
        }}
      >
        {/* Printable Sheet Canvas */}
        <div ref={canvasRef} className="document-canvas" style={{ 
          position: 'relative', 
          padding: '0', 
          display: 'flex',
          flexDirection: 'column',
          width: '800px',
          minHeight: '1050px',
          boxSizing: 'border-box',
          background: '#ffffff',
          color: '#000000',
          fontFamily: "'Outfit', sans-serif",
          transform: scale < 1 ? `scale(${scale})` : 'none',
          transformOrigin: 'top left',
          flexShrink: 0,
          margin: '0'
        }}>
        {/* Logo Watermark */}
        {logoSrc && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            opacity: 0.05,
            pointerEvents: 'none',
            zIndex: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '320px',
            height: '320px'
          }}>
            <img
              src={logoSrc}
              alt="Watermark"
              loading="lazy"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain'
              }}
            />
          </div>
        )}


        {/* Standard Corporate Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'flex-start', 
          padding: '2.5rem 2rem 1.5rem 2rem', 
          borderBottom: '2px solid #cbd5e1', 
          marginBottom: '2rem',
          color: '#0f172a'
        }}>
          {/* Left Column: Company Info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '60%' }}>
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={activeProfile.name}
                style={{ height: '90px', width: 'auto', display: 'block', objectFit: 'contain', alignSelf: 'flex-start' }}
              />
            ) : (
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>{activeProfile.name}</h2>
            )}
            <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: '1.4', marginTop: '0.25rem' }}>
              {activeProfile.address ? (
                getAddressLines(activeProfile.address).map((line, idx, arr) => (
                  <p key={idx} style={{ margin: '0 0 2px 0' }}>
                    {line}{idx < arr.length - 1 ? ',' : ''}
                  </p>
                ))
              ) : null}
              {activeProfile.phone && <p style={{ margin: '0 0 2px 0' }}>Phone: {activeProfile.phone}</p>}
              {activeProfile.email && <p style={{ margin: '0 0 2px 0' }}>Email: {activeProfile.email}</p>}
              {activeProfile.website && <p style={{ margin: '0 0 2px 0' }}>Web: {activeProfile.website}</p>}
              {activeProfile.gstin && (
                <p style={{ margin: '4px 0 0 0', fontWeight: 700, color: '#0f172a' }}>
                  GSTIN: <span className="mono">{activeProfile.gstin}</span>
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Document Type Title */}
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', maxWidth: '38%', flexShrink: 0 }}>
            <h1 style={{ 
              fontSize: '2.25rem', 
              fontWeight: 800, 
              margin: 0, 
              color: '#0f172a', 
              textTransform: 'uppercase', 
              letterSpacing: '-0.02em',
              lineHeight: '1.1'
            }}>
              {getDocTitle(document.document_type)}
            </h1>
          </div>
        </div>

        {/* Outer content container with standard A4 page margins */}
        <div style={{ padding: '0 2rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
          
          {/* Metadata Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: '#000000' }}>
            <div>
              <strong style={{ fontSize: '0.95rem' }}>To, {document.customer_name}</strong>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', color: '#334155', lineHeight: '1.4' }}>
                {document.customer_address}
              </div>
              {document.customer_gstin && (
                <div style={{ marginTop: '0.35rem', color: '#334155', fontWeight: 500 }}>
                  GSTIN: <span style={{ fontWeight: 600 }} className="mono">{document.customer_gstin}</span>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div>
                <strong style={{ color: '#475569' }}>Date</strong> &nbsp;&nbsp;&nbsp;: &nbsp;
                <span style={{ fontWeight: 600 }}>{document.date ? document.date.split('-').reverse().join('/') : ''}</span>
              </div>
              <div>
                <strong style={{ color: '#475569' }}>
                  {document.document_type === 'invoice' || document.document_type === 'non_tax_invoice' ? 'Invoice No' : document.document_type === 'proforma_invoice' ? 'Invoice No' : document.document_type === 'quotation' ? 'Quotation No' : 'Order No'}
                </strong> : &nbsp;
                <span style={{ fontWeight: 600 }} className="mono">{document.document_number}</span>
              </div>
            </div>
          </div>

          {/* Service Name & Period Section */}
          {document.notes && (
            <div style={{ marginBottom: '1.25rem', fontSize: '0.85rem' }}>
              <strong style={{ color: '#475569' }}>Service Name & Period :</strong>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', marginTop: '0.15rem', color: '#000000' }}>
                {document.notes}
              </div>
            </div>
          )}

          {/* Line Items Table */}
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #cbd5e1',
            marginBottom: '1.5rem',
            fontSize: '0.8rem',
            color: '#0f172a'
          }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #cbd5e1', background: '#f8fafc' }}>
                <th style={{ borderRight: '1px solid #cbd5e1', padding: '0.5rem', textAlign: 'center', width: '40px', fontWeight: 700 }}>No</th>
                <th style={{ borderRight: '1px solid #cbd5e1', padding: '0.5rem', textAlign: 'left', fontWeight: 700 }}>
                  {document.col_name_description || 'Particulars'}
                </th>
                <th style={{ borderRight: '1px solid #cbd5e1', padding: '0.5rem', textAlign: 'center', width: '60px', fontWeight: 700 }}>
                  {document.col_name_quantity || 'Qty'}
                </th>
                <th style={{ borderRight: '1px solid #cbd5e1', padding: '0.5rem', textAlign: 'center', width: '60px', fontWeight: 700 }}>
                  {document.col_name_unit || 'Days'}
                </th>
                <th style={{ borderRight: '1px solid #cbd5e1', padding: '0.5rem', textAlign: 'right', width: '90px', fontWeight: 700 }}>
                  {document.col_name_rate || 'Rate'}
                </th>
                <th style={{ padding: '0.5rem', textAlign: 'right', width: '100px', fontWeight: 700 }}>
                  {document.col_name_amount || 'Amount'}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #cbd5e1' }}>
                  <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.65rem 0.5rem', textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.65rem 0.5rem', fontWeight: 500, whiteSpace: 'pre-wrap' }}>{item.description}</td>
                  <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.65rem 0.5rem', textAlign: 'center' }}>{item.quantity}</td>
                  <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                    {document.col_name_unit?.toLowerCase().trim() === 'days' || document.col_name_unit?.toLowerCase().trim() === 'day'
                      ? (item.days || 1)
                      : item.unit
                    }
                  </td>
                  <td className="mono" style={{ borderRight: '1px solid #cbd5e1', padding: '0.65rem 0.5rem', textAlign: 'right' }}>
                    {Number(item.rate).toFixed(2)}
                  </td>
                  <td className="mono" style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                    {Number(item.amount).toFixed(2)}
                  </td>
                </tr>
              ))}

              {/* Totals Section */}
              {totals.discountTotal > 0 ? (
                <>
                  {/* Discount Row */}
                  <tr style={{ fontWeight: 600, color: '#dc2626', fontSize: '0.75rem' }}>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.4rem 0.5rem', textAlign: 'right' }}>Discount</td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td className="mono" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                      -{totals.discountTotal.toFixed(2)}
                    </td>
                  </tr>

                  {/* Taxable Amount Row */}
                  <tr style={{ fontWeight: 600, color: '#475569', fontSize: '0.75rem' }}>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.4rem 0.5rem', textAlign: 'right' }}>Taxable Amount</td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td className="mono" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                      {totals.taxableAmount.toFixed(2)}
                    </td>
                  </tr>
                </>
              ) : (
                /* Subtotal Row when no discount */
                <tr style={{ fontWeight: 600, color: '#475569', fontSize: '0.75rem' }}>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.4rem 0.5rem', textAlign: 'right' }}>Subtotal</td>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td className="mono" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                    {totals.subtotal.toFixed(2)}
                  </td>
                </tr>
              )}

              {/* GST Row - hidden for Non-Tax Invoices and for any document
                  where no GST was actually applied (taxTotal is 0), per the
                  business rule that non-GST documents must show no GST row
                  or a ₹0 GST amount at all. */}
              {document.document_type !== 'non_tax_invoice' && totals.taxTotal > 0 && (
                <tr style={{ fontWeight: 600, color: '#475569', fontSize: '0.75rem' }}>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                    GST {totals.effectiveGstRate > 0 ? `(${totals.effectiveGstRate.toFixed(0)}%)` : ''}
                  </td>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                  <td className="mono" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                    {totals.taxTotal.toFixed(2)}
                  </td>
                </tr>
              )}

              {/* Grand Total Row */}
              <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.5rem', textAlign: 'right' }}>Grand Total</td>
                <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                <td className="mono" style={{ padding: '0.5rem', textAlign: 'right', fontSize: '0.85rem' }}>
                  {totals.total.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Amount in Words */}
          <div style={{ marginBottom: '1.25rem', fontSize: '0.8rem', color: '#0f172a' }}>
            <strong>Amount in Words: </strong>
            <span style={{ fontStyle: 'italic', fontWeight: 600, color: '#334155' }}>{totals.amountInWords}</span>
          </div>

          {/* Bottom bank details and signature signatory box */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            fontSize: '0.8rem',
            marginTop: 'auto', 
            paddingBottom: '2.5rem'
          }}>
            {/* Left: Bank details inside border box */}
            {activeProfile.bank_name && (
              <div style={{
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                padding: '0.75rem 1rem',
                lineHeight: '1.6',
                width: '55%',
                background: '#ffffff',
                color: '#000000'
              }}>
                <strong>Account No :</strong> <span className="mono">{activeProfile.bank_account_no}</span><br />
                <strong>Acc Name :</strong> {activeProfile.bank_holder || activeProfile.name}<br />
                <strong>IFSC :</strong> <span className="mono">{activeProfile.bank_ifsc}</span><br />
                <strong>Bank Name :</strong> {activeProfile.bank_name}
              </div>
            )}

            {/* Right: Signatory block */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center',
              width: '180px',
              position: 'relative'
            }}>
              <div style={{ 
                fontSize: '0.8rem', 
                fontWeight: 700, 
                color: '#475569', 
                marginBottom: '4.5rem', 
                textAlign: 'center',
                width: '100%'
              }}>
                For {activeProfile.name}
              </div>
              {activeProfile.seal_url && (
                <img 
                  src={activeProfile.seal_url} 
                  alt="Seal/Stamp" 
                  loading="lazy"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '20px',
                    transform: 'translateX(-50%)',
                    height: '90px',
                    width: '90px',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    mixBlendMode: 'multiply',
                    zIndex: 2
                  }}
                />
              )}
              <div style={{ borderTop: '1px solid #000000', width: '100%', paddingTop: '0.25rem', textAlign: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Authorized Signatory
                </span>
              </div>
            </div>
          </div>

          {/* Terms info box if present (hidden for Tax Invoices) */}
          {document.document_type !== 'invoice' && document.document_type !== 'non_tax_invoice' && (document.terms || activeProfile.default_terms) && (
            <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: '0.75rem', paddingBottom: '1.5rem', fontSize: '0.75rem', color: '#334155' }}>
              <strong>TERMS & CONDITIONS:</strong>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', lineHeight: '1.4' }}>
                {document.terms || activeProfile.default_terms}
              </div>
            </div>
          )}

        </div>

        {/* Standard Corporate Footer */}
        <div style={{ 
          borderTop: '1px solid #cbd5e1', 
          padding: '1.25rem 2rem', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          gap: '1.5rem',
          fontSize: '0.75rem', 
          color: '#475569',
          marginTop: 'auto',
          flexWrap: 'wrap',
          textAlign: 'center'
        }}>
          {activeProfile.phone && (
            <div>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>Phone:</span> {activeProfile.phone}
            </div>
          )}
          {activeProfile.email && (
            <div>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>Email:</span> {activeProfile.email}
            </div>
          )}
          {activeProfile.website && (
            <div>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>Web:</span> {activeProfile.website}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
