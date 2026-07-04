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
        padding: '0', 
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

        {/* Diagonal Header Banner */}
        <div style={{ display: 'flex', minHeight: '130px', color: 'white', overflow: 'hidden', width: '100%', marginBottom: '2rem' }}>
          {/* Left section (blue) */}
          <div style={{ 
            backgroundColor: '#1d3b68', 
            flex: '1.4', 
            padding: '1.5rem 1.5rem 1rem 1.5rem', 
            clipPath: 'polygon(0 0, 100% 0, 88% 100%, 0 100%)', 
            marginRight: '-50px', 
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center'
          }}>
            {activeProfile.logo_url ? (
              <img 
                src={activeProfile.logo_url} 
                alt={activeProfile.name} 
                style={{ maxHeight: '45px', maxWidth: '180px', objectFit: 'contain', marginBottom: '0.5rem', alignSelf: 'flex-start' }} 
              />
            ) : (
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'white' }}>{activeProfile.name}</h2>
            )}
            <p style={{ fontSize: '0.75rem', color: '#e2e8f0', margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.3', maxWidth: '380px' }}>
              {activeProfile.address}
            </p>
          </div>
          {/* Right section (orange) */}
          <div style={{ 
            backgroundColor: '#eb5406', 
            flex: '1', 
            padding: '1.5rem 2rem 1rem 5rem', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'flex-end', 
            zIndex: 1 
          }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
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
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div>
                <strong style={{ color: '#475569' }}>Date</strong> &nbsp;&nbsp;&nbsp;: &nbsp;
                <span style={{ fontWeight: 600 }}>{document.issue_date.split('-').reverse().join('/')}</span>
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

          {/* Line Items Table with Blue Borders */}
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1.5px solid #1d3b68',
            marginBottom: '1.5rem',
            fontSize: '0.8rem',
            color: '#000000'
          }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #1d3b68', background: '#f8fafc' }}>
                <th style={{ borderRight: '1px solid #1d3b68', padding: '0.5rem', textAlign: 'center', width: '40px', fontWeight: 700 }}>No</th>
                <th style={{ borderRight: '1px solid #1d3b68', padding: '0.5rem', textAlign: 'left', fontWeight: 700 }}>
                  {document.col_name_description || 'Particulars'}
                </th>
                <th style={{ borderRight: '1px solid #1d3b68', padding: '0.5rem', textAlign: 'center', width: '60px', fontWeight: 700 }}>
                  {document.col_name_quantity || 'Qty'}
                </th>
                <th style={{ borderRight: '1px solid #1d3b68', padding: '0.5rem', textAlign: 'center', width: '60px', fontWeight: 700 }}>
                  {document.col_name_unit || 'Days'}
                </th>
                <th style={{ borderRight: '1px solid #1d3b68', padding: '0.5rem', textAlign: 'right', width: '90px', fontWeight: 700 }}>
                  {document.col_name_rate || 'Rate'}
                </th>
                <th style={{ padding: '0.5rem', textAlign: 'right', width: '100px', fontWeight: 700 }}>
                  {document.col_name_amount || 'Amount'}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #1d3b68' }}>
                  <td style={{ borderRight: '1px solid #1d3b68', padding: '0.65rem 0.5rem', textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ borderRight: '1px solid #1d3b68', padding: '0.65rem 0.5rem', fontWeight: 500, whiteSpace: 'pre-wrap' }}>{item.description}</td>
                  <td style={{ borderRight: '1px solid #1d3b68', padding: '0.65rem 0.5rem', textAlign: 'center' }}>{item.quantity}</td>
                  <td style={{ borderRight: '1px solid #1d3b68', padding: '0.65rem 0.5rem', textAlign: 'center' }}>{item.unit}</td>
                  <td className="mono" style={{ borderRight: '1px solid #1d3b68', padding: '0.65rem 0.5rem', textAlign: 'right' }}>
                    {Number(item.rate).toFixed(2)}
                  </td>
                  <td className="mono" style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                    {Number(item.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
              {/* Spacer rows if items count is small to simulate the format grid height */}
              {items.length < 5 && Array.from({ length: 5 - items.length }).map((_, idx) => (
                <tr key={`spacer-${idx}`} style={{ borderBottom: '1px solid #1d3b68', height: '2.5rem' }}>
                  <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                  <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                  <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                  <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                  <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                  <td></td>
                </tr>
              ))}
              {/* Total Row */}
              <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                <td style={{ borderRight: '1px solid #1d3b68', padding: '0.5rem', textAlign: 'right' }}>Amount</td>
                <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                <td style={{ borderRight: '1px solid #1d3b68' }}></td>
                <td style={{ borderRight: '1px solid #1d3b68' }}></td>
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
                border: '1.5px solid #1d3b68',
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
                <strong>Bank Details :</strong> {activeProfile.bank_name}<br />
                <span style={{ paddingLeft: '5.2rem' }}>{activeProfile.bank_branch} Branch</span>
              </div>
            )}

            {/* Right: Signature stamp and seal and Authorized Signatory */}
            <div style={{ 
              textAlign: 'right', 
              minWidth: '220px', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'flex-end' 
            }}>
              {activeProfile.seal_url && (
                <img 
                  src={activeProfile.seal_url} 
                  alt="Company Seal" 
                  style={{ maxHeight: '70px', maxWidth: '140px', objectFit: 'contain', marginBottom: '0.5rem', marginRight: '2rem' }} 
                />
              )}
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '2.5rem' }}>
                For {activeProfile.name}
              </div>
              <div style={{ borderTop: '1px solid #000000', width: '180px', paddingTop: '0.25rem', textAlign: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Authorized Signatory
                </span>
              </div>
            </div>
          </div>

          {/* Terms info box if present */}
          {document.terms && (
            <div style={{ borderTop: '1.5px solid #1d3b68', paddingTop: '0.75rem', paddingBottom: '1.5rem', fontSize: '0.75rem', color: '#334155' }}>
              <strong>PAYMENT INFO:</strong>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', lineHeight: '1.4' }}>{document.terms}</div>
            </div>
          )}

        </div>

        {/* Diagonal Footer Banner */}
        <div style={{ display: 'flex', minHeight: '65px', color: 'white', overflow: 'hidden', width: '100%', marginTop: 'auto' }}>
          {/* Left section (blue) */}
          <div style={{ 
            backgroundColor: '#1d3b68', 
            flex: '1.4', 
            padding: '0.5rem 1.5rem', 
            clipPath: 'polygon(0 0, 100% 0, 92% 100%, 0 100%)', 
            marginRight: '-30px', 
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            fontSize: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{ fontWeight: 600 }}>f 📷 / {activeProfile.name.toLowerCase()}</span>
            </div>
            {activeProfile.website && (
              <div style={{ marginTop: '2px', color: '#e2e8f0' }}>w w w.{activeProfile.website.replace(/https?:\/\/(www\.)?/, '')}</div>
            )}
          </div>
          {/* Right section (orange) */}
          <div style={{ 
            backgroundColor: '#eb5406', 
            flex: '1', 
            padding: '0.5rem 2rem 0.5rem 3rem', 
            display: 'flex', 
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-end', 
            zIndex: 1,
            fontSize: '0.75rem',
            textAlign: 'right'
          }}>
            {activeProfile.phone && <div>{activeProfile.phone.split('/').join(' / ')}</div>}
            {activeProfile.email && <div style={{ marginTop: '2px' }}>{activeProfile.email}</div>}
          </div>
        </div>
    </div>
  </div>
  );
};
