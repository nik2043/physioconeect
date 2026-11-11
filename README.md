# PhysioConnect — full-stack app

Node.js + Express + SQLite backend serving the frontend. Shared database, bcrypt-hashed passwords, JWT login, atomic double-booking protection.

## Run
    npm install
    npm start          # http://localhost:3000

Demo login: demo@physioconnect.in / Demo@1234

## Config (optional env vars)
PORT (default 3000), JWT_SECRET (auto-generated into data/.secret if unset), DB_PATH.

## API
POST /api/auth/register|login · GET /api/me · GET|POST /api/physios · GET /api/slots
GET|POST /api/bookings · DELETE /api/bookings/:id · GET|POST /api/pain
GET /api/favs · POST /api/favs/:id · POST /api/contact

## Deploy
Any Node host works (Render, Railway, Fly.io, a VPS). Use a persistent disk for `data/`,
set JWT_SECRET, and put it behind HTTPS.
