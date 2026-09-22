import React, { useState, useEffect } from 'react';
import { X, Save, PhoneCall, Building2, User, Mail, MapPin, Loader2, Phone } from 'lucide-react';
import type { TelecallingEntry, TelecallingStatus } from '../../types';
import { TELECALLING_STATUSES } from '../../types';
import { telecallingService } from '../../services/telecallingService';

interface TelecallingEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: TelecallingEntry | null;
  onSaved: (updated: TelecallingEntry) => void;
}

export const TelecallingEditModal: React.FC<TelecallingEditModalProps> = ({
  isOpen,
  onClose,
  entry,
  onSaved
}) => {
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [otherPhone, setOtherPhone] = useState('');
  const [location, setLocation] = useState('');
  const [email, setEmail] = useState('');
  const [callStatus, setCallStatus] = useState<TelecallingStatus>('Interested / Details Shared');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (entry) {
      setCompanyName(entry.company_name || '');
      setContactPerson(entry.contact_person || '');
      setPhone(entry.phone || '');
      setOtherPhone(entry.other_phone || '');
      setLocation(entry.location || '');
      setEmail(entry.email || '');
      setCallStatus(entry.call_status || 'Interested / Details Shared');
      setFeedback(entry.feedback || '');
      setErrorMsg('');
    }
  }, [entry]);

  if (!isOpen || !entry) return null;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setErrorMsg('Company Name is required.');
      return;
    }
    if (!phone.trim()) {
      setErrorMsg('Phone Number is required.');
      return;
    }

    setSaving(true);
    setErrorMsg('');

    try {
      const res = await telecallingService.updateEntry(entry.id, {
        company_name: companyName.trim(),
        contact_person: contactPerson.trim() || null,
        phone: phone.trim(),
        other_phone: otherPhone.trim() || null,
        location: location.trim() || null,
        email: email.trim() || null,
        call_status: callStatus,
        feedback: feedback.trim() || null
      });

      if (res.success && res.entry) {
        onSaved(res.entry);
        onClose();
      } else {
        setErrorMsg(res.error || 'Failed to update entry.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      <div style={{
        background: 'var(--bg-primary, #ffffff)',
        borderRadius: '12px',
        maxWidth: '650px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
        border: '1px solid var(--border-color, #e2e8f0)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-color, #e2e8f0)'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>
              Edit Call Record
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
              Date: {entry.entry_date} | Telecaller: {entry.created_by_name || entry.created_by_email || 'Staff'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost"
            style={{ padding: '0.35rem', color: '#64748b', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleUpdate} style={{ padding: '1.25rem' }}>
          {errorMsg && (
            <div style={{
              padding: '0.75rem',
              background: '#fee2e2',
              color: '#991b1b',
              borderRadius: '6px',
              fontSize: '0.85rem',
              marginBottom: '1rem'
            }}>
              {errorMsg}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem', marginBottom: '1rem' }}>
            {/* Company Name */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                <Building2 size={13} color="#3b82f6" />
                Company / Business Name *
              </label>
              <input
                type="text"
                className="input-field"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}
              />
            </div>

            {/* Contact Person */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                <User size={13} color="#3b82f6" />
                Contact Person
              </label>
              <input
                type="text"
                className="input-field"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}
              />
            </div>

            {/* Primary Phone */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                <Phone size={13} color="#16a34a" />
                Phone Number *
              </label>
              <input
                type="tel"
                className="input-field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}
              />
            </div>

            {/* Other Phone */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                Other Phone (Optional)
              </label>
              <input
                type="tel"
                className="input-field"
                value={otherPhone}
                onChange={(e) => setOtherPhone(e.target.value)}
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}
              />
            </div>

            {/* Location */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                <MapPin size={13} color="#f59e0b" />
                Location
              </label>
              <input
                type="text"
                className="input-field"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}
              />
            </div>

            {/* Email */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                <Mail size={13} color="#64748b" />
                Email
              </label>
              <input
                type="email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          {/* Call Status */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              <PhoneCall size={13} color="#3b82f6" />
              Call Result / Status *
            </label>
            <select
              className="input-field"
              value={callStatus}
              onChange={(e) => setCallStatus(e.target.value as TelecallingStatus)}
              style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem', fontWeight: 600 }}
            >
              {TELECALLING_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Feedback / Comments / Remarks */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Feedback / Remarks / Comments
            </label>
            <textarea
              className="input-field"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="Enter client response, comments, or follow-up notes..."
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem', resize: 'vertical' }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: '0.75rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={saving}
              style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.85rem',
                padding: '0.5rem 1.25rem',
                background: '#2563eb',
                borderColor: '#2563eb'
              }}
            >
              {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

