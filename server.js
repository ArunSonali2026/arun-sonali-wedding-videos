require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const VIDEO_DIR = path.join(__dirname, "private_videos");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "wedding.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS videos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 filename TEXT NOT NULL,
 original_name TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 size INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS permissions (
 user_id INTEGER NOT NULL,
 video_id INTEGER NOT NULL,
 PRIMARY KEY(user_id, video_id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
);
`);

function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password || password.length < 10) {
    console.warn("Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars) in .env before first production use.");
    return;
  }
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare("INSERT INTO users(name,email,password_hash,role,status) VALUES(?,?,?,?,?)")
      .run("Arun (Admin)", email, hash, "admin", "approved");
    console.log("Admin account created:", email);
  }
}
ensureAdmin();

app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "100kb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "CHANGE-ME",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, "public")));

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id,name,email,role,status FROM users WHERE id=?").get(req.session.userId);
}
function requireLogin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.status !== "approved") return res.status(401).json({error:"Login required"});
  req.user = user; next();
}
function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({error:"Admin only"});
  req.user = user; next();
}
function cleanTitle(s) {
  return String(s || "").trim().replace(/[<>]/g, "").slice(0, 120);
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, VIDEO_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(18).toString("hex") + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only video files are allowed."));
  }
});

app.get("/api/me", (req,res) => {
  const u = currentUser(req);
  res.json({loggedIn: !!u, user: u || null});
});

app.post("/api/request-access", async (req,res) => {
  const name = String(req.body.name || "").trim().slice(0,80);
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!name || !email || !password || password.length < 8)
    return res.status(400).json({error:"Name, valid email and password (8+ characters) are required."});
  const exists = db.prepare("SELECT id,status FROM users WHERE email=?").get(email);
  if (exists) return res.status(409).json({error:"An account/request already exists for this email."});
  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO users(name,email,password_hash,status) VALUES(?,?,?,'pending')")
    .run(name,email,hash);
  res.json({ok:true,message:"Access request sent. Wait for admin approval."});
});

app.post("/api/login", async (req,res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !(await bcrypt.compare(password,u.password_hash)))
    return res.status(401).json({error:"Incorrect email or password."});
  if (u.status !== "approved") return res.status(403).json({error:"Your access request is still pending or was rejected."});
  req.session.userId = u.id;
  res.json({ok:true});
});

app.post("/api/logout", (req,res) => req.session.destroy(()=>res.json({ok:true})));

app.get("/api/videos", requireLogin, (req,res) => {
  const rows = req.user.role === "admin"
    ? db.prepare("SELECT id,title,original_name,size,created_at FROM videos ORDER BY id DESC").all()
    : db.prepare(`
      SELECT v.id,v.title,v.original_name,v.size,v.created_at
      FROM videos v JOIN permissions p ON p.video_id=v.id
      WHERE p.user_id=? ORDER BY v.id DESC`).all(req.user.id);
  res.json(rows);
});

app.get("/api/admin/users", requireAdmin, (req,res) => {
  res.json(db.prepare("SELECT id,name,email,role,status,created_at FROM users ORDER BY id DESC").all());
});

app.post("/api/admin/users/:id/status", requireAdmin, (req,res) => {
  const status = ["approved","rejected","pending"].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({error:"Invalid status"});
  db.prepare("UPDATE users SET status=? WHERE id=? AND role!='admin'").run(status, Number(req.params.id));
  if (status === "approved") {
    const vids = db.prepare("SELECT id FROM videos").all();
    const insert = db.prepare("INSERT OR IGNORE INTO permissions(user_id,video_id) VALUES(?,?)");
    const tx = db.transaction(() => vids.forEach(v => insert.run(Number(req.params.id), v.id)));
    tx();
  }
  res.json({ok:true});
});

app.post("/api/admin/videos", requireAdmin, upload.single("video"), (req,res) => {
  if (!req.file) return res.status(400).json({error:"Video file required"});
  const title = cleanTitle(req.body.title) || path.basename(req.file.originalname, path.extname(req.file.originalname));
  const result = db.prepare(`
    INSERT INTO videos(title,filename,original_name,mime_type,size) VALUES(?,?,?,?,?)
  `).run(title, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size);
  const users = db.prepare("SELECT id FROM users WHERE status='approved'").all();
  const add = db.prepare("INSERT OR IGNORE INTO permissions(user_id,video_id) VALUES(?,?)");
  const tx = db.transaction(() => users.forEach(u => add.run(u.id, result.lastInsertRowid)));
  tx();
  res.json({ok:true,id:result.lastInsertRowid});
});

app.delete("/api/admin/videos/:id", requireAdmin, (req,res) => {
  const v = db.prepare("SELECT filename FROM videos WHERE id=?").get(Number(req.params.id));
  if (!v) return res.status(404).json({error:"Video not found"});
  db.prepare("DELETE FROM videos WHERE id=?").run(Number(req.params.id));
  try { fs.unlinkSync(path.join(VIDEO_DIR,v.filename)); } catch {}
  res.json({ok:true});
});

app.get("/api/video/:id/stream", requireLogin, (req,res) => {
  const id = Number(req.params.id);
  const v = db.prepare("SELECT * FROM videos WHERE id=?").get(id);
  if (!v) return res.sendStatus(404);
  if (req.user.role !== "admin") {
    const allowed = db.prepare("SELECT 1 FROM permissions WHERE user_id=? AND video_id=?").get(req.user.id,id);
    if (!allowed) return res.sendStatus(403);
  }
  const file = path.join(VIDEO_DIR,v.filename);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  const stat = fs.statSync(file);
  const range = req.headers.range;
  res.setHeader("Content-Type", v.mime_type);
  res.setHeader("Accept-Ranges","bytes");
  res.setHeader("Cache-Control","private, no-store");
  if (!range) {
    res.setHeader("Content-Length", stat.size);
    return fs.createReadStream(file).pipe(res);
  }
  const [startRaw,endRaw] = range.replace(/bytes=/,"").split("-");
  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : stat.size-1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= stat.size || start > end)
    return res.status(416).set("Content-Range",`bytes */${stat.size}`).end();
  res.status(206);
  res.setHeader("Content-Range",`bytes ${start}-${end}/${stat.size}`);
  res.setHeader("Content-Length",end-start+1);
  fs.createReadStream(file,{start,end}).pipe(res);
});

app.get("/api/admin/permissions/:userId", requireAdmin, (req,res) => {
  const uid = Number(req.params.userId);
  const rows = db.prepare(`
    SELECT v.id,v.title,CASE WHEN p.user_id IS NULL THEN 0 ELSE 1 END AS allowed
    FROM videos v LEFT JOIN permissions p ON p.video_id=v.id AND p.user_id=?
    ORDER BY v.id DESC`).all(uid);
  res.json(rows);
});

app.post("/api/admin/permissions", requireAdmin, (req,res) => {
  const uid = Number(req.body.userId), vid = Number(req.body.videoId);
  if (req.body.allowed) db.prepare("INSERT OR IGNORE INTO permissions(user_id,video_id) VALUES(?,?)").run(uid,vid);
  else db.prepare("DELETE FROM permissions WHERE user_id=? AND video_id=?").run(uid,vid);
  res.json({ok:true});
});

app.use((err,req,res,next) => {
  if (err instanceof multer.MulterError || err.message?.includes("Only video")) return res.status(400).json({error:err.message});
  console.error(err); res.status(500).json({error:"Server error"});
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Arun & Sonali Wedding Videos running on port ${PORT}`);
});
