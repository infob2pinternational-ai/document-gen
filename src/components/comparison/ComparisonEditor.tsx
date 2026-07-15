import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document, Customer } from '../../types';
import type { 
  ComparisonColumn, 
  ComparisonOption, 
  ComparisonConfig, 
  ComparisonColumnType 
} from './ComparisonTypes';
import { ComparisonService } from './ComparisonService';
import { ComparisonTemplates } from './ComparisonTemplates';
import { 
  evaluateFormula, 
  calculateOptionTotal, 
  reorderColumns, 
  duplicateOption 
} from './ComparisonUtils';
import { dbService } from '../../services/db';
import { sendApprovalNotification } from '../../services/push';
import { 
  Plus, 
  Trash2, 
  ArrowLeft, 
  Save, 
  Sparkles, 
  Copy, 
  Settings, 
  Calendar, 
  User, 
  FileText, 
  Palette,
  EyeOff,
  FolderOpen
} from 'lucide-react';

interface ComparisonEditorProps {
  activeProfile: CompanyProfile;
  customers: Customer[];
  documents: Document[];
  documentToEdit: Document | null;
  onClose: () => void;
  onSaveSuccess: () => void;
}

const DEFAULT_COLUMNS: ComparisonColumn[] = [
  { id: 'col_particular', name: 'Particular', type: 'text', width: 220, visible: true },
  { id: 'col_qty', name: 'Qty', type: 'number', width: 80, visible: true },
  { id: 'col_rate', name: 'Rate', type: 'currency', width: 120, visible: true },
  { id: 'col_amount', name: 'Amount', type: 'formula', width: 140, visible: true, formulaConfig: { operator: 'multiply', colA: 'col_qty', colB: 'col_rate' } }
];

