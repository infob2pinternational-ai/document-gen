import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Customer, Lead, LeadPriority, LeadSource } from '../types';
import { X, UserCheck } from 'lucide-react';
import { leadService } from '../services/leadService';
import { formatStaffDisplayName, getAvailableStaffList } from '../utils/staffUtils';

interface LeadModalProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
  customers: Customer[];
  userEmail: string;
  companyId?: string;
}

const SERVICE_OPTIONS = [
  'LED Van Advertising',
  'LED Wall',
  'Lookwalker',
  'Mobile Roadshow Campaigns',
  'Events & Staging',
  'Signage & Printing',
  'Digital Outdoor Billboard',
  'Other Advertising'
];

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'whatsapp_bulk', label: 'WhatsApp Bulk' },
  { value: 'website', label: 'Website Inquiry' },
  { value: 'phone', label: 'Direct Phone Call' },
  { value: 'existing_customer', label: 'Existing Customer' },
  { value: 'referral', label: 'Referral' },
  { value: 'bulk_email', label: 'Bulk Email' },
  { value: 'other', label: 'Other' }
];

const KERALA_DISTRICTS = [
  'Thiruvananthapuram',
  'Kollam',
  'Pathanamthitta',
  'Alappuzha',
  'Kottayam',
  'Idukki',
  'Ernakulam',
  'Thrissur',
  'Palakkad',
  'Malappuram',
  'Kozhikode',
  'Wayanad',
  'Kannur',
  'Kasaragod'
];

