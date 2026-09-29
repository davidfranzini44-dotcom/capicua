-- The name helpers from 20261010000000 use only built-in functions: pin their search_path
-- (Supabase's linter: function_search_path_mutable).
alter function public.name_key(text) set search_path = '';
alter function public.name_reserved(text) set search_path = '';