export const ComparisonEditor: React.FC<ComparisonEditorProps> = ({
  activeProfile,
  customers,
  documents,
  documentToEdit,
  onClose,
  onSaveSuccess
}) => {
  // Document Metadata States
  const [docNumber, setDocNumber] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState(activeProfile.default_terms || '');

  // Comparison Configuration States
  const [options, setOptions] = useState<ComparisonOption[]>([]);
  const [selectedOptionTabId, setSelectedOptionTabId] = useState('');
  const [layout, setLayout] = useState<'stacked' | 'side-by-side'>('stacked');
  const [selectedOptionIdForTotal, setSelectedOptionIdForTotal] = useState('');
  const [themeColor, setThemeColor] = useState('#2563eb'); // Default Blue

  // UI States
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [draggedColumnIndex, setDraggedColumnIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize Data
  useEffect(() => {
    if (documentToEdit) {
      // Edit mode: Load metadata
      setDocNumber(documentToEdit.document_number);
      setSelectedCustomerId(documentToEdit.customer_id || '');
      setCustomerName(documentToEdit.customer_name);
      setCustomerEmail(documentToEdit.customer_email || '');
      setCustomerPhone(documentToEdit.customer_phone || '');
      setCustomerAddress(documentToEdit.customer_address || '');
      setCustomerGstin(documentToEdit.customer_gstin || '');
      setDocDate(documentToEdit.date);
      setNotes(documentToEdit.notes || '');
      setTerms(documentToEdit.terms || '');

      // Load dynamic comparison options data
      ComparisonService.getComparisonData(documentToEdit.id)
        .then(data => {
          if (data) {
            setOptions(data.options);
            setLayout(data.layout);
            setSelectedOptionIdForTotal(data.selectedOptionId);
            setThemeColor(data.themeColor || '#2563eb');
            if (data.options.length > 0) {
              setSelectedOptionTabId(data.options[0].id);
            }
          } else {
            // Fallback to default option if data record is missing
            createDefaultOption();
          }
        })
        .catch(err => {
          console.error('Failed to load comparison options:', err);
          createDefaultOption();
        });
    } else {
      // Create mode: Auto generate quotation number
      const prefix = activeProfile.quotation_prefix || 'QTN/';
      const compDocs = documents.filter(d => d.company_id === activeProfile.id && d.document_type === 'comparison_quotation');
      const maxSeq = compDocs.reduce((max, d) => Math.max(max, d.sequence_number || 0), 0);
      const nextNum = (activeProfile.quotation_start_number || 1001) + maxSeq;
      setDocNumber(`${prefix}${String(nextNum).padStart(4, '0')}`);
      createDefaultOption();
    }
  }, [documentToEdit, activeProfile]);

  const createDefaultOption = () => {
    const optId = 'opt_' + Math.random().toString(36).substring(2, 9);
    const newOpt: ComparisonOption = {
      id: optId,
      name: 'Option A',
      heading: 'Standard Package',
      description: 'Default column configuration description',
      isRecommended: false,
      columns: [...DEFAULT_COLUMNS],
      rows: [
        { col_particular: 'Item Particular 1', col_qty: 1, col_rate: 100, col_amount: 100 },
        { col_particular: 'Item Particular 2', col_qty: 2, col_rate: 150, col_amount: 300 }
      ],
      sumColumnId: 'col_amount',
      totalLabel: 'Subtotal Amount',
      showTotal: true,
      totalValue: 400
    };
    setOptions([newOpt]);
    setSelectedOptionTabId(optId);
    setSelectedOptionIdForTotal(optId);
  };

  // Option Operations
  const handleAddOption = () => {
    const optId = 'opt_' + Math.random().toString(36).substring(2, 9);
    const newOpt: ComparisonOption = {
      id: optId,
      name: `Option ${String.fromCharCode(65 + options.length)}`,
      heading: 'Custom Option Package',
      description: 'Enter description of deliverables here.',
      isRecommended: false,
      columns: [...DEFAULT_COLUMNS],
      rows: [{ col_particular: '', col_qty: 1, col_rate: 0, col_amount: 0 }],
      sumColumnId: 'col_amount',
      totalLabel: 'Total',
      showTotal: true,
      totalValue: 0
    };
    setOptions([...options, newOpt]);
    setSelectedOptionTabId(optId);
  };

  const handleDuplicateOption = (opt: ComparisonOption) => {
    const duplicated = duplicateOption(opt);
    setOptions([...options, duplicated]);
    setSelectedOptionTabId(duplicated.id);
  };

  const handleDeleteOption = (id: string) => {
    if (options.length <= 1) {
      alert('A quotation must have at least one option.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this option?')) {
      const filtered = options.filter(o => o.id !== id);
      setOptions(filtered);
      if (selectedOptionTabId === id) {
        setSelectedOptionTabId(filtered[0].id);
      }
      if (selectedOptionIdForTotal === id) {
        setSelectedOptionIdForTotal(filtered[0].id);
      }
    }
  };

  const updateActiveOption = (updated: Partial<ComparisonOption>) => {
    setOptions(options.map(opt => {
      if (opt.id === selectedOptionTabId) {
        const nextOpt = { ...opt, ...updated };
        nextOpt.totalValue = calculateOptionTotal(nextOpt);
        return nextOpt;
      }
      return opt;
    }));
  };

  const activeOption = options.find(o => o.id === selectedOptionTabId) || options[0];

  // Customer selection helper
  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    const cust = customers.find(c => c.id === customerId);
    if (cust) {
      setCustomerName(cust.name);
      setCustomerEmail(cust.email || '');
      setCustomerPhone(cust.phone || '');
      setCustomerAddress(cust.address || '');
      setCustomerGstin(cust.gstin || '');
    } else {
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerGstin('');
    }
  };

  // Dynamic Column Operations
  const handleAddColumn = () => {
    const colName = prompt('Enter Column Header Name:');
    if (!colName) return;
    
    const types: ComparisonColumnType[] = ['text', 'number', 'currency', 'date', 'dropdown', 'remarks', 'formula'];
    const typeInput = prompt(`Enter Type (${types.join(', ')}):`, 'text');
    const colType = (typeInput?.toLowerCase() || 'text') as ComparisonColumnType;
    
    if (!types.includes(colType)) {
      alert('Invalid Column Type!');
      return;
    }

    const colId = 'col_' + Math.random().toString(36).substring(2, 9);
    const newCol: ComparisonColumn = {
      id: colId,
      name: colName,
      type: colType,
      width: colName.toLowerCase().includes('particular') || colType === 'remarks' ? 200 : 120,
      visible: true
    };

    if (colType === 'dropdown') {
      const opts = prompt('Enter comma-separated choices for dropdown:');
      if (opts) {
        newCol.dropdownOptions = opts.split(',').map(s => s.trim());
      }
    }

    if (colType === 'formula') {
      const numericCols = activeOption.columns.filter(c => ['number', 'currency', 'formula'].includes(c.type));
      if (numericCols.length < 2) {
        alert('You need at least 2 numeric/currency/formula columns to create a formula.');
        return;
      }
      const colAName = prompt(`Select Source Column A:\n${numericCols.map(c => c.name).join('\n')}`);
      const colBName = prompt(`Select Source Column B:\n${numericCols.map(c => c.name).join('\n')}`);
      
      const colA = numericCols.find(c => c.name.toLowerCase() === colAName?.toLowerCase());
      const colB = numericCols.find(c => c.name.toLowerCase() === colBName?.toLowerCase());

      if (!colA || !colB) {
        alert('Invalid source columns selected!');
        return;
      }

      newCol.formulaConfig = {
        operator: 'multiply',
        colA: colA.id,
        colB: colB.id
      };
    }

    const updatedCols = [...activeOption.columns, newCol];
    const updatedRows = activeOption.rows.map(row => ({ ...row, [colId]: '' }));
    
    updateActiveOption({ columns: updatedCols, rows: updatedRows });
  };

  const handleUpdateColumnConfig = (colId: string, updates: Partial<ComparisonColumn>) => {
    const nextCols = activeOption.columns.map(col => {
      if (col.id === colId) {
        return { ...col, ...updates };
      }
      return col;
    });

    // Recompute rows if formula configuration changed
    const nextRows = activeOption.rows.map(row => {
      const updatedRow = { ...row };
      nextCols.forEach(col => {
        if (col.type === 'formula') {
          updatedRow[col.id] = evaluateFormula(col, updatedRow);
        }
      });
      return updatedRow;
    });

    updateActiveOption({ columns: nextCols, rows: nextRows });
  };

  const handleDeleteColumn = (colId: string) => {
    if (activeOption.columns.length <= 1) {
      alert('Table must have at least one column.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this column? All data inside it will be lost.')) {
      const nextCols = activeOption.columns.filter(c => c.id !== colId);
      const nextRows = activeOption.rows.map(row => {
        const cloned = { ...row };
        delete cloned[colId];
        return cloned;
      });

      const nextSumCol = activeOption.sumColumnId === colId ? nextCols[0].id : activeOption.sumColumnId;

      updateActiveOption({ 
        columns: nextCols, 
        rows: nextRows, 
        sumColumnId: nextSumCol 
      });
    }
  };

  // Native Column Header Drag and Drop Event Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedColumnIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedColumnIndex === null || draggedColumnIndex === targetIndex) return;

    const nextCols = reorderColumns(activeOption.columns, draggedColumnIndex, targetIndex);
    updateActiveOption({ columns: nextCols });
    setDraggedColumnIndex(null);
  };

  // Row Operations
  const handleAddRow = () => {
    const newRow: Record<string, any> = {};
    activeOption.columns.forEach(col => {
      if (col.type === 'formula') {
        newRow[col.id] = 0;
      } else {
        newRow[col.id] = '';
      }
    });
    updateActiveOption({ rows: [...activeOption.rows, newRow] });
  };

  const handleDeleteRow = (idx: number) => {
    if (activeOption.rows.length <= 1) {
      alert('Table must have at least one row.');
      return;
    }
    const nextRows = activeOption.rows.filter((_, i) => i !== idx);
    updateActiveOption({ rows: nextRows });
  };

  const handleCellChange = (rowIdx: number, colId: string, value: any) => {
    const nextRows = activeOption.rows.map((row, i) => {
      if (i === rowIdx) {
        const updatedRow = { ...row, [colId]: value };
        // Recalculate formula columns in this row dynamically
        activeOption.columns.forEach(col => {
          if (col.type === 'formula') {
            updatedRow[col.id] = evaluateFormula(col, updatedRow);
          }
        });
        return updatedRow;
      }
      return row;
    });
    updateActiveOption({ rows: nextRows });
  };

  // Save Document Trigger
  const handleSaveDoc = async () => {
    if (!customerName) {
      alert('Please select or specify a Customer.');
      return;
    }

    setIsSaving(true);
    try {
      const selectedOption = options.find(o => o.id === selectedOptionIdForTotal) || options[0];
      const grandTotal = selectedOption.totalValue || 0;

      // 1. Save standard parent document metadata
      const documentPayload: Document = {
        id: documentToEdit ? documentToEdit.id : crypto.randomUUID(),
        company_id: activeProfile.id,
        document_type: 'comparison_quotation',
        document_number: docNumber,
        sequence_number: documentToEdit ? documentToEdit.sequence_number : documents.length + 1,
        customer_id: selectedCustomerId || undefined,
        customer_name: customerName,
        customer_email: customerEmail || undefined,
        customer_phone: customerPhone || undefined,
        customer_address: customerAddress || undefined,
        customer_gstin: customerGstin || undefined,
        date: docDate,
        subtotal: grandTotal,
        tax_total: 0,
        discount_total: 0,
        total: grandTotal,
        col_name_description: 'Description',
        col_name_quantity: 'Quantity',
        col_name_unit: 'Unit',
        col_name_rate: 'Rate',
        col_name_amount: 'Amount',
        notes: notes,
        terms: terms,
        status: documentToEdit ? documentToEdit.status : 'pending_approval'
      };

      // Save using base database service
      await dbService.saveDocument(documentPayload, []);

      // 2. Save dynamic comparison options data
      const comparisonConfig: ComparisonConfig = {
        layout,
        selectedOptionId: selectedOptionIdForTotal,
        options,
        themeColor,
        notes,
        terms
      };
      await ComparisonService.saveComparisonData(documentPayload.id, comparisonConfig);

      // 3. Dispatch FCM Push Notification asynchronously (fire-and-forget)
      const userStr = localStorage.getItem('supabase_user');
      const user = userStr ? JSON.parse(userStr) : null;
      const activeProfileWithUser = { ...activeProfile, user_id: user?.id };
      
      sendApprovalNotification(activeProfileWithUser, documentPayload).catch(pushErr => {
        console.error('[Push Trigger] Failed to send approval notification:', pushErr);
      });

      alert('Comparison Quotation saved successfully!');
      onSaveSuccess();
    } catch (err: any) {
      console.error(err);
      alert('Failed to save Comparison Quotation: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', paddingBottom: '3rem' }}>
      
      {/* Navbar Actions */}
      <div className="page-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '0.4rem', borderRadius: '4px' }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
              {documentToEdit ? 'Edit Comparison Quotation' : 'Create Comparison Quotation'}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
              Compare multiple packaging, packages, or services in a single dynamic table quotation.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            onClick={() => setTemplatesOpen(true)} 
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <FolderOpen size={16} />
            <span>Templates</span>
          </button>
          <button 
            onClick={handleSaveDoc} 
            className="btn-primary" 
            disabled={isSaving}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Save size={16} />
            <span>{isSaving ? 'Saving...' : 'Save Quotation'}</span>
          </button>
        </div>
      </div>

      {/* Editor Main Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem', alignItems: 'start' }}>
        
        {/* Left Side: Tables Builder */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Metadata Section */}
          <div className="card" style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <FileText size={12} />
                <span>Quotation Number</span>
              </label>
              <input
                type="text"
                className="text-input"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                style={{ fontFamily: 'monospace' }}
              />
            </div>
            <div>
              <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Calendar size={12} />
                <span>Date</span>
              </label>
              <input
                type="date"
                className="text-input"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
              />
            </div>
            <div>
              <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <User size={12} />
                <span>Select Customer</span>
              </label>
              <select
                className="text-input"
                value={selectedCustomerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
              >
                <option value="">-- Custom Write-in --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Customer Details Form (Collapsible/Editable) */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Customer Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              <div>
                <label className="input-label">Customer Name</label>
                <input
                  type="text"
                  className="text-input"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="input-label">Phone</label>
                <input
                  type="text"
                  className="text-input"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                />
              </div>
              <div>
                <label className="input-label">Email</label>
                <input
                  type="email"
                  className="text-input"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="e.g. customer@domain.com"
                />
              </div>
              <div>
                <label className="input-label">GSTIN</label>
                <input
                  type="text"
                  className="text-input"
                  value={customerGstin}
                  onChange={(e) => setCustomerGstin(e.target.value)}
                  placeholder="29AAAAA1111A1Z1"
                />
              </div>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <label className="input-label">Address</label>
              <textarea
                className="text-input"
                rows={2}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Full delivery/billing address..."
              />
            </div>
          </div>

          {/* Options Management Tab Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', paddingBottom: '2px' }}>
              {options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setSelectedOptionTabId(opt.id)}
                  style={{
                    padding: '0.75rem 1.25rem',
                    border: 'none',
                    background: 'transparent',
                    borderBottom: selectedOptionTabId === opt.id ? `3px solid ${themeColor}` : '3px solid transparent',
                    color: selectedOptionTabId === opt.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: selectedOptionTabId === opt.id ? 600 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.2s'
                  }}
                >
                  <span>{opt.name}</span>
                  {opt.isRecommended && (
                    <span style={{
                      fontSize: '0.6rem',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#fff',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '9999px',
                      fontWeight: 700
                    }}>
                      REC
                    </span>
                  )}
                </button>
              ))}
              <button 
                onClick={handleAddOption}
                className="btn-secondary"
                style={{ padding: '0.25rem 0.75rem', borderRadius: '4px', alignSelf: 'center', border: '1px dashed var(--border-color)', margin: '0.5rem' }}
              >
                <Plus size={14} />
                <span>Add Option</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', paddingBottom: '0.5rem' }}>
              <button
                onClick={() => handleDuplicateOption(activeOption)}
                className="btn-secondary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                title="Duplicate active option"
              >
                <Copy size={12} />
                <span>Duplicate</span>
              </button>
              <button
                onClick={() => handleDeleteOption(activeOption.id)}
                className="btn-secondary"
                style={{ padding: '0.4rem', color: 'var(--accent-danger)' }}
                title="Delete active option"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Active Option Editor */}
          <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Option Configuration Header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div>
                <label className="input-label">Option Tab Name</label>
                <input
                  type="text"
                  className="text-input"
                  value={activeOption.name}
                  onChange={(e) => updateActiveOption({ name: e.target.value })}
                />
              </div>
              <div>
                <label className="input-label">Custom Display Heading</label>
                <input
                  type="text"
                  className="text-input"
                  value={activeOption.heading}
                  onChange={(e) => updateActiveOption({ heading: e.target.value })}
                  placeholder="e.g. Option A - Standard Branding Layout"
                />
              </div>
              <div>
                <label className="input-label">Description (Deliverables)</label>
                <input
                  type="text"
                  className="text-input"
                  value={activeOption.description}
                  onChange={(e) => updateActiveOption({ description: e.target.value })}
                  placeholder="e.g. Includes full mockup design and vinyl print"
                />
              </div>
            </div>

            {/* Recommended & Total Display Flags */}
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={activeOption.isRecommended}
                  onChange={(e) => updateActiveOption({ isRecommended: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: themeColor }}
                />
                <span>Mark as Recommended Option</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={activeOption.showTotal}
                  onChange={(e) => updateActiveOption({ showTotal: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: themeColor }}
                />
                <span>Show Option Total Section</span>
              </label>

              {activeOption.showTotal && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Label:</span>
                  <input
                    type="text"
                    className="text-input"
                    value={activeOption.totalLabel}
                    onChange={(e) => updateActiveOption({ totalLabel: e.target.value })}
                    style={{ padding: '0.25rem 0.5rem', width: '150px' }}
                  />
                </div>
              )}
            </div>

            {/* Column builder control drawer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Dynamic Table Builder</h4>
              <button onClick={handleAddColumn} className="btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Plus size={14} />
                <span>Add Column</span>
              </button>
            </div>

            {/* Live Table Editor */}
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card)', borderBottom: '2px solid var(--border-color)' }}>
                    {activeOption.columns.map((col, idx) => (
                      <th
                        key={col.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, idx)}
                        style={{
                          padding: '0.75rem 0.5rem',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'grab',
                          minWidth: `${col.width}px`,
                          width: `${col.width}px`,
                          opacity: col.visible ? 1 : 0.45,
                          borderRight: '1px solid var(--border-color)',
                          position: 'relative'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span>{col.name}</span>
                            {!col.visible && <EyeOff size={10} style={{ color: 'var(--accent-danger)' }} />}
                          </span>
                          <div style={{ display: 'flex', gap: '0.1rem' }}>
                            <button
                              onClick={() => setEditingColumnId(editingColumnId === col.id ? null : col.id)}
                              style={{ border: 'none', background: 'transparent', padding: '0.15rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
                              title="Column Settings"
                            >
                              <Settings size={10} />
                            </button>
                            <button
                              onClick={() => handleDeleteColumn(col.id)}
                              style={{ border: 'none', background: 'transparent', padding: '0.15rem', cursor: 'pointer', color: 'var(--accent-danger)' }}
                              title="Delete Column"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>

                        {/* Column settings drop menu */}
                        {editingColumnId === col.id && (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 10,
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            padding: '0.75rem',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                            width: '200px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                            fontWeight: 'normal',
                            textAlign: 'left'
                          }}>
                            <div>
                              <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Rename Header</label>
                              <input
                                type="text"
                                className="text-input"
                                value={col.name}
                                onChange={(e) => handleUpdateColumnConfig(col.id, { name: e.target.value })}
                                style={{ padding: '0.25rem', fontSize: '0.75rem' }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.7rem', fontWeight: 600 }}>Width (px)</label>
                              <input
                                type="number"
                                className="text-input"
                                value={col.width}
                                onChange={(e) => handleUpdateColumnConfig(col.id, { width: parseInt(e.target.value) || 120 })}
                                style={{ padding: '0.25rem', fontSize: '0.75rem' }}
                              />
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                              <input
                                type="checkbox"
                                checked={col.visible}
                                onChange={(e) => handleUpdateColumnConfig(col.id, { visible: e.target.checked })}
                              />
                              <span>Visible in PDF</span>
                            </label>
                            <button onClick={() => setEditingColumnId(null)} className="btn-secondary" style={{ padding: '0.2rem', fontSize: '0.7rem', width: '100%' }}>
                              Done
                            </button>
                          </div>
                        )}
                      </th>
                    ))}
                    <th style={{ width: '40px', padding: '0.5rem' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activeOption.rows.map((row, rowIdx) => (
                    <tr key={rowIdx} style={{ borderBottom: '1px solid var(--border-color)', background: rowIdx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                      {activeOption.columns.map(col => {
                        const cellVal = row[col.id];
                        return (
                          <td 
                            key={col.id} 
                            style={{ 
                              padding: '0.5rem', 
                              borderRight: '1px solid var(--border-color)',
                              opacity: col.visible ? 1 : 0.45 
                            }}
                          >
                            {col.type === 'formula' ? (
                              <div style={{ 
                                padding: '0.5rem 0.75rem', 
                                background: 'rgba(0,0,0,0.03)', 
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                fontFamily: 'monospace',
                                fontWeight: 600,
                                fontSize: '0.85rem'
                              }}>
                                {col.type === 'formula' && col.formulaConfig?.operator === 'multiply' ? (
                                  <>
                                    {activeProfile.currency === 'INR' ? '₹' : '$'}
                                    {Number(cellVal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </>
                                ) : cellVal}
                              </div>
                            ) : col.type === 'dropdown' ? (
                              <select
                                className="text-input"
                                value={cellVal || ''}
                                onChange={(e) => handleCellChange(rowIdx, col.id, e.target.value)}
                                style={{ padding: '0.35rem', fontSize: '0.85rem' }}
                              >
                                <option value="">-- Select --</option>
                                {col.dropdownOptions?.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : col.type === 'date' ? (
                              <input
                                type="date"
                                className="text-input"
                                value={cellVal || ''}
                                onChange={(e) => handleCellChange(rowIdx, col.id, e.target.value)}
                                style={{ padding: '0.35rem', fontSize: '0.85rem' }}
                              />
                            ) : (
                              <input
                                type={col.type === 'number' || col.type === 'currency' ? 'number' : 'text'}
                                className="text-input"
                                value={cellVal === undefined ? '' : cellVal}
                                onChange={(e) => handleCellChange(rowIdx, col.id, e.target.value)}
                                style={{ 
                                  padding: '0.35rem', 
                                  fontSize: '0.85rem',
                                  fontFamily: col.type === 'number' || col.type === 'currency' ? 'monospace' : 'inherit'
                                }}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td style={{ padding: '0.25rem', textAlign: 'center' }}>
                        <button
                          onClick={() => handleDeleteRow(rowIdx)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent-danger)' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table Footer: Add Row, Select Sum Column, Option Total Display */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <button onClick={handleAddRow} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Plus size={14} />
                <span>Add Row</span>
              </button>

              {activeOption.showTotal && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {/* Select Sum Column */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Sum Column:</span>
                    <select
                      className="text-input"
                      value={activeOption.sumColumnId}
                      onChange={(e) => updateActiveOption({ sumColumnId: e.target.value })}
                      style={{ padding: '0.25rem', width: '130px', fontSize: '0.8rem' }}
                    >
                      {activeOption.columns.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Calculated Section Total Display */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', fontWeight: 700 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{activeOption.totalLabel}:</span>
                    <span style={{ color: themeColor, fontFamily: 'monospace' }}>
                      {activeProfile.currency === 'INR' ? '₹' : '$'}
                      {activeOption.totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Global Notes & Terms Card */}
          <div className="card" style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div>
              <label className="input-label">Notes (Visible to Customer)</label>
              <textarea
                className="text-input"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter any footnotes or descriptive remarks..."
              />
            </div>
            <div>
              <label className="input-label">Terms & Conditions</label>
              <textarea
                className="text-input"
                rows={3}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Specify timelines, payment options, guarantees..."
              />
            </div>
          </div>

        </div>

        {/* Right Side: Global Configurations & Sidebar Settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'sticky', top: '20px' }}>
          
          {/* Main Layout & PDF Settings */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Palette size={16} style={{ color: themeColor }} />
              <span>Layout & PDF Theme</span>
            </h3>

            {/* Layout switch Stacked vs Side-by-side */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label className="input-label">PDF Layout Mode</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', background: 'rgba(0,0,0,0.05)', padding: '2px', borderRadius: '6px' }}>
                <button
                  onClick={() => setLayout('stacked')}
                  style={{
                    padding: '0.4rem',
                    border: 'none',
                    borderRadius: '4px',
                    background: layout === 'stacked' ? 'var(--bg-card)' : 'transparent',
                    color: layout === 'stacked' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: layout === 'stacked' ? 600 : 500,
                    cursor: 'pointer',
                    fontSize: '0.75rem'
                  }}
                >
                  Stacked (Vertical)
                </button>
                <button
                  onClick={() => setLayout('side-by-side')}
                  style={{
                    padding: '0.4rem',
                    border: 'none',
                    borderRadius: '4px',
                    background: layout === 'side-by-side' ? 'var(--bg-card)' : 'transparent',
                    color: layout === 'side-by-side' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: layout === 'side-by-side' ? 600 : 500,
                    cursor: 'pointer',
                    fontSize: '0.75rem'
                  }}
                >
                  Side-by-Side (Grid)
                </button>
              </div>
            </div>

            {/* Theme color selectors */}
            <div style={{ marginBottom: '1rem' }}>
              <label className="input-label">Theme Accent Color</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#db2777'].map(color => (
                  <button
                    key={color}
                    onClick={() => setThemeColor(color)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: color,
                      border: themeColor === color ? '3px solid var(--text-primary)' : '2px solid transparent',
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Quotation Total Options */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Sparkles size={16} style={{ color: 'var(--accent-warning)' }} />
              <span>Quotation Total Source</span>
            </h3>
            
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 1rem 0', lineHeight: 1.4 }}>
              Select which comparison option total is used as the primary total for the quotation record.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {options.map(opt => (
                <label
                  key={opt.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    border: selectedOptionIdForTotal === opt.id ? `2px solid ${themeColor}` : '1px solid var(--border-color)',
                    background: selectedOptionIdForTotal === opt.id ? 'rgba(37, 99, 235, 0.03)' : 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="radio"
                      name="totalOption"
                      checked={selectedOptionIdForTotal === opt.id}
                      onChange={() => setSelectedOptionIdForTotal(opt.id)}
                      style={{ accentColor: themeColor }}
                    />
                    <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>{opt.name}</span>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.85rem' }}>
                    {activeProfile.currency === 'INR' ? '₹' : '$'}
                    {opt.totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </label>
              ))}
            </div>
          </div>

        </div>

      </div>

      {/* Templates popup manager */}
      {templatesOpen && (
        <ComparisonTemplates
          companyId={activeProfile.id}
          currentConfig={{
            layout,
            selectedOptionId: selectedOptionIdForTotal,
            options,
            themeColor,
            notes,
            terms
          }}
          onLoadTemplate={(config) => {
            if (config.options && config.options.length > 0) {
              setOptions(config.options);
              setLayout(config.layout);
              setSelectedOptionIdForTotal(config.selectedOptionId);
              setThemeColor(config.themeColor || '#2563eb');
              setSelectedOptionTabId(config.options[0].id);
              if (config.notes) setNotes(config.notes);
              if (config.terms) setTerms(config.terms);
            }
          }}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

    </div>
  );
};
