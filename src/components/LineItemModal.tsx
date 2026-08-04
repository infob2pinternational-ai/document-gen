import React, { useState, useEffect, useRef } from 'react';
import type { DocumentItem, Service } from '../types';
import { Search, X, Check, Calculator, Sparkles } from 'lucide-react';

export interface LineItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveItem: (item: DocumentItem) => void;
  itemToEdit?: DocumentItem | null;
  services: Service[];
  currency?: string;
  isTaxableDoc?: boolean;
  colDesc?: string;
  colQty?: string;
  colUnit?: string;
  colRate?: string;
}

export const LineItemModal: React.FC<LineItemModalProps> = ({
  isOpen,
  onClose,
  onSaveItem,
  itemToEdit,
  services = [],
  currency = 'INR',
  isTaxableDoc = true,
  colDesc = 'Service / Item Description',
  colQty = 'Quantity',
  colUnit = 'Unit',
  colRate = 'Rate'
}) => {
  // Form States
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [serviceSearchQuery, setServiceSearchQuery] = useState<string>('');
  const [isServiceDropdownOpen, setIsServiceDropdownOpen] = useState<boolean>(false);
  
  const [description, setDescription] = useState<string>('');
  const [hsnSac, setHsnSac] = useState<string>('');
  const [quantity, setQuantity] = useState<number | ''>(1);
  const [days, setDays] = useState<number | ''>(1);
  const [unit, setUnit] = useState<string>('Unit');
  const [rate, setRate] = useState<number | ''>('');
  const [gstPercentage, setGstPercentage] = useState<number>(18);
  
  // Discount States
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountPercent, setDiscountPercent] = useState<number | ''>('');
  const [discountAmount, setDiscountAmount] = useState<number | ''>('');

  const [notes, setNotes] = useState<string>('');

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Populate data on open or edit
  useEffect(() => {
    if (!isOpen) return;

    if (itemToEdit) {
      setSelectedServiceId(itemToEdit.service_id || '');
      const matchedSrv = services.find(s => s.id === itemToEdit.service_id);
      setServiceSearchQuery(matchedSrv ? matchedSrv.name : '');
      setDescription(itemToEdit.description || '');
      setHsnSac(itemToEdit.hsn_sac || '');
      setQuantity(itemToEdit.quantity ?? 1);
      setDays(itemToEdit.days ?? 1);
      setUnit(itemToEdit.unit || 'Unit');
      setRate(itemToEdit.rate ?? '');
      setGstPercentage(itemToEdit.gst_percentage ?? 18);
      setDiscountType(itemToEdit.discount_amount ? 'amount' : (itemToEdit.discount_percent ? 'percent' : 'percent'));
      setDiscountPercent(itemToEdit.discount_percent ?? '');
      setDiscountAmount(itemToEdit.discount_amount ?? '');
      setNotes('');
    } else {
      // Default reset
      setSelectedServiceId('');
      setServiceSearchQuery('');
      setDescription('');
      setHsnSac('');
      setQuantity(1);
      setDays(1);
      setUnit('Unit');
      setRate('');
      setGstPercentage(18);
      setDiscountType('percent');
      setDiscountPercent('');
      setDiscountAmount('');
      setNotes('');
    }

    // Auto-focus search input on open
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  }, [isOpen, itemToEdit, services]);

  // Click outside listener for command palette dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsServiceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);





  // Filtered services for command palette search
  const safeServices = Array.isArray(services) ? services : [];
  const queryLower = (serviceSearchQuery || '').toLowerCase().trim();

  const filteredServices = safeServices.filter(srv => {
    if (!srv) return false;
    const nameMatch = srv.name ? String(srv.name).toLowerCase().includes(queryLower) : false;
    const descMatch = srv.description ? String(srv.description).toLowerCase().includes(queryLower) : false;
    const hsnMatch = srv.hsn_sac ? String(srv.hsn_sac).toLowerCase().includes(queryLower) : false;
    return nameMatch || descMatch || hsnMatch;
  });

  const handleSelectService = (s: Service) => {
    setSelectedServiceId(s.id);
    setServiceSearchQuery(s.name);
    if (!description || description === s.name) {
      setDescription(s.name + (s.description ? `\n${s.description}` : ''));
    }
    if (s.hsn_sac) setHsnSac(s.hsn_sac);
    if (s.default_rate) setRate(s.default_rate);
    if (s.unit) setUnit(s.unit);
    if (s.gst_percentage !== undefined && isTaxableDoc) setGstPercentage(s.gst_percentage);
    setIsServiceDropdownOpen(false);
  };

  const handleClearService = () => {
    setSelectedServiceId('');
    setServiceSearchQuery('');
    setIsServiceDropdownOpen(false);
  };

  // Sync Discount Percent vs Amount
  const qtyNum = Number(quantity) || 0;
  const daysNum = Number(days) || 1;
  const effectiveQty = qtyNum * daysNum;
  const rateNum = Number(rate) || 0;
  const subtotal = effectiveQty * rateNum;

  const handleDiscountPercentChange = (val: number | '') => {
    setDiscountPercent(val);
    setDiscountType('percent');
    if (val === '' || subtotal === 0) {
      setDiscountAmount('');
    } else {
      const amt = (subtotal * Number(val)) / 100;
      setDiscountAmount(Number(amt.toFixed(2)));
    }
  };

  const handleDiscountAmountChange = (val: number | '') => {
    setDiscountAmount(val);
    setDiscountType('amount');
    if (val === '' || subtotal === 0) {
      setDiscountPercent('');
    } else {
      const pct = (Number(val) / subtotal) * 100;
      setDiscountPercent(Number(pct.toFixed(2)));
    }
  };

  // Calculations
  const calculatedDiscountAmount = discountType === 'amount'
    ? (Number(discountAmount) || 0)
    : (subtotal * (Number(discountPercent) || 0)) / 100;

  const taxableAmount = Math.max(0, subtotal - calculatedDiscountAmount);
  const gstAmount = isTaxableDoc ? (taxableAmount * (gstPercentage / 100)) : 0;
  const lineTotal = taxableAmount + gstAmount;

  // Validation Rules
  const isDescriptionValid = description.trim().length > 0;
  const isQtyValid = qtyNum > 0;
  const isRateValid = rateNum >= 0 && rate !== '';
  const isValid = isDescriptionValid && isQtyValid && isRateValid;

  const currSymbol = currency === 'INR' ? '₹' : (currency === 'USD' ? '$' : currency + ' ');

  const handleSave = () => {
    if (!isValid) return;

    // Append notes to description if provided
    let finalDesc = description.trim();
    if (notes.trim()) {
      finalDesc += `\n[Note: ${notes.trim()}]`;
    }

    const itemToSave: DocumentItem = {
      id: itemToEdit?.id || crypto.randomUUID(),
      document_id: itemToEdit?.document_id || '',
      service_id: selectedServiceId || undefined,
      description: finalDesc,
      hsn_sac: hsnSac.trim() || undefined,
      quantity: qtyNum,
      days: daysNum > 1 ? daysNum : undefined,
      unit: unit.trim() || 'Unit',
      rate: rateNum,
      gst_percentage: isTaxableDoc ? gstPercentage : 0,
      amount: subtotal, // Line Subtotal compatible with backend DB & PDF
      sort_order: itemToEdit?.sort_order ?? 0,
      discount_amount: calculatedDiscountAmount > 0 ? calculatedDiscountAmount : undefined,
      discount_percent: (calculatedDiscountAmount > 0 && Number(discountPercent) > 0) ? Number(discountPercent) : undefined
    };

    onSaveItem(itemToSave);
    onClose();
  };

  // Keyboard shortcut listener (Esc -> Close, Ctrl+Enter -> Save)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.ctrlKey && e.key === 'Enter') {
        if (isValid) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isValid]);

  if (!isOpen) return null;

  return (
    <div 
      className="line-item-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.2s ease forwards'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="line-item-modal-container card"
        style={{
          width: '1000px',
          maxWidth: '95vw',
          height: '720px',
          maxHeight: '92vh',
          backgroundColor: 'var(--bg-card, #1e293b)',
          border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideUpModal 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-canvas, #0f172a)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(37, 99, 235, 0.15)',
              color: 'var(--accent-primary, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Sparkles size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary, #ffffff)' }}>
                {itemToEdit ? 'Edit Line Item' : 'Add Line Item'}
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary, #94a3b8)' }}>
                {itemToEdit ? 'Update service specifications & rates' : 'Specify service details, pricing, and tax specifications'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn-secondary"
            style={{
              width: '32px',
              height: '32px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)'
            }}
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Content (Two Column Layout) */}
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 3fr)',
          overflow: 'hidden'
        }}>
          {/* LEFT SIDE (70%): Form Inputs */}
          <div style={{
            padding: '1.5rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            borderRight: '1px solid var(--border-color, rgba(255,255,255,0.1))'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-primary, #3b82f6)' }}>
                Service Information
              </h4>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>* Required fields</span>
            </div>

            {/* Searchable Service Dropdown / Command Palette */}
            <div className="form-group" style={{ position: 'relative' }} ref={dropdownRef}>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Search & Select Service Preset
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Type to search saved services (e.g. Web Development)..."
                  value={serviceSearchQuery}
                  onChange={(e) => {
                    setServiceSearchQuery(e.target.value);
                    setIsServiceDropdownOpen(true);
                  }}
                  onFocus={() => setIsServiceDropdownOpen(true)}
                  style={{
                    paddingLeft: '38px',
                    paddingRight: serviceSearchQuery ? '36px' : '12px',
                    height: '42px',
                    fontSize: '0.875rem'
                  }}
                />
                {serviceSearchQuery && (
                  <button
                    type="button"
                    onClick={handleClearService}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '2px'
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Command Palette Dropdown List */}
              {isServiceDropdownOpen && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  right: 0,
                  maxHeight: '220px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-card, #1e293b)',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                  borderRadius: '10px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
                  zIndex: 1000,
                  padding: '0.35rem'
                }}>
                  {filteredServices.length > 0 ? (
                    filteredServices.map(srv => (
                      <div
                        key={srv.id}
                        onClick={() => handleSelectService(srv)}
                        style={{
                          padding: '0.6rem 0.75rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: selectedServiceId === srv.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                          transition: 'background-color 0.15s ease'
                        }}
                        className="service-dropdown-item"
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                            {srv.name}
                          </div>
                          {srv.description && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {srv.description}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }} className="mono">
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-success)' }}>
                            {currSymbol}{Number(srv.default_rate || 0).toLocaleString('en-IN')}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                            /{srv.unit || 'Unit'}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                      No preset services matching "{serviceSearchQuery}". You can enter custom description below.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Description Textarea */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                {colDesc} *
              </label>
              <textarea
                placeholder="Enter item description, specifications, scope of work..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                style={{
                  fontSize: '0.875rem',
                  lineHeight: '1.5',
                  padding: '0.75rem',
                  resize: 'vertical'
                }}
              />
              {!isDescriptionValid && (
                <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '4px' }}>
                  Description is required.
                </span>
              )}
            </div>

            {/* Row 1: HSN Code, Quantity, Days, Unit */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  HSN / SAC Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. 998314"
                  value={hsnSac}
                  onChange={(e) => setHsnSac(e.target.value)}
                  style={{ height: '40px', fontSize: '0.85rem', textAlign: 'center' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  {colQty} *
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  placeholder="Qty"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  style={{ height: '40px', fontSize: '0.85rem', textAlign: 'center' }}
                />
                {!isQtyValid && (
                  <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '4px' }}>
                    Qty &gt; 0
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Days / Duration
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  placeholder="Days"
                  value={days}
                  onChange={(e) => setDays(e.target.value === '' ? '' : Number(e.target.value))}
                  style={{ height: '40px', fontSize: '0.85rem', textAlign: 'center' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  {colUnit}
                </label>
                <input
                  type="text"
                  placeholder="Unit (e.g. Nos, Days, Hrs)"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  style={{ height: '40px', fontSize: '0.85rem', textAlign: 'center' }}
                />
              </div>
            </div>

            {/* Row 2: Rate, Tax % */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  {colRate} ({currSymbol}) *
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {currSymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={rate}
                    onChange={(e) => setRate(e.target.value === '' ? '' : Number(e.target.value))}
                    style={{
                      paddingLeft: '28px',
                      height: '40px',
                      fontSize: '0.875rem',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      fontWeight: 600
                    }}
                  />
                </div>
                {!isRateValid && (
                  <span style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '4px' }}>
                    Rate is required
                  </span>
                )}
              </div>

              {isTaxableDoc ? (
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    Tax Rate (GST %)
                  </label>
                  <select
                    value={gstPercentage}
                    onChange={(e) => setGstPercentage(Number(e.target.value))}
                    style={{ height: '40px', fontSize: '0.85rem' }}
                  >
                    <option value={0}>0% (Exempt)</option>
                    <option value={5}>5% GST</option>
                    <option value={12}>12% GST</option>
                    <option value={18}>18% GST (Standard)</option>
                    <option value={28}>28% GST</option>
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    Tax Rate
                  </label>
                  <input
                    type="text"
                    disabled
                    value="Non-GST Profile (0%)"
                    style={{ height: '40px', fontSize: '0.85rem', background: 'var(--bg-canvas)', opacity: 0.7 }}
                  />
                </div>
              )}
            </div>

            {/* Row 3: Discount % and Discount Amount */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Discount (%)
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    placeholder="0"
                    value={discountPercent}
                    onChange={(e) => handleDiscountPercentChange(e.target.value === '' ? '' : Number(e.target.value))}
                    style={{
                      paddingRight: '28px',
                      height: '40px',
                      fontSize: '0.85rem',
                      textAlign: 'right'
                    }}
                  />
                  <span style={{ position: 'absolute', right: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    %
                  </span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  Discount Amount ({currSymbol})
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {currSymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={discountAmount}
                    onChange={(e) => handleDiscountAmountChange(e.target.value === '' ? '' : Number(e.target.value))}
                    style={{
                      paddingLeft: '28px',
                      height: '40px',
                      fontSize: '0.85rem',
                      textAlign: 'right',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Optional Notes */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Item Notes / Additional Terms (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Includes 1-year maintenance support"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ height: '38px', fontSize: '0.825rem' }}
              />
            </div>
          </div>

          {/* RIGHT SIDE (30%): Live Calculation Card */}
          <div style={{
            padding: '1.5rem',
            backgroundColor: 'var(--bg-canvas, #0f172a)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))'
              }}>
                <Calculator size={18} style={{ color: 'var(--accent-primary, #3b82f6)' }} />
                <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Live Item Summary
                </h4>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1.25rem' }}>
                {/* Quantity & Days */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span>Quantity & Duration:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {qtyNum} {unit} {daysNum > 1 ? `x ${daysNum} days` : ''}
                  </span>
                </div>

                {/* Rate */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span>Rate:</span>
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {currSymbol}{rateNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <hr style={{ border: 'none', borderTop: '1px dashed var(--border-color, rgba(255,255,255,0.15))', margin: '0.25rem 0' }} />

                {/* Subtotal */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span>Subtotal:</span>
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {currSymbol}{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Discount */}
                {calculatedDiscountAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#ef4444' }}>
                    <span>Discount:</span>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      - {currSymbol}{calculatedDiscountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                {/* Taxable Amount */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span>Taxable Amount:</span>
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {currSymbol}{taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {/* GST */}
                {isTaxableDoc && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <span>GST ({gstPercentage}%):</span>
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                      + {currSymbol}{gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-color, rgba(255,255,255,0.2))', margin: '0.5rem 0' }} />

                {/* LINE TOTAL */}
                <div style={{
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.25)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem'
                }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#22c55e' }}>
                    LINE ITEM TOTAL
                  </span>
                  <span className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#22c55e', lineHeight: 1.1 }}>
                    {currSymbol}{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Info Notice Card */}
            <div style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '10px',
              padding: '0.85rem',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.4
            }}>
              💡 This amount will be added to the document total after saving.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color, rgba(255,255,255,0.1))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-canvas, #0f172a)'
        }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Press <kbd style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)' }}>Ctrl</kbd> + <kbd style={{ padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)' }}>Enter</kbd> to save</span>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              style={{ padding: '0.55rem 1.25rem', fontSize: '0.85rem' }}
            >
              Cancel
            </button>
            
            <button
              type="button"
              onClick={handleSave}
              disabled={!isValid}
              className="btn-primary"
              style={{
                padding: '0.55rem 1.5rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                opacity: isValid ? 1 : 0.5,
                cursor: isValid ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <Check size={16} />
              <span>{itemToEdit ? 'Update Item' : 'Add Item'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
