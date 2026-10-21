-- Expose review status to shop members without granting the token digest column.
create policy read_review_status on public.review_requests for select to authenticated using(public.is_member(workspace_id));
grant select(id,workspace_id,order_id,proof_id,expires_at,revoked_at,decided_at,created_at) on public.review_requests to authenticated;
