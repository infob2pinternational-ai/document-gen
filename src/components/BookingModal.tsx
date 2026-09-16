import React, { useState, useEffect } from 'react';
import type { Booking, BookingStatus, Lead } from '../types';
import { officeService } from '../services/officeService';
import { X, Calendar, AlertTriangle } from 'lucide-react';

interface BookingModalProps {
  booking: Booking | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (b: Booking) => void;
  prefilledLead?: Lead | null;
  userEmail: string;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  booking,
  isOpen,
  onClose,
  onSaved,
  prefilledLead,
  userEmail
}) => {
  const [customerName, setCustomerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [driverOperator, setDriverOperator] = useState('');
  const [status, setStatus] = useState<BookingStatus>('CONFIRMED');
  const [notes, setNotes] = useState('');
  const [conflictError, setConflictError] = useState<string | null>(null);

  const resources = officeService.getResources();

  useEffect(() => {
    setConflictError(null);
    if (booking) {
      setCustomerName(booking.customer_name);
      setCompanyName(booking.company_name || '');
      setPhone(booking.customer_phone || '');
      setResourceId(booking.resource_id);
      setStartDate(booking.start_date);
      setEndDate(booking.end_date);
      setLocation(booking.location);
      setDriverOperator(booking.driver_or_operator || '');
      setStatus(booking.status);
      setNotes(booking.notes || '');
    } else if (prefilledLead) {
      setCustomerName(prefilledLead.customer_name);
      setCompanyName(prefilledLead.company_name || '');
      setPhone(prefilledLead.phone || '');
      // Auto-match resource category
      const matchedRes = resources.find(r => 
        prefilledLead.service_required?.toLowerCase().includes(r.category.toLowerCase()) ||
        r.name.toLowerCase().includes(prefilledLead.service_required?.toLowerCase() || '')
      ) || resources[0];
      setResourceId(matchedRes?.id || '');
      
      const reqDate = prefilledLead.required_date || new Date().toISOString().split('T')[0];
      setStartDate(reqDate);
      
      // Calculate end date based on duration
      const days = prefilledLead.number_of_days || 1;
      const d = new Date(reqDate);
      d.setDate(d.getDate() + days - 1);
      setEndDate(d.toISOString().split('T')[0]);
      
      setLocation(prefilledLead.campaign_location || prefilledLead.location || 'Kerala');
      setDriverOperator('');
      setStatus('CONFIRMED');
      setNotes(prefilledLead.notes || '');
    } else {
      setCustomerName('');
      setCompanyName('');
      setPhone('');
      setResourceId(resources[0]?.id || '');
      const today = new Date().toISOString().split('T')[0];
      setStartDate(today);
      setEndDate(today);
      setLocation('Thrissur');
      setDriverOperator('');
      setStatus('CONFIRMED');
      setNotes('');
    }
  }, [booking, prefilledLead, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConflictError(null);

    if (!customerName.trim()) {
      alert('Please enter Customer Name.');
      return;
    }
    if (!resourceId) {
      alert('Please select a Resource.');
      return;
    }
    if (!startDate || !endDate) {
      alert('Please select Start Date and End Date.');
      return;
    }
    if (endDate < startDate) {
      alert('End Date cannot be before Start Date.');
      return;
    }

    const res = await officeService.saveBooking({
      id: booking?.id,
      booking_number: booking?.booking_number,
      customer_name: customerName.trim(),
      company_name: companyName.trim() || undefined,
      customer_phone: phone.trim() || undefined,
      lead_id: booking?.lead_id || prefilledLead?.id,
      lead_number: booking?.lead_number || prefilledLead?.lead_number,
      resource_id: resourceId,
      start_date: startDate,
      end_date: endDate,
      location: location.trim() || 'Kerala',
      driver_or_operator: driverOperator.trim() || undefined,
      status,
      notes: notes.trim() || undefined
    }, userEmail);

    if (!res.success) {
      setConflictError(res.error || 'Resource conflict detected.');
      return;
    }

    if (res.booking) {
      onSaved(res.booking);
      onClose();
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1200 }}>
      <div className="modal-content animate-fade-in" style={{ maxWidth: '650px', width: '95%', padding: '1.75rem 2rem' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Calendar size={18} color="var(--accent-primary)" />
            {booking ? `Edit Booking ${booking.booking_number}` : 'Reserve Resource Booking'}
          </h3>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '0.35rem', border: 'none', background: 'transparent' }}>
            <X size={18} />
          </button>
        </div>

        {/* Conflict Error Alert */}
        {conflictError && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '2px solid #ef4444',
            borderRadius: 'var(--radius-sm)',
            padding: '0.85rem 1rem',
            color: '#ef4444',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem'
          }}>
            <AlertTriangle size={20} style={{ flexShrink: 0 }} />
            <div>
              <strong>RESOURCE UNAVAILABLE:</strong> {conflictError}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Resource Selector */}
          <div className="form-group">
            <label className="form-label" htmlFor="bk-res">Select Fleet / Equipment Resource *</label>
            <select
              id="bk-res"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              className="filter-select"
              style={{ width: '100%', fontSize: '0.9rem', padding: '0.5rem' }}
              required
            >
              {resources.map(r => (
                <option key={r.id} value={r.id}>
                  [{r.category}] {r.name} · ({r.location})
                </option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="bk-start">Start Date *</label>
              <input
                id="bk-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="bk-end">End Date *</label>
              <input
                id="bk-end"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Client Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="bk-cust">Customer Name *</label>
              <input
                id="bk-cust"
                type="text"
                required
                placeholder="e.g. Arun Kumar"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="bk-comp">Company Name</label>
              <input
                id="bk-comp"
                type="text"
                placeholder="e.g. Kerala Grand Events"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
          </div>

          {/* Location & Driver */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="bk-loc">Campaign Route / Location *</label>
              <input
                id="bk-loc"
                type="text"
                required
                placeholder="e.g. Thrissur Town, Guruvayur"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="bk-driver">Assigned Driver/Crew</label>
              <input
                id="bk-driver"
                type="text"
                placeholder="e.g. Suresh (Driver)"
                value={driverOperator}
                onChange={(e) => setDriverOperator(e.target.value)}
              />
            </div>
          </div>

          {/* Status */}
          <div className="form-group">
            <label className="form-label" htmlFor="bk-status">Booking Status</label>
            <select
              id="bk-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as BookingStatus)}
              className="filter-select"
              style={{ width: '100%' }}
            >
              <option value="CONFIRMED">CONFIRMED (Blocks availability)</option>
              <option value="TENTATIVE">TENTATIVE (Holds calendar slot)</option>
              <option value="COMPLETED">COMPLETED (Job done)</option>
              <option value="CANCELLED">CANCELLED (Releases slot)</option>
            </select>
          </div>

          {/* Notes */}
          <div className="form-group">
            <label className="form-label" htmlFor="bk-notes">Special Instructions & Route Details</label>
            <textarea
              id="bk-notes"
              rows={2}
              placeholder="Sound volume guidelines, generator fuel schedule, branding banner mounting..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {booking ? 'Update Booking' : 'Confirm Calendar Reservation'}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
