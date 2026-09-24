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
  Pencil,
  Search,
  History,
  ChevronDown,
  ChevronUp,
  AlertTriangle
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
  initialPrefillEntry?: TelecallingEntry | null;
  onClearInitialPrefill?: () => void;
}

export const TelecallingDailyEntry: React.FC<TelecallingDailyEntryProps> = ({
  activeProfile,
  user,
  userRole = 'staff',
  onNavigateToDailyReport,
  initialPrefillEntry,
  onClearInitialPrefill
}) => {
  const companyId = activeProfile?.id || '';

  // Form states - Date is strictly determined at save time via getKolkataToday()
  const todayKolkataDate = getKolkataToday();
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
  const [editingOriginalDate, setEditingOriginalDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [todayEntries, setTodayEntries] = useState<TelecallingEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Duplicate warning state
  const [duplicateWarning, setDuplicateWarning] = useState<TelecallingEntry | null>(null);
  const [duplicateDismissed, setDuplicateDismissed] = useState(false);

  // Previous Records Search states
  const [searchOpen, setSearchOpen] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyResults, setHistoryResults] = useState<TelecallingEntry[]>([]);
  const [searchingHistory, setSearchingHistory] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Field focus ref
  const companyInputRef = useRef<HTMLInputElement>(null);

  // Load today's entries (strictly today's Asia/Kolkata date)
  const loadTodayEntries = async () => {
    if (!companyId) return;
    setLoadingEntries(true);
    try {
      const data = await telecallingService.getEntriesForDate(companyId, todayKolkataDate);
      setTodayEntries(data);
    } catch (err) {
      console.error('Failed to load telecalling entries:', err);
    } finally {
      setLoadingEntries(false);
    }
  };

  useEffect(() => {
    loadTodayEntries();
  }, [companyId, todayKolkataDate]);

  // Debounced duplicate / previous call check
  useEffect(() => {
    if (editingId || duplicateDismissed) return;
    const cleanPhone = phone.replace(/\D/g, '');
    const cleanName = companyName.trim();

    if (cleanPhone.length < 6 && cleanName.length < 3) {
      setDuplicateWarning(null);
      return;
    }

    const timer = setTimeout(async () => {
      if (!companyId) return;
      try {
        const found = await telecallingService.checkDuplicateWarning(companyId, phone, companyName);
        if (found && found.id !== editingId) {
          setDuplicateWarning(found);
        } else {
          setDuplicateWarning(null);
        }
      } catch (err) {
        console.warn('Duplicate check notice:', err);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [companyId, phone, companyName, editingId, duplicateDismissed]);

  const resetForm = () => {
    setEditingId(null);
    setEditingOriginalDate(null);
    setCompanyName('');
    setContactPerson('');
    setPhone('');
    setOtherPhone('');
    setLocation('');
    setEmail('');
    setCallStatus('Interested / Details Shared');
    setFeedback('');
    setErrorMsg('');
    setDuplicateWarning(null);
    setDuplicateDismissed(false);
    setTimeout(() => {
      companyInputRef.current?.focus();
    }, 50);
  };

  const handleEditEntry = (entry: TelecallingEntry) => {
    setEditingId(entry.id);
    setEditingOriginalDate(entry.entry_date);
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
    setDuplicateWarning(null);
    setDuplicateDismissed(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      companyInputRef.current?.focus();
    }, 100);
  };

  const handleCancelEdit = () => {
    resetForm();
  };

  /**
   * "Call Again" action handler.
   * Prefills company, contact, phone, other phone, location, email.
   * STRICTLY DOES NOT COPY: Date (uses today Asia/Kolkata), Call Status (resets), or Feedback (cleared).
   */
  const handleCallAgain = (record: TelecallingEntry) => {
    setEditingId(null);
    setEditingOriginalDate(null);
    setCompanyName(record.company_name || '');
    setContactPerson(record.contact_person || '');
    setPhone(record.phone || '');
    setOtherPhone(record.other_phone || '');
    setLocation(record.location || '');
    setEmail(record.email || '');
    setCallStatus('Interested / Details Shared');
    setFeedback('');
    setDuplicateWarning(null);
    setDuplicateDismissed(true);
    setErrorMsg('');
    setSaveSuccessMsg(`Prefilled contact details for "${record.company_name}". Enter call feedback below.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      companyInputRef.current?.focus();
    }, 100);
  };

  useEffect(() => {
    if (initialPrefillEntry) {
      handleCallAgain(initialPrefillEntry);
      if (onClearInitialPrefill) onClearInitialPrefill();
    }
  }, [initialPrefillEntry]);

  // Search historical previous records
  const handleSearchHistory = async () => {
    if (!companyId || !historySearchQuery.trim()) return;
    setSearchingHistory(true);
    setHasSearched(true);
    try {
      const results = await telecallingService.searchPreviousEntries(companyId, historySearchQuery.trim(), 40);
      setHistoryResults(results);
    } catch (err) {
      console.error('Previous call search error:', err);
      setHistoryResults([]);
    } finally {
      setSearchingHistory(false);
    }
  };

  const handleSave = async (andNew: boolean = false) => {
    if (!companyId) {
      setErrorMsg('No active company profile selected. Please select a company.');
      return;
    }

    const cleanCompany = companyName.trim();
    const cleanPhone = phone.trim();
    const cleanFeedback = feedback.trim();

    if (!cleanCompany) {
      setErrorMsg('Company / Business Name is required.');
      companyInputRef.current?.focus();
      return;
    }

    if (!cleanPhone) {
      setErrorMsg('Phone Number is required.');
      return;
    }

    // MANDATORY FEEDBACK REQUIREMENT
    if (!cleanFeedback) {
      setErrorMsg('Feedback / Remarks is required. Please write a brief comment regarding the call outcome.');
      return;
    }

    if (saving) return; // Prevent double submission

    setSaving(true);
    setErrorMsg('');
    setSaveSuccessMsg('');

    const callerEmail = user?.email || '';
    const callerName = callerEmail.split('@')[0] || 'Staff';

    if (editingId) {
      // Update existing record (preserves original entry_date)
      const result = await telecallingService.updateEntry(editingId, {
        entry_date: editingOriginalDate || todayKolkataDate,
        company_name: cleanCompany,
        contact_person: contactPerson.trim() || null,
        phone: cleanPhone,
        other_phone: otherPhone.trim() || null,
        location: location.trim() || null,
        email: email.trim() || null,
        call_status: callStatus,
        feedback: cleanFeedback
      });

      setSaving(false);

      if (result.success && result.entry) {
        setSaveSuccessMsg(`Call record for "${cleanCompany}" updated successfully!`);
        setTodayEntries(prev => prev.map(item => item.id === editingId ? result.entry! : item));
        resetForm();
      } else {
        setErrorMsg(result.error || 'Failed to update telecalling entry. Please retry.');
      }
      return;
    }

    // NEW ENTRY: entry_date is STRICTLY determined at save time via getKolkataToday()
    const autoSaveDate = getKolkataToday();

    const result = await telecallingService.createEntry({
      company_id: companyId,
      entry_date: autoSaveDate,
      company_name: cleanCompany,
      contact_person: contactPerson.trim() || null,
      phone: cleanPhone,
      other_phone: otherPhone.trim() || null,
      location: location.trim() || null,
      email: email.trim() || null,
      call_status: callStatus,
      feedback: cleanFeedback,
      created_by: user?.id || null,
      created_by_email: callerEmail,
      created_by_name: callerName
    });

    setSaving(false);

    if (result.success && result.entry) {
      setSaveSuccessMsg(`Call record for "${cleanCompany}" saved successfully!`);
      // Prepend to today's list
      setTodayEntries(prev => [result.entry!, ...prev.filter(e => e.id !== result.entry!.id)]);

      if (andNew) {
        resetForm();
      } else {
        setTimeout(() => setSaveSuccessMsg(''), 4500);
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
      loadTodayEntries();
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Toggle Previous Calls Search Drawer */}
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            className="btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem',
              background: searchOpen ? '#eff6ff' : undefined,
              borderColor: searchOpen ? '#3b82f6' : undefined,
              color: searchOpen ? '#1d4ed8' : undefined
            }}
          >
            <History size={16} color={searchOpen ? '#1d4ed8' : '#64748b'} />
            <span>Search Previous Calls</span>
            {searchOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

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

      {/* Feature 8: Search Previous Telecalling Records Drawer */}
      {searchOpen && (
        <div style={{
          background: 'var(--bg-primary, #ffffff)',
          border: '1px solid #bfdbfe',
          borderRadius: '12px',
          padding: '1.25rem',
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.08)',
          marginBottom: '1.5rem',
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <History size={16} color="#2563eb" />
              Search Previous Telecalling History
            </h4>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Search across all historical telecalling data</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
              <input
                type="text"
                className="input-field"
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchHistory()}
                placeholder="Type Company name, Contact person, or Phone number..."
                style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}
              />
            </div>
            <button
              type="button"
              onClick={handleSearchHistory}
              disabled={searchingHistory || !historySearchQuery.trim()}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.55rem 1rem' }}
            >
              {searchingHistory ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
              <span>Search</span>
            </button>
            {hasSearched && (
              <button
                type="button"
                onClick={() => {
                  setHistorySearchQuery('');
                  setHistoryResults([]);
                  setHasSearched(false);
                }}
                className="btn-secondary"
                style={{ fontSize: '0.85rem', padding: '0.55rem 0.85rem' }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Search Results */}
          {searchingHistory ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
              <Loader2 className="spin" size={20} style={{ margin: '0 auto 0.5rem auto' }} />
              <p style={{ margin: 0, fontSize: '0.85rem' }}>Searching previous call records...</p>
            </div>
          ) : hasSearched && historyResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b', fontSize: '0.85rem', background: '#f8fafc', borderRadius: '8px' }}>
              No historical call records found matching "{historySearchQuery}".
            </div>
          ) : historyResults.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>
                Found {historyResults.length} matching previous record{historyResults.length > 1 ? 's' : ''}:
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '0.75rem',
                maxHeight: '380px',
                overflowY: 'auto',
                paddingRight: '4px'
              }}>
                {historyResults.map((rec) => {
                  const caller = rec.created_by_name || (rec.created_by_email ? rec.created_by_email.split('@')[0] : 'Staff');
                  return (
                    <div
                      key={rec.id}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '0.75rem',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        fontSize: '0.8rem'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                          <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{rec.company_name}</strong>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            background: rec.call_status === 'Appointment Confirmed' ? '#dcfce7' :
                                        rec.call_status === 'Interested / Details Shared' ? '#dbeafe' :
                                        rec.call_status === 'Follow-up Required' || rec.call_status === 'Call Back' ? '#fef3c7' :
                                        rec.call_status === 'No Interest' ? '#fee2e2' : '#f1f5f9',
                            color: rec.call_status === 'Appointment Confirmed' ? '#166534' :
                                   rec.call_status === 'Interested / Details Shared' ? '#1e40af' :
                                   rec.call_status === 'Follow-up Required' || rec.call_status === 'Call Back' ? '#92400e' :
                                   rec.call_status === 'No Interest' ? '#991b1b' : '#475569'
                          }}>
                            {rec.call_status}
                          </span>
                        </div>

                        {rec.contact_person && (
                          <div style={{ color: '#475569', marginTop: '0.2rem' }}>
                            Contact: <strong>{rec.contact_person}</strong>
                          </div>
                        )}

                        <div style={{ color: '#2563eb', fontWeight: 600, marginTop: '0.15rem' }}>
                          Phone: {rec.phone} {rec.other_phone ? ` / ${rec.other_phone}` : ''}
                        </div>

                        {rec.feedback && (
                          <div style={{
                            background: '#ffffff',
                            padding: '0.4rem',
                            borderRadius: '4px',
                            border: '1px solid #e2e8f0',
                            marginTop: '0.35rem',
                            fontSize: '0.75rem',
                            color: '#334155'
                          }}>
                            "{rec.feedback}"
                          </div>
                        )}
                      </div>

                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: '0.4rem',
                        borderTop: '1px solid #e2e8f0',
                        fontSize: '0.75rem',
                        color: '#64748b'
                      }}>
                        <span>
                          {formatKolkataDisplayDate(rec.entry_date)} • by {caller}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCallAgain(rec)}
                          className="btn-secondary"
                          style={{
                            padding: '2px 8px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#1d4ed8',
                            borderColor: '#93c5fd',
                            background: '#eff6ff'
                          }}
                        >
                          Call Again
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

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

      {/* Feature 6: Non-blocking Duplicate / Previous Call Warning */}
      {duplicateWarning && (
        <div style={{
          padding: '0.85rem 1rem',
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderLeft: '4px solid #d97706',
          borderRadius: '8px',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.6rem',
          fontSize: '0.85rem',
          color: '#92400e',
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flex: 1, minWidth: '240px' }}>
            <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 700 }}>
                Previous call record found for "{duplicateWarning.company_name}"
              </div>
              <div style={{ fontSize: '0.8rem', marginTop: '2px' }}>
                Last called on <strong>{formatKolkataDisplayDate(duplicateWarning.entry_date)}</strong> by{' '}
                <strong>{duplicateWarning.created_by_name || duplicateWarning.created_by_email?.split('@')[0] || 'Staff'}</strong>
                {' '}— Result: <strong style={{ color: '#b45309' }}>{duplicateWarning.call_status}</strong>
                {duplicateWarning.feedback ? ` ("${duplicateWarning.feedback}")` : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              type="button"
              onClick={() => handleCallAgain(duplicateWarning)}
              className="btn-secondary"
              style={{
                fontSize: '0.75rem',
                padding: '0.3rem 0.6rem',
                background: '#fef3c7',
                borderColor: '#f59e0b',
                color: '#92400e',
                fontWeight: 700
              }}
            >
              Prefill Form (Call Again)
            </button>
            <button
              type="button"
              onClick={() => setDuplicateDismissed(true)}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem', color: '#92400e' }}
            >
              Dismiss
            </button>
          </div>
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
            {editingOriginalDate && (
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                (Original Date: {formatKolkataDisplayDate(editingOriginalDate)})
              </span>
            )}
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
        {/* Automatic India / Kolkata Date Indicator Badge (No manual date editing) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '0.5rem 0.85rem',
          marginBottom: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#334155' }}>
            <Calendar size={16} color="#2563eb" />
            <span>
              Entry Date: <strong>{formatKolkataDisplayDate(todayKolkataDate)}</strong>
              {' '}<span style={{ fontSize: '0.75rem', color: '#64748b' }}>(Auto-assigned at save: Asia/Kolkata IST)</span>
            </span>
          </div>
          <span style={{
            fontSize: '0.75rem',
            background: '#dbeafe',
            color: '#1e40af',
            padding: '2px 8px',
            borderRadius: '999px',
            fontWeight: 700
          }}>
            IST Source of Truth
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          marginBottom: '1rem'
        }}>
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
                setDuplicateDismissed(false);
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
                setDuplicateDismissed(false);
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

        {/* Feedback / Remarks — EXPLICITLY MANDATORY */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Feedback / Remarks <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            className="input-field"
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
              if (errorMsg) setErrorMsg('');
            }}
            placeholder="e.g. Sent LED Van advertising details; will contact next week. Appointment confirmed with Mr. Syam."
            rows={2}
            required
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
            onClick={resetForm}
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
                  style={{ fontSize: '0.85rem', padding: '0.55rem 1rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.85rem',
                    padding: '0.55rem 1.25rem',
                    background: '#2563eb',
                    borderColor: '#2563eb'
                  }}
                >
                  {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  <span>Update Call Record</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                >
                  <Plus size={15} />
                  <span>Save &amp; Log Another</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="btn-primary"
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

      {/* Activity Log for Today */}
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
              Today's Call Log ({formatKolkataDisplayDate(todayKolkataDate)})
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

          <button onClick={loadTodayEntries} className="btn-ghost" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
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
            <p style={{ margin: 0, fontWeight: 600 }}>No telecalling entries recorded for today yet.</p>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem' }}>Enter a call above to start today's log.</p>
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
                          onClick={() => handleCallAgain(e)}
                          className="btn-ghost"
                          title="Call Again (prefill contact)"
                          style={{
                            padding: '0.25rem 0.4rem',
                            color: '#1d4ed8',
                            marginRight: '0.35rem',
                            background: '#eff6ff',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}
                        >
                          Call Again
                        </button>
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
            loadTodayEntries();
          }}
        />
      )}
    </div>
  );
};
