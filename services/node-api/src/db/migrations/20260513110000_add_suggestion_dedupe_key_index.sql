create index if not exists suggestions_files_gin_idx
  on public.suggestions using gin (files jsonb_path_ops);

create index if not exists suggestions_analysis_gin_idx
  on public.suggestions using gin (analysis jsonb_path_ops);
