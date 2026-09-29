-- Sponsors: an optional second logo for the face-down fichas. A square or upright
-- mark reads better on the back of a ficha than the wide logo printed on the felt.
-- Empty = the fichas use the felt logo, turned along the long edge.
alter table public.sponsors add column tile_image_path text;

-- Players may read it, like everything else that prints the sponsor at the table.
grant select (tile_image_path) on public.sponsors to authenticated;
