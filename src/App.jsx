import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'

const TYPES = [
  { id: 'url', label: 'URL' },
  { id: 'text', label: 'Text' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'wifi', label: 'Wi-Fi' },
]

const PRESETS = [
  { name: 'Classic', fg: '#000000', bg: '#ffffff' },
  { name: 'Ocean', fg: '#0b3d91', bg: '#e8f1ff' },
  { name: 'Forest', fg: '#14532d', bg: '#ecfdf3' },
  { name: 'Berry', fg: '#7a1850', bg: '#fdeef6' },
  { name: 'Ember', fg: '#7c2d12', bg: '#fff4e5' },
]

const EMPTY = {
  url: '', text: '', email: '', subject: '', body: '', phone: '',
  ssid: '', password: '', security: 'WPA', hidden: false,
}
const DEFAULT_STYLE = { size: 256, fg: '#000000', bg: '#ffffff', ecc: 'M', margin: 4 }
const STORE_KEY = 'qr-recent'

// ---- Step 1: validate input and build the string that goes into the QR ----
const escWifi = (s) => s.replace(/([\\;,:"])/g, '\\$1')

function build(type, f) {
  const errors = {}
  let data = null
  if (type === 'url') {
    const v = f.url.trim()
    if (!v) errors.url = 'Enter a URL, like example.com.'
    else {
      const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'https://' + v
      try {
        const u = new URL(full)
        if (!/^https?:$/.test(u.protocol)) errors.url = 'Only http and https links are supported.'
        else if (!u.hostname.includes('.') && u.hostname !== 'localhost') errors.url = 'Enter a full address, like example.com.'
        else data = full
      } catch { errors.url = 'This is not a valid URL.' }
    }
  } else if (type === 'text') {
    if (!f.text.trim()) errors.text = 'Enter some text.'
    else data = f.text
  } else if (type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errors.email = 'Enter a valid email address.'
    else {
      const q = []
      if (f.subject.trim()) q.push('subject=' + encodeURIComponent(f.subject.trim()))
      if (f.body.trim()) q.push('body=' + encodeURIComponent(f.body.trim()))
      data = 'mailto:' + f.email.trim() + (q.length ? '?' + q.join('&') : '')
    }
  } else if (type === 'phone') {
    const p = f.phone.replace(/[\s()-]/g, '')
    if (!/^\+?\d{6,15}$/.test(p)) errors.phone = 'Enter 6 to 15 digits. Start with + for a country code.'
    else data = 'tel:' + p
  } else if (type === 'wifi') {
    if (!f.ssid.trim()) errors.ssid = 'Enter the network name.'
    if (f.security !== 'nopass') {
      if (!f.password) errors.password = 'Enter the password.'
      else if (f.security === 'WPA' && f.password.length < 8) errors.password = 'WPA passwords need at least 8 characters.'
    }
    if (!Object.keys(errors).length) {
      data = `WIFI:T:${f.security};S:${escWifi(f.ssid)};` +
        (f.security === 'nopass' ? '' : `P:${escWifi(f.password)};`) +
        (f.hidden ? 'H:true;' : '') + ';'
    }
  }
  return { errors, data }
}

// ---- Step 2: scan reliability checks (WCAG luminance + contrast formulas) ----
const lum = (h) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
function warnings(data, s) {
  const w = []
  const c = contrast(s.fg, s.bg)
  if (c < 4) w.push(`Low contrast (${c.toFixed(1)}:1). Use at least 4:1 so scanners can read it.`)
  if (lum(s.fg) > lum(s.bg)) w.push('Light code on a dark background. Some scanners cannot read inverted codes.')
  if (s.margin < 2) w.push('Margin is very small. Scanners need a blank border (at least 2 to 4 modules).')
  if (s.size < 160) w.push('This size is small. Increase it for reliable scanning.')
  if (data && data.length > 200 && s.size < 256) w.push('Long content makes a dense code. Increase the size.')
  if (s.ecc === 'L') w.push('Error correction L tolerates almost no damage or smudging.')
  return w
}

const Field = ({ label, error, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {error && <small className="err" role="alert">{error}</small>}
  </label>
)

export default function App() {
  const canvasRef = useRef(null)
  const [type, setType] = useState('url')
  const [f, setF] = useState(EMPTY)
  const [touched, setTouched] = useState({})
  const [style, setStyle] = useState(DEFAULT_STYLE)
  const [genError, setGenError] = useState('')
  const [note, setNote] = useState('')
  const [recent, setRecent] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || [] } catch { return [] }
  })

  const { errors, data } = build(type, f)
  const warns = data ? warnings(data, style) : []

  // Persist recent codes so they survive a refresh
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(recent)) } catch { /* storage full or blocked */ }
  }, [recent])

  // Redraw the preview whenever the content or style changes
  useEffect(() => {
    if (!data || !canvasRef.current) { setGenError(''); return }
    QRCode.toCanvas(canvasRef.current, data, {
      width: style.size, margin: style.margin, errorCorrectionLevel: style.ecc,
      color: { dark: style.fg, light: style.bg },
    }).then(() => setGenError(''))
      .catch(() => setGenError('Too much content for a QR code. Shorten it or lower the error correction.'))
  }, [data, style])

  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setTouched((p) => ({ ...p, [k]: true })) }
  const touch = (k) => setTouched((p) => ({ ...p, [k]: true }))
  const inp = (k) => ({ value: f[k], onChange: (e) => set(k, e.target.value), onBlur: () => touch(k) })
  const err = (k) => (touched[k] ? errors[k] : '')
  const setS = (k, v) => setStyle((p) => ({ ...p, [k]: v }))
  const ready = data && !genError

  const flash = (m) => { setNote(m); setTimeout(() => setNote(''), 2000) }

  async function saveRecent() {
    const thumb = await QRCode.toDataURL(data, {
      width: 96, margin: 1, errorCorrectionLevel: style.ecc, color: { dark: style.fg, light: style.bg },
    })
    const entry = { id: Date.now(), type, f, style, thumb, label: data.slice(0, 40) }
    setRecent((p) => [entry, ...p.filter((r) => !(r.type === type && JSON.stringify(r.f) === JSON.stringify(f)))].slice(0, 8))
  }

  function download() {
    const a = document.createElement('a')
    a.href = canvasRef.current.toDataURL('image/png') // exactly what the preview shows
    a.download = `qr-${type}.png`
    a.click()
    saveRecent()
  }

  async function copy() {
    try {
      const blob = await new Promise((res) => canvasRef.current.toBlob(res))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      flash('Copied to clipboard')
    } catch { flash('Copy is not supported in this browser') }
  }

  function reuse(r) {
    setType(r.type); setF(r.f); setStyle(r.style); setTouched({})
  }

  return (
    <>
      <div className="bar" />
      <main>
        <header>
          <h1>QR code designer</h1>
          <p className="tagline">A project made for the GDG Recruitment Process</p>
          <p>Create, style and download QR codes. Everything runs in your browser.</p>
        </header>

        <div className="layout">
          <section className="panel">
            <div className="tabs" role="tablist">
              {TYPES.map((t) => (
                <button key={t.id} role="tab" aria-selected={type === t.id}
                  className={type === t.id ? 'tab on' : 'tab'}
                  onClick={() => { setType(t.id); setTouched({}) }}>{t.label}</button>
              ))}
            </div>

            {type === 'url' && (
              <Field label="Website address" error={err('url')}>
                <input type="text" placeholder="example.com" {...inp('url')} />
              </Field>
            )}
            {type === 'text' && (
              <Field label="Text" error={err('text')}>
                <textarea rows="4" placeholder="Type anything" {...inp('text')} />
              </Field>
            )}
            {type === 'email' && (
              <>
                <Field label="Email address" error={err('email')}>
                  <input type="email" placeholder="name@example.com" {...inp('email')} />
                </Field>
                <Field label="Subject (optional)"><input type="text" {...inp('subject')} /></Field>
                <Field label="Message (optional)"><textarea rows="3" {...inp('body')} /></Field>
              </>
            )}
            {type === 'phone' && (
              <Field label="Phone number" error={err('phone')}>
                <input type="tel" placeholder="+91 98765 43210" {...inp('phone')} />
              </Field>
            )}
            {type === 'wifi' && (
              <>
                <Field label="Network name" error={err('ssid')}><input type="text" {...inp('ssid')} /></Field>
                <Field label="Security">
                  <select value={f.security} onChange={(e) => set('security', e.target.value)}>
                    <option value="WPA">WPA/WPA2</option>
                    <option value="WEP">WEP</option>
                    <option value="nopass">No password</option>
                  </select>
                </Field>
                {f.security !== 'nopass' && (
                  <Field label="Password" error={err('password')}><input type="text" {...inp('password')} /></Field>
                )}
                <label className="check">
                  <input type="checkbox" checked={f.hidden} onChange={(e) => set('hidden', e.target.checked)} />
                  Hidden network
                </label>
              </>
            )}

            <h2>Style</h2>
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.name} className={style.fg === p.fg && style.bg === p.bg ? 'preset on' : 'preset'}
                  onClick={() => setStyle((s) => ({ ...s, fg: p.fg, bg: p.bg }))}>
                  <i style={{ background: p.bg, color: p.fg }}>QR</i>{p.name}
                </button>
              ))}
            </div>

            <div className="grid2">
              <Field label="Code color"><input type="color" value={style.fg} onChange={(e) => setS('fg', e.target.value)} /></Field>
              <Field label="Background"><input type="color" value={style.bg} onChange={(e) => setS('bg', e.target.value)} /></Field>
            </div>
            <Field label={`Size: ${style.size}px`}>
              <input type="range" min="128" max="512" step="8" value={style.size} onChange={(e) => setS('size', +e.target.value)} />
            </Field>
            <Field label={`Margin: ${style.margin} modules`}>
              <input type="range" min="0" max="10" value={style.margin} onChange={(e) => setS('margin', +e.target.value)} />
            </Field>
            <Field label="Error correction">
              <select value={style.ecc} onChange={(e) => setS('ecc', e.target.value)}>
                <option value="L">Low (7%)</option>
                <option value="M">Medium (15%)</option>
                <option value="Q">Quartile (25%)</option>
                <option value="H">High (30%)</option>
              </select>
            </Field>
          </section>

          <section className="panel preview">
            <h2>Preview</h2>
            <div className="stage">
              <canvas ref={canvasRef} className={ready ? '' : 'hide'} />
              {!ready && <p className="empty">{genError || 'Fill in the form to see your QR code.'}</p>}
            </div>

            {ready && warns.length > 0 && (
              <ul className="warns" role="status">
                {warns.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

            <div className="actions">
              <button className="primary" disabled={!ready} onClick={download}>Download PNG</button>
              <button disabled={!ready} onClick={copy}>Copy image</button>
              <button disabled={!ready} onClick={() => { saveRecent(); flash('Saved to recent') }}>Save</button>
            </div>
            <p className="note" aria-live="polite">{note}</p>
          </section>
        </div>

        <section className="panel recent">
          <h2>Recent codes</h2>
          {recent.length === 0 ? (
            <p className="empty">Codes you download or save appear here.</p>
          ) : (
            <>
              <ul className="rlist">
                {recent.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => reuse(r)} title="Reuse this code">
                      <img src={r.thumb} alt="" width="64" height="64" />
                      <span>{r.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button className="link" onClick={() => setRecent([])}>Clear recent</button>
            </>
          )}
        </section>

        <footer className="credit">
          Created by Pratham Sharma &middot; RA2511003010250 &middot; 2nd Year CSE Core
        </footer>
      </main>
    </>
  )
}
