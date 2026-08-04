import React, { useEffect, useState } from 'react';
import { 
  CheckCircle2, 
  Eye, 
  Download, 
  Printer, 
  Share2, 
  Plus, 
  X, 
  Clock, 
  User, 
  Check 
} from 'lucide-react';
import type { Document, DocumentItem, CompanyProfile } from '../types';
import { calculateDocumentTotals } from '../utils/calculations';

export interface DocumentSuccessDialogProps {
  isOpen: boolean;
  isEditMode: boolean;
  document: Document | null;
  items: DocumentItem[];
  profile: CompanyProfile | null;
  createdByName?: string;
  onClose: () => void;
  onViewDocument: () => void;
  onDownloadPdf: () => void;
  onPrint: () => void;
  onShare: () => void;
  onSendWhatsApp: () => void;
  onCreateNew: () => void;
}

export const DocumentSuccessDialog: React.FC<DocumentSuccessDialogProps> = ({
  isOpen,
  isEditMode,
  document,
  items,
  profile,
  createdByName,
  onClose,
  onViewDocument,
  onDownloadPdf,
  onPrint,
  onShare,
  onSendWhatsApp,
  onCreateNew
}) => {
  const [copied, setCopied] = useState(false);

  // Esc key listener for modal closure
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !document || !profile) return null;

  // Format labels & type text
  const docTypeLabels: Record<string, string> = {
    invoice: 'Tax Invoice',
    proforma_invoice: 'Proforma Invoice',
    quotation: 'Quotation',
    work_order: 'Work Order',
    non_tax_invoice: 'Non-Tax Invoice',
    comparison_quotation: 'Comparison Quote',
    comparison_invoice: 'Comparison Invoice'
  };

  const docTypeLabel = docTypeLabels[document.document_type] || document.document_type.replace('_', ' ').toUpperCase();
  const currencySymbol = profile.currency === 'INR' ? '₹' : (profile.currency === 'USD' ? '$' : `${profile.currency} `);

  // Calculations
  const totals = calculateDocumentTotals(items, document.discount_total, document.document_type);

  // Dates & Metadata
  const now = new Date();
  const formattedCreatedOn = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }) + ' ' + now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const currentUserEmail = createdByName || profile.approver_email || profile.email || 'Current Logged-in User';
  const hasGoogleSheets = Boolean(profile.google_sheets_url && profile.google_sheets_url.trim().length > 0);
  const hasCustomerPhone = Boolean(document.customer_phone && document.customer_phone.trim().length > 0);

  const handleShareClick = () => {
    onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="modal-overlay animate-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
        overflowY: 'auto'
      }}
      onClick={(e) => {
        // Prevent accidental close on backdrop click per requirements
        e.stopPropagation();
      }}
    >
      <div 
        className="card animate-scale-up"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-card, #1e293b)',
          borderColor: 'var(--border-color, rgba(255,255,255,0.1))',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Close Button */}
        <button
          onClick={onClose}
          className="btn-secondary"
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: 'var(--border-color)',
            cursor: 'pointer'
          }}
          title="Close (Esc)"
        >
          <X size={18} />
        </button>

        {/* 1. Header with Green Success Icon */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            border: '2px solid rgba(34, 197, 94, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#22c55e',
            boxShadow: '0 0 20px rgba(34, 197, 94, 0.2)'
          }}>
            <CheckCircle2 size={36} />
          </div>

          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              {isEditMode ? '✅ Document Updated Successfully' : '✅ Document Created Successfully'}
            </h2>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Your <strong style={{ color: 'var(--accent-primary)' }}>{docTypeLabel}</strong> has been generated, formatted, and saved.
            </p>
          </div>
        </div>

        {/* 2. Key Metadata Summary Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '0.85rem',
          backgroundColor: 'var(--bg-canvas, #0f172a)',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          border: '1px solid var(--border-color)'
        }}>
          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Document Type
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)', marginTop: '0.2rem' }}>
              {docTypeLabel}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Document Number
            </div>
            <div className="mono" style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {document.document_number}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Customer Name
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {document.customer_name || 'N/A'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Company Name
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile.name}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Document Date
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              {document.date}
            </div>
          </div>
        </div>

        {/* 3. Financial Breakdown Card */}
        <div style={{
          backgroundColor: 'var(--bg-canvas, #0f172a)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          padding: '1.15rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem'
        }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            Financial Breakdown
          </div>

          {/* Subtotal / Item Breakdown */}
          {totals.discountTotal > 0 ? (
            <>
              {/* Discount Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#ef4444' }}>
                <span>Discount</span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  - {currencySymbol}{totals.discountTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* Taxable Amount Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span>Taxable Amount</span>
                <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {currencySymbol}{totals.taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </>
          ) : (
            /* Subtotal Row when no discount */
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <span>Subtotal</span>
              <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {currencySymbol}{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* GST Row (If taxable document) */}
          {document.document_type !== 'non_tax_invoice' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <span>GST {totals.effectiveGstRate > 0 ? `(${totals.effectiveGstRate.toFixed(0)}%)` : ''}</span>
              <span className="mono" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                + {currencySymbol}{totals.taxTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px dashed var(--border-color)', margin: '0.25rem 0' }} />

          {/* Grand Total */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Grand Total
            </span>
            <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#22c55e' }}>
              {currencySymbol}{totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Amount in Words */}
          <div style={{
            fontSize: '0.78rem',
            fontStyle: 'italic',
            color: 'var(--text-secondary)',
            marginTop: '0.25rem',
            paddingTop: '0.5rem',
            borderTop: '1px solid rgba(255,255,255,0.05)'
          }}>
            <strong>Amount in Words:</strong> {totals.amountInWords}
          </div>
        </div>

        {/* 4. Timeline Section */}
        <div style={{
          backgroundColor: 'var(--bg-canvas, #0f172a)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          padding: '1.1rem'
        }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Process Timeline
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: '0.65rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#22c55e' }}>
              <Check size={14} strokeWidth={3} />
              <span style={{ fontWeight: 600 }}>Document Saved</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#22c55e' }}>
              <Check size={14} strokeWidth={3} />
              <span style={{ fontWeight: 600 }}>PDF Generated</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#22c55e' }}>
              <Check size={14} strokeWidth={3} />
              <span style={{ fontWeight: 600 }}>Supabase Synced</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: hasGoogleSheets ? '#22c55e' : 'var(--text-muted)' }}>
              <Check size={14} strokeWidth={3} />
              <span style={{ fontWeight: 600 }}>Google Sheets {hasGoogleSheets ? 'Updated' : '(N/A)'}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#22c55e' }}>
              <Check size={14} strokeWidth={3} />
              <span style={{ fontWeight: 600 }}>Backup Completed</span>
            </div>
          </div>
        </div>

        {/* 5. Additional Info & Sync Status Badges */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          padding: '0.75rem 1rem',
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={13} style={{ color: 'var(--text-muted)' }} />
              <span><strong>Created On:</strong> {formattedCreatedOn}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <User size={13} style={{ color: 'var(--text-muted)' }} />
              <span><strong>Created By:</strong> {currentUserEmail}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#22c55e', fontWeight: 600 }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#22c55e' }}></span>
              Supabase
            </span>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: hasGoogleSheets ? '#22c55e' : 'var(--text-muted)', fontWeight: 600 }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: hasGoogleSheets ? '#22c55e' : '#94a3b8' }}></span>
              {hasGoogleSheets ? 'Google Sheets' : 'Sheets Not Set'}
            </span>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#22c55e', fontWeight: 600 }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#22c55e' }}></span>
              Drive Backup
            </span>
          </div>
        </div>

        {/* 6. Quick Action Buttons Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
            Quick Actions
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.75rem'
          }}>
            {/* View Document */}
            <button
              onClick={onViewDocument}
              className="btn-primary"
              style={{ padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 700, justifyContent: 'center' }}
            >
              <Eye size={16} />
              <span>View Document</span>
            </button>

            {/* Download PDF */}
            <button
              onClick={onDownloadPdf}
              className="btn-secondary"
              style={{ padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 600, justifyContent: 'center' }}
            >
              <Download size={16} />
              <span>Download PDF</span>
            </button>

            {/* Print */}
            <button
              onClick={onPrint}
              className="btn-secondary"
              style={{ padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 600, justifyContent: 'center' }}
            >
              <Printer size={16} />
              <span>Print</span>
            </button>

            {/* Share */}
            <button
              onClick={handleShareClick}
              className="btn-secondary"
              style={{ padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 600, justifyContent: 'center' }}
            >
              {copied ? <Check size={16} style={{ color: '#22c55e' }} /> : <Share2 size={16} />}
              <span>{copied ? 'Link Copied!' : 'Share'}</span>
            </button>

            {/* Send WhatsApp */}
            <button
              onClick={onSendWhatsApp}
              disabled={!hasCustomerPhone}
              className="btn-secondary"
              style={{ 
                padding: '0.65rem 1rem', 
                fontSize: '0.85rem', 
                fontWeight: 600, 
                justifyContent: 'center',
                color: hasCustomerPhone ? '#25D366' : 'var(--text-muted)',
                borderColor: hasCustomerPhone ? '#25D366' : 'var(--border-color)',
                opacity: hasCustomerPhone ? 1 : 0.6,
                cursor: hasCustomerPhone ? 'pointer' : 'not-allowed'
              }}
              title={hasCustomerPhone ? 'Send via WhatsApp' : 'Customer phone number not provided'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.49-4.22c1.7.994 3.551 1.54 5.46 1.545 5.867 0 10.639-4.76 10.643-10.627.002-2.842-1.096-5.513-3.093-7.514S14.86 3.1 12.016 3.1C6.15 3.1 1.38 7.86 1.377 13.728c-.001 1.955.513 3.868 1.49 5.58l-.995 3.637 3.733-.979zm11.168-5.32c-.305-.152-1.802-.888-2.082-.99-.28-.102-.484-.152-.688.152-.204.305-.79.99-.969 1.2-.178.204-.356.229-.66.076-.305-.152-1.289-.475-2.455-1.515-.908-.81-1.52-1.81-1.698-2.115-.178-.305-.019-.47.133-.621.137-.136.305-.356.457-.534.152-.178.204-.305.305-.508.102-.204.051-.381-.025-.533-.076-.152-.688-1.659-.942-2.27-.248-.596-.5-.515-.688-.525-.178-.01-.382-.01-.586-.01-.204 0-.535.076-.814.381-.28.305-1.069 1.042-1.069 2.54 0 1.498 1.09 2.946 1.242 3.149.152.204 2.146 3.277 5.198 4.59.726.313 1.293.5 1.734.64.73.232 1.394.2 1.918.12.584-.087 1.802-.737 2.057-1.448.255-.71.255-1.321.178-1.448-.076-.127-.28-.203-.585-.355z"/>
              </svg>
              <span>Send WhatsApp</span>
            </button>

            {/* Create New */}
            <button
              onClick={onCreateNew}
              className="btn-secondary"
              style={{ padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 600, justifyContent: 'center' }}
            >
              <Plus size={16} />
              <span>Create New</span>
            </button>
          </div>
        </div>

        {/* Bottom Secondary Action Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border-color)'
        }}>
          <button
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '0.55rem 1.5rem', fontSize: '0.85rem', fontWeight: 600 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
