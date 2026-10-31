import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { en } from './en';
import { zhCN, type MessageKey } from './zh-CN';

const dictionaries = { 'zh-CN': zhCN, en } as const;
export type Locale = keyof typeof dictionaries;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      return localStorage.getItem('lingbo.locale') === 'en' ? 'en' : 'zh-CN';
    } catch {
      return 'zh-CN';
    }
  });

  const setLocale = (next: Locale) => {
    try {
      localStorage.setItem('lingbo.locale', next);
    } catch {
      // private mode can reject storage; the in-memory locale still switches
    }
    setLocaleState(next);
  };

  useEffect(() => {
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
    document.title = locale === 'zh-CN' ? '灵播 · AI 数字人直播' : 'Lingbo · AI livestream';
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const dict = dictionaries[locale];
    return {
      locale,
      setLocale,
      t: (key, vars) => {
        let text: string = dict[key] ?? zhCN[key];
        if (vars) {
          for (const [name, replacement] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(replacement));
          }
        }
        return text;
      },
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('i18n missing');
  return value;
}

const ERRORS: Record<string, MessageKey> = {
  invalid_body: 'error.invalid_body',
  product_not_found: 'error.product_not_found',
  session_not_found: 'error.session_not_found',
  session_already_live: 'error.session_already_live',
  session_not_live: 'error.session_not_live',
  image_type: 'error.image_type',
  image_too_large: 'error.image_too_large',
  file_missing: 'error.file_missing',
  product_required: 'error.product_required',
  server_error: 'error.server_error',
  network: 'error.network',
  not_found: 'error.not_found',
  invalid_push_url: 'error.invalid_push_url',
  destination_not_found: 'error.destination_not_found',
  ingest_disabled: 'error.ingest_disabled',
  ingest_unauthorized: 'error.ingest_unauthorized',
  livekit_required: 'error.livekit_required',
  livekit_unavailable: 'error.livekit_unavailable',
};

export function explainError(t: I18nValue['t'], error: unknown): string {
  if (!(error instanceof ApiError)) return t('error.network');
  const head = t(ERRORS[error.code] ?? 'error.server_error');
  return error.details ? `${head}（${error.details}）` : head;
}
