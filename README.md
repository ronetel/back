# Wardrobe Backend (scaffold)

This folder contains a minimal Express + Postgres backend scaffold for the Wardrobe mobile app.

Quick start:

1. Copy `.env.example` to `.env` and fill values (Postgres `DATABASE_URL`, Cloudinary keys).
2. Create Postgres database and run `sql/schema.sql` to create tables.
3. Install dependencies:

```bash
cd wardrobe/backend
npm install
```

4. Start server:

```bash
npm start
```

Routes implemented (minimal):
- `GET /clothes` — list clothes
- `GET /clothes/:id` — get cloth
- `POST /clothes` — create cloth metadata
- `DELETE /clothes/:id` — delete cloth
- `GET /get-signature` — cloudinary signature
- `POST /uploadImage` — save uploaded image metadata
- `GET /outfits/date/:YYYYMMDD` — outfits by date
- `POST /outfits/activity` — create activity (body: `{ event, date }`)
