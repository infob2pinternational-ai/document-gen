import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  telecallingService, 
  type ImportedLeadRow, 
  type ImportPreviewResult,
  mapRemarkToOutcome 
} from '../../services/telecallingService';
import { getAvailableStaffList } from '../../utils/staffUtils';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  AlertTriangle, 
  Check, 
  ArrowRight, 
  RotateCcw
} from 'lucide-react';
import JSZip from 'jszip';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (importedCount: number, activitiesCount: number) => void;
  currentUserEmail: string;
  companyId?: string;
}

/**
 * Robust CSV/TSV Parser that handles quoted multi-line cells and delimiters
 */
function parseDelimitedText(text: string): string[][] {
  const lines: string[][] = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.trim()) return lines;

  // Auto-detect delimiter from the first line
  const firstLine = clean.split('\n')[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = tabCount > commaCount && tabCount > semiCount ? '\t' : (semiCount > commaCount ? ';' : ',');

  let row: string[] = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(currentVal.trim());
      currentVal = '';
    } else if (char === '\n' && !inQuotes) {
      row.push(currentVal.trim());
      if (row.some(c => c !== '')) {
        lines.push(row);
      }
      row = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  if (currentVal || row.length > 0) {
    row.push(currentVal.trim());
    if (row.some(c => c !== '')) {
      lines.push(row);
    }
  }

  return lines;
}

