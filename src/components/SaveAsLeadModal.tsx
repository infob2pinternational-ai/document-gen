import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { WhatsAppConversation, Lead, LeadPriority } from '../types';
import { UserPlus, X, AlertCircle } from 'lucide-react';
import { leadService } from '../services/leadService';
import { whatsappService } from '../services/whatsappService';

interface SaveAsLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: WhatsAppConversation | null;
  userEmail: string;
  companyId?: string;
  onSaved: (lead: Lead) => void;
}

const SERVICE_OPTIONS = [
  'LED Video Wall Vehicle',
  'Lookwalker Promoters',
  'Mall Activation & Roadshow',
  'Hoardings & Billboards',
  'Custom Fabrication & Branding',
  'Audio & Visual Equipment',
  'General Inquiry'
];

export const SaveAsLeadModal: React.FC<SaveAsLeadModalProps> = ({
  isOpen,
  onClose,
  conversation,
  userEmail,
  companyId,
  onSaved
}) => {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [serviceRequired, setServiceRequired] = useState(SERVICE_OPTIONS[0]);
  const [campaignLocation, setCampaignLocation] = useState('');
  const [priority, setPriority] = useState<LeadPriority>('WARM');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveInProgressRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      saveInProgressRef.current = false;
      setIsSaving(false);
      return;
    }
    if (isOpen && conversation) {
      setCustomerName(conversation.customer_name || '');
      setPhone(conversation.phone || '');
      setCompanyName(conversation.company_name || '');
      setNotes(conversation.last_message || '');
      setServiceRequired(SERVICE_OPTIONS[0]);
      setCampaignLocation('');
      setPriority('WARM');
      setError(null);
    }
  }, [isOpen, conversation]);

  if (!isOpen || !conversation) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saveInProgressRef.current) return;

    if (!customerName.trim() || !phone.trim()) {
      setError('Customer name and phone number are required.');
      return;
    }

    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    setIsSaving(true);
    setError(null);

    try {
      const savedLead = await leadService.saveLead({
        customer_name: customerName.trim(),
        phone: phone.trim(),
        whatsapp_number: phone.trim(),
        company_name: companyName.trim() || undefined,
        service_required: serviceRequired,
        campaign_location: campaignLocation.trim() || undefined,
        location: campaignLocation.trim() || undefined,
        priority,
        notes: notes.trim() || undefined,
        lead_source: 'whatsapp_bulk',
        source_details: 'Saved from WhatsApp Business Workspace',
        status: 'new',
        company_id: conversation.company_id || companyId || undefined
      }, userEmail || 'Staff');

      await whatsappService.linkLeadToConversation(conversation.id, savedLead);
      onSaved(savedLead);
      onClose();
    } catch (err: any) {
      console.error('[SaveAsLeadModal] Error saving lead:', err);
      setError(err?.message || 'Failed to save lead to CRM. Please try again.');
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  };

  const modalElement = (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px', width: '95%', margin: 'auto' }}>
        
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <UserPlus size={18} color="var(--brand-navy)" />
              <span>Save WhatsApp Contact as CRM Lead</span>
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0 0' }}>
              Convert this WhatsApp inquiry into an active CRM lead pipeline entry.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ padding: '0.35rem' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{
            margin: '0.75rem 1.25rem 0',
            padding: '0.65rem 0.85rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 'var(--radius-sm)',
            color: '#b91c1c',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Customer Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Arun Kumar"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={{ fontSize: '0.8125rem' }}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Phone / WhatsApp *</label>
              <input
                type="tel"
                required
                placeholder="e.g. 9847012345"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Company / Organization</label>
              <input
                type="text"
                placeholder="e.g. Kerala Grand Events"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                style={{ fontSize: '0.8125rem' }}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Campaign Location / Town</label>
              <input
                type="text"
                placeholder="e.g. Thrissur & Kochi"
                value={campaignLocation}
                onChange={(e) => setCampaignLocation(e.target.value)}
                style={{ fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Service Required *</label>
              <select
                value={serviceRequired}
                onChange={(e) => setServiceRequired(e.target.value)}
                style={{ fontSize: '0.8125rem' }}
              >
                {SERVICE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as LeadPriority)}
                style={{ fontSize: '0.8125rem' }}
              >
                <option value="HOT">🔥 Hot (Immediate)</option>
                <option value="WARM">⚡ Warm (This Week)</option>
                <option value="COLD">❄️ Cold (Later)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Initial Inquiry Notes / Chat Context</label>
            <textarea
              rows={3}
              placeholder="e.g. Inquired about LED van booking for 3-day roadshow in December..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ fontSize: '0.8125rem' }}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="btn-secondary"
              style={{ fontSize: '0.8125rem', padding: '0.45rem 0.9rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary"
              style={{
                fontSize: '0.8125rem',
                padding: '0.45rem 1rem',
                background: '#2563eb',
                borderColor: '#2563eb',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <UserPlus size={14} />
              <span>{isSaving ? 'Saving to CRM...' : 'Create CRM Lead'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );

  return createPortal(modalElement, document.body);
};
