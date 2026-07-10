import React, { useState, useEffect, useRef } from 'react';
import type { CompanyProfile, Document, DocumentItem } from '../types';
import { dbService } from '../services/db';
import { ArrowLeft, Printer, AlertTriangle, Download } from 'lucide-react';

interface DocumentPreviewProps {
  activeProfile: CompanyProfile | null;
  document: Document;
  onClose: () => void;
  isPublicShare?: boolean;
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  activeProfile: propProfile,
  document,
  onClose,
  isPublicShare = false
}) => {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeProfile, setActiveProfile] = useState<CompanyProfile | null>(propProfile);
  const [scale, setScale] = useState(1);
  const isB2P = activeProfile?.name?.toLowerCase().includes('b2p') || 
                activeProfile?.name?.toLowerCase().includes('inter media') || 
                activeProfile?.name?.toLowerCase().includes('inter-media') || 
                activeProfile?.name?.toLowerCase().includes('international');

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

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 840) {
        setScale(Math.min(1, (width - 36) / 800));
      } else {
        setScale(1);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
        
        let profileToUse = activeProfile;
        if (!profileToUse) {
          const prof = await dbService.getProfileById(document.company_id);
          if (prof) {
            setActiveProfile(prof);
            profileToUse = prof;
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
  }, [document, activeProfile]);

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

  const handleWhatsAppSend = () => {
    if (!document.customer_phone) {
      alert('This customer does not have a phone number specified.');
      return;
    }

    let cleanPhone = document.customer_phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    }

    const docTypeLabel = getDocTitle(document.document_type) === 'TAX INVOICE' ? 'Tax Invoice' : getDocTitle(document.document_type) === 'PROFORMA INVOICE' ? 'Proforma Invoice' : getDocTitle(document.document_type) === 'QUOTATION' ? 'Quotation' : 'Work Order';
    const docDate = document.date ? document.date.split('-').reverse().join('/') : '';
    const formattedTotal = Number(document.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
    const shareLink = baseUrl + '/doc/' + document.id;
    
    const message = `Dear *${document.customer_name}*,\n\n` +
      `Thank you for considering *${activeProfile?.name}*.\n\n` +
      `Please find attached your *${docTypeLabel}* (*#${document.document_number}*) dated *${docDate}*.\n\n` +
      `*View / Download PDF:* ${shareLink}\n\n` +
      `*Total Amount:* ₹${formattedTotal}\n\n` +
      `We appreciate your consideration and look forward to working with you. Please let us know if you need any additional information or revisions.\n\n` +
      `Best regards,\n` +
      `*${activeProfile?.name}*\n\n` +
      `---\n` +
      `📲 *Follow us on Social Media:*\n` +
      `Instagram: https://instagram.com/b2pinternational\n` +
      `Facebook: https://facebook.com/b2pinternational\n\n` +
      `⭐ *We value your feedback!*\n` +
      `Please leave us a review on Google: https://g.page/r/CcC1J3PCvB_BEBM/review`;

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, 'whatsapp_window');
  };

  const getDocTitle = (type: string) => {
    switch (type) {
      case 'invoice': return 'TAX INVOICE';
      case 'proforma_invoice': return 'PROFORMA INVOICE';
      case 'quotation': return 'QUOTATION';
      case 'work_order': return 'WORK ORDER';
      default: return 'DOCUMENT';
    }
  };


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

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Action Header */}
      <div className="no-print" style={{
        display: 'flex',
        justifyContent: isPublicShare ? 'center' : 'space-between',
        alignItems: 'center',
        background: 'var(--bg-card)',
        padding: '1rem 1.5rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        width: '100%'
      }}>
        {!isPublicShare && (
          <button onClick={onClose} className="btn-secondary">
            <ArrowLeft size={16} />
            <span>Back to List</span>
          </button>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', width: isPublicShare ? '100%' : 'auto', justifyContent: 'center' }}>
          {document.customer_phone && !isPublicShare && (
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

      {/* Scaling Wrapper for Mobile Responsiveness */}
      <div style={{
        width: scale < 1 ? `${800 * scale}px` : '100%',
        overflow: 'hidden',
        display: 'flex',
        justifyContent: 'flex-start',
        height: scale < 1 ? `${canvasHeight * scale}px` : 'auto',
        margin: '0 auto'
      }}>
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
        {activeProfile.logo_url && (
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
              src={activeProfile.logo_url} 
              alt="Watermark" 
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain'
              }}
            />
          </div>
        )}


        {isB2P ? (
          /* Render gorgeous B2P branded quotation/invoice layout */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '1050px', width: '100%' }}>
            {/* Header Block with Skew Gradient */}
            <div style={{
              display: 'flex',
              width: '100%',
              height: '140px',
              background: 'linear-gradient(115deg, #0c2b5c 45%, #ffffff 45%, #ffffff 47%, #f34e21 47%)',
              position: 'relative',
              color: '#ffffff',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 2.5rem',
              boxSizing: 'border-box'
            }}>
              {/* Left: Logo */}
              <div style={{ height: '90px', display: 'flex', alignItems: 'center' }}>
                {activeProfile.logo_url && (
                  <img 
                    src={activeProfile.logo_url} 
                    alt={activeProfile.name} 
                    style={{ height: '90px', width: 'auto', objectFit: 'contain' }}
                  />
                )}
              </div>
              {/* Right: Document Type */}
              <div style={{ textAlign: 'right' }}>
                <h1 style={{
                  fontSize: '3rem',
                  fontWeight: 800,
                  margin: 0,
                  color: '#ffffff',
                  textTransform: 'capitalize',
                  fontFamily: "'Outfit', sans-serif"
                }}>
                  {document.document_type === 'invoice' ? 'Invoice' : document.document_type === 'proforma_invoice' ? 'Proforma Invoice' : document.document_type === 'quotation' ? 'Quotation' : 'Work Order'}
                </h1>
              </div>
            </div>

            {/* Address Bar */}
            <div style={{
              width: '100%',
              background: '#ffffff',
              padding: '0.75rem 2.5rem',
              fontSize: '0.85rem',
              color: '#0f172a',
              fontWeight: 500,
              lineHeight: '1.4',
              borderBottom: '1px dashed #cbd5e1',
              boxSizing: 'border-box'
            }}>
              {activeProfile.address ? activeProfile.address.replace(/\n/g, ', ') : ''}
            </div>

            {/* Content Body Container */}
            <div style={{ padding: '1.5rem 2.5rem', display: 'flex', flexDirection: 'column', flex: 1, boxSizing: 'border-box' }}>
              {/* Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#000000' }}>
                {/* Left Column: Customer details */}
                <div style={{ lineHeight: '1.6' }}>
                  <strong style={{ fontSize: '0.95rem' }}>To, {document.customer_name}</strong>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', color: '#000000', fontSize: '0.85rem' }}>
                    {document.customer_address}
                  </div>
                </div>
                {/* Right Column: Date, Quot No, Service Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', textAlign: 'right' }}>
                  <div>
                    <strong>Date</strong> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: &nbsp;
                    <span style={{ fontWeight: 600 }}>{document.date ? document.date.split('-').reverse().join('/') : ''}</span>
                  </div>
                  <div>
                    <strong>
                      {document.document_type === 'invoice' ? 'Invoice No' : document.document_type === 'proforma_invoice' ? 'Invoice No' : document.document_type === 'quotation' ? 'Quot No' : 'Order No'}
                    </strong> : &nbsp;
                    <span style={{ fontWeight: 600 }} className="mono">{document.document_number}</span>
                  </div>
                  {document.notes && (
                    <div style={{ marginTop: '0.25rem' }}>
                      <strong>Service Name & Period</strong> : &nbsp;<br />
                      <span style={{ fontWeight: 600, display: 'inline-block', borderBottom: '1px dotted #000', paddingBottom: '2px' }}>{document.notes}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Items Table - 5 Columns */}
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                border: '1.5px solid #000000',
                marginBottom: '1.5rem',
                fontSize: '0.8rem',
                color: '#000000'
              }}>
                <thead>
                  <tr style={{ borderBottom: '1.5px solid #000000', background: '#ffffff' }}>
                    <th style={{ borderRight: '1px solid #000000', padding: '0.5rem', textAlign: 'center', width: '40px', fontWeight: 700, color: '#000000' }}>No</th>
                    <th style={{ borderRight: '1px solid #000000', padding: '0.5rem', textAlign: 'left', fontWeight: 700, color: '#000000' }}>Particulars</th>
                    <th style={{ borderRight: '1px solid #000000', padding: '0.5rem', textAlign: 'center', width: '120px', fontWeight: 700, color: '#000000' }}>Qty</th>
                    <th style={{ borderRight: '1px solid #000000', padding: '0.5rem', textAlign: 'center', width: '120px', fontWeight: 700, color: '#000000' }}>Rate</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right', width: '120px', fontWeight: 700, color: '#000000' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #000000' }}>
                      <td style={{ borderRight: '1px solid #000000', padding: '0.65rem 0.5rem', textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ borderRight: '1px solid #000000', padding: '0.65rem 0.5rem', fontWeight: 500, whiteSpace: 'pre-wrap' }}>{item.description}</td>
                      <td style={{ borderRight: '1px solid #000000', padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        {item.unit || item.quantity || '-'}
                      </td>
                      <td style={{ borderRight: '1px solid #000000', padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                        {item.hsn_sac || (item.rate > 0 ? Number(item.rate).toFixed(2) : '-')}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                        {Number(item.amount).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr style={{ fontWeight: 600, borderTop: '1.5px solid #000000' }}>
                    <td style={{ borderRight: '1px solid #000000' }}></td>
                    <td style={{ borderRight: '1px solid #000000', padding: '0.65rem 0.5rem', textAlign: 'right' }}>Grand Total</td>
                    <td style={{ borderRight: '1px solid #000000' }}></td>
                    <td style={{ borderRight: '1px solid #000000' }}></td>
                    <td className="mono" style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>
                      ₹{Number(document.total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Bank Details and Signature Block */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', marginTop: 'auto' }}>
                {activeProfile.bank_name && (
                  <div style={{
                    border: '1.5px solid #0c2b5c',
                    borderRadius: '4px',
                    padding: '0.75rem 1rem',
                    lineHeight: '1.6',
                    width: '55%',
                    background: '#ffffff',
                    color: '#000000',
                    fontSize: '0.8rem',
                    boxSizing: 'border-box'
                  }}>
                    <strong>Account No :</strong> <span className="mono">{activeProfile.bank_account_no}</span><br />
                    <strong>Acc Name :</strong> {activeProfile.bank_holder || activeProfile.name}<br />
                    <strong>IFSC :</strong> <span className="mono">{activeProfile.bank_ifsc}</span><br />
                    <strong>Bank Details :</strong> {activeProfile.bank_name} {activeProfile.bank_branch ? `(${activeProfile.bank_branch})` : ''}
                  </div>
                )}

                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  width: '200px',
                  position: 'relative'
                }}>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    fontWeight: 700, 
                    color: '#000000', 
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
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '15px',
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
                  <div style={{ borderTop: '1.5px solid #000000', width: '100%', paddingTop: '0.25rem', textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Authorized Signatory
                    </span>
                  </div>
                </div>
              </div>

              {/* Terms and Conditions block */}
              {(document.terms || activeProfile.default_terms) && (
                <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: '0.5rem', fontSize: '0.7rem', color: '#334155' }}>
                  <strong>TERMS & CONDITIONS:</strong>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.15rem', lineHeight: '1.3' }}>
                    {document.terms || activeProfile.default_terms}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Contact Footer Bar */}
            <div style={{
              display: 'flex',
              width: '100%',
              height: '60px',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: '#ffffff',
              boxSizing: 'border-box'
            }}>
              {/* Left Split: Blue */}
              <div style={{
                width: '40%',
                background: '#0c2b5c',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                paddingLeft: '2.5rem',
                boxSizing: 'border-box'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                  <span>/ b2p international</span>
                </div>
              </div>
              {/* Right Split: Orange */}
              <div style={{
                width: '60%',
                background: '#f34e21',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                paddingLeft: '1.5rem',
                paddingRight: '2.5rem',
                gap: '2px',
                boxSizing: 'border-box'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                    <span>+91 8589 9090 34, +91 8139 0090 34</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    <span>info@b2pinternational.com</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                  <span>www.b2pinternational.com</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Render the standard corporate layout */
          <div style={{ padding: '0 2rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* Standard Corporate Header */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'flex-start', 
              padding: '2.5rem 0 1.5rem 0', 
              borderBottom: '2px solid #cbd5e1', 
              marginBottom: '2rem',
              color: '#0f172a'
            }}>
              {/* Left Column: Company Info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '60%' }}>
                {activeProfile.logo_url ? (
                  <img 
                    src={activeProfile.logo_url} 
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
                  {activeProfile.website && <p style={{ margin: 0 }}>Web: {activeProfile.website}</p>}
                </div>
              </div>

              {/* Right Column: Document Type Title */}
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
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

            {/* Metadata Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: '#000000' }}>
              <div>
                <strong style={{ fontSize: '0.95rem' }}>To, {document.customer_name}</strong>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', color: '#334155', lineHeight: '1.4' }}>
                  {document.customer_address}
                </div>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div>
                  <strong style={{ color: '#475569' }}>Date</strong> &nbsp;&nbsp;&nbsp;: &nbsp;
                  <span style={{ fontWeight: 600 }}>{document.date ? document.date.split('-').reverse().join('/') : ''}</span>
                </div>
                <div>
                  <strong style={{ color: '#475569' }}>
                    {document.document_type === 'invoice' ? 'Invoice No' : document.document_type === 'proforma_invoice' ? 'Invoice No' : document.document_type === 'quotation' ? 'Quotation No' : 'Order No'}
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

                {/* Subtotal Row */}
                {(Number(document.discount_total) > 0 || Number(document.tax_total) > 0) && (
                  <tr style={{ fontWeight: 600, color: '#475569', fontSize: '0.75rem' }}>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.4rem 0.5rem', textAlign: 'right' }}>Subtotal</td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td className="mono" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                      {Number(document.subtotal).toFixed(2)}
                    </td>
                  </tr>
                )}

                {/* Discount Row */}
                {Number(document.discount_total) > 0 && (
                  <tr style={{ fontWeight: 600, color: '#dc2626', fontSize: '0.75rem' }}>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.4rem 0.5rem', textAlign: 'right' }}>Discount</td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td className="mono" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                      -{Number(document.discount_total).toFixed(2)}
                    </td>
                  </tr>
                )}

                {/* Tax Row */}
                {Number(document.tax_total) > 0 && (
                  <tr style={{ fontWeight: 600, color: '#475569', fontSize: '0.75rem' }}>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', padding: '0.4rem 0.5rem', textAlign: 'right' }}>Calculated Tax (GST)</td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1' }}></td>
                    <td className="mono" style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                      {Number(document.tax_total).toFixed(2)}
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
                    {Number(document.total).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>

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

            {/* Terms info box if present */}
            {(document.terms || activeProfile.default_terms) && (
              <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: '0.75rem', paddingBottom: '1.5rem', fontSize: '0.75rem', color: '#334155' }}>
                <strong>TERMS & CONDITIONS:</strong>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', lineHeight: '1.4' }}>
                  {document.terms || activeProfile.default_terms}
                </div>
              </div>
            )}
          </div>
        )}

        {/* B2P custom footer bar is printed directly inside the B2P block above, so we only show the standard corporate footer for non-B2P profiles */}
        {!isB2P && (
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
        )}
      </div>
      </div>
    </div>
  );
};
