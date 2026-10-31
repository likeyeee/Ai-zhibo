import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { SystemInfo } from '@lingbo/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

const SystemContext = createContext<SystemInfo | null>(null);
export function useSystem() {
  return useContext(SystemContext);
}

export function Layout() {
  const { t, locale, setLocale } = useI18n();
  const location = useLocation();
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const immersive = location.pathname.startsWith('/live/');

  useEffect(() => {
    let cancelled = false;
    api
      .system()
      .then((info) => {
        if (!cancelled) setSystem(info);
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SystemContext.Provider value={system}>
      <div className={immersive ? 'app-shell immersive' : 'app-shell'}>
        <header className="topbar">
          <NavLink to="/" className="brand">
            <span className="logo-mark" aria-hidden>
              <svg viewBox="0 0 32 32">
                <rect width="32" height="32" rx="9" fill="#ff4b38" />
                <path d="M10 18c0-4 2.4-7 6-7s6 3 6 7" fill="none" stroke="#fff" strokeWidth="2" />
                <circle cx="16" cy="13" r="2" fill="#fff" />
              </svg>
            </span>
            <span>
              <strong>{t('app.name')}</strong>
              <small>{t('app.tagline')}</small>
            </span>
          </NavLink>
          <nav>
            <NavLink to="/" end>
              {t('nav.console')}
            </NavLink>
            <NavLink to="/products">{t('nav.products')}</NavLink>
          </nav>
          <div className="lang-switch" role="group" aria-label="language">
            <button type="button" className={locale === 'zh-CN' ? 'on' : ''} onClick={() => setLocale('zh-CN')}>
              {t('lang.zh')}
            </button>
            <button type="button" className={locale === 'en' ? 'on' : ''} onClick={() => setLocale('en')}>
              {t('lang.en')}
            </button>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
        {immersive ? null : (
          <footer className="system-bar">
            {offline ? <span>{t('system.offline')}</span> : null}
            {system ? (
              <>
                <span>
                  {t('system.llm')} · {providerName(system.llm.id, t)}
                </span>
                <span>
                  {t('system.tts')} · {providerName(system.tts.id, t)}
                </span>
                <span>
                  {t('system.avatar')} · {avatarLabel(system.avatar.id, t)}
                </span>
                <span>
                  {t('system.realtime')} · {system.realtime.id === 'livekit' ? t('system.livekit') : t('system.localRoom')}
                </span>
                <span>
                  {t('system.output')} · {outputName(system.output.id, t)}
                </span>
                <span>{system.simulateViewers ? t('system.simulateOn') : t('system.simulateOff')}</span>
                {system.avatar.configured === 'heygem' ? <span>{t('system.duixCredit')}</span> : null}
                {system.llm.degraded || system.tts.degraded || system.avatar.degraded || system.realtime.degraded || system.output.degraded ? (
                  <span>{t('system.degraded')}</span>
                ) : null}
              </>
            ) : null}
          </footer>
        )}
      </div>
    </SystemContext.Provider>
  );
}

function avatarLabel(id: string, t: ReturnType<typeof useI18n>['t']) {
  if (id === 'heygem') return t('system.avatarHeygem');
  if (id === 'musetalk') return t('system.avatarMusetalk');
  if (id === 'http') return t('system.avatarHttp');
  if (id === 'livekit') return t('system.avatarLivekit');
  if (id === 'video') return t('system.video');
  return t('system.local');
}

function providerName(id: string, t: ReturnType<typeof useI18n>['t']) {
  if (id === 'mock') return t('system.mock');
  if (id === 'openai') return t('system.openai');
  if (id === 'http') return t('system.http');
  if (id === 'cosyvoice') return t('system.cosyvoice');
  if (id === 'gpt-sovits') return t('system.gptSovits');
  if (id === 'f5') return t('system.f5');
  if (id === 'video') return t('system.video');
  return t('system.local');
}

function outputName(id: string, t: ReturnType<typeof useI18n>['t']) {
  if (id === 'ffmpeg') return t('system.ffmpeg');
  if (id === 'livekit-egress') return t('system.livekitEgress');
  return t('system.mock');
}
