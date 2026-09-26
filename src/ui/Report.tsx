// "Reportar trampa" on a player's card at the table: pick a reason, add a note,
// send. Only the admin sees reports (Admin → Juego limpio).
import { useState } from 'react';
import { errorText, useI18n } from '../i18n';
import { supabase } from '../lib/supabase';

const REASONS = ['sharing', 'teaming', 'screens', 'other'] as const;

export function ReportButton({ userId, gameId, name }: { userId: string; gameId: string; name: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) return <p className="report-sent">{t.fair.sent}<small>{t.fair.thanks}</small></p>;
  if (!open) return <button className="btn ghost wide report-open" onClick={() => setOpen(true)}>{t.fair.report}</button>;

  const send = async () => {
    if (!reason) return setError(errorText(t, 'bad_reason'));
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('report_player', { p_user: userId, p_game: gameId, p_reason: reason, p_note: note.trim() || null });
    setBusy(false);
    if (e) setError(errorText(t, e.message));
    else setSent(true);
  };

  return (
    <div className="report-form">
      <h4>{t.fair.reportTitle} {name}</h4>
      <div className="report-reasons">
        {REASONS.map((r) => (
          <button key={r} className={`report-reason ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{t.fair.reasons[r]}</button>
        ))}
      </div>
      <textarea className="text-input" rows={2} maxLength={300} placeholder={t.fair.notePh} value={note} onChange={(e) => setNote(e.target.value)} />
      <small className="report-hint">{t.fair.reportHint}</small>
      {error && <p className="error">{error}</p>}
      <div className="report-buttons">
        <button className="btn ghost" onClick={() => setOpen(false)}>{t.cancel}</button>
        <button className="btn primary" disabled={busy || !reason} onClick={send}>{t.fair.send}</button>
      </div>
    </div>
  );
}
