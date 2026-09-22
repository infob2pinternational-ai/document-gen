import React, { useState } from 'react';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { parseExcelTelecallingFile, type ExcelImportSummary } from '../../utils/excelImport';
import { telecallingService } from '../../services/telecallingService';
import { supabase } from '../../services/supabaseClient';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  user: any;
  onImportComplete?: () => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  companyId,
  user,
  onImportComplete
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [summary, setSummary] = useState<ExcelImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [importResults, setImportResults] = useState<{
    total: number;
    imported: number;
    duplicates: number;
    invalid: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setErrorMsg('');
    setSummary(null);
    setImportDone(false);
    setParsing(true);

    try {
      const buffer = await selected.arrayBuffer();

      // Query existing entry keys from Supabase to check for existing duplicates
      const existingKeys = new Set<string>();
      if (supabase && companyId) {
        const { data } = await supabase
          .from('telecalling_entries')
          .select('entry_date, phone, company_name')
          .eq('company_id', companyId);

        if (data) {
          for (const d of data) {
            const cleanPhone = (d.phone || '').replace(/\D/g, '');
            const key = `${d.entry_date}_${cleanPhone}_${(d.company_name || '').trim().toLowerCase()}`;
            existingKeys.add(key);
          }
        }
      }

      const parsed = await parseExcelTelecallingFile(buffer, existingKeys);
      setSummary(parsed);
    } catch (err: any) {
      console.error('Excel parse error:', err);
      setErrorMsg('Failed to parse Excel file: ' + (err.message || 'Invalid .xlsx format.'));
    } finally {
      setParsing(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!summary || !summary.rows.length || !companyId) return;

    setImporting(true);
    setImportProgress(0);
    setErrorMsg('');

    const validRows = summary.rows.filter(r => r.isValid && !r.isDuplicate);
    let importedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Batch insert in chunks of 25 for fast Supabase insertion
    const chunkSize = 25;
    const callerEmail = user?.email || '';
    const callerName = callerEmail.split('@')[0] || 'Admin';

    for (let i = 0; i < validRows.length; i += chunkSize) {
      const chunk = validRows.slice(i, i + chunkSize);
      const payloads = chunk.map(r => ({
        company_id: companyId,
        entry_date: r.date,
        company_name: r.companyName,
        contact_person: r.contactPerson || null,
        phone: r.phone,
        other_phone: r.otherPhone || null,
        location: r.location || null,
        email: r.email || null,
        call_status: r.callStatus,
        feedback: r.feedback || null,
        created_by: user?.id || null,
        created_by_email: callerEmail,
        created_by_name: callerName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      try {
        if (supabase) {
          const { data, error } = await supabase
            .from('telecalling_entries')
            .insert(payloads)
            .select('id, company_id, entry_date, company_name, phone, call_status');

          if (error) {
            throw error;
          }

          importedCount += chunk.length;

          // Enqueue each into google sync queue in background
          if (data) {
            for (const saved of data) {
              void telecallingService.enqueueGoogleSync(saved as any);
            }
          }
        } else {
          throw new Error('Supabase client not initialized.');
        }
      } catch (err: any) {
        console.error('Chunk import failed:', err);
        failedCount += chunk.length;
        errors.push(`Rows ${i + 1} to ${i + chunk.length}: ${err.message || 'Insert failed'}`);
      }

      setImportProgress(Math.min(100, Math.round(((i + chunk.length) / validRows.length) * 100)));
    }

    setImportResults({
      total: summary.totalRowsFound,
      imported: importedCount,
      duplicates: summary.duplicateRows,
      invalid: summary.invalidRows,
      failed: failedCount,
      errors
    });

    setImporting(false);
    setImportDone(true);
    if (onImportComplete) onImportComplete();
  };

  return (
    <div className="modal-overlay" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(5px)',
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
        maxWidth: '800px',
        width: '100%',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden',
        border: '1px solid var(--border-color, #e2e8f0)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
                Import Historical Telecalling Data (.xlsx)
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
                Upload manual spreadsheet to migrate calls into Supabase
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.35rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {errorMsg && (
            <div style={{
              padding: '0.85rem 1rem',
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
              <AlertCircle size={18} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Step 1: File selector */}
          {!importDone && (
            <div style={{
              border: '2px dashed var(--border-color, #cbd5e1)',
              borderRadius: '8px',
              padding: '2rem 1rem',
              textAlign: 'center',
              background: 'var(--bg-secondary, #f8fafc)',
              marginBottom: '1.5rem'
            }}>
              <input
                type="file"
                id="excel-file-input"
                accept=".xlsx"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <label htmlFor="excel-file-input" style={{ cursor: 'pointer', display: 'inline-block' }}>
                <Upload size={36} color="#3b82f6" style={{ margin: '0 auto 0.75rem auto' }} />
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                  {file ? file.name : 'Click to select Excel (.xlsx) file'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
                  Supports "Data" sheet with Date, Company, Phone, Location & Feedback columns
                </div>
              </label>
            </div>
          )}

          {parsing && (
            <div style={{ textAlign: 'center', padding: '1.5rem' }}>
              <Loader2 className="spin" size={28} style={{ margin: '0 auto 0.5rem auto', color: '#3b82f6' }} />
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Parsing Excel structure & categorizing statuses...</p>
            </div>
          )}

          {/* Step 2: Preview & Validation stats */}
          {summary && !importDone && (
            <div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.75rem',
                marginBottom: '1.25rem'
              }}>
                <div style={{ background: '#f1f5f9', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Found</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>{summary.totalRowsFound}</div>
                </div>
                <div style={{ background: '#dcfce7', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>Ready to Import</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#166534' }}>{summary.validRows}</div>
                </div>
                <div style={{ background: '#fef3c7', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 600, textTransform: 'uppercase' }}>Duplicates (Skip)</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#92400e' }}>{summary.duplicateRows}</div>
                </div>
                <div style={{ background: '#fee2e2', padding: '0.75rem', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600, textTransform: 'uppercase' }}>Invalid (Skip)</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#991b1b' }}>{summary.invalidRows}</div>
                </div>
              </div>

              {/* Sample preview table */}
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>Sample Records Preview (First 8 Rows):</h4>
              <div style={{ overflowX: 'auto', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '6px' }}>
                <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Company</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Phone</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Call Result</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Feedback</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center' }}>Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.slice(0, 8).map((r, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                        <td style={{ padding: '6px 8px' }}>{r.date}</td>
                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.companyName}</td>
                        <td style={{ padding: '6px 8px' }}>{r.phone}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            background: '#eff6ff',
                            color: '#1d4ed8'
                          }}>
                            {r.callStatus}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.feedback || '—'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          {r.isDuplicate ? (
                            <span style={{ color: '#d97706', fontWeight: 700 }}>Duplicate</span>
                          ) : !r.isValid ? (
                            <span style={{ color: '#ef4444', fontWeight: 700 }}>Invalid</span>
                          ) : (
                            <span style={{ color: '#16a34a', fontWeight: 700 }}>Valid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3: Progress indicator */}
          {importing && (
            <div style={{ textAlign: 'center', padding: '1.5rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Importing records into Supabase... {importProgress}%</div>
              <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${importProgress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s ease' }} />
              </div>
            </div>
          )}

          {/* Step 4: Final Summary */}
          {importDone && importResults && (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <CheckCircle2 size={48} color="#16a34a" style={{ margin: '0 auto 1rem auto' }} />
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: '#166534' }}>
                Migration Complete!
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Historical telecalling records have been imported as single source of truth.
              </p>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.75rem',
                marginBottom: '1.5rem'
              }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Total Processed</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{importResults.total}</div>
                </div>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#166534' }}>Successfully Saved</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#166534' }}>{importResults.imported}</div>
                </div>
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#92400e' }}>Duplicates Skipped</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#92400e' }}>{importResults.duplicates}</div>
                </div>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '0.75rem', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#991b1b' }}>Invalid / Failed</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#991b1b' }}>{importResults.invalid + importResults.failed}</div>
                </div>
              </div>

              {importResults.errors.length > 0 && (
                <div style={{ textAlign: 'left', background: '#fee2e2', padding: '0.75rem', borderRadius: '6px', fontSize: '0.8rem', color: '#991b1b' }}>
                  <strong>Errors Encountered:</strong>
                  <ul style={{ margin: '4px 0 0 16px' }}>
                    {importResults.errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          background: 'var(--bg-secondary, #f8fafc)',
          borderTop: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          flexShrink: 0
        }}>
          <button onClick={onClose} className="btn-secondary" disabled={importing}>
            {importDone ? 'Close' : 'Cancel'}
          </button>
          {!importDone && summary && summary.validRows > 0 && (
            <button
              onClick={handleExecuteImport}
              className="btn-primary"
              disabled={importing}
              style={{ background: '#2563eb', borderColor: '#2563eb' }}
            >
              {importing ? 'Importing...' : `Import ${summary.validRows} Records`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
