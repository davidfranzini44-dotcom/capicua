-- A 2v2 organizer chooses how solo entrants receive partners at the start.
-- Existing tournaments keep the behavior they already had.
alter table public.tournaments
  add column partner_matching text not null default 'random'
  check (partner_matching in ('random', 'balanced'));
