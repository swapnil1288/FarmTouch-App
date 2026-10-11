'use client';
/* eslint-disable @next/next/no-img-element -- static logo */

import { useId, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, KeyRound, LoaderCircle, LogIn, ShieldCheck } from 'lucide-react';

async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return null;
    const d = (await r.json().catch(() => null)) as { error?: string } | null;
    return d?.error ?? `Server error (${r.status}). Please try again.`;
  } catch {
    return 'Network problem. Check your internet and try again.';
  }
}

function PasswordInput({ value, onChange, label, autoComplete }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="pw-input">
        <input id={id} type={show ? 'text' : 'password'} required value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      </span>
    </div>
  );
}

export default function LoginScreen({ needsSetup, setupLocked, platformEmail, portal = 'admin' }: { needsSetup: boolean; setupLocked: boolean; platformEmail: string | null; portal?: 'admin' | 'rider' }) {
  const [mode, setMode] = useState<'login' | 'setup'>(portal === 'admin' && needsSetup ? 'setup' : 'login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState({ code: '', name: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const err = await post('/api/admin/login', { login, password, portal });
    if (err) { setError(err); setBusy(false); return; }
    window.location.reload();
  }

  async function doSetup(e: React.FormEvent) {
    e.preventDefault();
    if (setup.password !== setup.confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    setError('');
    const err = await post('/api/admin/setup', { code: setup.code, name: setup.name, email: setup.email, phone: setup.phone, password: setup.password });
    if (err) { setError(err); setBusy(false); return; }
    window.location.reload();
  }

  return (
    <main className="adm-gate">
      <img src="/logo.jpg" alt="" width={72} height={72} />
      <h1>{mode === 'setup' ? 'Create the owner account' : 'Staff login'}</h1>
      <p>{mode === 'setup' ? 'First-time setup. This account will be the admin of Farm’s Touch.' : portal === 'rider' ? 'Sign in to see deliveries assigned to you.' : 'Farm’s Touch staff panel: orders, packing and deliveries.'}</p>
      {platformEmail && mode === 'login' && (
        <p className="small muted">You are signed in to the shop as <b>{platformEmail}</b>, which is not a staff account. Log in with your staff email or phone below.</p>
      )}

      {mode === 'login' ? (
        <form className="address-form login-card" onSubmit={doLogin}>
          <label>Email or mobile number<input required autoComplete="username" value={login} placeholder="you@example.com or 98XXXXXXXX" onChange={(e) => setLogin(e.target.value)} /></label>
          <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary block lg" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />} Log in</button>
          <p className="small muted">Forgot your password? Ask the owner to set a new one in <b>Staff</b>.</p>
          {portal === 'admin' && needsSetup && <button type="button" className="link" onClick={() => { setMode('setup'); setError(''); }}>First time? Create the owner account</button>}
        </form>
      ) : (
        <form className="address-form login-card" onSubmit={doSetup}>
          {setupLocked && (
            <p className="form-error" role="alert">
              Setup is locked. Add a secret <code>ADMIN_SETUP_CODE</code> to your settings (<code>.dev.vars</code> on your computer, or a Worker secret when hosted), restart, and enter the same code here.
            </p>
          )}
          <label>Setup code<input required value={setup.code} autoComplete="off" placeholder="The ADMIN_SETUP_CODE you chose" onChange={(e) => setSetup({ ...setup, code: e.target.value })} /></label>
          <label>Your name<input required value={setup.name} autoComplete="name" onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></label>
          <label>Email<input required type="email" value={setup.email} autoComplete="email" onChange={(e) => setSetup({ ...setup, email: e.target.value })} /></label>
          <label>Mobile (optional, can be used to log in)<input inputMode="numeric" maxLength={10} value={setup.phone} autoComplete="tel-national" onChange={(e) => setSetup({ ...setup, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></label>
          <PasswordInput label="Password (min 8 characters)" value={setup.password} onChange={(v) => setSetup({ ...setup, password: v })} autoComplete="new-password" />
          <PasswordInput label="Repeat password" value={setup.confirm} onChange={(v) => setSetup({ ...setup, confirm: v })} autoComplete="new-password" />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary block lg" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />} Create owner account</button>
          {!needsSetup ? null : <button type="button" className="link" onClick={() => { setMode('login'); setError(''); }}><KeyRound size={14} /> I already have an account</button>}
        </form>
      )}
      <Link className="link" href="/">← Back to the shop</Link>
    </main>
  );
}
