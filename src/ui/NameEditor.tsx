// Picking a name: checked as it's typed ("✓ Disponible" / "«David» ya lo usa otro
// jugador"), with free names close to it to tap. Used when a player first signs up
// (or has to re-pick after a clash) and from Perfil → Cambiar nombre.
import { useState } from 'react';
import { useI18n } from '../i18n';
import { NAME_MAX, takeName, useNameCheck, type NameResult } from '../lib/names';

export function NameEditor({ initial, current, submitLabel, onSaved }: {
  initial: string;
  /** The name the player has now (typing it again isn't a change). */
  current?: string;
  submitLabel: string;
  onSaved: (name: string) => void;
}) {
  const { t, lang } = useI18n();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<NameResult | null>(null);
  const { state, result } = useNameCheck(name, current);
  const shown = refused ?? (state === 'bad' ? result : null);
  const canSave = state === 'ok' && !saving && !refused;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const r = await takeName(name.trim());
    setSaving(false);
    if (r.ok) onSaved(r.name ?? name.trim());
    else setRefused(r);
  };

  const why = (r: NameResult) => {
    switch (r.error) {
      case 'name_taken': return t.names.taken.replace('{name}', name.trim());
      case 'name_reserved': return t.names.reserved;
      case 'name_length': return t.names.length;
      case 'name_cooldown': return t.names.cooldown.replace('{date}', r.until
        ? new Date(r.until).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { day: 'numeric', month: 'long' }) : '');
      default: return t.names.failed;
    }
  };

  return (
    <div className="name-editor">
      <input className="text-input" value={name} maxLength={NAME_MAX} autoFocus aria-describedby="name-status" aria-invalid={!!shown}
        onChange={(e) => { setName(e.target.value); setRefused(null); }} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <p id="name-status" className={`name-status ${shown ? 'bad' : state === 'ok' ? 'ok' : ''}`} aria-live="polite">
        {shown ? why(shown) : state === 'ok' ? `✓ ${t.names.available}` : state === 'checking' ? t.names.checking : '\u00a0'}
      </p>
      {!!shown?.suggestions?.length && (
        <div className="name-suggest">
          <small>{t.names.try}</small>
          {shown.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => { setName(s); setRefused(null); }}>{s}</button>
          ))}
        </div>
      )}
      <button className="btn primary big-btn" disabled={!canSave} onClick={save}>{saving ? '…' : submitLabel}</button>
    </div>
  );
}
