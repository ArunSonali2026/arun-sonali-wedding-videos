require('dotenv').config();

const express = require("express");
const session = require("express-session");
const sqlite = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const VIDEOS_DIR = path.join(__dirname, "private_videos");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const db = sqlite(path.join(DATA_DIR, "wedding_2.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    approved INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (email && password && password.length >= 10) {
  const hash = password; 
  const stmt = db.prepare("INSERT OR IGNORE INTO users (email, password, role, approved) VALUES (?, ?, 'admin', 1)");
  stmt.run(email, hash);
} else {
  console.warn("Warning: Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars) in .env before first production use.");
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "fallback_secret_key_12345",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use(express.static(path.join(__dirname, "public")));
app.use("/videos", (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}, express.static(VIDEOS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEOS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });
  
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || user.password !== password) return res.status(401).json({ error: "Invalid credentials" });
  if (!user.approved) return res.status(403).json({ error: "Account pending approval" });
  
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ success: true, role: user.role });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false, user: null });
  const user = db.prepare("SELECT id, email, role, approved FROM users WHERE id = ?").get(req.session.userId);
  res.json({ loggedIn: true, user });
});

function isAdmin(req, res, next) {
  if (req.session.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

app.post("/api/admin/videos", isAdmin, upload.single("video"), (req, res) => {
  const { title } = req.body;
  if (!title || !req.file) return res.status(400).json({ error: "Title and video file required" });
  
  const stmt = db.prepare("INSERT INTO videos (title, filename) VALUES (?, ?)");
  stmt.run(title, req.file.filename);
  res.json({ success: true });
});

app.get("/api/videos", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const videos = db.prepare("SELECT * FROM videos ORDER BY uploaded_at DESC").all();
  res.json({ videos });
});

app.listen(PORT, () => console.log(`Arun & Sonali Wedding Videos running on port ${PORT}`));
