import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document, DocumentItem } from '../types';
import { dbService } from '../services/db';
import { ArrowLeft, Printer, AlertTriangle } from 'lucide-react';

interface DocumentPreviewProps {
  activeProfile: CompanyProfile | null;
  document: Document;
  onClose: () => void;
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  activeProfile,
  document,
  onClose
}) => {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchDocDetails = async () => {
      try {
        console.log('DocumentPreview: Fetching details for document ID:', document.id);
        console.log('DocumentPreview: Active profile branding details:', {
          name: activeProfile?.name,
          has_header: !!activeProfile?.letterhead_header_url,
          header_length: activeProfile?.letterhead_header_url ? activeProfile.letterhead_header_url.length : 0,
          has_footer: !!activeProfile?.letterhead_footer_url,
          footer_length: activeProfile?.letterhead_footer_url ? activeProfile.letterhead_footer_url.length : 0
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

  const handlePrint = () => {
    window.print();
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
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-card)',
        padding: '1rem 1.5rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)'
      }}>
        <button onClick={onClose} className="btn-secondary">
          <ArrowLeft size={16} />
          <span>Back to List</span>
        </button>
        <button onClick={handlePrint} className="btn-primary">
          <Printer size={16} />
          <span>Print / Export PDF</span>
        </button>
      </div>

      {/* Printable Sheet Canvas */}
      <div className="document-canvas" style={{ 
        position: 'relative', 
        padding: activeProfile.letterhead_header_url ? '0' : '2.5rem', 
        display: 'flex',
        flexDirection: 'column',
        minHeight: '1050px',
        boxSizing: 'border-box',
        background: '#ffffff',
        color: '#000000',
        fontFamily: "'Outfit', sans-serif"
      }}>
        
        {/* Watermark overlay */}
        {activeProfile.watermark_text && (
          <div className="document-watermark" style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) rotate(-45deg)',
            fontSize: '5rem',
            fontWeight: 800,
            color: 'rgba(15, 23, 42, 0.035)',
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 1,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap'
          }}>
            {activeProfile.watermark_text}
          </div>
        )}

        {/* Letterhead Header Image if present */}
        {activeProfile.letterhead_header_url ? (
          <img 
            src={activeProfile.letterhead_header_url} 
            alt="Letterhead Header" 
            style={{ width: '100%', maxHeight: '150px', objectFit: 'contain', marginBottom: '1.5rem' }}
          />
        ) : (
          /* Text-based Header with Logo */
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '2px solid #0f172a',
            paddingBottom: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              {activeProfile.logo_url && (
                <img 
                  src={activeProfile.logo_url} 
                  alt={activeProfile.name} 
                  style={{ maxHeight: '55px', maxWidth: '180px', objectFit: 'contain', marginBottom: '0.75rem' }} 
                />
              )}
              <h2 style={{ fontSize: '1.5rem', color: '#0f172a', fontWeight: 700, margin: 0 }}>{activeProfile.name}</h2>
              <p style={{ fontSize: '0.8rem', color: '#475569', whiteSpace: 'pre-wrap', marginTop: '0.25rem', maxWidth: '360px', lineHeight: '1.4' }}>
                {activeProfile.address}
              </p>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: '#475569' }}>
                {activeProfile.phone && <span><strong>Phone:</strong> {activeProfile.phone}</span>}
                {activeProfile.email && <span><strong>Email:</strong> {activeProfile.email}</span>}
              </div>
              {activeProfile.website && (
                <p style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.15rem' }}>
                  <strong>Web:</strong> {activeProfile.website}
                </p>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <h1 style={{ fontSize: '1.75rem', color: '#0f172a', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                {getDocTitle(document.document_type)}
              </h1>
              <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span><strong>Doc No:</strong> <span className="mono" style={{ fontWeight: 700 }}>{document.document_number}</span></span>
                {activeProfile.gstin && <span><strong>GSTIN:</strong> <span className="mono">{activeProfile.gstin}</span></span>}
                {activeProfile.pan && <span><strong>PAN:</strong> <span className="mono">{activeProfile.pan}</span></span>}
              </div>
            </div>
          </div>
        )}

        {/* Outer content container with standard A4 page padding if letterhead is used */}
        <div style={{ padding: activeProfile.letterhead_header_url ? '0 2.5rem' : '0', display: 'flex', flexDirection: 'column', flex: 1 }}>
          
          {/* Metadata Grid (Only needed if header image is uploaded, as standard header renders it inside itself) */}
          {activeProfile.letterhead_header_url && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              borderBottom: '1px solid #e2e8f0',
              paddingBottom: '1rem',
              marginBottom: '1.5rem',
              fontSize: '0.85rem'
            }}>
              <div>
                <h1 style={{ fontSize: '1.5rem', color: '#0f172a', fontWeight: 800, margin: 0 }}>
                  {getDocTitle(document.document_type)}
                </h1>
                <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.25rem' }}>
                  Issued by <strong>{activeProfile.name}</strong>
                </p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span><strong>Doc ID:</strong> <span className="mono" style={{ fontWeight: 700 }}>{document.document_number}</span></span>
                {activeProfile.gstin && <span><strong>GSTIN:</strong> <span className="mono">{activeProfile.gstin}</span></span>}
              </div>
            </div>
          )}

          {/* Customer Details Block */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '2rem',
            marginBottom: '2rem',
            fontSize: '0.85rem',
            color: '#334155'
          }}>
            <div style={{
              border: '1px solid #e2e8f0',
              borderRadius: '4px',
              padding: '1rem',
              background: '#f8fafc'
            }}>
              <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: '0.5rem', fontWeight: 700 }}>
                BILL TO:
              </h4>
              <h3 style={{ fontSize: '1rem', color: '#0f172a', fontWeight: 700, marginBottom: '0.25rem' }}>{document.customer_name}</h3>
              {document.customer_address && (
                <p style={{ whiteSpace: 'pre-wrap', color: '#475569', marginBottom: '0.5rem' }}>{document.customer_address}</p>
              )}
              <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                {document.customer_email && <p><strong>Email:</strong> {document.customer_email}</p>}
                {document.customer_phone && <p><strong>Phone:</strong> {document.customer_phone}</p>}
                {document.customer_gstin && <p><strong>GSTIN:</strong> <span className="mono">{document.customer_gstin}</span></p>}
              </div>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              padding: '1rem',
              border: '1px solid #e2e8f0',
              borderRadius: '4px'
            }}>
              <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: '0.5rem', fontWeight: 700 }}>
                PAYMENT INFO:
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem', color: '#475569' }}>
                <span><strong>Payment Term:</strong> {document.terms || 'Due on Receipt'}</span>
                {activeProfile.bank_name && activeProfile.show_bank_details && (
                  <>
                    <span style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '0.25rem', marginBottom: '0.25rem', fontWeight: 600, color: '#0f172a' }}>
                      Bank details:
                    </span>
                    <span><strong>Bank Name:</strong> {activeProfile.bank_name}</span>
                    <span><strong>Account Holder:</strong> {activeProfile.bank_holder || activeProfile.name}</span>
                    <span><strong>A/C No:</strong> <span className="mono">{activeProfile.bank_account_no}</span></span>
                    <span><strong>IFSC Code:</strong> <span className="mono">{activeProfile.bank_ifsc}</span></span>
                    {activeProfile.bank_branch && <span><strong>Branch:</strong> {activeProfile.bank_branch}</span>}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Service Name & Period Section */}
          {document.notes && (
            <div style={{ marginBottom: '1.25rem', fontSize: '0.85rem' }}>
              <strong>Service Name & Period :</strong>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', marginTop: '0.15rem', color: '#000000' }}>
                {document.notes}
              </div>
            </div>
          )}

          {/* Line Items Table */}
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginBottom: '2rem',
            fontSize: '0.8rem'
          }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #0f172a' }}>
                <th style={{ color: '#0f172a', background: 'transparent', borderBottom: 'none', padding: '0.75rem 0.5rem', textTransform: 'uppercase', fontSize: '0.75rem', width: '40px' }}>#</th>
                <th style={{ color: '#0f172a', background: 'transparent', borderBottom: 'none', padding: '0.75rem 0.5rem', textTransform: 'uppercase', fontSize: '0.75rem', textAlign: 'left' }}>
                  {document.col_name_description}
                </th>
                <th style={{ color: '#0f172a', background: 'transparent', borderBottom: 'none', padding: '0.75rem 0.5rem', textTransform: 'uppercase', fontSize: '0.75rem', textAlign: 'center', width: '80px' }}>HSN</th>
                <th style={{ color: '#0f172a', background: 'transparent', borderBottom: 'none', padding: '0.75rem 0.5rem', textTransform: 'uppercase', fontSize: '0.75rem', textAlign: 'center', width: '60px' }}>
                  {document.col_name_quantity}
                </th>
                <th style={{ color: '#0f172a', background: 'transparent', borderBottom: 'none', padding: '0.75rem 0.5rem', textTransform: 'uppercase', fontSize: '0.75rem', textAlign: 'center', width: '60px' }}>
                  {document.col_name_unit}
                </th>
                <th style={{ color: '#0f172a', background: 'transparent', borderBottom: 'none', padding: '0.75rem 0.5rem', textTransform: 'uppercase', fontSize: '0.75rem', textAlign: 'right', width: '90px' }}>
                  {document.col_name_rate}
                </th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right', width: '100px', fontWeight: 700 }}>
                  {document.col_name_amount}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: '#64748b' }}>{idx + 1}</td>
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: 500, color: '#0f172a', whiteSpace: 'pre-wrap' }}>{item.description}</td>
                  <td className="mono" style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: '#64748b' }}>{item.hsn_sac || '-'}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>{item.quantity}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', textTransform: 'lowercase' }}>{item.unit}</td>
                  <td className="mono" style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                    {Number(item.rate).toFixed(2)}
                  </td>
                  <td className="mono" style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                    {Number(item.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
              {/* Total Row */}
              <tr style={{ fontWeight: 700, borderTop: '2px solid #0f172a' }}>
                <td></td>
                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Amount</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td className="mono" style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontSize: '0.85rem' }}>
                  {Number(document.total).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Watermark/Signature Block with Seal & Stamp - Hidden if letterhead footer image handles it */}
          {!activeProfile.letterhead_footer_url && (
            <div style={{
              marginTop: 'auto',
              paddingTop: '2rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              fontSize: '0.85rem',
              paddingBottom: '2.5rem'
            }}>
              <div>
                {/* Stamp and Seal visual box */}
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.5rem' }}>
                  {activeProfile.seal_url && (
                    <div style={{ textAlign: 'center' }}>
                      <img 
                        src={activeProfile.seal_url} 
                        alt="Company Seal" 
                        style={{ width: '80px', height: '80px', objectFit: 'contain', opacity: 0.85 }} 
                      />
                      <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.25rem' }}>Company Seal</p>
                    </div>
                  )}
                  {activeProfile.stamp_url && (
                    <div style={{ textAlign: 'center' }}>
                      <img 
                        src={activeProfile.stamp_url} 
                        alt="Company Stamp" 
                        style={{ width: '80px', height: '80px', objectFit: 'contain', opacity: 0.85 }} 
                      />
                      <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.25rem' }}>Official Stamp</p>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ textAlign: 'right', minWidth: '220px' }}>
                <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '2.5rem' }}>
                  For <strong>{activeProfile.name}</strong>
                </p>
                {activeProfile.show_signature && activeProfile.signature_text && (
                  <p style={{ fontStyle: 'italic', fontFamily: 'Outfit, sans-serif', color: '#3b82f6', fontSize: '1rem', marginBottom: '0.25rem' }}>
                    {activeProfile.signature_text}
                  </p>
                )}
                <div style={{ borderTop: '1px solid #0f172a', paddingTop: '0.35rem', marginTop: '0.5rem' }}>
                  <p style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    Authorized Signatory
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Letterhead Footer Image if present */}
        {activeProfile.letterhead_footer_url && (
          <img 
            src={activeProfile.letterhead_footer_url} 
            alt="Letterhead Footer" 
            style={{ width: '100%', maxHeight: '100px', objectFit: 'contain', marginTop: 'auto' }}
          />
        )}
      </div>
    </div>
  );
};
