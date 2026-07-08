import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Customer, Service, Document, DocumentItem, DocumentType } from '../types';
import { dbService } from '../services/db';
import { ArrowLeft, Plus, Trash2, GripVertical, Save } from 'lucide-react';

interface DocumentEditorProps {
  activeProfile: CompanyProfile | null;
  documentToEdit: Document | null; // null if creating
  onClose: () => void;
  onRefreshDocs: () => void;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  activeProfile,
  documentToEdit,
  onClose,
  onRefreshDocs
}) => {
  // Database Libraries
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  // Main Document States
  const [docType, setDocType] = useState<DocumentType>('invoice');
  const [docNumber, setDocNumber] = useState('');
  const [sequenceNumber, setSequenceNumber] = useState<number>(1001);
  const [date, setDate] = useState('');

  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [discountTotal, setDiscountTotal] = useState<number>(0);

  // Customer Billing Details
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');

  // Editable Column Names
  const [colDesc, setColDesc] = useState('Description');
  const [colQty, setColQty] = useState('Quantity');
  const [colUnit, setColUnit] = useState('Unit');
  const [colRate, setColRate] = useState('Rate');
  const [colAmt, setColAmt] = useState('Amount');

  // Document Items
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Drag and Drop States
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Load Customers and Services libraries
  useEffect(() => {
    const loadLibraries = async () => {
      if (!activeProfile) return;
      try {
        const [cList, sList] = await Promise.all([
          dbService.getCustomers(activeProfile.id),
          dbService.getServices(activeProfile.id)
        ]);
        setCustomers(cList);
        setServices(sList);
      } catch (err) {
        console.error('Error loading libraries:', err);
      }
    };
    loadLibraries();
  }, [activeProfile]);

  // Set default sequences and values on Create
  useEffect(() => {
    if (!activeProfile) return;

    if (documentToEdit) {
      // Editing Mode
      const loadDocData = async () => {
        try {
          const res = await dbService.getDocumentById(documentToEdit.id);
          if (res) {
            const { document, items: docItems } = res;
            setDocType(document.document_type);
            setDocNumber(document.document_number);
            setSequenceNumber(document.sequence_number);
            setDate(document.date || '');

            setNotes(document.notes || '');
            setTerms(document.terms || '');
            setDiscountTotal(Number(document.discount_total));

            // Customer
            setSelectedCustomerId(document.customer_id || '');
            setCustomerName(document.customer_name);
            setCustomerEmail(document.customer_email || '');
            setCustomerPhone(document.customer_phone || '');
            setCustomerAddress(document.customer_address || '');
            setCustomerGstin(document.customer_gstin || '');

            // Columns
            setColDesc(document.col_name_description);
            setColQty(document.col_name_quantity);
            setColUnit(document.col_name_unit);
            setColRate(document.col_name_rate);
            setColAmt(document.col_name_amount);

            // Line items
            setItems(docItems);
          }
        } catch (err) {
          console.error('Error loading document details:', err);
          alert('Failed to load document details.');
        }
      };
      loadDocData();
    } else {
      // Create Mode
      const today = new Date().toISOString().split('T')[0];
      setDate(today);

      
      // Load column names from profile
      setColDesc(activeProfile.col_name_description || 'Description');
      setColQty(activeProfile.col_name_quantity || 'Quantity');
      setColUnit(activeProfile.col_name_unit || 'Unit');
      setColRate(activeProfile.col_name_rate || 'Rate');
      setColAmt(activeProfile.col_name_amount || 'Amount');

      setTerms(activeProfile.default_terms || '');
      setItems([]);
      setNotes('');
      setDiscountTotal(0);
      setSelectedCustomerId('');
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerGstin('');
      
      // Auto-sequence numbers
      generateSequenceNumber(docType);
    }
  }, [documentToEdit, activeProfile]);

  // Handle document type change -> update sequence
  useEffect(() => {
    if (!documentToEdit && activeProfile) {
      generateSequenceNumber(docType);
    }
  }, [docType]);

  // Sequence generator
  const generateSequenceNumber = async (type: DocumentType) => {
    if (!activeProfile) return;
    try {
      const allDocs = await dbService.getDocuments(activeProfile.id);
      const matchingDocs = allDocs.filter(d => d.document_type === type);
      
      let nextSeq = 1001;
      let prefix = 'INV/';

      if (type === 'invoice') {
        prefix = activeProfile.invoice_prefix;
        nextSeq = activeProfile.invoice_start_number;
      } else if (type === 'proforma_invoice') {
        prefix = activeProfile.proforma_prefix;
        nextSeq = activeProfile.proforma_start_number;
      } else if (type === 'quotation') {
        prefix = activeProfile.quotation_prefix;
        nextSeq = activeProfile.quotation_start_number;
      } else if (type === 'work_order') {
        prefix = activeProfile.work_order_prefix;
        nextSeq = activeProfile.work_order_start_number;
      }

      if (matchingDocs.length > 0) {
        // Find highest sequence number
        const maxSeq = Math.max(...matchingDocs.map(d => d.sequence_number), 0);
        if (maxSeq >= nextSeq) {
          nextSeq = maxSeq + 1;
        }
      }

      setSequenceNumber(nextSeq);
      setDocNumber(`${prefix}${nextSeq}`);
    } catch (err) {
      console.error('Error generating sequence:', err);
    }
  };



  // Customer dropdown select
  const handleCustomerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const custId = e.target.value;
    setSelectedCustomerId(custId);

    const cust = customers.find(c => c.id === custId);
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

  // Line item CRUD & Calculations
  const addLineItem = () => {
    const newItem: DocumentItem = {
      id: crypto.randomUUID(),
      document_id: documentToEdit?.id || '',
      description: '',
      quantity: 1,
      rate: 0,
      unit: 'nos',
      gst_percentage: 0,
      amount: 0,
      sort_order: items.length
    };
    setItems([...items, newItem]);
  };

  const removeLineItem = (index: number) => {
    const updated = items.filter((_, idx) => idx !== index);
    setItems(updated.map((item, idx) => ({ ...item, sort_order: idx })));
  };

  const handleItemChange = (index: number, field: keyof DocumentItem, value: any) => {
    const updated = [...items];
    const item = { ...updated[index] };

    if (field === 'service_id') {
      const srvId = value;
      item.service_id = srvId;
      const srv = services.find(s => s.id === srvId);
      if (srv) {
        item.description = srv.description ? `${srv.name} - ${srv.description}` : srv.name;
        item.rate = Number(srv.default_rate);
        item.unit = srv.unit;
        item.gst_percentage = Number(srv.gst_percentage);
      }
    } else {
      (item as any)[field] = value;
    }

    // Recalculate item amount
    if (field === 'quantity' || field === 'rate') {
      const q = field === 'quantity' ? Number(value) : item.quantity;
      const r = field === 'rate' ? Number(value) : item.rate;
      item.amount = q * r;
    } else {
      item.amount = item.quantity * item.rate;
    }

    updated[index] = item;
    setItems(updated);
  };

  // Totals calculations
  const calculateTotals = () => {
    let subtotal = 0;
    let taxTotal = 0;

    items.forEach(item => {
      const amt = item.amount || 0;
      const gstPercent = item.gst_percentage || 0;
      const gstAmt = amt * (gstPercent / 100);
      subtotal += amt;
      taxTotal += gstAmt;
    });

    const total = subtotal + taxTotal - (discountTotal || 0);

    return {
      subtotal,
      taxTotal,
      total
    };
  };

  const { subtotal, taxTotal, total } = calculateTotals();

  // Save Document
  const handleSaveDoc = async () => {
    if (!activeProfile) return;
    if (!customerName) {
      alert('Please specify a Customer Name.');
      return;
    }
    if (items.length === 0) {
      alert('Please add at least one line item.');
      return;
    }

    setLoading(true);
    try {
      const docId = documentToEdit?.id || crypto.randomUUID();

      // Check if this is a new customer and auto-save to CRM list if it doesn't exist
      let finalCustomerId = selectedCustomerId;
      if (customerName.trim()) {
        const customerExists = customers.some(c => c.name.trim().toLowerCase() === customerName.trim().toLowerCase());
        if (!customerExists) {
          const newCustId = crypto.randomUUID();
          const newCust: Customer = {
            id: newCustId,
            company_id: activeProfile.id,
            name: customerName.trim(),
            email: customerEmail.trim() || undefined,
            phone: customerPhone.trim() || undefined,
            address: customerAddress.trim() || undefined,
            gstin: customerGstin.trim() || undefined
          };
          await dbService.saveCustomer(newCust);
          finalCustomerId = newCustId;
        }
      }
      
      const docPayload: Document = {
        id: docId,
        company_id: activeProfile.id,
        document_type: docType,
        document_number: docNumber,
        sequence_number: sequenceNumber,
        customer_id: finalCustomerId || undefined,
        customer_name: customerName,
        customer_email: customerEmail || undefined,
        customer_phone: customerPhone || undefined,
        customer_address: customerAddress || undefined,
        customer_gstin: customerGstin || undefined,
        date,
        col_name_description: colDesc,
        col_name_quantity: colQty,
        col_name_unit: colUnit,
        col_name_rate: colRate,
        col_name_amount: colAmt,
        subtotal,
        tax_total: taxTotal,
        discount_total: discountTotal,
        total,
        notes,
        terms
      };

      // Map document_id to line items
      const itemsPayload = items.map(it => ({
        ...it,
        document_id: docId
      }));

      await dbService.saveDocument(docPayload, itemsPayload);

      // Trigger Google Sheets Auto-Save
      if (activeProfile.google_sheets_url) {
        const payloadForSheets = {
          company_name: activeProfile.name,
          document_number: docNumber,
          document_type: docType,
          customer_name: customerName,
          customer_gstin: customerGstin,
          date,
          subtotal,
          tax_total: taxTotal,
          discount_total: discountTotal,
          total,
          items: items.map(it => ({
            description: it.description,
            qty: it.quantity,
            unit: it.unit,
            rate: it.rate,
            amount: it.amount
          }))
        };

        fetch(activeProfile.google_sheets_url, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payloadForSheets)
        }).catch(err => console.error('Failed to auto-save to Google Sheet:', err));
      }

      onRefreshDocs();
      onClose();
    } catch (err) {
      console.error('Error saving document:', err);
      alert('Failed to save document.');
    } finally {
      setLoading(false);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (index: number) => {
    if (draggedIndex === null) return;
    const updated = [...items];
    const [removed] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, removed);
    
    setItems(updated.map((item, idx) => ({ ...item, sort_order: idx })));
    setDraggedIndex(null);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Editor Header */}
      <div className="editor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '0.5rem', borderRadius: '50%' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
              {documentToEdit ? `Edit ${docType.replace('_', ' ')}` : `Create ${docType.replace('_', ' ')}`}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '2px 0 0 0' }}>
              Sequence details and custom branding will be locked upon save.
            </p>
          </div>
        </div>

        <div className="editor-header-buttons">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSaveDoc} className="btn-primary" disabled={loading}>
            <Save size={16} />
            <span>{loading ? 'Saving...' : 'Save Document'}</span>
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="editor-layout">
        
        {/* Left Columns: Form Fields & Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Metadata Block */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Document Configuration</h3>
            
            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">Document Type</label>
                <select 
                  value={docType} 
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  disabled={!!documentToEdit} // cannot change type on edit
                >
                  <option value="invoice">Tax Invoice</option>
                  <option value="proforma_invoice">Proforma Invoice</option>
                  <option value="quotation">Quotation</option>
                  <option value="work_order">Work Order</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Document ID</label>
                <input 
                  type="text" 
                  value={docNumber} 
                  onChange={(e) => setDocNumber(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Document Date</label>
                <input 
                  type="date" 
                  value={date} 
                  onChange={(e) => setDate(e.target.value)} 
                />
              </div>
            </div>
          </div>

          {/* Line Items Matrix */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1rem' }}>Line Items Matrix</h3>
              <button onClick={addLineItem} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                <Plus size={14} />
                <span>Add Item</span>
              </button>
            </div>

            {/* Editable Columns Section */}
            <div className="rename-cols-grid">
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Desc Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colDesc} onChange={(e) => setColDesc(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Qty Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colQty} onChange={(e) => setColQty(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Unit Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colUnit} onChange={(e) => setColUnit(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Rate Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colRate} onChange={(e) => setColRate(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Amt Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colAmt} onChange={(e) => setColAmt(e.target.value)} />
              </div>
            </div>

            {/* Line items Table (Scrollable on mobile) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <div 
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      minWidth: '820px'
                    }}
                  >
                    <div style={{ cursor: 'grab', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                      <GripVertical size={16} />
                    </div>

                    {/* Pre-saved Service Selector Dropdown */}
                    <div style={{ width: '130px', flexShrink: 0 }}>
                      <select 
                        value={item.service_id || ''} 
                        onChange={(e) => handleItemChange(idx, 'service_id', e.target.value)}
                        style={{ padding: '0.4rem', fontSize: '0.75rem' }}
                      >
                        <option value="">-- Load Service --</option>
                        {services.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Description Input */}
                    <div style={{ flex: 1 }}>
                      <input 
                        type="text" 
                        placeholder={colDesc}
                        value={item.description} 
                        onChange={(e) => handleItemChange(idx, 'description', e.target.value)} 
                        style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                      />
                    </div>

                    {/* HSN/SAC Input */}
                    <div style={{ width: '80px' }}>
                      <input 
                        type="text" 
                        placeholder="HSN" 
                        value={item.hsn_sac || ''} 
                        onChange={(e) => handleItemChange(idx, 'hsn_sac', e.target.value)}
                        style={{ padding: '0.4rem', fontSize: '0.8rem', textAlign: 'center' }}
                      />
                    </div>

                    {/* Quantity Input */}
                    <div style={{ width: '60px' }}>
                      <input 
                        type="number" 
                        placeholder="Qty" 
                        value={item.quantity} 
                        onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                        style={{ padding: '0.4rem', fontSize: '0.8rem', textAlign: 'center' }}
                      />
                    </div>

                    {/* Unit Input */}
                    <div style={{ width: '60px' }}>
                      <input 
                        type="text" 
                        placeholder="Unit" 
                        value={item.unit} 
                        onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                        style={{ padding: '0.4rem', fontSize: '0.8rem', textAlign: 'center' }}
                      />
                    </div>

                    {/* Rate Input */}
                    <div style={{ width: '90px' }}>
                      <input 
                        type="number" 
                        placeholder="Rate" 
                        value={item.rate} 
                        onChange={(e) => handleItemChange(idx, 'rate', Number(e.target.value))}
                        style={{ padding: '0.4rem', fontSize: '0.8rem', textAlign: 'right' }}
                      />
                    </div>

                    {/* GST dropdown */}
                    <div style={{ width: '75px' }}>
                      <select 
                        value={item.gst_percentage} 
                        onChange={(e) => handleItemChange(idx, 'gst_percentage', Number(e.target.value))}
                        style={{ padding: '0.4rem', fontSize: '0.75rem' }}
                      >
                        <option value={0}>0%</option>
                        <option value={5}>5%</option>
                        <option value={12}>12%</option>
                        <option value={18}>18%</option>
                        <option value={28}>28%</option>
                      </select>
                    </div>

                    {/* Amount preview */}
                    <div className="mono" style={{ width: '90px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 600 }}>
                      {activeProfile?.currency === 'INR' ? '₹' : '$'}
                      {item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>

                    {/* Trash Action */}
                    <button 
                      onClick={() => removeLineItem(idx)}
                      className="btn-secondary"
                      style={{ padding: '0.4rem', color: 'var(--accent-danger)', border: 'none', background: 'transparent' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-canvas)', borderRadius: 'var(--radius-sm)' }}>
                  No items added yet. Click "Add Item" to add columns.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Customer selector, terms and summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Customer CRM Selector */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Customer Details</h3>
            
            <div className="form-group">
              <label className="form-label">Load Saved Customer</label>
              <select value={selectedCustomerId} onChange={handleCustomerChange}>
                <option value="">-- Choose Customer --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)' }} />

            <div className="form-group">
              <label className="form-label">Customer/Company Name *</label>
              <input 
                type="text" 
                value={customerName} 
                onChange={(e) => setCustomerName(e.target.value)} 
                placeholder="Billing Customer Name"
              />
            </div>

            <div className="form-group">
              <label className="form-label">GSTIN (Optional)</label>
              <input 
                type="text" 
                value={customerGstin} 
                onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())} 
                placeholder="07AAAAA1111A1Z1"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Billing Address</label>
              <textarea 
                value={customerAddress} 
                onChange={(e) => setCustomerAddress(e.target.value)} 
                placeholder="Customer Address..."
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input 
                type="email" 
                value={customerEmail} 
                onChange={(e) => setCustomerEmail(e.target.value)} 
                placeholder="customer@domain.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input 
                type="text" 
                value={customerPhone} 
                onChange={(e) => setCustomerPhone(e.target.value)} 
                placeholder="+91 99999 99999"
              />
            </div>
          </div>

          {/* Running Calculations and Totals */}
          <div className="card animate-fade-in" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            background: 'var(--bg-input)'
          }}>
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Financial Summary</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {activeProfile?.currency === 'INR' ? '₹' : '$'}
                {subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Calculated Tax (GST):</span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {activeProfile?.currency === 'INR' ? '₹' : '$'}
                {taxTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Apply Discount ({activeProfile?.currency})</label>
              <input 
                type="number" 
                value={discountTotal || ''} 
                onChange={(e) => setDiscountTotal(Number(e.target.value))} 
                placeholder="0.00"
                style={{ textAlign: 'right' }}
              />
            </div>

            <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>Grand Total:</span>
              <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                {activeProfile?.currency === 'INR' ? '₹' : '$'}
                {total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Terms & Notes */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Payment Terms / Period</label>
              <textarea 
                value={terms} 
                onChange={(e) => setTerms(e.target.value)} 
                placeholder="e.g. Net 15 days, 50% advance..."
                rows={2}
              />
            </div>
            
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Service Name & Period</label>
              <input 
                type="text"
                value={notes} 
                onChange={(e) => setNotes(e.target.value)} 
                placeholder="e.g. led van advertisement"
              />
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
