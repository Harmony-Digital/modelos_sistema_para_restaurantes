create policy mfa_required on public.attendance_notices as restrictive for all to authenticated
  using ((select app.mfa_ok())) with check ((select app.mfa_ok()));
