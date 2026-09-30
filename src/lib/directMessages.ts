import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, onlineEnabled, supabase } from './supabase';

export interface DirectMessage {
  id: number;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

const sortMessages = (messages: DirectMessage[]) => [...messages].sort((a, b) => a.id - b.id);

/** My latest private messages, kept live by Supabase Realtime. */
export function useDirectMessages(uid: string | undefined) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(!!uid);

  const put = useCallback((message: DirectMessage) => {
    setMessages((all) => sortMessages([...all.filter((m) => m.id !== message.id), message]).slice(-250));
  }, []);

  useEffect(() => {
    if (!uid || !onlineEnabled) { setMessages([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    supabase.from('direct_messages')
      .select('id, sender_id, recipient_id, body, created_at, read_at')
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
      .order('id', { ascending: false }).limit(250)
      .then(({ data }) => {
        if (alive) {
          setMessages(sortMessages((data ?? []) as DirectMessage[]));
          setLoading(false);
        }
      });
    const channel = supabase.channel(`direct-messages:${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => put(payload.new as DirectMessage))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages' }, (payload) => put(payload.new as DirectMessage))
      .subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [uid, put]);

  const send = useCallback(async (userId: string, text: string) => {
    const { message } = await api<{ message: DirectMessage }>('direct_message_send', { userId, text });
    put(message);
  }, [put]);

  const read = useCallback(async (userId: string) => {
    if (!uid || !messages.some((m) => m.sender_id === userId && m.recipient_id === uid && !m.read_at)) return;
    await api('direct_message_read', { userId });
    const at = new Date().toISOString();
    setMessages((all) => all.map((m) => m.sender_id === userId && m.recipient_id === uid && !m.read_at ? { ...m, read_at: at } : m));
  }, [uid, messages]);

  return useMemo(() => ({
    uid, messages, loading, send, read,
    unread: messages.filter((m) => m.recipient_id === uid && !m.read_at).length,
    unreadWith: (userId: string) => messages.filter((m) => m.sender_id === userId && m.recipient_id === uid && !m.read_at).length,
    withUser: (userId: string) => messages.filter((m) =>
      (m.sender_id === uid && m.recipient_id === userId) || (m.sender_id === userId && m.recipient_id === uid)),
    lastWith: (userId: string) => messages.findLast((m) =>
      (m.sender_id === uid && m.recipient_id === userId) || (m.sender_id === userId && m.recipient_id === uid)),
  }), [uid, messages, loading, send, read]);
}

export type DirectMessages = ReturnType<typeof useDirectMessages>;
