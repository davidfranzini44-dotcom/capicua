// Who may hear a player: friends watching, and — only at a private table, only with the voice
// on air, only those the server lists — people watching by link.
import { describe, expect, it } from 'vitest';
import { AIR_OFF, airVoices, voiceSubscribers } from '../src/lib/voiceAccess';

const present = ['u-yokasta', 'u-wilfri', 'spec-u-papo', 'air-aaaaaaaaaaaaaaaaaaaaaaaa', 'air-bbbbbbbbbbbbbbbbbbbbbbbb'];
const listed = { on: true, listeners: ['air-aaaaaaaaaaaaaaaaaaaaaaaa', 'air-cccccccccccccccccccccccc'] };

describe('voiceSubscribers', () => {
  it('public tables keep the old rule: everyone, or only the players when spectators are off', () => {
    expect(voiceSubscribers(present, { spectatorsHear: true, airRoom: false, air: listed })).toBe('all');
    expect(voiceSubscribers(present, { spectatorsHear: false, airRoom: false, air: listed })).toEqual(['u-yokasta', 'u-wilfri']);
  });

  it('at a private table it is always a list: nobody by link while my voice is off', () => {
    expect(voiceSubscribers(present, { spectatorsHear: true, airRoom: true, air: AIR_OFF })).toEqual(['u-yokasta', 'u-wilfri', 'spec-u-papo']);
    expect(voiceSubscribers(present, { spectatorsHear: false, airRoom: true, air: { ...listed, on: false } })).toEqual(['u-yokasta', 'u-wilfri']);
  });

  it('on air: exactly the link listeners the server lists — including ones not in the room yet, never others', () => {
    const allowed = voiceSubscribers(present, { spectatorsHear: false, airRoom: true, air: listed });
    expect(allowed).toEqual(['u-yokasta', 'u-wilfri', 'air-aaaaaaaaaaaaaaaaaaaaaaaa', 'air-cccccccccccccccccccccccc']);
    expect(allowed).not.toContain('air-bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(allowed).not.toContain('spec-u-papo');
  });

  it('only air- identities can come in through the list', () => {
    const allowed = voiceSubscribers([], { spectatorsHear: false, airRoom: true, air: { on: true, listeners: ['spec-u-x', 'u-someone', 'air-dddddddddddddddddddddddd'] } });
    expect(allowed).toEqual(['air-dddddddddddddddddddddddd']);
  });
});

describe('airVoices', () => {
  it('the viewer plays the on-air seats that have a person in them', () => {
    const seats = [
      { seat: 0, user_id: 'u-robert', is_bot: false }, { seat: 1, user_id: 'u-yokasta', is_bot: false },
      { seat: 2, user_id: null, is_bot: true }, { seat: 3, user_id: 'u-kirsy', is_bot: false },
    ];
    expect(airVoices([1, 2], seats)).toEqual(['u-yokasta']);
    expect(airVoices([], seats)).toEqual([]);
  });
});
