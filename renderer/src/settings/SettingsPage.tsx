import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import type { RemoteStatus } from '../../../shared/remote'
import { ipcErrorMessage } from '../format'
import './Settings.css'

/** app settings (#1.1) - the phone remote for now, TV mode and integrations later */
export function SettingsPage() {
  return (
    <section className="settings">
      <h2>Reglages</h2>
      <RemoteSettings />
      <section className="settings__card">
        <h3>A propos</h3>
        <p>EpiKodi v{window.epikodi.version}</p>
      </section>
    </section>
  )
}

/** the connection link on another LAN address of this PC (Wi-Fi vs Ethernet, VPN...) */
function linkFor(status: RemoteStatus, address: string): string | null {
  if (!status.url) return null
  const url = new URL(status.url)
  url.hostname = address
  return url.toString()
}

function RemoteSettings() {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /** LAN address put in the QR code - the first (most likely Wi-Fi) one unless changed */
  const [chosenAddress, setChosenAddress] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)

  useEffect(() => {
    window.epikodi
      .remoteStatus()
      .then(setStatus, (cause: unknown) => setError(ipcErrorMessage(cause)))
  }, [])

  const running = status?.running ?? false
  const address =
    status && chosenAddress && status.addresses.includes(chosenAddress)
      ? chosenAddress
      : (status?.addresses[0] ?? null)
  const link = running && status && address ? linkFor(status, address) : null

  // a new token at each start (#1.4) means a new link, hence a new QR code
  useEffect(() => {
    if (!link) return
    let isCancelled = false
    QRCode.toDataURL(link, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 480,
      // always dark on white: phone cameras read inverted codes badly
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      (dataUrl) => {
        if (!isCancelled) setQrCode(dataUrl)
      },
      () => {
        if (!isCancelled) setQrCode(null)
      },
    )
    return () => {
      isCancelled = true
    }
  }, [link])

  async function toggle(): Promise<void> {
    setIsBusy(true)
    setError(null)
    setCopied(false)
    setQrCode(null)
    try {
      setStatus(
        await (status?.running ? window.epikodi.stopRemote() : window.epikodi.startRemote()),
      )
    } catch (cause) {
      setError(ipcErrorMessage(cause))
    } finally {
      setIsBusy(false)
    }
  }

  async function copyLink(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setError('Copie impossible, selectionne le lien a la main.')
    }
  }

  const message = error ?? status?.error ?? null

  return (
    <section className="settings__card">
      <div className="settings__card-header">
        <h3>📱 Telecommande smartphone</h3>
        <span className={`settings__status${running ? ' is-on' : ''}`}>
          {running ? '● Active' : '○ Arretee'}
        </span>
        <button
          type="button"
          className={`settings__button${running ? '' : ' settings__button--primary'}`}
          onClick={() => void toggle()}
          disabled={isBusy || status === null}
        >
          {running ? 'Desactiver' : 'Activer'}
        </button>
      </div>

      {!running && (
        <p className="settings__hint">
          Controle EpiKodi depuis ton telephone, connecte au <strong>meme Wi-Fi</strong> que ce PC :
          active la telecommande puis scanne le QR code, rien a installer ni a taper. Un nouveau
          code est cree a chaque activation, les anciens ne fonctionnent alors plus.
        </p>
      )}

      {message && <p className="settings__error">{message}</p>}

      {running && status && status.addresses.length === 0 && (
        <p className="settings__warning">
          Aucune adresse reseau : ce PC n'est connecte a aucun reseau, le telephone ne pourra pas le
          joindre.
        </p>
      )}

      {running && status && address && link && (
        <div className="settings__remote">
          <div className="settings__qr">
            {qrCode ? (
              <img src={qrCode} alt="QR code de connexion a la telecommande" />
            ) : (
              <span className="settings__qr-pending">Generation…</span>
            )}
          </div>

          <div className="settings__remote-info">
            <ol className="settings__steps">
              <li>
                Connecte ton telephone au <strong>meme Wi-Fi</strong> que ce PC.
              </li>
              <li>Ouvre l'appareil photo et vise le QR code.</li>
              <li>Touche le lien qui s'affiche : la telecommande s'ouvre, deja connectee.</li>
            </ol>

            <dl className="settings__details">
              <dt>Adresse</dt>
              <dd>
                {status.addresses.length > 1 ? (
                  <select
                    className="settings__select"
                    value={address}
                    onChange={(event) => {
                      setChosenAddress(event.target.value)
                      setCopied(false)
                    }}
                    aria-label="Adresse reseau mise dans le QR code"
                  >
                    {status.addresses.map((item) => (
                      <option key={item} value={item}>
                        {item}:{status.port}
                      </option>
                    ))}
                  </select>
                ) : (
                  <code>
                    {address}:{status.port}
                  </code>
                )}
              </dd>
              <dt>Lien</dt>
              <dd className="settings__link">
                <code>{link}</code>
                <button
                  type="button"
                  className="settings__button"
                  onClick={() => void copyLink(link)}
                >
                  {copied ? '✓ Copie' : 'Copier'}
                </button>
              </dd>
            </dl>

            <p className="settings__note">
              La page ne charge pas sur le telephone ? Verifie qu'il est bien sur le meme Wi-Fi que
              ce PC (pas en 4G/5G ni sur un reseau invite).
              {status.addresses.length > 1 &&
                ' Si ce PC a plusieurs reseaux, essaie une autre adresse dans la liste.'}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
