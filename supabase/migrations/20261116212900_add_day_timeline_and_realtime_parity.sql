-- ============================================================================
-- Stage 1 UX & Full-Parity Upgrade: day_timeline widget + Realtime tables
-- ============================================================================

alter publication supabase_realtime add table
  public.projects,
  public.daily_reviews,
  public.assistant_agreements,
  public.assistant_settings;

alter table public.dashboard_widgets
  drop constraint if exists dashboard_widgets_widget_key_check,
  add constraint dashboard_widgets_widget_key_check check (
    widget_key in (
      'now_focus', 'day_timeline', 'day_slots_buffer', 'safe_to_spend',
      'waiting_radar', 'state_pulse', 'habits_strip', 'workout_window',
      'today_meals', 'goals_progress', 'pending_confirmations'
    )
  );
