-- DriveSense local development seed data
-- SQL-first, deterministic seed for rules/settings/suggestions.
-- Intended for local testing only.

begin;

do $$
declare
  v_user_id uuid;
begin
  select id
  into v_user_id
  from auth.users
  where email = 'test@local.dev'
  limit 1;

  if v_user_id is null then
    insert into auth.users (email, created_at, updated_at)
    values ('test@local.dev', now(), now())
    returning id into v_user_id;
  end if;

  insert into public.rules (user_id, rules)
  values (
    v_user_id,
    '[
      {"type":"folder_whitelist","path":"/Team Drive/Marketing","platform":"google_drive"},
      {"type":"folder_blacklist","path":"/Team Drive/Marketing/Legal","platform":"google_drive"},
      {"type":"age_guard","min_days_since_modified":90},
      {"type":"keyword_guard","keywords":["contract","invoice","signed","final"]}
    ]'::jsonb
  )
  on conflict (user_id) do update
    set rules = excluded.rules,
        updated_at = now();

  insert into public.settings (
    user_id,
    llm_provider,
    llm_model,
    preferences,
    timezone,
    prompt_logging_enabled,
    scan_schedule,
    stale_after_days,
    not_accessed_after_days,
    similarity_threshold,
    suggestion_notifications,
    auto_confirm_actions
  )
  values (
    v_user_id,
    'gemini',
    null,
    '{"source":"dev_seed_sql"}'::jsonb,
    'UTC',
    false,
    'manual',
    90,
    180,
    0.900,
    '{"dashboard":true,"realtime":true}'::jsonb,
    false
  )
  on conflict (user_id) do update
    set llm_provider = excluded.llm_provider,
        llm_model = excluded.llm_model,
        preferences = excluded.preferences,
        timezone = excluded.timezone,
        prompt_logging_enabled = excluded.prompt_logging_enabled,
        scan_schedule = excluded.scan_schedule,
        stale_after_days = excluded.stale_after_days,
        not_accessed_after_days = excluded.not_accessed_after_days,
        similarity_threshold = excluded.similarity_threshold,
        suggestion_notifications = excluded.suggestion_notifications,
        auto_confirm_actions = excluded.auto_confirm_actions,
        updated_at = now();

  delete from public.suggestions where user_id = v_user_id;

  insert into public.suggestions
    (user_id, platform, action, status, title, description, reason, files, analysis)
  values
    (
      v_user_id,
      'google_drive',
      'merge',
      'pending',
      'Merge near-duplicate launch plans',
      'These two launch plan docs look very similar; consider merging so the team has one source of truth.',
      'Similar structure and topic with a newer final version.',
      '[
        {
          "id":"gd_file_1",
          "platform":"google_drive",
          "type":"doc",
          "path":"/Team Drive/Marketing/Launches/2024-Q4/Launch Plan.doc",
          "title":"Launch Plan",
          "owner":"alex@company.com",
          "last_modified":"2024-10-18T12:00:00.000Z",
          "last_accessed":"2024-11-10T08:00:00.000Z",
          "content_summary":"Launch plan for Q4: timeline, channels, KPIs, draft messaging and tasks."
        },
        {
          "id":"gd_file_2",
          "platform":"google_drive",
          "type":"doc",
          "path":"/Team Drive/Marketing/Launches/2024-Q4/Launch Plan (final).doc",
          "title":"Launch Plan (final)",
          "owner":"alex@company.com",
          "last_modified":"2024-10-21T17:35:00.000Z",
          "last_accessed":"2025-01-03T10:00:00.000Z",
          "content_summary":"Finalized Q4 launch plan; same structure as draft with updated dates, approvals, and finalized messaging."
        }
      ]'::jsonb,
      '{"is_duplicate":true,"preferred_file":"B","reason":"Same plan with updated dates and approvals."}'::jsonb
    ),
    (
      v_user_id,
      'google_drive',
      'archive',
      'pending',
      'Archive stale outreach tracker',
      'This outreach tracker has not been touched in a long time; consider archiving to reduce clutter.',
      'Last modified/accessed in 2023.',
      '[
        {
          "id":"gd_file_3",
          "platform":"google_drive",
          "type":"sheet",
          "path":"/Team Drive/Marketing/Launches/2024-Q4/Influencer outreach tracker.xlsx",
          "title":"Influencer outreach tracker",
          "owner":"maria@company.com",
          "last_modified":"2023-07-11T09:15:00.000Z",
          "last_accessed":"2023-07-12T09:15:00.000Z",
          "content_summary":"Spreadsheet of influencer contacts and outreach status; last updated mid-2023."
        }
      ]'::jsonb,
      '{"is_stale":true,"confidence":"high","suggested_action":"archive"}'::jsonb
    ),
    (
      v_user_id,
      'google_drive',
      'rename',
      'pending',
      'Rename unclear document',
      'This document name does not explain what it is for; consider renaming it so it is easier to find later.',
      'Title is generic and likely came from an accidental create/download.',
      '[
        {
          "id":"gd_p_3",
          "platform":"google_drive",
          "type":"doc",
          "path":"/My Drive/Downloads/Untitled document.doc",
          "title":"Untitled document",
          "owner":"me@local.dev",
          "last_modified":"2020-05-03T12:00:00.000Z",
          "last_accessed":"2020-05-03T12:00:00.000Z",
          "content_summary":"A short pasted snippet with no clear purpose; likely safe to archive or rename."
        }
      ]'::jsonb,
      '{"action_type":"rename","reason":"Generic title with unclear purpose."}'::jsonb
    ),
    (
      v_user_id,
      'notion',
      'merge',
      'pending',
      'Consolidate duplicate specs',
      'These two specs cover the same feature; consider consolidating so the team follows the most current version.',
      'Older v1 appears superseded by v2.',
      '[
        {
          "id":"nt_page_1",
          "platform":"notion",
          "type":"page",
          "path":"/Product/Specs/Search ranking v1",
          "title":"Search ranking v1",
          "owner":"pm@company.com",
          "last_modified":"2022-06-10T10:30:00.000Z",
          "last_accessed":"2022-06-10T10:30:00.000Z",
          "content_summary":"Original spec for search ranking. Mentions legacy architecture and deprecated services."
        },
        {
          "id":"nt_page_2",
          "platform":"notion",
          "type":"page",
          "path":"/Product/Specs/Search ranking v2",
          "title":"Search ranking v2",
          "owner":"pm@company.com",
          "last_modified":"2023-03-18T14:00:00.000Z",
          "last_accessed":"2025-08-02T09:00:00.000Z",
          "content_summary":"Updated spec for search ranking with current architecture; includes rollout plan and metrics."
        }
      ]'::jsonb,
      '{"is_duplicate":true,"preferred_file":"B","reason":"v2 is newer and reflects current architecture."}'::jsonb
    ),
    (
      v_user_id,
      'notion',
      'archive',
      'pending',
      'Archive old weekly sync notes',
      'These notes are from years ago and likely outdated; consider archiving to keep the workspace tidy.',
      'No modifications or access since 2021.',
      '[
        {
          "id":"nt_page_3",
          "platform":"notion",
          "type":"page",
          "path":"/Product/Meeting notes/Weekly sync notes",
          "title":"Weekly sync notes",
          "owner":"team@company.com",
          "last_modified":"2021-02-01T09:00:00.000Z",
          "last_accessed":"2021-02-01T09:00:00.000Z",
          "content_summary":"Old weekly sync notes from 2021; contains outdated action items."
        }
      ]'::jsonb,
      '{"is_stale":true,"confidence":"high","suggested_action":"archive"}'::jsonb
    );

  raise notice 'Seeded local dev data for user id: %', v_user_id;
end
$$;

commit;