function colLetterToIndex(colStr: string): number {
  let index = 0;
  for (let i = 0; i < colStr.length; i++) {
    index = index * 26 + (colStr.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Lightweight XLSX reader using JSZip (extracts sheet1.xml & sharedStrings.xml)
 */
async function parseXlsxFile(file: File): Promise<string[][]> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Load shared strings
  const sharedStrings: string[] = [];
  const sstFile = zip.file('xl/sharedStrings.xml');
  if (sstFile) {
    const sstXml = await sstFile.async('string');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(sstXml, 'text/xml');
    const siNodes = xmlDoc.getElementsByTagName('si');
    for (let i = 0; i < siNodes.length; i++) {
      sharedStrings.push(siNodes[i].textContent || '');
    }
  }

  // 2. Load worksheet sheet1
  const sheetFile = zip.file('xl/worksheets/sheet1.xml') || zip.file('xl/worksheets/sheet.xml');
  if (!sheetFile) {
    throw new Error('Could not find worksheet sheet1.xml inside Excel file.');
  }

  const sheetXml = await sheetFile.async('string');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(sheetXml, 'text/xml');
  const rowNodes = xmlDoc.getElementsByTagName('row');

  const rows: string[][] = [];

  for (let r = 0; r < rowNodes.length; r++) {
    const rowNode = rowNodes[r];
    const cNodes = rowNode.getElementsByTagName('c');
    const rowData: string[] = [];

    for (let c = 0; c < cNodes.length; c++) {
      const cNode = cNodes[c];
      const type = cNode.getAttribute('t');
      const cellRef = cNode.getAttribute('r') || '';
      const match = cellRef.match(/^([A-Z]+)(\d+)$/);
      let colIdx = c;
      if (match) {
        colIdx = colLetterToIndex(match[1]);
      }

      let val = '';
      if (type === 'inlineStr') {
        const isNode = cNode.getElementsByTagName('is')[0];
        val = isNode ? isNode.textContent || '' : '';
      } else {
        const vNode = cNode.getElementsByTagName('v')[0];
        val = vNode ? vNode.textContent || '' : '';
        if (type === 's') {
          const sIdx = parseInt(val, 10);
          if (!isNaN(sIdx) && sharedStrings[sIdx] !== undefined) {
            val = sharedStrings[sIdx];
          }
        }
      }

      rowData[colIdx] = val.trim();
    }

    // Fill any sparse column gaps with empty string
    for (let i = 0; i < rowData.length; i++) {
      if (rowData[i] === undefined) {
        rowData[i] = '';
      }
    }

    if (rowData.some(cell => cell !== '')) {
      rows.push(rowData);
    }
  }

  return rows;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  currentUserEmail,
  companyId
}) => {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [previewData, setPreviewData] = useState<ImportPreviewResult | null>(null);
  const [assignedTelecaller, setAssignedTelecaller] = useState<string>('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [importProgress, setImportProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const staffList = getAvailableStaffList(currentUserEmail);

  if (!isOpen) return null;

  const handleProcessRawRows = (rows: string[][]) => {
    if (!rows || rows.length < 2) {
      setErrorMsg('The file or text must have a header row and at least one data record.');
      return;
    }

    const headers = rows[0].map(h => h.trim().toLowerCase());

    // Smart Column Matchers
    const findIndex = (patterns: string[]): number => {
      return headers.findIndex(h => patterns.some(p => h.includes(p)));
    };

    const compIdx = findIndex(['company', 'firm', 'client', 'business', 'org', 'name']);
    const contactIdx = findIndex(['contact', 'person', 'owner', 'manager', 'customer']);
    const phoneIdx = findIndex(['primary phone', 'phone', 'mobile', 'cell', 'number', 'tel']);
    const altIdx = findIndex(['alt', 'secondary', 'whatsapp', 'other']);
    const emailIdx = findIndex(['email', 'mail']);
    const locIdx = findIndex(['location', 'city', 'place', 'address', 'area', 'district']);
    const dateIdx = findIndex(['date', 'created', 'time']);
    const remarkIdx = findIndex(['remark', 'feedback', 'status', 'notes', 'comment', 'result']);

    const leadRows: ImportedLeadRow[] = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every(cell => !cell.trim())) continue;

      const company = compIdx >= 0 && r[compIdx] ? r[compIdx].trim() : '';
      const contact = contactIdx >= 0 && r[contactIdx] ? r[contactIdx].trim() : '';
      const phone = phoneIdx >= 0 && r[phoneIdx] ? r[phoneIdx].trim() : '';
      const altPhone = altIdx >= 0 && r[altIdx] ? r[altIdx].trim() : '';
      const email = emailIdx >= 0 && r[emailIdx] ? r[emailIdx].trim() : '';
      const location = locIdx >= 0 && r[locIdx] ? r[locIdx].trim() : '';
      const date = dateIdx >= 0 && r[dateIdx] ? r[dateIdx].trim() : '';
      const remarks = remarkIdx >= 0 && r[remarkIdx] ? r[remarkIdx].trim() : '';

      // Skip row if completely lacking company and contact
      if (!company && !contact && !phone) continue;

      leadRows.push({
        company_name: company || contact || 'Unnamed Company',
        customer_name: contact || company || 'Contact Person',
        phone: phone || '—',
        alternate_phone: altPhone,
        email,
        location,
        date,
        remarks
      });
    }

    if (leadRows.length === 0) {
      setErrorMsg('No valid client records could be extracted from the data.');
      return;
    }

    const preview = telecallingService.previewExcelImport(leadRows);
    setPreviewData(preview);
    setErrorMsg('');
    setStep('preview');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setErrorMsg('');

    try {
      if (file.name.endsWith('.xlsx')) {
        const rows = await parseXlsxFile(file);
        handleProcessRawRows(rows);
      } else {
        const text = await file.text();
        const rows = parseDelimitedText(text);
        handleProcessRawRows(rows);
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      setErrorMsg(err.message || 'Failed to read file. Please ensure it is a valid .xlsx or .csv file.');
    }
  };

  const handlePasteProcess = () => {
    if (!pastedText.trim()) {
      setErrorMsg('Please paste your Excel or spreadsheet table data.');
      return;
    }
    const rows = parseDelimitedText(pastedText);
    handleProcessRawRows(rows);
  };

  const handleExecuteImport = async () => {
    if (!previewData) return;

    setStep('importing');
    setImportProgress(10);

    const rowsToExecute = skipDuplicates 
      ? previewData.newRows 
      : [...previewData.newRows, ...previewData.duplicateRows.map(d => d.row)];

    try {
      setImportProgress(40);
      const res = await telecallingService.executeExcelImport(rowsToExecute, {
        assignedTelecallerEmail: assignedTelecaller || undefined,
        companyId,
        importUserEmail: currentUserEmail,
        updateDuplicates: !skipDuplicates
      });

      setImportProgress(100);
      if (res.failedCount > 0) {
        const sampleErr = res.errors[0] ? `\n\nDetail: ${res.errors[0]}` : '';
        alert(`Import completed with partial warnings:\n• ${res.importedCount} records imported successfully.\n• ${res.failedCount} rows failed and were safely logged to system errors.${sampleErr}`);
      }
      setTimeout(() => {
        onImportSuccess(res.importedCount, res.activitiesCreated);
        onClose();
      }, 500);
    } catch (err: any) {
      alert(err.message || 'Import failed. Please try again.');
      setStep('preview');
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        padding: '1rem'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== 'importing') onClose();
      }}
    >
      <div
        className="glass-panel animate-scale-up"
        style={{
          width: '100%',
          maxWidth: '820px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-card)',
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          border: '1px solid var(--border-color)'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--glass-bg-subtle)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <FileSpreadsheet size={18} color="#10b981" />
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Operational Database Migration
              </span>
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              Import Companies & Feedback from Excel
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              Eliminates the Excel sheet. Converts historical feedback into immutable call activity logs.
            </p>
          </div>

          {step !== 'importing' && (
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
              style={{ padding: '0.45rem', borderRadius: '50%' }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {errorMsg && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              fontSize: '0.8125rem'
            }}>
              <AlertTriangle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* File Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '16px',
                  padding: '2.5rem 1.5rem',
                  textAlign: 'center',
                  background: 'var(--glass-bg-subtle)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx,.csv,.tsv,.txt"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <Upload size={38} color="var(--brand-blue)" style={{ margin: '0 auto 0.75rem auto', opacity: 0.8 }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {fileName ? `Selected: ${fileName}` : 'Click to select Excel (.xlsx) or CSV file'}
                </h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  Supports standard Excel columns: Company Name, Contact Person, Phone, Alternate Phone, Location, Date, Remarks.
                </p>
              </div>

              {/* Paste Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  OR COPY & PASTE FROM EXCEL
                </span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
              </div>

              {/* Textarea Paste */}
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.4rem' }}>
                  Paste rows directly from your Excel sheet (including headers)
                </label>
                <textarea
                  rows={6}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Company Name&#9;Contact Person&#9;Phone&#9;Location&#9;Feedback&#10;Brahmins&#9;Jaison&#9;9847012345&#9;Thrissur&#9;Spoke with owner. Interested&#10;Kitchen Treasure&#9;Mathew&#9;9847054321&#9;Kochi&#9;No answer"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.8125rem',
                    fontFamily: 'monospace',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-input, rgba(255,255,255,0.05))',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                    lineHeight: 1.4
                  }}
                />
              </div>

            </div>
          )}

          {step === 'preview' && previewData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Summary Stats Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Total Found in Sheet
                  </span>
                  <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                    {previewData.totalRows}
                  </div>
                </div>

                <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                  <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600, textTransform: 'uppercase' }}>
                    New Records to Import
                  </span>
                  <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981', marginTop: '0.15rem' }}>
                    {previewData.newRows.length}
                  </div>
                </div>

                <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: previewData.duplicateRows.length > 0 ? 'rgba(245, 158, 11, 0.08)' : 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.72rem', color: previewData.duplicateRows.length > 0 ? '#d97706' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Duplicates Detected
                  </span>
                  <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: previewData.duplicateRows.length > 0 ? '#f59e0b' : 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {previewData.duplicateRows.length}
                  </div>
                </div>
              </div>

              {/* Assignment & Duplicate Preferences */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
                padding: '1rem',
                borderRadius: '12px',
                background: 'var(--glass-bg-subtle)',
                border: '1px solid var(--border-color)'
              }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    Assign Imported Leads To:
                  </label>
                  <select
                    value={assignedTelecaller}
                    onChange={(e) => setAssignedTelecaller(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  >
                    <option value="">Leave Unassigned (Shared Pool)</option>
                    {staffList.map(s => (
                      <option key={s.email} value={s.email}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.35rem' }}>
                    Duplicate Handling:
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                    />
                    Skip {previewData.duplicateRows.length} duplicates (Recommended)
                  </label>
                </div>
              </div>

              {/* Preview Table */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Sample Extracted Records ({Math.min(previewData.newRows.length, 10)} of {previewData.newRows.length})
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Feedback converts into immutable activity timeline
                  </span>
                </div>

                <div className="table-responsive" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                  <table style={{ fontSize: '0.78rem' }}>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Contact</th>
                        <th>Phone</th>
                        <th>Location</th>
                        <th>Detected Outcome</th>
                        <th>Excel Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.newRows.slice(0, 10).map((row, idx) => {
                        const outcome = mapRemarkToOutcome(row.remarks);
                        return (
                          <tr key={idx}>
                            <td><strong>{row.company_name}</strong></td>
                            <td>{row.customer_name}</td>
                            <td className="mono">{row.phone}</td>
                            <td>{row.location || '—'}</td>
                            <td>
                              <span className="badge badge-info" style={{ fontSize: '0.6875rem' }}>
                                {outcome}
                              </span>
                            </td>
                            <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {row.remarks || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Duplicates notice */}
              {previewData.duplicateRows.length > 0 && (
                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)'
                }}>
                  <strong style={{ color: '#d97706' }}>{previewData.duplicateRows.length} duplicates detected</strong> based on phone or company name.
                  {skipDuplicates ? ' These rows will be safely skipped to avoid duplicates in CRM.' : ' These rows will be imported.'}
                </div>
              )}

            </div>
          )}

          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
              <div style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.1)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem auto'
              }}>
                <RotateCcw size={28} className="spin" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Importing Records into Database...
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                Generating CRM leads, preserving historical remarks as activities, and syncing cloud state.
              </p>
              
              <div style={{
                width: '100%',
                maxWidth: '400px',
                height: '8px',
                background: 'var(--border-color)',
                borderRadius: '9999px',
                margin: '1.5rem auto 0 auto',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${importProgress}%`,
                  height: '100%',
                  background: '#10b981',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        {step !== 'importing' && (
          <div style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--glass-bg-subtle)'
          }}>
            {step === 'upload' ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePasteProcess}
                  disabled={!pastedText.trim() && !fileName}
                  className="btn btn-primary"
                  style={{ gap: '0.4rem', fontWeight: 700 }}
                >
                  Preview Records <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="btn btn-secondary"
                  style={{ gap: '0.4rem' }}
                >
                  <RotateCcw size={14} /> Back to Upload
                </button>

                <button
                  type="button"
                  onClick={handleExecuteImport}
                  className="btn btn-primary"
                  style={{
                    gap: '0.45rem',
                    fontWeight: 700,
                    background: '#10b981',
                    borderColor: '#10b981',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                  }}
                >
                  <Check size={16} /> Import {skipDuplicates ? previewData?.newRows.length : previewData?.totalRows} Records
                </button>
              </>
            )}
          </div>
        )}

      </div>
    </div>,
    document.body
  );
};
