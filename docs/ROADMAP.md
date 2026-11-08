# Spatial Studio: Product and Engineering Roadmap

## Product direction

Spatial Studio should help someone move from an empty room to an editable room plan:

1. Create or scan a room.
2. Identify existing furniture and room features.
3. Confirm or correct detected objects and measurements.
4. Try replacement furniture in the 3D room.
5. Save the project and return to it later.

The current website is a client-side prototype. Its furniture list and prices are sample data, and its camera button opens a camera preview rather than performing a 3D scan.

## Phase 1 — UI and room-planning foundation

- Make the workspace responsive on desktop and mobile.
- Keep Viewer, Layout, and Store navigation consistent.
- Make room dimensions, selected furniture, and object lists easy to find.
- Add clear empty, loading, permission-denied, and error states.
- Keep the 3D editor usable without an account or network connection.
- Clearly distinguish manually entered dimensions, imported scan data, and measured scan data.

**Acceptance checks:** the app builds on GitHub Actions; controls remain usable on a phone; room edits and furniture placement work; camera preview is never described as a scan.

## Phase 2 — Database and user projects

### Recommended starting stack

Use Supabase (PostgreSQL, Auth, and Storage) as the first backend candidate. It provides a relational database for rooms and products, user authentication, and storage for room images. The static GitHub Pages frontend can connect using the public client key, but every table must have Row Level Security (RLS) policies. Never put a service-role key, database password, or AI-provider secret in browser code.

Keep database access behind a small data-access layer so the app can change providers without rewriting the room editor.

### Initial data model

| Table | Purpose | Important fields |
| --- | --- | --- |
| profiles | User profile | id (auth user), display_name, created_at |
| rooms | Saved room projects | id, user_id, name, width_m, length_m, height_m, created_at, updated_at |
| room_objects | Furniture and detected objects | id, room_id, category, label, width_m, depth_m, height_m, position_x, position_z, rotation_y, source, confidence |
| products | Furniture catalog | id, brand, name, category, width_m, depth_m, height_m, price, currency, image_path, product_url, active |
| room_images | User-provided room photos | id, room_id, storage_path, created_at, consent_status |
| recognition_jobs | Track AI processing | id, room_id, status, model_version, created_at, completed_at, error_code |

Use UUID primary keys, foreign keys, timestamps, and constraints for positive dimensions and valid ownership. Store product dimensions in meters and prices with an explicit currency. Avoid storing unnecessary personal information.

### Security and privacy requirements

- Enable RLS on every user-owned table.
- A user may read or edit only their own rooms and room objects.
- Keep public product catalog reads separate from private user project data.
- Validate uploads and limit file size and accepted formats.
- Ask permission before uploading room images; explain why images are used and how they can be deleted.
- Do not expose backend service credentials in the frontend.
- Add delete-project and delete-account paths before public launch.

### Build order

1. Create the Supabase project and schema.
2. Add authentication (start with email sign-in).
3. Add RLS policies and test cross-user access.
4. Add save, list, rename, and delete room-project operations.
5. Persist furniture placements and room dimensions.
6. Add image storage when the recognition workflow is ready.

## Phase 3 — Furniture recognition

### Recognition pipeline

1. **Capture:** user takes or uploads a room photo, or supplies supported scan data.
2. **Detect:** a vision model finds candidate objects and returns bounding boxes and category labels (sofa, chair, desk, table, bed, lamp).
3. **Segment:** optionally separate each object from the background to improve its outline.
4. **Estimate:** estimate dimensions only when there is a trustworthy scale reference or supported AR/depth data. A normal single photo cannot reliably provide exact real-world dimensions by itself.
5. **Review:** show each candidate with a confidence score and let the user confirm, rename, resize, or remove it.
6. **Place:** add confirmed objects to the 3D room with a source value such as manual, photo_estimate, or room_scan.
7. **Improve:** with user permission, collect corrected labels as evaluation examples; do not silently use private room photos as training data.

### Model strategy

Start with a pretrained object-detection model (for example, a YOLO-family detector) rather than training a custom model from scratch. Evaluate it on a small, consented set of varied room photos. Track per-category precision/recall and false detections. Add segmentation only if bounding boxes are not good enough for the user experience.

Run inference through a backend function or a supported on-device model. A browser-only app must not contain private model/API credentials. Choose server-side versus on-device inference after comparing latency, cost, device support, and privacy.

### Important device limitation

The regular iPhone 17 does not have LiDAR. It can capture photos and use supported AR tracking in a native app, but it cannot use LiDAR-based RoomPlan scanning. The website's camera preview is not a room scan. Exact furniture dimensions and room geometry need a supported scale/depth source or user confirmation.

## Phase 4 — Product matching and recommendations

- Import a licensed or partner-provided furniture catalog with reliable dimensions, images, prices, stock status, and product links.
- Filter products by category, room clearance, dimensions, and budget before using semantic similarity.
- Use image/text embeddings only as a ranking aid; retain hard dimension and availability filters.
- Explain why an item was recommended and show the source and last-updated time for product data.
- Do not invent live prices or availability.

## Phase 5 — Testing and launch readiness

- Unit-test dimension validation, object placement, and import/export.
- Test RLS with two separate accounts.
- Evaluate recognition separately for each furniture category and lighting condition.
- Test on current desktop browsers and physical iPhones.
- Add error monitoring, backups, rate limits, and AI usage limits.
- Launch recognition as an opt-in beta until accuracy and privacy behavior are measured.

## Suggested MVP sequence

**First:** finish the UI and make room projects persist.

**Second:** connect a real furniture catalog with accurate dimensions.

**Third:** add photo-based furniture detection with a user confirmation step.

**Fourth:** investigate native iOS AR features for better room geometry. Treat LiDAR-only features as unavailable on the regular iPhone 17.

This order gives Spatial Studio useful value before the more expensive and less predictable AI and scanning work.
