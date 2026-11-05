-- B-43: frames, logo corners and announcement designs are PNG files (they
-- need a see-through middle), but photo storage only took JPEG and WebP, so
-- every upload of one was refused ("Choose a PNG file and try again").
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png']
where id = 'photos';
