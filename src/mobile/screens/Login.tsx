import React, { useState } from 'react';
import { supabase } from '../../services/db';

interface LoginProps {
  onLoggedIn: () => void;
}

/**
 * Reuses the exact same supabase.auth.signInWithPassword call the web
 * app's AuthPanel.tsx uses - same account, same session, no separate
 * login system. Only the UI is new (simplified for a single owner).
 */
export const Login: React.FC<LoginProps> = ({ onLoggedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }
    setLoading(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    onLoggedIn();
  };

  return (
    <div className="owner-shell" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
      <form onSubmit={handleLogin} style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', marginBottom: '0.5rem' }}>
          B2P Owner
        </h1>
        {error && (
          <div style={{ color: '#ef4444', fontSize: '0.85rem', textAlign: 'center' }}>{error}</div>
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={{ padding: '0.85rem', fontSize: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={{ padding: '0.85rem', fontSize: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        />
        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
          style={{ padding: '0.9rem', fontSize: '1rem', minHeight: '48px' }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
};
