import React, { useState } from 'react';
import { supabase } from '../services/db';
import { KeyRound, Mail, ShieldAlert } from 'lucide-react';

interface AuthPanelProps {
  onAuthSuccess: (user: any) => void;
}

export const AuthPanel: React.FC<AuthPanelProps> = ({
  onAuthSuccess
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const role = 'user';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    
    setLoading(true);
    setError(null);
    
    try {
      if (authMode === 'login') {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (authError) throw authError;
        if (data?.user) {
          localStorage.setItem('supabase_user', JSON.stringify(data.user));
          onAuthSuccess(data.user);
        }
      } else if (authMode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              role
            }
          }
        });
        if (authError) throw authError;
        if (data?.user) {
          alert('Sign up successful! You can now log in.');
          setAuthMode('login');
        }
      } else if (authMode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (resetError) throw resetError;
        alert('Password reset link sent! Please check your email inbox.');
        setAuthMode('login');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      backgroundColor: 'var(--bg-canvas)'
    }}>
      <div className="card" style={{
        maxWidth: '450px',
        width: '100%',
        padding: '2.5rem',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-card)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'var(--accent-primary)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem auto'
          }}>
            <KeyRound size={24} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', fontWeight: 700 }}>
            {authMode === 'login' ? 'Welcome Back' : authMode === 'signup' ? 'Create Account' : 'Reset Password'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {authMode === 'login' 
              ? 'Log in to sync documents to Supabase Cloud' 
              : authMode === 'signup' 
                ? 'Sign up to secure your documents online' 
                : 'Enter your email to receive a password reset link'}
          </p>
        </div>

        {error && (
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            padding: '1rem',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--accent-danger)',
            color: 'var(--accent-danger)',
            fontSize: '0.875rem',
            marginBottom: '1.5rem'
          }}>
            <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label className="form-label" htmlFor="email">Email Address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{
                position: 'absolute',
                left: '0.875rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }} />
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{ paddingLeft: '2.5rem' }}
              />
            </div>
          </div>

          {authMode !== 'forgot' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
                {authMode === 'login' && (
                  <button
                    type="button"
                    onClick={() => setAuthMode('forgot')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: 500,
                      padding: 0,
                      marginBottom: '0.25rem'
                    }}
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <KeyRound size={16} style={{
                  position: 'absolute',
                  left: '0.875rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)'
                }} />
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ paddingLeft: '2.5rem' }}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
          >
            {loading ? 'Processing...' : authMode === 'login' ? 'Sign In' : authMode === 'signup' ? 'Register' : 'Send Reset Link'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          {authMode === 'forgot' ? (
            <button
              onClick={() => setAuthMode('login')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '0.875rem',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              Back to Login
            </button>
          ) : (
            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '0.875rem',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
