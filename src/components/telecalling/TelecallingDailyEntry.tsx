import React, { useState, useEffect, useRef } from 'react';
import { 
  PhoneCall, 
  Save, 
  Plus, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Smartphone, 
  MessageSquare, 
  FileSpreadsheet, 
  Building2, 
  MapPin, 
  Mail, 
  User, 
  Calendar,
  Loader2,
  Trash2,
  Pencil
} from 'lucide-react';
import type { CompanyProfile, TelecallingEntry, TelecallingStatus } from '../../types';
import { TELECALLING_STATUSES } from '../../types';
import { telecallingService } from '../../services/telecallingService';
import { getKolkataToday, formatKolkataDisplayDate } from '../../utils/dateUtils';
import { ExcelImportModal } from './ExcelImportModal';

interface TelecallingDailyEntryProps {
  activeProfile: CompanyProfile | null;
  user: any;
  userRole?: string;
  onNavigateToDailyReport?: () => void;
}

export const TelecallingDailyEntry: React.FC<TelecallingDailyEntryProps> = ({
  activeProfile,
  user,
  userRole = 'staff',
  onNavigateToDailyReport
}) => {
  const companyId = activeProfile?.id || '';

  // Form states
  const [entryDate, setEntryDate] = useState<string>(getKolkataToday());
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [otherPhone, setOtherPhone] = useState('');
  const [location, setLocation] = useState('');
  const [email, setEmail] = useState('');
  const [callStatus, setCallStatus] = useState<TelecallingStatus>('Interested / Details Shared');
  const [feedback, setFeedback] = useState('');

  // UI / submission states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [todayEntries, setTodayEntries] = useState<TelecallingEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Field focus ref
  const companyInputRef = useRef<HTMLInputElement>(null);

  // Load today's entries
  const loadEntries = async () => {
    if (!companyId) return;
    setLoadingEntries(true);
    try {
      const data = await telecallingService.getEntriesForDate(companyId, entryDate);
      setTodayEntries(data);
    } catch (err) {
      console.error('Failed to load telecalling entries:', err);
    } finally {
      setLoadingEntries(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, [companyId, entryDate]);

  const resetForm = (keepDate: boolean = true) => {
    if (!keepDate) setEntryDate(getKolkataToday());
    setEditingId(null);
    setCompanyName('');
    setContactPerson('');
    setPhone('');
    setOtherPhone('');
    setLocation('');
    setEmail('');
    setCallStatus('Interested / Details Shared');
    setFeedback('');
    setErrorMsg('');
    setTimeout(() => {
      companyInputRef.current?.focus();
    }, 50);
  };

  const handleEditEntry = (entry: TelecallingEntry) => {
    setEditingId(entry.id);
    setEntryDate(entry.entry_date || getKolkataToday());
    setCompanyName(entry.company_name || '');
    setContactPerson(entry.contact_person || '');
    setPhone(entry.phone || '');
    setOtherPhone(entry.other_phone || '');
    setLocation(entry.location || '');
    setEmail(entry.email || '');
    setCallStatus(entry.call_status || 'Interested / Details Shared');
    setFeedback(entry.feedback || '');
    setErrorMsg('');
    setSaveSuccessMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      companyInputRef.current?.focus();
    }, 100);
  };

  const handleCancelEdit = () => {
    resetForm(true);
  };

  const handleSave = async (andNew: boolean = false) => {
    if (!companyId) {
      setErrorMsg('No active company profile selected. Please select a company.');
      return;
    }

    const cleanCompany = companyName.trim();
    const cleanPhone = phone.trim();

    if (!cleanCompany) {
      setErrorMsg('Company / Business Name is required.');
      companyInputRef.current?.focus();
      return;
    }

    if (!cleanPhone) {
      setErrorMsg('Phone Number is required.');
      return;
    }

    if (saving) return; // Prevent double submission

    setSaving(true);
    setErrorMsg('');
    setSaveSuccessMsg('');

    const callerEmail = user?.email || '';
    const callerName = callerEmail.split('@')[0] || 'Staff';

    if (editingId) {
      // Update existing record
      const result = await telecallingService.updateEntry(editingId, {
        entry_date: entryDate || getKolkataToday(),
        company_name: cleanCompany,
        contact_person: contactPerson.trim() || null,
        phone: cleanPhone,
        other_phone: otherPhone.trim() || null,
        location: location.trim() || null,
        email: email.trim() || null,
        call_status: callStatus,
        feedback: feedback.trim() || null
      });

      setSaving(false);

      if (result.success && result.entry) {
        setSaveSuccessMsg(`Call record for "${cleanCompany}" updated successfully!`);
        setTodayEntries(prev => prev.map(item => item.id === editingId ? result.entry! : item));
        resetForm(true);
      } else {
        setErrorMsg(result.error || 'Failed to update telecalling entry. Please retry.');
      }
      return;
    }

    const result = await telecallingService.createEntry({
      company_id: companyId,
      entry_date: entryDate || getKolkataToday(),
      company_name: cleanCompany,
      contact_person: contactPerson.trim() || null,
      phone: cleanPhone,
      other_phone: otherPhone.trim() || null,
      location: location.trim() || null,
      email: email.trim() || null,
      call_status: callStatus,
      feedback: feedback.trim() || null,
      created_by: user?.id || null,
      created_by_email: callerEmail,
      created_by_name: callerName
    });

    setSaving(false);

    if (result.success && result.entry) {
      setSaveSuccessMsg(`Call record for "${cleanCompany}" saved successfully!`);
      // Prepend to recent list
      setTodayEntries(prev => [result.entry!, ...prev.filter(e => e.id !== result.entry!.id)]);

      if (andNew) {
        resetForm(true);
      } else {
        setTimeout(() => setSaveSuccessMsg(''), 4000);
      }
    } else {
      setErrorMsg(result.error || 'Failed to save telecalling entry. Please retry.');
    }
  };

  const handleDeleteEntry = async (id: string, name: string) => {
    if (!window.confirm(`Delete telecalling record for "${name}"?`)) return;
    const res = await telecallingService.deleteEntry(id);
    if (res.success) {
      setTodayEntries(prev => prev.filter(e => e.id !== id));
    } else {
      alert('Failed to delete: ' + (res.error || 'Unknown error'));
    }
  };

  const handleRetrySync = async (entryId: string) => {
    const success = await telecallingService.retryEntrySync(entryId, companyId);
    if (success) {
      alert('Sync retry queued. Google Sheets will update in a moment.');
      loadEntries();
    }
  };

  const isAdminOrOwner = userRole === 'owner' || userRole === 'admin';

  return (
    <div className="telecalling-entry-container" style={{ padding: '1rem', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Top Banner / Actions */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        marginBottom: '1.25rem'
      }}>
        <div>
          <h2 style={{
            fontSize: '1.4rem',
            fontWeight: 800,
            margin: 0,
            color: 'var(--text-primary, #0f172a)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <PhoneCall size={24} color="#3b82f6" />
            Telecalling Daily Entry
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
            Rapid call logging for {activeProfile?.name || 'Company Profile'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {isAdminOrOwner && (
            <button
              onClick={() => setImportModalOpen(true)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <FileSpreadsheet size={16} color="#16a34a" />
              <span>Import Excel (.xlsx)</span>
            </button>
          )}

          {onNavigateToDailyReport && (
            <button
              onClick={onNavigateToDailyReport}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <Calendar size={16} color="#3b82f6" />
              <span>View Daily Report</span>
            </button>
          )}
        </div>
      </div>

      {/* Save Success Alert */}
      {saveSuccessMsg && (
        <div style={{
          padding: '0.85rem 1rem',
          background: '#f0fdf4',
          borderLeft: '4px solid #16a34a',
          color: '#166534',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.9rem',
          animation: 'fadeIn 0.3s ease'
        }}>
          <CheckCircle2 size={18} />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div style={{
          padding: '0.85rem 1rem',
          background: '#fee2e2',
          borderLeft: '4px solid #ef4444',
          color: '#991b1b',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.9rem'
        }}>
          <AlertCircle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Editing Notice Banner */}
      {editingId && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#eff6ff',
          border: '1px solid #93c5fd',
          borderLeft: '4px solid #2563eb',
          color: '#1e40af',
          borderRadius: '8px',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          fontSize: '0.85rem',
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <Pencil size={16} color="#2563eb" />
            <span>Editing Call Record for: <strong>{companyName || 'Selected Entry'}</strong></span>
          </div>
          <button
            type="button"
            onClick={handleCancelEdit}
            className="btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
          >
            Cancel Edit
          </button>
        </div>
      )}

      {/* Rapid Entry Form Card */}
      <div style={{
        background: 'var(--bg-primary, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '12px',
        padding: '1.25rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        marginBottom: '1.5rem'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          marginBottom: '1rem'
        }}>
          {/* Date */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <Calendar size={14} color="#64748b" />
              Call Date <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="date"
              className="input-field"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}
            />
          </div>

          {/* Company / Name */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <Building2 size={14} color="#64748b" />
              Company / Business Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              ref={companyInputRef}
              type="text"
              className="input-field"
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="e.g. Nirapara, Devon Foods, Jayalakshmi"
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}
            />
          </div>

          {/* Contact Person */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <User size={14} color="#64748b" />
              Contact Person
            </label>
            <input
              type="text"
              className="input-field"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              placeholder="e.g. Syam (Marketing Manager)"
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}
            />
          </div>

          {/* Phone */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <Smartphone size={14} color="#64748b" />
              Phone Number <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="tel"
              className="input-field"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="e.g. 9847012345 or 0484-4000544"
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}
            />
          </div>

          {/* Other Phone */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <Smartphone size={14} color="#64748b" />
              Other Phone / Landline
            </label>
            <input
              type="tel"
              className="input-field"
              value={otherPhone}
              onChange={(e) => setOtherPhone(e.target.value)}
              placeholder="e.g. Alternate mobile or office line"
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}
            />
          </div>

          {/* Location */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <MapPin size={14} color="#64748b" />
              Location / City
            </label>
            <input
              type="text"
              className="input-field"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Palakkad, Kochi, Thrissur"
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}
            />
          </div>

          {/* Email */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <Mail size={14} color="#64748b" />
              Email Address
            </label>
            <input
              type="email"
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. marketing@company.com"
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}
            />
          </div>

          {/* Call Result / Status */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <PhoneCall size={14} color="#3b82f6" />
              Call Result / Status <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className="input-field"
              value={callStatus}
              onChange={(e) => setCallStatus(e.target.value as TelecallingStatus)}
              style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}
            >
              {TELECALLING_STATUSES.map(status => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Feedback / Remarks */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Feedback / Remarks
          </label>
          <textarea
            className="input-field"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Sent LED Van advertising details; will contact next week. Appointment confirmed with Mr. Syam."
            rows={2}
            style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem', resize: 'vertical' }}
          />
        </div>

        {/* Actions Toolbar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border-color, #e2e8f0)'
        }}>
          <button
            type="button"
            onClick={() => resetForm(true)}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
          >
            <RotateCcw size={15} />
            <span>Clear</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {editingId ? (
              <>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="btn-secondary"
                  disabled={saving}
                  style={{ fontSize: '0.85rem', padding: '0.65rem 1rem' }}
                >
                  Cancel Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(false)}
                  className="btn-primary"
                  disabled={saving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    padding: '0.65rem 1.25rem',
                    background: '#2563eb',
                    borderColor: '#2563eb'
                  }}
                >
                  {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  <span>Update Entry</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  className="btn-secondary"
                  disabled={saving}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', fontWeight: 600 }}
                >
                  {saving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                  <span>Save & New</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSave(false)}
                  className="btn-primary"
                  disabled={saving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    padding: '0.65rem 1.25rem',
                    background: '#2563eb',
                    borderColor: '#2563eb'
                  }}
                >
                  {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  <span>Save Entry</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Recent Entries for the Selected Date */}
      <div style={{
        background: 'var(--bg-primary, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '12px',
        padding: '1.25rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Clock size={18} color="#64748b" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              Activity Log for {formatKolkataDisplayDate(entryDate)}
            </h3>
            <span style={{
              background: '#eff6ff',
              color: '#2563eb',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '0.75rem',
              fontWeight: 800
            }}>
              {todayEntries.length} Calls
            </span>
          </div>

          <button onClick={loadEntries} className="btn-ghost" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
            Refresh
          </button>
        </div>

        {loadingEntries ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Loader2 className="spin" size={24} style={{ margin: '0 auto', color: '#3b82f6' }} />
          </div>
        ) : todayEntries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted, #64748b)' }}>
            <PhoneCall size={32} style={{ margin: '0 auto 0.5rem auto', opacity: 0.4 }} />
            <p style={{ margin: 0, fontWeight: 600 }}>No telecalling entries recorded for this date yet.</p>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem' }}>Enter a call above to start your daily log.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Company</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Contact</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Phone</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Result / Status</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Feedback</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Telecaller</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>Sync</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {todayEntries.map((e) => {
                  const cleanPhone = (e.phone || '').replace(/\D/g, '');
                  const waNumber = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

                  return (
                    <tr key={e.id} style={{
                      borderBottom: '1px solid var(--border-color, #e2e8f0)',
                      background: e.id === editingId ? '#eff6ff' : undefined,
                      transition: 'background 0.2s ease'
                    }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                        {e.company_name}
                        {e.location && (
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{e.location}</div>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{e.contact_person || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span>{e.phone}</span>
                          {cleanPhone && (
                            <>
                              <a href={`tel:${cleanPhone}`} title="Direct Call" style={{ color: '#2563eb' }}>
                                <Smartphone size={14} />
                              </a>
                              <a
                                href={`https://wa.me/${waNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="WhatsApp Chat"
                                style={{ color: '#16a34a' }}
                              >
                                <MessageSquare size={14} />
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: e.call_status === 'Appointment Confirmed' ? '#dcfce7' :
                                      e.call_status === 'Interested / Details Shared' ? '#dbeafe' :
                                      e.call_status === 'Follow-up Required' || e.call_status === 'Call Back' ? '#fef3c7' :
                                      e.call_status === 'No Interest' ? '#fee2e2' : '#f1f5f9',
                          color: e.call_status === 'Appointment Confirmed' ? '#166534' :
                                 e.call_status === 'Interested / Details Shared' ? '#1e40af' :
                                 e.call_status === 'Follow-up Required' || e.call_status === 'Call Back' ? '#92400e' :
                                 e.call_status === 'No Interest' ? '#991b1b' : '#475569'
                        }}>
                          {e.call_status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569', maxWidth: '240px' }}>
                        {e.feedback || '—'}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: '0.8rem', color: '#64748b' }}>
                        {e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        {e.google_sync_status === 'synced' ? (
                          <span title="Synced with Google Sheets Data tab" style={{ color: '#16a34a', fontSize: '0.75rem', fontWeight: 700 }}>
                            Synced
                          </span>
                        ) : e.google_sync_status === 'failed' ? (
                          <button
                            onClick={() => handleRetrySync(e.id)}
                            title={`Sync Failed: ${e.google_sync_error || 'Click to retry'}`}
                            style={{
                              background: '#fee2e2',
                              color: '#991b1b',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.7rem',
                              cursor: 'pointer',
                              fontWeight: 700
                            }}
                          >
                            Retry Sync
                          </button>
                        ) : (
                          <span style={{ color: '#d97706', fontSize: '0.75rem' }}>Pending</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => handleEditEntry(e)}
                          className="btn-ghost"
                          title="Edit details & comments"
                          style={{
                            padding: '0.25rem',
                            color: '#2563eb',
                            marginRight: '0.35rem',
                            background: e.id === editingId ? '#dbeafe' : 'transparent',
                            borderRadius: '4px'
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteEntry(e.id, e.company_name)}
                          className="btn-ghost"
                          title="Delete entry"
                          style={{ padding: '0.25rem', color: '#ef4444' }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Excel Import Modal */}
      {importModalOpen && (
        <ExcelImportModal
          isOpen={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          companyId={companyId}
          user={user}
          onImportComplete={() => {
            loadEntries();
          }}
        />
      )}
    </div>
  );
};
