import React, { useState, useEffect } from 'react';
import { X, FileText, ArrowRight, ShieldAlert } from 'lucide-react';
import type { Document, CompanyProfile, DocumentType } from '../types';

interface ConvertModalProps {
  isOpen: boolean;
  document: Document | null;
  activeProfile: CompanyProfile | null;
  onClose: () => void;
  onConfirm: (targetType: DocumentType) => void;
}

export const ConvertModal: React.FC<ConvertModalProps> = ({
  isOpen,
  document,
  activeProfile,
  onClose,
  onConfirm
}) => {
  const lowerName = (activeProfile?.name || '').toLowerCase();
  const isInterMedia = lowerName.includes('inter media') || lowerName.includes('inter-media');
  const isInternational = lowerName.includes('international');

  // Default selection: 'non_tax_invoice' for International, else 'invoice'
  const [selectedType, setSelectedType] = useState<DocumentType>(
    isInternational ? 'non_tax_invoice' : 'invoice'
  );

  useEffect(() => {
    if (isInternational) {
      setSelectedType('non_tax_invoice');
    } else if (isInterMedia) {
      setSelectedType('invoice');
    }
  }, [isInternational, isInterMedia]);

  if (!isOpen || !document) return null;

  const getSourceDocLabel = (type: string) => {
    switch (type) {
      case 'quotation': return 'Quotation';
      case 'proforma_invoice': return 'Proforma Invoice';
      case 'work_order': return 'Work Order';
      default: return 'Document';
    }
  };

  const srcLabel = getSourceDocLabel(document.document_type);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '1rem',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        width: '100%',
        maxWidth: '480px',
        overflow: 'hidden',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        animation: 'modalSlideUp 0.2s ease-out'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              padding: '0.5rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(37, 99, 235, 0.1)',
              color: 'var(--accent-primary)'
            }}>
              <FileText size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                Convert to Invoice
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                {srcLabel}: <strong style={{ color: 'var(--text-primary)' }}>{document.document_number}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '0.25rem'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
            Select the invoice format for your new document. Customer details, line items, and quantities will be copied, and a new sequential invoice number will be generated.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Tax Invoice Option */}
            {!isInternational ? (
              <label style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                border: `2px solid ${selectedType === 'invoice' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: selectedType === 'invoice' ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <input
                    type="radio"
                    name="convertType"
                    value="invoice"
                    checked={selectedType === 'invoice'}
                    onChange={() => setSelectedType('invoice')}
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                      Tax Invoice
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Standard Tax Invoice with GST calculations
                    </div>
                  </div>
                </div>
              </label>
            ) : (
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8rem',
                color: '#ef4444'
              }}>
                <ShieldAlert size={16} />
                <span>Tax Invoices are not issued for B2P International.</span>
              </div>
            )}

            {/* Non-Tax Invoice Option */}
            {!isInterMedia ? (
              <label style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                border: `2px solid ${selectedType === 'non_tax_invoice' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: selectedType === 'non_tax_invoice' ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <input
                    type="radio"
                    name="convertType"
                    value="non_tax_invoice"
                    checked={selectedType === 'non_tax_invoice'}
                    onChange={() => setSelectedType('non_tax_invoice')}
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                      Invoice
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Standard Invoice without GST tax applied
                    </div>
                  </div>
                </div>
              </label>
            ) : (
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8rem',
                color: '#ef4444'
              }}>
                <ShieldAlert size={16} />
                <span>Non-Tax Invoices are restricted for B2P Inter-Media Solutions.</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          background: 'rgba(0, 0, 0, 0.1)'
        }}>
          <button
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '0.5rem 1rem' }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm(isInternational ? 'non_tax_invoice' : isInterMedia ? 'invoice' : selectedType);
            }}
            className="btn-primary"
            style={{ padding: '0.5rem 1.25rem', gap: '0.5rem' }}
          >
            <span>Proceed to Invoice</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