export const LeadModal: React.FC<LeadModalProps> = ({
  lead,
  isOpen,
  onClose,
  onSaved,
  customers,
  userEmail,
  companyId = 'default'
}) => {
  const [customerName, setCustomerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [location, setLocation] = useState('Thrissur');
  const [address, setAddress] = useState('');
  const [businessType, setBusinessType] = useState('');
  
  const [leadSource, setLeadSource] = useState<LeadSource>('phone');
  const [sourceDetails, setSourceDetails] = useState('');
  
  const [serviceRequired, setServiceRequired] = useState(SERVICE_OPTIONS[0]);
  const [vehicleServiceType, setVehicleServiceType] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [campaignLocation, setCampaignLocation] = useState('');
  const [numberOfDays, setNumberOfDays] = useState<number | ''>(1);
  
  const [priority, setPriority] = useState<LeadPriority>('WARM');
  const [assignedTelecaller, setAssignedTelecaller] = useState(userEmail || '');
  const [notes, setNotes] = useState('');
  const [remarks, setRemarks] = useState('');
  
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const availableStaff = useMemo(() => {
    return getAvailableStaffList(userEmail, leadService.getLeads());
  }, [userEmail, isOpen]);

  const prevOpenRef = useRef(false);
  const prevLeadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      prevOpenRef.current = false;
      return;
    }

    const currentLeadId = lead?.id || 'new';
    const justOpened = !prevOpenRef.current && isOpen;
    const leadChanged = prevLeadRef.current !== currentLeadId;
    prevOpenRef.current = isOpen;
    prevLeadRef.current = currentLeadId;

    if (!justOpened && !leadChanged) {
      return;
    }

    if (lead) {
      setCustomerName(lead.customer_name || '');
      setCompanyName(lead.company_name || '');
      setPhone(lead.phone || '');
      setWhatsappNumber(lead.whatsapp_number || lead.phone || '');
      setLocation(lead.location || 'Thrissur');
      setAddress(lead.address || '');
      setBusinessType(lead.business_type || '');
      setLeadSource(lead.lead_source || 'phone');
      setSourceDetails(lead.source_details || '');
      setServiceRequired(lead.service_required || SERVICE_OPTIONS[0]);
      setVehicleServiceType(lead.vehicle_service_type || '');
      setRequiredDate(lead.required_date || '');
      setCampaignLocation(lead.campaign_location || '');
      setNumberOfDays(lead.number_of_days !== undefined ? lead.number_of_days : 1);
      setPriority(lead.priority || 'WARM');
      setAssignedTelecaller(lead.assigned_telecaller_email || userEmail || '');
      setNotes(lead.notes || '');
      setRemarks(lead.remarks || '');
    } else {
      setCustomerName('');
      setCompanyName('');
      setPhone('');
      setWhatsappNumber('');
      setLocation('Thrissur');
      setAddress('');
      setBusinessType('');
      setLeadSource('phone');
      setSourceDetails('');
      setServiceRequired(SERVICE_OPTIONS[0]);
      setVehicleServiceType('');
      setRequiredDate('');
      setCampaignLocation('');
      setNumberOfDays(1);
      setPriority('WARM');
      setAssignedTelecaller(userEmail || '');
      setNotes('');
      setRemarks('');
      setMatchedCustomer(null);
    }
  }, [lead, isOpen, userEmail]);

  useEffect(() => {
    if (!lead && phone && phone.length >= 7) {
      const cleanPhone = phone.replace(/\D/g, '');
      const found = customers.find(c => c.phone && c.phone.replace(/\D/g, '').includes(cleanPhone));
      if (found) {
        setMatchedCustomer(found);
      } else {
        setMatchedCustomer(null);
      }
    } else {
      setMatchedCustomer(null);
    }
  }, [phone, customers, lead]);

  if (!isOpen) return null;

  const handleCopyPhoneToWhatsapp = () => {
    setWhatsappNumber(phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    if (!customerName.trim()) {
      alert('Please enter a customer name.');
      return;
    }
    if (!phone.trim()) {
      alert('Please enter a contact phone number.');
      return;
    }

    try {
      setIsSaving(true);
      const saved = await leadService.saveLead({
        id: lead?.id,
        company_id: companyId,
        customer_name: customerName.trim(),
        company_name: companyName.trim() || undefined,
        phone: phone.trim(),
        whatsapp_number: whatsappNumber.trim() || phone.trim(),
        location: location.trim(),
        address: address.trim() || undefined,
        business_type: businessType.trim() || undefined,
        lead_source: leadSource,
        source_details: sourceDetails.trim() || undefined,
        service_required: serviceRequired,
        vehicle_service_type: vehicleServiceType.trim() || undefined,
        required_date: requiredDate || undefined,
        campaign_location: campaignLocation.trim() || undefined,
        number_of_days: numberOfDays === '' ? 1 : Number(numberOfDays),
        priority: priority,
        assigned_telecaller_email: assignedTelecaller,
        notes: notes.trim() || undefined,
        remarks: remarks.trim() || undefined,
        status: lead?.status || 'new'
      }, userEmail);

      onSaved(saved);
      onClose();
    } catch (err: any) {
      console.error('[LeadModal] Failed to save lead:', err);
      alert('Failed to save lead: ' + (err?.message || 'Unknown error occurred.'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2000 }}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()} 
        style={{ 
          maxWidth: '860px', 
          width: '95%', 
          maxHeight: 'min(92vh, 880px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          margin: 'auto'
        }}
      >
        
        <div className="modal-header">
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              {lead ? `Edit Lead: ${lead.lead_number || lead.id}` : 'New Lead Intake Form'}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0 0' }}>
              Capture customer details, campaign specifications, and assign telecaller.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ padding: '0.35rem' }} title="Close Form">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {matchedCustomer && !lead && (
            <div style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 'var(--radius-sm)',
              padding: '0.65rem 0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem'
            }}>
              <UserCheck size={16} color="#1d4ed8" />
              <div style={{ fontSize: '0.78rem', color: '#1e40af', flex: 1 }}>
                <strong>Existing Customer Matched:</strong> {matchedCustomer.name} {(matchedCustomer as any).company_name ? `(${(matchedCustomer as any).company_name})` : ''} · Phone: {matchedCustomer.phone}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomerName(matchedCustomer.name);
                  if ((matchedCustomer as any).company_name) setCompanyName((matchedCustomer as any).company_name);
                  if (matchedCustomer.address) setAddress(matchedCustomer.address);
                }}
                className="btn-secondary"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
              >
                Autofill
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-navy)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.35rem' }}>
                1. Customer & Contact
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Anand Menon"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Company / Enterprise Name</label>
                <input
                  type="text"
                  placeholder="e.g. Kalyan Silks"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Phone *</label>
                    <button
                      type="button"
                      onClick={handleCopyPhoneToWhatsapp}
                      style={{ fontSize: '0.6875rem', color: 'var(--brand-navy)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                    >
                      {copiedPhone ? 'Copied' : 'Copy to WA'}
                    </button>
                  </div>
                  <input
                    type="tel"
                    required
                    placeholder="9847012345"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>WhatsApp</label>
                  <input
                    type="tel"
                    placeholder="9847012345"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>District / City</label>
                  <select
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  >
                    {KERALA_DISTRICTS.map(dist => (
                      <option key={dist} value={dist}>{dist}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Lead Source *</label>
                  <select
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value as LeadSource)}
                    style={{ fontSize: '0.8125rem' }}
                  >
                    {SOURCE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Source Campaign Reference</label>
                <input
                  type="text"
                  placeholder="e.g. Onam Promo Reel / Google Search"
                  value={sourceDetails}
                  onChange={(e) => setSourceDetails(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-navy)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.35rem' }}>
                2. Requirements & Priority
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Service Required *</label>
                <select
                  value={serviceRequired}
                  onChange={(e) => setServiceRequired(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                >
                  {SERVICE_OPTIONS.map(srv => (
                    <option key={srv} value={srv}>{srv}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Vehicle / Equipment Spec</label>
                <input
                  type="text"
                  placeholder="e.g. 14ft High-Brightness LED Screen Van"
                  value={vehicleServiceType}
                  onChange={(e) => setVehicleServiceType(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.6rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Target Event Date</label>
                  <input
                    type="date"
                    value={requiredDate}
                    onChange={(e) => setRequiredDate(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Duration (Days)</label>
                  <input
                    type="number"
                    min="1"
                    value={numberOfDays}
                    onChange={(e) => setNumberOfDays(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Campaign Venue / Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Thrissur Round & Guruvayur Temple Road"
                    value={campaignLocation}
                    onChange={(e) => setCampaignLocation(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Assigned Staff</label>
                  <select
                    value={assignedTelecaller}
                    onChange={(e) => setAssignedTelecaller(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  >
                    {availableStaff.map(s => (
                      <option key={s.email} value={s.email}>{s.label}</option>
                    ))}
                    {assignedTelecaller && !availableStaff.some(s => s.email === assignedTelecaller) && (
                      <option value={assignedTelecaller}>{formatStaffDisplayName(assignedTelecaller)} ({assignedTelecaller})</option>
                    )}
                    <option value="">Unassigned</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Lead Priority *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                  {(['HOT', 'WARM', 'COLD'] as LeadPriority[]).map(p => {
                    const isSelected = priority === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={`badge ${p === 'HOT' ? 'priority-pill-hot' : p === 'WARM' ? 'priority-pill-warm' : 'priority-pill-cold'}`}
                        style={{
                          padding: '0.45rem',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          opacity: isSelected ? 1 : 0.5,
                          borderWidth: isSelected ? '2px' : '1px'
                        }}
                      >
                        <span className={`status-dot ${p === 'HOT' ? 'status-dot-danger' : p === 'WARM' ? 'status-dot-warning' : 'status-dot-info'}`} />
                        <span>{p}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Customer Requirements / Notes</label>
              <textarea
                rows={2}
                placeholder="Specific customer requests, route timing, audio preferences..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ fontSize: '0.8125rem' }}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Internal Staff Remarks</label>
              <textarea
                rows={2}
                placeholder="Pricing flexibility, competitor quotes, client decision date..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                style={{ fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.85rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              style={{ fontSize: '0.8125rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary"
              style={{
                fontSize: '0.8125rem',
                padding: '0.45rem 1.25rem',
                opacity: isSaving ? 0.7 : 1,
                cursor: isSaving ? 'not-allowed' : 'pointer'
              }}
            >
              {isSaving ? 'Saving Lead...' : lead ? 'Update Lead Record' : 'Create & Save Lead'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
