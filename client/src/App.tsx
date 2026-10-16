import { useCallback, useEffect, useState, type FormEvent } from 'react'
import './App.css'

type ServerState = 'checking' | 'online' | 'offline'

interface Campaign {
  id: string
  name: string
  description: string
  setting: string
  createdAt: string
}

interface CampaignForm {
  name: string
  description: string
  setting: string
}

interface ApiError {
  error?: string
  fields?: Record<string, string>
}

const API_URL = 'http://localhost:3001/api'
const emptyForm: CampaignForm = { name: '', description: '', setting: '' }

const navItems = [
  { label: 'Dashboard', icon: '⌂', active: true },
  { label: 'Campaigns', icon: '◈' },
  { label: 'Characters', icon: '♙' },
  { label: 'Settings', icon: '⚙' },
]

function App() {
  const [serverState, setServerState] = useState<ServerState>('checking')
  const [notice, setNotice] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [campaignsError, setCampaignsError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<CampaignForm>(emptyForm)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const checkServer = useCallback(async () => {
    setServerState('checking')
    try {
      const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error(`Health check returned ${response.status}`)
      setServerState('online')
    } catch {
      setServerState('offline')
    }
  }, [])

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    setCampaignsError('')
    try {
      const response = await fetch(`${API_URL}/campaigns`)
      const payload = await response.json() as { campaigns?: Campaign[]; error?: string }
      if (!response.ok) throw new Error(payload.error || `Could not load campaigns (${response.status}).`)
      setCampaigns(Array.isArray(payload.campaigns) ? payload.campaigns : [])
    } catch (error) {
      setCampaignsError(error instanceof Error ? error.message : 'Could not connect to the RealmForge server.')
    } finally {
      setCampaignsLoading(false)
    }
  }, [])

  useEffect(() => {
    void checkServer()
    void loadCampaigns()
  }, [checkServer, loadCampaigns])

  const openCampaignForm = () => {
    setForm(emptyForm)
    setFormErrors({})
    setSubmitError('')
    setFormOpen(true)
  }

  const submitCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setFormErrors({})
    setSubmitError('')

    try {
      const response = await fetch(`${API_URL}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = await response.json() as { campaign?: Campaign } & ApiError
      if (!response.ok) {
        if (payload.fields) setFormErrors(payload.fields)
        else setSubmitError(payload.error || `Could not save campaign (${response.status}).`)
        return
      }

      setFormOpen(false)
      setForm(emptyForm)
      await loadCampaigns()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not connect to the RealmForge server.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="RealmForge home">
          <span className="brand-mark" aria-hidden="true"><span>✦</span></span>
          <span className="brand-name">Realm<span>Forge</span></span>
        </a>

        <div className="nav-caption">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <a
              className={`nav-link${item.active ? ' active' : ''}`}
              href={item.active ? '#dashboard' : item.label === 'Campaigns' ? '#campaign-heading' : '#'}
              key={item.label}
              aria-current={item.active ? 'page' : undefined}
              onClick={(event) => {
                if (item.label === 'Campaigns') return
                if (!item.active) {
                  event.preventDefault()
                  setNotice(`${item.label} will be available in a future update.`)
                }
              }}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.label === 'Campaigns' && <span className="nav-count">{campaigns.length}</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          <div className="table-card">
            <div className="table-card-icon">♜</div>
            <div>
              <div className="table-card-title">Your table awaits</div>
              <div className="table-card-copy">Gather your party and begin.</div>
            </div>
            <span className="table-card-star">✧</span>
          </div>
          <div className="profile">
            <div className="avatar">A</div>
            <div className="profile-copy"><strong>Adventurer</strong><span>Dungeon Master</span></div>
            <span className="profile-more">···</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-divider">/</span><strong>Dashboard</strong></div>
          <div className={`server-status ${serverState}`} role="status" aria-live="polite">
            <span className="status-dot" />
            <span>{serverState === 'checking' ? 'Checking server' : serverState === 'online' ? 'Server online' : 'Server offline'}</span>
            {serverState === 'offline' && <button className="retry-button" onClick={() => void checkServer()}>Retry</button>}
          </div>
        </header>

        {notice && <div className="global-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}

        <div className="content-wrap">
          <section className="welcome-section">
            <div className="welcome-copy">
              <div className="eyebrow"><span className="eyebrow-line" />YOUR ADVENTURE STARTS HERE</div>
              <h1>Welcome, <em>Adventurer.</em></h1>
              <p>Your next great story is waiting to be told. Set the scene, gather your party, and let the legend begin.</p>
            </div>
            <div className="welcome-art" aria-hidden="true">
              <div className="moon-glow" />
              <div className="moon" />
              <div className="mountain mountain-back" />
              <div className="mountain mountain-front" />
              <div className="art-sigil">✦</div>
            </div>
          </section>

          <section className="campaign-section" aria-labelledby="campaign-heading">
            <div className="section-heading">
              <div>
                <div className="eyebrow small"><span className="eyebrow-line" />THE CHRONICLES</div>
                <h2 id="campaign-heading">Your Campaigns</h2>
              </div>
              <div className="section-actions">
                <span className="campaign-total">{campaigns.length} <span>CAMPAIGNS</span></span>
                <button className="section-create-button" onClick={openCampaignForm}>＋ <span>Create Campaign</span></button>
              </div>
            </div>

            {campaignsError ? (
              <div className="campaign-message error-panel" role="alert">
                <span>{campaignsError}</span>
                <button className="text-button" onClick={() => void loadCampaigns()}>Try again</button>
              </div>
            ) : campaignsLoading ? (
              <div className="campaign-message">Opening the campaign archive…</div>
            ) : campaigns.length === 0 ? (
              <div className="empty-state">
                <div className="empty-art" aria-hidden="true">
                  <div className="orbital orbital-one" /><div className="orbital orbital-two" />
                  <div className="book-shadow" />
                  <div className="spellbook"><span className="book-corner top-left" /><span className="book-corner top-right" /><span className="book-corner bottom-left" /><span className="book-corner bottom-right" /><span className="book-rune">✧</span><span className="book-line" /><span className="book-line short" /></div>
                  <span className="spark spark-one">✦</span><span className="spark spark-two">✧</span><span className="spark spark-three">·</span>
                </div>
                <div className="empty-copy">
                  <div className="empty-kicker">A BLANK PAGE. A THOUSAND POSSIBILITIES.</div>
                  <h3>No campaigns yet</h3>
                  <p>Every legend begins somewhere. Create your first campaign and give your next adventure a world of its own.</p>
                  <button className="create-button" onClick={openCampaignForm}><span className="button-plus">＋</span>Create Campaign<span className="button-arrow">↗</span></button>
                </div>
              </div>
            ) : (
              <div className="campaign-grid">
                {campaigns.map((campaign) => (
                  <article className="campaign-card" key={campaign.id}>
                    <div className="campaign-card-mark" aria-hidden="true">✦</div>
                    <div className="campaign-card-content">
                      <div className="campaign-card-meta">CAMPAIGN <span>·</span> {new Date(campaign.createdAt).toLocaleDateString()}</div>
                      <h3>{campaign.name}</h3>
                      {campaign.setting && <div className="campaign-setting">{campaign.setting}</div>}
                      <p>{campaign.description || 'A new adventure waits to be written.'}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <footer className="page-footer"><span>FORGED FOR ADVENTURE</span><span className="footer-sigil">✦</span><span>YOUR STORY, YOUR WORLD</span></footer>
        </div>
      </main>

      {formOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setFormOpen(false) }}>
          <section className="campaign-modal" role="dialog" aria-modal="true" aria-labelledby="form-heading">
            <button className="modal-close" onClick={() => setFormOpen(false)} aria-label="Close campaign form" disabled={submitting}>×</button>
            <div className="eyebrow small"><span className="eyebrow-line" />BEGIN A NEW CHRONICLE</div>
            <h2 id="form-heading">Create a Campaign</h2>
            <p className="modal-intro">Give your adventure a name, a world, and a place to begin.</p>
            <form onSubmit={(event) => void submitCampaign(event)} noValidate>
              <label className="form-field">
                <span>Campaign name <i>*</i></span>
                <input autoFocus maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} aria-invalid={Boolean(formErrors.name)} aria-describedby={formErrors.name ? 'name-error' : undefined} placeholder="The Shattered Crown" />
                {formErrors.name && <small id="name-error" className="field-error">{formErrors.name}</small>}
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea maxLength={2000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} aria-invalid={Boolean(formErrors.description)} aria-describedby={formErrors.description ? 'description-error' : undefined} placeholder="A brief glimpse of the adventure…" />
                {formErrors.description && <small id="description-error" className="field-error">{formErrors.description}</small>}
              </label>
              <label className="form-field">
                <span>Setting</span>
                <input maxLength={120} value={form.setting} onChange={(event) => setForm({ ...form, setting: event.target.value })} aria-invalid={Boolean(formErrors.setting)} aria-describedby={formErrors.setting ? 'setting-error' : undefined} placeholder="Forgotten Realms, homebrew…" />
                {formErrors.setting && <small id="setting-error" className="field-error">{formErrors.setting}</small>}
              </label>
              {submitError && <div className="form-error" role="alert">{submitError}</div>}
              <div className="modal-actions">
                <button className="cancel-button" type="button" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</button>
                <button className="create-button" type="submit" disabled={submitting}><span className="button-plus">＋</span>{submitting ? 'Creating…' : 'Create Campaign'}<span className="button-arrow">↗</span></button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
