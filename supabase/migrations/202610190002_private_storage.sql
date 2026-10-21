insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-files','order-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);
-- No authenticated storage writes or anonymous reads. Server routes validate bytes and
-- reserve quota with the user's session before using the service role for upload/download.
-- Private files are delivered by authorization-checked same-origin routes, not public URLs.
