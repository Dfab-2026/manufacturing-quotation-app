-- Enable the drawing formats already offered by the upload UI and extractor.
-- Keeps the existing tenant RLS and storage access controls unchanged.
alter table public.drawings
  drop constraint if exists drawings_mime_type_check;

alter table public.drawings
  add constraint drawings_mime_type_check
  check (mime_type in (
    'application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/webp',
    'application/dxf', 'application/acad', 'application/step',
    'model/iges', 'application/zip'
  ));

-- The private storage bucket must allow the same formats as the drawings table.
-- Otherwise Supabase rejects CAD files before a drawing row can be created.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/webp',
  'application/dxf', 'application/acad', 'application/step',
  'model/iges', 'application/zip'
]
where id = 'drawings';
