import React, { useState, useEffect } from 'react';
import { X, Smartphone, Mail, CheckCircle, AlertCircle, Settings } from 'lucide-react';
import {
  getOwnerWhatsAppNumber,
  setOwnerWhatsAppNumber,
  getOwnerReportEmail,
  setOwnerReportEmail
} from '../../utils/telecallingShare';
import { normalizeIndianPhone } from '../../utils/whatsappShare';

interface OwnerWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (phone: string, email?: string) => void;
  defaultEmail?: string;
}

export const OwnerWhatsAppModal: React.FC<OwnerWhatsAppModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  defaultEmail
}) => {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPhone(getOwnerWhatsAppNumber());
      setEmail(getOwnerReportEmail(defaultEmail));
      setError('');
      setSuccess(false);
    }
  }, [isOpen, defaultEmail]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();

    if (trimmedPhone) {
      const cleanPhone = normalizeIndianPhone(trimmedPhone);
      if (cleanPhone.length < 10) {
        setError('Please enter a valid 10-digit Indian phone number.');
        return;
      }
      setOwnerWhatsAppNumber(trimmedPhone);
    }

    if (trimmedEmail) {
      if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
        setError('Please enter a valid email address.');
        return;
      }
      setOwnerReportEmail(trimmedEmail);
    }

    if (!trimmedPhone && !trimmedEmail) {
      setError('Please provide at least a phone number or email recipient.');
      return;
    }

    setSuccess(true);
    if (onSaved) onSaved(trimmedPhone, trimmedEmail);
    setTimeout(() => {
      onClose();
    }, 700);
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
        maxWidth: '480px',
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
              background: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Settings size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Report Delivery Settings</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
                Configure Owner WhatsApp &amp; Email recipients
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
              <span>Report delivery settings saved successfully!</span>
            </div>
          )}

          {/* Owner WhatsApp Number */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              <Smartphone size={15} color="#16a34a" />
              <span>Owner WhatsApp Number</span>
            </label>
            <input
              type="tel"
              className="input-field"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError('');
              }}
              placeholder="e.g. 9847012345"
              style={{ width: '100%', padding: '0.65rem 0.85rem', fontSize: '0.9rem' }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', margin: '0.3rem 0 0 0' }}>
              When clicking "Share to Owner WhatsApp", the pre-filled report opens targeting this number.
            </p>
          </div>

          {/* Owner Report Email */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              <Mail size={15} color="#2563eb" />
              <span>Management / Owner Report Email</span>
            </label>
            <input
              type="email"
              className="input-field"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="e.g. director@company.com or reports@company.com"
              style={{ width: '100%', padding: '0.65rem 0.85rem', fontSize: '0.9rem' }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', margin: '0.3rem 0 0 0' }}>
              When clicking "Send Email", the Daily Report and Unresolved Calls summary will be emailed here.
            </p>
          </div>
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
          <button onClick={handleSave} className="btn-primary" style={{ background: '#2563eb', borderColor: '#2563eb' }}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
