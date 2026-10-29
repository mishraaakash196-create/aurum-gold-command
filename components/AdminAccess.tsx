'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Archive, Download, KeyRound, LogIn, LogOut, ShieldCheck, Upload, X } from 'lucide-react'

export default function AdminAccess({ configured, authenticated, onSessionChange }: {
  configured: boolean
  authenticated: boolean
  onSessionChange: (authenticated: boolean, configured?: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Admin sign-in failed.')
      setPassword(''); onSessionChange(true, true); setMessage('Admin session active for up to eight hours.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Admin sign-in failed.') }
    finally { setBusy(false) }
  }

  async function signOut() {
    setBusy(true); setError(null)
    try {
      await fetch('/api/admin/session', { method: 'DELETE', cache: 'no-store' })
      onSessionChange(false)
      setMessage('Signed out. Dashboard is read-only.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-out failed.') }
    finally { setBusy(false) }
  }

  async function downloadBackup() {
    setBusy(true); setError(null); setMessage(null)
    try {
      const response = await fetch('/api/admin/backup', { cache: 'no-store' })
      if (!response.ok) throw new Error((await response.json()).error ?? 'Backup export failed.')
      const blob = await response.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `aurum-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(link.href)
      setMessage('Backup downloaded.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Backup export failed.') }
    finally { setBusy(false) }
  }

  async function restoreBackup(file: File | undefined) {
    if (!file) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const text = await file.text()
      if (!window.confirm('Restore this validated backup and replace the app’s current stored records? This cannot be undone.')) return
      const response = await fetch('/api/admin/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text, cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(`${result?.error ?? 'Restore failed.'}${Array.isArray(result?.details) ? ` ${result.details.join(' ')}` : ''}`)
      setMessage('Backup restored. Reload the dashboard to see restored records.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Backup restore failed.') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return <>
    <button type="button" className={`admin-access-button ${authenticated ? 'authenticated' : ''}`} onClick={() => { setOpen(true); setError(null) }} title={authenticated ? 'Admin controls and backup' : 'Read-only dashboard · administrator sign-in'}>
      {authenticated ? <ShieldCheck size={14} /> : <KeyRound size={14} />}<span>{authenticated ? 'ADMIN' : 'READ ONLY'}</span>
    </button>
    {open && <div className="drawer-scrim admin-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <aside className="admin-access-panel" role="dialog" aria-modal="true" aria-labelledby="admin-access-title">
        <div className="drawer-heading"><div><span className="drawer-kicker"><ShieldCheck size={13} /> SECURE APP CONTROLS</span><h2 id="admin-access-title">{authenticated ? 'Administrator access' : 'Read-only dashboard'}</h2><p>All persistent write routes are checked by the server; this browser never receives the admin password.</p></div><button type="button" className="drawer-close" onClick={() => setOpen(false)} aria-label="Close admin access"><X size={18} /></button></div>
        {!configured && <div className="drawer-error"><AlertCircle size={15} />Set ADMIN_PASSWORD in server environment variables to enable admin access.</div>}
        {!authenticated && configured && <form className="admin-login-form" onSubmit={(event) => void signIn(event)}><label>ADMIN PASSWORD<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="button button-primary" type="submit" disabled={busy}><LogIn size={14} />{busy ? 'Signing in…' : 'Sign in'}</button></form>}
        {authenticated && <div className="admin-tools"><div className="admin-status"><ShieldCheck size={16} /><span>Signed in · httpOnly session cookie · expires after 8 hours</span></div><div className="admin-backup-actions"><button className="button button-subtle" type="button" onClick={() => void downloadBackup()} disabled={busy}><Download size={14} />Export backup</button><button className="button button-subtle" type="button" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14} />Restore backup</button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void restoreBackup(event.target.files?.[0])} /></div><small className="admin-backup-note"><Archive size={12} /> Restore accepts validated AURUM version-1 backups up to 25 MiB. It replaces stored app data.</small><button className="button button-subtle admin-signout" type="button" onClick={() => void signOut()} disabled={busy}><LogOut size={14} />Sign out</button></div>}
        {error && <div className="drawer-error"><AlertCircle size={15} />{error}</div>}{message && <div className="settings-saved">{message}</div>}
      </aside>
    </div>}
  </>
}
