import { lazy, Suspense, useState } from 'react';
import { LangContext, loadLang, saveLang, strings, type Lang } from './i18n';

const onlineEnabled = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

// One main screen for everyone. With Supabase configured it's the full online game
// (sign-in optional for practice); without it, the same screen in practice-only mode.
const Game = lazy(() => import('./ui/Online').then((m) => ({ default: onlineEnabled ? m.Online : m.OfflineApp })));
// A sponsor's private report link (/?reporte=…): its own page, no sign-in.
const SponsorReport = lazy(() => import('./ui/SponsorReport'));
const reportToken = onlineEnabled ? new URLSearchParams(location.search).get('reporte') : null;

export default function App() {
  const [lang, setLangState] = useState<Lang>(loadLang);
  const t = strings(lang);
  const setLang = (l: Lang) => {
    setLangState(l);
    saveLang(l);
    document.documentElement.lang = l;
  };

  return (
    <LangContext.Provider value={{ lang, t, setLang }}>
      <Suspense fallback={<div className="boot"><span className="boot-logo">CAPICÚA</span></div>}>
        {reportToken ? <SponsorReport token={reportToken} /> : <Game />}
      </Suspense>
    </LangContext.Provider>
  );
}
