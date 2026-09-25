import React, { useState, useEffect } from 'react';
import { X, Smartphone, Mail, CheckCircle, AlertCircle, Settings, Send, Loader2, Clock, Check } from 'lucide-react';
import {
  getOwnerWhatsAppNumber,
  setOwnerWhatsAppNumber,
  getOwnerReportEmail,
  setOwnerReportEmail,
  isOwnerAutoReportEnabled,
  setOwnerAutoReportEnabled,
  getOwnerAutoReportTime,
  setOwnerAutoReportTime,
  sendTestPingToOwner
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
  const [autoReport, setAutoReport] = useState(true);
  const [reportTime, setReportTime] = useState('20:00');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Ping state
  const [pinging, setPinging] = useState(false);
  const [pingSuccess, setPingSuccess] = useState('');
  const [pingError, setPingError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPhone(getOwnerWhatsAppNumber());
      setEmail(getOwnerReportEmail(defaultEmail));
      setAutoReport(isOwnerAutoReportEnabled());
      setReportTime(getOwnerAutoReportTime());
      setError('');
      setSuccess(false);
      setPingSuccess('');
      setPingError('');
    }
  }, [isOpen, defaultEmail]);

  if (!isOpen) return null;

  const handleTestPing = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      setPingError('Please enter an Owner WhatsApp number first.');
      return;
    }
    const cleanPhone = normalizeIndianPhone(trimmedPhone);
    if (cleanPhone.length < 10) {
      setPingError('Please enter a valid 10-digit phone number.');
      return;
    }
    if (cleanPhone === '918139009034') {
      setPingError("Cannot send to the business's own sender number (+91 81390 09034).");
      return;
    }

    setPinging(true);
    setPingSuccess('');
    setPingError('');

    const res = await sendTestPingToOwner(cleanPhone);
    setPinging(false);

    if (res.success) {
      setPingSuccess(`Verification message sent to +${cleanPhone}! Check WhatsApp.`);
      setTimeout(() => setPingSuccess(''), 5000);
    } else {
      setPingError(res.error || 'Failed to send test message via Bizylead WhatsApp.');
    }
  };

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

    setOwnerAutoReportEnabled(autoReport);
    setOwnerAutoReportTime(reportTime);

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
        maxWidth: '520px',
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
                Configure Owner WhatsApp &amp; Automated Delivery
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

          {pingSuccess && (
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
              <Check size={16} />
              <span>{pingSuccess}</span>
            </div>
          )}

          {pingError && (
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
              <span>{pingError}</span>
            </div>
          )}

          {/* Owner WhatsApp Number with Test Ping Button */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Smartphone size={15} color="#16a34a" />
                <span>Owner WhatsApp Number</span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted, #64748b)' }}>
                Sender: +91 81390 09034
              </span>
            </label>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="tel"
                className="input-field"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError('');
                }}
                placeholder="e.g. 9847012345"
                style={{ flex: 1, padding: '0.65rem 0.85rem', fontSize: '0.9rem', fontWeight: 600 }}
              />
              <button
                type="button"
                onClick={handleTestPing}
                disabled={pinging || !phone.trim()}
                className="btn-secondary"
                title="Send an immediate verification test WhatsApp message from B2P"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  padding: '0.65rem 0.85rem'
                }}
              >
                {pinging ? <Loader2 className="spin" size={14} /> : <Send size={14} color="#16a34a" />}
                <span>{pinging ? 'Sending...' : 'Test Send'}</span>
              </button>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', margin: '0.35rem 0 0 0' }}>
              Daily reports will be dispatched directly to this WhatsApp number via verified Bizylead WhatsApp API.
            </p>
          </div>

          {/* Auto-Report Schedule Setting */}
          <div style={{
            background: 'var(--bg-secondary, #f8fafc)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1.25rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={16} color="#2563eb" />
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Automated Daily Report Dispatch</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.4rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={autoReport}
                  onChange={(e) => setAutoReport(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 600, color: autoReport ? '#16a34a' : '#64748b' }}>
                  {autoReport ? 'Active' : 'Disabled'}
                </span>
              </label>
            </div>

            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', lineHeight: 1.4 }}>
              The cloud system automatically compiles today's telecalling &amp; business metrics and sends an executive report to the owner WhatsApp every evening at <strong>8:00 PM IST (20:00)</strong>.
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
              When clicking "Send Email", the Daily Report and Unresolved Calls summary will also be emailed here.
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
