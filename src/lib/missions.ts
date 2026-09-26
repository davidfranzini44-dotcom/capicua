// Today's missions (see migration 20261001000000_missions): three for everyone,
// progress counted by the server when online games with two or more people end.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, onlineEnabled, supabase } from './supabase';

export interface Mission {
  id: string;
  /** 1 easy · 2 medium · 3 hard · 4 = the bonus for finishing all three. */
  tier: number;
  kind: 'play' | 'win' | 'hands' | 'capicua' | 'mode_1v1' | 'mode_2v2' | 'mode_ffa' | 'bonus';
  goal: number;
  chips: number;
  xp: number;
  progress: number;
  claimed: boolean;
  resets_at: string;
}

const CODES = ['guest_missions', 'mission_not_done', 'mission_claimed', 'no_mission', 'banned', 'not_signed_in'];

export function useMissions(enabled: boolean) {
  const [list, setList] = useState<Mission[]>([]);

  const reload = useCallback(async () => {
    if (!enabled || !onlineEnabled) return;
    const { data } = await supabase.rpc('my_missions');
    if (data) setList(data as Mission[]);
  }, [enabled]);

  // Fresh when the home screen shows, when the app comes back, and at the daily reset.
  useEffect(() => {
    reload();
    const onShow = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [reload]);
  const resetsAt = list[0] ? new Date(list[0].resets_at).getTime() : null;
  useEffect(() => {
    if (!resetsAt) return;
    const id = setTimeout(reload, Math.max(1000, resetsAt - Date.now() + 2000));
    return () => clearTimeout(id);
  }, [resetsAt, reload]);

  const claim = useCallback(async (id: string): Promise<{ chips?: number; xp?: number; chest?: string }> => {
    const { data, error } = await supabase.rpc('claim_mission', { p_mission: id });
    if (error) throw new ApiError(CODES.includes(error.message) ? error.message : 'server_error');
    await reload();
    return data;
  }, [reload]);

  const missions = list.filter((m) => m.tier < 4);
  const bonus = list.find((m) => m.tier === 4) ?? null;
  const ready = (m: Mission) => !m.claimed && m.progress >= m.goal;
  return {
    missions,
    bonus,
    resetsAt,
    reload,
    claim,
    ready,
    /** Rewards waiting to be collected (for the badge). */
    claimable: missions.filter(ready).length + (bonus && ready(bonus) ? 1 : 0),
    done: missions.filter((m) => m.progress >= m.goal).length,
  };
}

export type Missions = ReturnType<typeof useMissions>;
