import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document } from '../../types';
import type { ComparisonConfig } from './ComparisonTypes';
import { ComparisonService } from './ComparisonService';
import { Printer, ArrowLeft, Award } from 'lucide-react';

interface ComparisonPreviewProps {
  activeProfile: CompanyProfile;
  document: Document;
  onClose: () => void;
}

export const ComparisonPreview: React.FC<ComparisonPreviewProps> = ({
  activeProfile,
  document,
  onClose
}) => {
  const [config, setConfig] = useState<ComparisonConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ComparisonService.getComparisonData(document.id)
      .then(data => {
        setConfig(data);
      })
      .catch(err => {
        console.error('Failed to load comparison data for preview:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [document.id]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem auto' }}></div>
        <span>Loading Comparison Preview...</span>
      </div>
    );
  }

  if (!config || config.options.length === 0) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>No comparison configuration data found for this document.</p>
        <button onClick={onClose} className="btn-secondary" style={{ marginTop: '1rem' }}>
          Go Back
        </button>
      </div>
    );
  }

  const { themeColor, layout, options } = config;
  const docDate = document.date ? document.date.split('-').reverse().join('/') : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Action Header (Hidden during Print) */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <button onClick={onClose} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <ArrowLeft size={16} />
          <span>Back to Documents</span>
        </button>
        <button onClick={handlePrint} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Printer size={16} />
          <span>Print / Save as PDF</span>
        </button>
      </div>

      {/* Printable Sheet */}
      <div className="printable-document font-sans" style={{
        background: '#fff',
        color: '#1e293b',
        padding: '2.5rem',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '2.5rem'
      }}>
        
        {/* Header Block */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `3px solid ${themeColor}`, paddingBottom: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {activeProfile.logo_url ? (
              <img src={activeProfile.logo_url} alt="Logo" style={{ maxHeight: '60px', maxWidth: '200px', objectFit: 'contain', alignSelf: 'flex-start' }} />
            ) : (
              <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: themeColor, margin: 0 }}>{activeProfile.name}</h1>
            )}
            <div style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'pre-line', lineHeight: 1.4 }}>
              {activeProfile.address}
              {activeProfile.phone && `\nPhone: ${activeProfile.phone}`}
              {activeProfile.email && `\nEmail: ${activeProfile.email}`}
              {activeProfile.website && `\nWebsite: ${activeProfile.website}`}
              {activeProfile.gstin && `\nGSTIN: ${activeProfile.gstin}`}
            </div>
          </div>
          
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: themeColor, margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {document.document_type === 'comparison_invoice' ? 'Manual Invoice' : 'Manual Quote'}
            </h2>
            <div style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
              No: {document.document_number}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Date: {docDate}
            </div>
          </div>
        </div>

        {/* Customer Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', padding: '1rem', background: '#f8fafc', borderRadius: '6px' }}>
          <div>
            <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px', margin: '0 0 0.5rem 0', fontWeight: 700 }}>
              Quotation For
            </h4>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>{document.customer_name}</div>
            <div style={{ fontSize: '0.85rem', color: '#475569', whiteSpace: 'pre-line', marginTop: '0.25rem', lineHeight: 1.4 }}>
              {document.customer_address}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px', margin: '0 0 0.5rem 0', fontWeight: 700 }}>
              Contact Details
            </h4>
            <div style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.4 }}>
              {document.customer_email && <div>Email: {document.customer_email}</div>}
              {document.customer_phone && <div>Phone: {document.customer_phone}</div>}
              {document.customer_gstin && <div>GSTIN: {document.customer_gstin}</div>}
            </div>
          </div>
        </div>

        {/* Comparison Tables Layout */}
        <div style={{ 
          display: 'flex', 
          flexDirection: layout === 'stacked' ? 'column' : 'row', 
          gap: '2rem', 
          alignItems: 'stretch',
          width: '100%'
        }}>
          {options.map(opt => {
            const visibleCols = opt.columns.filter(c => c.visible);
            const totalColsWidth = visibleCols.reduce((sum, col) => sum + (col.width || 120), 0);
            
            return (
              <div 
                key={opt.id} 
                className="comparison-option-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  border: opt.isRecommended ? `2.5px solid ${themeColor}` : '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '1.5rem',
                  position: 'relative',
                  background: opt.isRecommended ? 'rgba(37, 99, 235, 0.005)' : '#fff',
                  boxShadow: opt.isRecommended ? '0 10px 15px -3px rgba(37, 99, 235, 0.04)' : 'none',
                  flex: layout === 'side-by-side' ? '1 1 0px' : '1 1 auto',
                  minWidth: layout === 'side-by-side' ? '300px' : 'auto'
                }}
              >
                {/* Recommended Badge Indicator */}
                {opt.isRecommended && (
                  <div style={{
                    position: 'absolute',
                    top: '-15px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: `linear-gradient(135deg, ${themeColor} 0%, #1d4ed8 100%)`,
                    color: '#fff',
                    padding: '0.25rem 0.85rem',
                    borderRadius: '9999px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    zIndex: 2
                  }}>
                    <Award size={12} />
                    <span>Recommended Option</span>
                  </div>
                )}

                {/* Option Header */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: opt.isRecommended ? themeColor : '#0f172a', margin: '0 0 0.25rem 0' }}>
                    {opt.heading || opt.name}
                  </h3>
                  {opt.description && (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                      {opt.description}
                    </p>
                  )}
                </div>

                {/* Option Table */}
                <div style={{ overflowX: 'auto', flex: 1, marginBottom: '1.5rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: themeColor }}>
                        {visibleCols.map(col => {
                          const pctWidth = totalColsWidth > 0 ? (((col.width || 120) / totalColsWidth) * 100).toFixed(2) + '%' : 'auto';
                          const isNumeric = col.type === 'number' || col.type === 'currency' || col.type === 'formula';
                          return (
                            <th 
                              key={col.id} 
                              style={{ 
                                padding: '0.65rem 0.5rem', 
                                fontWeight: 700, 
                                color: '#ffffff', 
                                textAlign: isNumeric ? 'right' : 'left',
                                width: pctWidth
                              }}
                            >
                              {col.name}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {opt.rows.map((row, rowIdx) => (
                        <tr key={rowIdx} style={{ borderBottom: '1px solid #f1f5f9', background: rowIdx % 2 === 0 ? 'transparent' : '#f8fafc' }}>
                          {visibleCols.map(col => {
                            const val = row[col.id];
                            const isNumeric = col.type === 'number' || col.type === 'currency' || col.type === 'formula';
                            const pctWidth = totalColsWidth > 0 ? (((col.width || 120) / totalColsWidth) * 100).toFixed(2) + '%' : 'auto';
                            
                            return (
                              <td 
                                key={col.id} 
                                style={{ 
                                  padding: '0.65rem 0.5rem', 
                                  color: '#334155',
                                  textAlign: isNumeric ? 'right' : 'left',
                                  fontVariantNumeric: isNumeric ? 'tabular-nums' : 'normal',
                                  width: pctWidth,
                                  whiteSpace: isNumeric || col.type === 'date' ? 'nowrap' : 'normal',
                                  wordBreak: 'break-word'
                                }}
                              >
                                {col.type === 'currency' || (col.type === 'formula' && col.formulaConfig?.operator === 'multiply') ? (
                                  <>
                                    {activeProfile.currency === 'INR' ? '₹' : '$'}
                                    {Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </>
                                ) : col.type === 'number' ? (
                                  val
                                ) : (
                                  val || '-'
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Option Total Display */}
                {opt.showTotal && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '2px solid #e2e8f0',
                    paddingTop: '0.75rem',
                    marginTop: 'auto'
                  }}>
                    <span style={{ fontWeight: 600, color: '#64748b', fontSize: '0.85rem' }}>
                      {opt.totalLabel || 'Total'}
                    </span>
                    <span style={{ fontWeight: 800, color: themeColor, fontSize: '1.1rem', fontFamily: 'monospace' }}>
                      {activeProfile.currency === 'INR' ? '₹' : '$'}
                      {opt.totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Notes & Footnotes */}
        {(document.notes || config.notes) && (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem', fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
            <h4 style={{ margin: '0 0 0.5rem 0', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px', fontWeight: 700 }}>
              Important Notes
            </h4>
            <div style={{ whiteSpace: 'pre-line' }}>{document.notes || config.notes}</div>
          </div>
        )}

        {/* Terms & Footer Signatures */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '3rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem', marginTop: 'auto' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
            <h4 style={{ margin: '0 0 0.5rem 0', textTransform: 'uppercase', color: '#475569', letterSpacing: '0.5px', fontWeight: 700 }}>
              Terms & Conditions
            </h4>
            <div style={{ whiteSpace: 'pre-line' }}>{document.terms || config.terms}</div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', textAlign: 'center' }}>
            {activeProfile.seal_url && (
              <img src={activeProfile.seal_url} alt="Seal" style={{ maxHeight: '70px', objectFit: 'contain', marginBottom: '0.5rem' }} />
            )}
            <div style={{ borderTop: '1px solid #94a3b8', width: '150px', margin: '0 auto' }}></div>
            <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>Authorized Signatory</div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{activeProfile.name}</div>
          </div>
        </div>

      </div>

      {/* Global CSS Style tag for PDF Print layout */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body {
            background: #fff !important;
            color: #000 !important;
          }
          .no-print {
            display: none !important;
          }
          .printable-document {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .comparison-option-card {
            box-shadow: none !important;
            break-inside: avoid;
          }
        }
      ` }} />

    </div>
  );
};
