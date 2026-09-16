import React, { useState, useEffect } from 'react';
import type { Booking, BookingStatus, Resource } from '../types';
import { officeService } from '../services/officeService';
import { metricsService } from '../services/metricsService';
import { BookingModal } from './BookingModal';
import { 
  Plus, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Edit, 
  Trash2,
  AlertTriangle,
  Truck,
  Layers,
  Users
} from 'lucide-react';

interface BookingCalendarProps {
  role?: string;
  userEmail?: string;
  onOpenLead?: (leadId: string) => void;
}

const STATUS_CONFIG: Record<BookingStatus, { label: string; badgeClass: string; dotClass: string }> = {
  TENTATIVE: { label: 'TENTATIVE', badgeClass: 'badge-warning', dotClass: 'status-dot-warning' },
  CONFIRMED: { label: 'CONFIRMED', badgeClass: 'badge-danger', dotClass: 'status-dot-danger' },
  COMPLETED: { label: 'COMPLETED', badgeClass: 'badge-success', dotClass: 'status-dot-success' },
  CANCELLED: { label: 'CANCELLED', badgeClass: 'badge-neutral', dotClass: 'status-dot-neutral' }
};

export const BookingCalendar: React.FC<BookingCalendarProps> = ({
  userEmail = 'owner@b2p.com',
  onOpenLead: _onOpenLead
}) => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedResource, setSelectedResource] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  const refreshData = () => {
    setBookings(officeService.getBookings());
    setResources(officeService.getResources());
  };

  useEffect(() => {
    refreshData();
    const unsub = metricsService.subscribe(refreshData);
    return unsub;
  }, []);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleOpenAdd = () => {
    setEditingBooking(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (b: Booking) => {
    setEditingBooking(b);
    setModalOpen(true);
  };

  const handleDelete = async (id: string, bNum: string) => {
    if (window.confirm(`Delete booking ${bNum}? This will release the resource calendar slot.`)) {
      try {
        await officeService.deleteBooking(id);
        refreshData();
      } catch (err: any) {
        alert(err.message || 'Failed to delete booking.');
      }
    }
  };

  // Calendar calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Filtered Bookings
  const filteredBookings = bookings.filter(b => {
    const matchRes = selectedResource === 'all' || b.resource_id === selectedResource;
    const matchStatus = statusFilter === 'all' || b.status === statusFilter;
    const matchSearch = 
      b.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.company_name && b.company_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      b.resource_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.booking_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.location.toLowerCase().includes(searchTerm.toLowerCase());

    return matchRes && matchStatus && matchSearch;
  });

  const getBookingsForDay = (dayNum: number) => {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    return filteredBookings.filter(b => dayStr >= b.start_date && dayStr <= b.end_date);
  };

  const counts = metricsService.getBookingCounts();

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div className="glass-panel" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 1.5rem',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Fleet & Resource Booking Calendar
            </h1>
            <span className="badge badge-neutral">
              {filteredBookings.length} Scheduled
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Live scheduling and conflict prevention for LED Vans, LED Walls, and Lookwalker crews.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="btn-primary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
        >
          <Plus size={15} />
          <span>New Reservation</span>
        </button>
      </div>

      {/* Resource Category Availability Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '0.75rem'
      }}>
        {counts.resourceAvailability.map(resCat => {
          const icon = resCat.category === 'LED Van' ? <Truck size={16} color="var(--brand-blue)" /> :
                       resCat.category === 'LED Wall' ? <Layers size={16} color="#0284c7" /> :
                       <Users size={16} color="#7c3aed" />;
          return (
            <div
              key={resCat.category}
              className="glass-panel"
              style={{
                padding: '0.85rem 1.15rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {icon}
                <div>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, display: 'block', color: 'var(--text-primary)' }}>{resCat.category}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{resCat.activeBookings}/{resCat.totalUnits} Booked</span>
                </div>
              </div>
              <span className={`badge ${resCat.availableUnits > 0 ? 'badge-success' : 'badge-danger'}`}>
                {resCat.availableUnits} Available
              </span>
            </div>
          );
        })}

        {/* Conflicts Badge Card */}
        <div
          className="glass-panel"
          style={{
            padding: '0.85rem 1.15rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: counts.conflicts > 0 ? 'rgba(254, 242, 242, 0.9)' : 'rgba(255, 255, 255, 0.85)',
            borderColor: counts.conflicts > 0 ? '#fca5a5' : 'rgba(255, 255, 255, 0.85)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertTriangle size={16} color={counts.conflicts > 0 ? '#dc2626' : '#10b981'} />
            <div>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, display: 'block', color: counts.conflicts > 0 ? '#dc2626' : 'var(--text-primary)' }}>
                Resource Conflicts
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Overlapped fleet dates</span>
            </div>
          </div>
          <span className={`badge ${counts.conflicts > 0 ? 'badge-danger' : 'badge-success'}`}>
            {counts.conflicts > 0 ? `${counts.conflicts} CONFLICTS` : '0 Conflicts'}
          </span>
        </div>
      </div>

      {/* Resource Inventory Filter Pills */}
      <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.2rem' }}>
        <button
          type="button"
          onClick={() => setSelectedResource('all')}
          className={`btn-secondary ${selectedResource === 'all' ? 'active' : ''}`}
          style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', whiteSpace: 'nowrap' }}
        >
          All Fleet Units ({resources.length})
        </button>
        {resources.map(res => (
          <button
            key={res.id}
            type="button"
            onClick={() => setSelectedResource(res.id)}
            className={`btn-secondary ${selectedResource === res.id ? 'active' : ''}`}
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            {res.category === 'LED Van' && <Truck size={12} />}
            {res.category === 'LED Wall' && <Layers size={12} />}
            {res.category === 'Lookwalker' && <Users size={12} />}
            <span>{res.name}</span>
          </button>
        ))}
      </div>

      {/* Calendar Navigation & Status Filter Bar */}
      <div className="glass-panel" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.75rem 1.25rem'
      }}>
        {/* Month Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button onClick={handlePrevMonth} className="btn-secondary" style={{ padding: '0.35rem' }}>
            <ChevronLeft size={15} />
          </button>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, minWidth: '160px', textAlign: 'center', color: 'var(--text-primary)' }}>
            {monthNames[month]} {year}
          </h2>
          <button onClick={handleNextMonth} className="btn-secondary" style={{ padding: '0.35rem' }}>
            <ChevronRight size={15} />
          </button>
          <button onClick={() => setCurrentDate(new Date())} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
            Today
          </button>
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', width: '180px' }}
          >
            <option value="all">All Statuses ({counts.total})</option>
            <option value="TENTATIVE">Tentative ({counts.tentative})</option>
            <option value="CONFIRMED">Confirmed ({counts.confirmed})</option>
            <option value="COMPLETED">Completed ({counts.completed})</option>
            <option value="CANCELLED">Cancelled ({counts.cancelled})</option>
          </select>
        </div>
      </div>

      {/* Month Calendar Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '1px',
        background: 'var(--border-color)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden'
      }}>
        {/* Days of week header */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div
            key={d}
            style={{
              background: '#f8fafc',
              padding: '0.5rem',
              textAlign: 'center',
              fontWeight: 700,
              fontSize: '0.72rem',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase'
            }}
          >
            {d}
          </div>
        ))}

        {/* Empty cells before month start */}
        {Array.from({ length: firstDayIndex }).map((_, idx) => (
          <div key={`empty-${idx}`} style={{ background: '#ffffff', minHeight: '95px', opacity: 0.3 }} />
        ))}

        {/* Days in Month */}
        {Array.from({ length: daysInMonth }).map((_, idx) => {
          const dayNum = idx + 1;
          const dayBookings = getBookingsForDay(dayNum);
          const isToday = new Date().toDateString() === new Date(year, month, dayNum).toDateString();

          return (
            <div
              key={`day-${dayNum}`}
              style={{
                background: isToday ? '#eff6ff' : '#ffffff',
                minHeight: '100px',
                padding: '0.4rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem',
                position: 'relative'
              }}
            >
              {/* Day Number Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: isToday ? 800 : 600,
                  color: isToday ? '#ffffff' : 'var(--text-primary)',
                  background: isToday ? 'var(--brand-navy)' : 'transparent',
                  padding: isToday ? '0.05rem 0.35rem' : '0',
                  borderRadius: '3px'
                }}>
                  {dayNum}
                </span>
                {dayBookings.length > 0 && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {dayBookings.length} {dayBookings.length === 1 ? 'job' : 'jobs'}
                  </span>
                )}
              </div>

              {/* Booking Badges */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', overflowY: 'auto', maxHeight: '72px' }}>
                {dayBookings.map(b => {
                  return (
                    <div
                      key={b.id}
                      onClick={() => handleOpenEdit(b)}
                      title={`${b.booking_number} · ${b.customer_name}\n${b.resource_name}\n${b.location} (${b.start_date} to ${b.end_date})`}
                      style={{
                        background: b.status === 'CONFIRMED' ? '#fee2e2' : b.status === 'TENTATIVE' ? '#fef3c7' : '#f0fdf4',
                        borderLeft: b.status === 'CONFIRMED' ? '3px solid #dc2626' : b.status === 'TENTATIVE' ? '3px solid #d97706' : '3px solid #16a34a',
                        color: 'var(--text-primary)',
                        padding: '0.15rem 0.3rem',
                        borderRadius: '2px',
                        fontSize: '0.68rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      <strong>{b.customer_name.split(' ')[0]}</strong> · {b.resource_name.split(' ')[0]}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bookings Data Table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Scheduled Bookings List ({filteredBookings.length})
          </h3>
          <div style={{ position: 'relative', width: '260px' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search reservations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '2rem', fontSize: '0.8125rem' }}
            />
          </div>
        </div>

        <div className="table-container animate-fade-in">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: '110px' }}>Booking #</th>
                <th style={{ minWidth: '160px' }}>Customer & Company</th>
                <th style={{ minWidth: '150px' }}>Resource</th>
                <th style={{ minWidth: '100px' }}>Start Date</th>
                <th style={{ minWidth: '100px' }}>End Date</th>
                <th style={{ minWidth: '130px' }}>Location</th>
                <th style={{ minWidth: '120px' }}>Driver/Tech</th>
                <th style={{ minWidth: '110px' }}>Status</th>
                <th style={{ textAlign: 'right', minWidth: '80px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBookings.map(b => {
                const meta = STATUS_CONFIG[b.status] || STATUS_CONFIG.CONFIRMED;

                return (
                  <tr key={b.id} onClick={() => handleOpenEdit(b)} style={{ cursor: 'pointer' }}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--brand-navy)' }}>
                      {b.booking_number}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.customer_name}</div>
                      {b.company_name && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{b.company_name}</div>}
                    </td>
                    <td style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                      {b.resource_name}
                    </td>
                    <td className="mono" style={{ fontSize: '0.8125rem' }}>{b.start_date.split('-').reverse().join('/')}</td>
                    <td className="mono" style={{ fontSize: '0.8125rem' }}>{b.end_date.split('-').reverse().join('/')}</td>
                    <td style={{ fontSize: '0.8125rem' }}>{b.location}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{b.driver_or_operator || '—'}</td>
                    <td>
                      <span className={`badge ${meta.badgeClass}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => handleOpenEdit(b)} className="btn-ghost" style={{ padding: '0.3rem' }} title="Edit">
                          <Edit size={13} />
                        </button>
                        <button onClick={() => handleDelete(b.id, b.booking_number)} className="btn-ghost" style={{ padding: '0.3rem', color: 'var(--accent-danger)' }} title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Booking Modal */}
      {modalOpen && (
        <BookingModal
          booking={editingBooking}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={() => refreshData()}
          userEmail={userEmail}
        />
      )}

    </div>
  );
};
