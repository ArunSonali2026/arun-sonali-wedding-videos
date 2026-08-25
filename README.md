# Arun & Sonali Wedding Videos

A self-hosted private video website.

## Features
- Admin login
- Visitor access request
- Admin approve/reject
- Private video storage outside `public/`
- Authenticated video streaming with HTTP Range support
- Approved users can watch videos
- Admin can upload/delete videos
- New videos are automatically granted to approved users
- SQLite database
- Password hashing with bcrypt
- Helmet security headers
- HTTP-only session cookie

## Run locally

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set a long random `SESSION_SECRET`.
4. Set `ADMIN_EMAIL` and an admin password of at least 10 characters.
5. Run:
   `npm install`
   `npm start`
6. Open `http://localhost:3000`

## Important production notes
- Use HTTPS/TLS when deployed.
- Use a strong random SESSION_SECRET.
- Do not put `.env`, `data/`, or `private_videos/` in a public web directory.
- Back up the SQLite database and private video folder.
- For very large video libraries, replace local disk storage with private object storage and signed/authenticated streaming.
- This starter intentionally does not claim to prevent screen recording; no website can reliably prevent a viewer from recording their screen.
