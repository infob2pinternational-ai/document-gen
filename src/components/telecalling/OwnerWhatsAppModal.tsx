import React, { useState, useEffect } from 'react';
import { X, Smartphone, CheckCircle, AlertCircle } from 'lucide-react';
import { getOwnerWhatsAppNumber, setOwnerWhatsAppNumber } from '../../utils/telecallingShare';
import { normalizeIndianPhone } from '../../utils/whatsappShare';

interface OwnerWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (phone: string) => void;
}

export const OwnerWhatsAppModal: React.FC<OwnerWhatsAppModalProps> = ({
  isOpen,
  onClose,
  onSaved
}) => {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPhone(getOwnerWhatsAppNumber());
      setError('');
      setSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmed = phone.trim();
    if (!trimmed) {
      setError('Please enter a valid phone number for the owner.');
      return;
    }

    const clean = normalizeIndianPhone(trimmed);
    if (clean.length < 10) {
      setError('Please enter a valid 10-digit Indian phone number.');
      return;
    }

    setOwnerWhatsAppNumber(trimmed);
    setSuccess(true);
    if (onSaved) onSaved(trimmed);
    setTimeout(() => {
      onClose();
    }, 900);
  };

  return (
    <div className="modal-overlay" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      <div className="modal-content" style={{
        background: 'var(--bg-primary, #ffffff)',
        color: 'var(--text-primary, #0f172a)',
        borderRadius: '12px',
        maxWidth: '440px',
        width: '100%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
        overflow: 'hidden',
        border: '1px solid var(--border-color, #e2e8f0)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: '#dcfce7',
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Smartphone size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Owner WhatsApp Number</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
                Destination number for Daily & Weekly reports
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.35rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              padding: '0.75rem 1rem',
              background: '#fee2e2',
              borderLeft: '4px solid #ef4444',
              color: '#991b1b',
              borderRadius: '4px',
              fontSize: '0.85rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div style={{
              padding: '0.75rem 1rem',
              background: '#f0fdf4',
              borderLeft: '4px solid #16a34a',
              color: '#166534',
              borderRadius: '4px',
              fontSize: '0.85rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <CheckCircle size={16} />
              <span>Owner WhatsApp number updated successfully!</span>
            </div>
          )}

          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Owner WhatsApp Phone (e.g. 9847012345)
          </label>
          <input
            type="tel"
            className="input-field"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setError('');
            }}
            placeholder="Enter 10-digit mobile number"
            style={{ width: '100%', padding: '0.65rem 0.85rem', fontSize: '0.95rem' }}
            autoFocus
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginTop: '0.5rem' }}>
            When staff click "Share to Owner WhatsApp", the pre-filled report will open targeting this number.
          </p>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          background: 'var(--bg-secondary, #f8fafc)',
          borderTop: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem'
        }}>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary" style={{ background: '#16a34a', borderColor: '#16a34a' }}>
            Save Number
          </button>
        </div>
      </div>
    </div>
  );
};

