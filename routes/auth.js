const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { generateCode, sendVerificationEmail, sendPasswordResetEmail } = require("../services/email_service");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const SALT_ROUNDS = 10;




const requireRole = (roles) => {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (!roles.includes(decoded.role)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ message: "Invalid token" });
    }
  };
};




router.post("/register", async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ message: "Email, username and password required" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ message: "Username must be 3-30 characters, alphanumeric and underscores only" });
  }

  try {
    // Проверяем что email/username не заняты в реальных аккаунтах
    const existing = await pool.query(
      "SELECT email, username FROM users WHERE email=$1 OR username=$2",
      [email, username]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].email === email) return res.status(409).json({ message: "Email already exists" });
      return res.status(409).json({ message: "Username already exists" });
    }

    // Проверяем username в pending (другой человек мог занять ник)
    // Проверяем ник только у ДРУГИХ пользователей — тот же email может перерегистрироваться
    const pendingUsername = await pool.query(
      "SELECT 1 FROM pending_registrations WHERE username=$1 AND email!=$2 AND expires_at > NOW()",
      [username, email]
    );
    if (pendingUsername.rows.length > 0) {
      return res.status(409).json({ message: "Username already exists" });
    }

    // Rate limit: не чаще раза в минуту
    const recent = await pool.query(
      "SELECT 1 FROM pending_registrations WHERE email=$1 AND created_at > NOW() - INTERVAL '1 minute' LIMIT 1",
      [email]
    );
    if (recent.rows.length > 0) return res.status(429).json({ message: "Подождите минуту перед повторной отправкой" });

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const code = generateCode();

    // Удаляем старые pending записи для этого email и создаём новую
    await pool.query("DELETE FROM pending_registrations WHERE email=$1", [email]);
    await pool.query(
      "INSERT INTO pending_registrations(email, username, password_hash, code, expires_at) VALUES ($1,$2,$3,$4, NOW() + INTERVAL '15 minutes')",
      [email, username, hashedPassword, code]
    );

    res.status(201).json({ message: "Verification code sent", email });
    sendVerificationEmail(email, code).catch(err => console.error("Mail send error:", err.message));
  } catch (err) {
    console.error("Registration error:", err.message, err.code);
    res.status(500).json({ message: "Internal error" });
  }
});




router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, username, password_hash, role, avatar_url, is_banned, ban_until, ban_reason, created_at
       FROM users WHERE email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    
    if (user.is_banned) {
      if (user.ban_until && new Date(user.ban_until) > new Date()) {
        return res.status(403).json({
          message: "Account is banned",
          banReason: user.ban_reason,
          banUntil: user.ban_until,
        });
      }
      
      if (user.ban_until && new Date(user.ban_until) <= new Date()) {
        await pool.query(
          "UPDATE users SET is_banned = FALSE, ban_until = NULL, ban_reason = NULL WHERE id = $1",
          [user.id],
        );
      }
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    
    const statsResult = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM clothes WHERE owner_id = $1) as clothes_count,
        (SELECT COUNT(*) FROM outfits WHERE owner_id = $1) as outfits_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = $1) as posts_count`,
      [user.id],
    );
    const stats = statsResult.rows[0];

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
        clothesCount: parseInt(stats.clothes_count),
        outfitsCount: parseInt(stats.outfits_count),
        postsCount: parseInt(stats.posts_count),
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Internal error" });
  }
});




router.get("/me", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      `SELECT id, email, username, role, avatar_url, created_at,
        (SELECT COUNT(*) FROM clothes WHERE owner_id = $1) as clothes_count,
        (SELECT COUNT(*) FROM outfits WHERE owner_id = $1) as outfits_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = $1) as posts_count
       FROM users WHERE id = $1`,
      [decoded.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
});




router.put("/profile", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { username, avatarUrl } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username) {
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        return res.status(400).json({ message: "Invalid username format" });
      }
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }

    if (avatarUrl !== undefined) {
      updates.push(`avatar_url = $${paramCount++}`);
      values.push(avatarUrl);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    values.push(decoded.id);
    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramCount} RETURNING
      id, email, username, avatar_url, role, created_at,
      (SELECT COUNT(*) FROM clothes WHERE owner_id = $${paramCount}) as clothes_count,
      (SELECT COUNT(*) FROM outfits WHERE owner_id = $${paramCount}) as outfits_count,
      (SELECT COUNT(*) FROM posts WHERE author_id = $${paramCount}) as posts_count`;

    const result = await pool.query(query, values);
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Update profile error:", err);
    if (err.code === "23505") {
      return res.status(409).json({ message: "Username already exists" });
    }
    res.status(500).json({ message: "Internal error" });
  }
});




// Step 1: validate current password → send email code
router.post("/password-change-code", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ message: "Current password required" });
    }

    const userResult = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE id = $1",
      [decoded.id]
    );
    if (!userResult.rows.length) return res.status(404).json({ message: "User not found" });

    const user = userResult.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return res.status(400).json({ message: "Неверный текущий пароль" });

    const recent = await pool.query(
      "SELECT id FROM email_codes WHERE email=$1 AND type='password_change' AND created_at > NOW() - INTERVAL '1 minute' AND used=FALSE",
      [user.email]
    );
    if (recent.rows.length > 0) {
      return res.status(429).json({ message: "Подождите минуту перед повторной отправкой" });
    }

    await pool.query("UPDATE email_codes SET used=TRUE WHERE email=$1 AND type='password_change'", [user.email]);
    const code = generateCode();
    await pool.query(
      "INSERT INTO email_codes(email,code,type,expires_at) VALUES($1,$2,'password_change', NOW() + INTERVAL '15 minutes')",
      [user.email, code]
    );

    console.log(`[password-change] code for ${user.email}: ${code}`)
    res.json({ message: "Code sent", email: user.email });
    sendPasswordResetEmail(user.email, code).catch(err => console.error(`[password-change] mail error: ${err.message}`));
  } catch (err) {
    console.error("Password change code error:", err);
    res.status(500).json({ message: "Internal error" });
  }
});

// Step 2: verify code + change password
router.put("/password", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { currentPassword, newPassword, code } = req.body;

    if (!currentPassword || !newPassword || !code) {
      return res.status(400).json({ message: "Current password, new password and code required" });
    }

    const userResult = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE id = $1",
      [decoded.id]
    );
    if (!userResult.rows.length) return res.status(404).json({ message: "User not found" });

    const user = userResult.rows[0];
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) return res.status(400).json({ message: "Неверный текущий пароль" });

    const activeCode = await pool.query(
      "SELECT id, code, attempts FROM email_codes WHERE email=$1 AND type='password_change' AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
      [user.email]
    );
    if (!activeCode.rows.length) {
      return res.status(400).json({ message: "Неверный или истёкший код" });
    }

    const codeRow = activeCode.rows[0];
    if (codeRow.attempts >= 5) {
      await pool.query("UPDATE email_codes SET used=TRUE WHERE id=$1", [codeRow.id]);
      return res.status(400).json({ message: "Слишком много попыток. Запросите новый код." });
    }
    if (codeRow.code !== code) {
      await pool.query("UPDATE email_codes SET attempts=attempts+1 WHERE id=$1", [codeRow.id]);
      const left = 4 - codeRow.attempts;
      return res.status(400).json({ message: `Неверный код. Осталось попыток: ${left}` });
    }

    await pool.query("UPDATE email_codes SET used=TRUE WHERE id=$1", [codeRow.id]);
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hashedPassword, decoded.id]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Password change error:", err);
    res.status(500).json({ message: "Internal error" });
  }
});




router.get("/profile/:id", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  let currentUserId = null;
  if (token) {
    try { currentUserId = jwt.verify(token, JWT_SECRET).id; } catch {}
  }

  try {
    const userId = req.params.id;
    const result = await pool.query(
      `SELECT id, email, username, avatar_url, role, created_at,
        (SELECT COUNT(*) FROM clothes WHERE owner_id = $1) as clothes_count,
        (SELECT COUNT(*) FROM outfits WHERE owner_id = $1) as outfits_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = $1) as posts_count,
        (SELECT COUNT(*) FROM user_follows WHERE following_id = $1) as followers_count,
        (SELECT COUNT(*) FROM user_follows WHERE follower_id = $1) as following_count
       FROM users WHERE id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    let isFollowing = false;
    if (currentUserId && currentUserId !== parseInt(userId)) {
      const followRes = await pool.query(
        "SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2",
        [currentUserId, userId],
      );
      isFollowing = followRes.rows.length > 0;
    }

    res.json({ user: { ...result.rows[0], is_following: isFollowing } });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});




router.post("/users/:id/follow", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const targetId = parseInt(req.params.id);

    if (decoded.id === targetId) {
      return res.status(400).json({ message: "Cannot follow yourself" });
    }

    await pool.query(
      "INSERT INTO user_follows(follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [decoded.id, targetId],
    );

    res.json({ following: true });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});




router.delete("/users/:id/follow", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const targetId = req.params.id;

    await pool.query(
      "DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2",
      [decoded.id, targetId],
    );

    res.json({ following: false });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});




router.get("/users/:id/followers", async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url
       FROM user_follows uf
       JOIN users u ON u.id = uf.follower_id
       WHERE uf.following_id = $1
       ORDER BY uf.created_at DESC`,
      [userId],
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});




router.get("/users/:id/following", async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url
       FROM user_follows uf
       JOIN users u ON u.id = uf.following_id
       WHERE uf.follower_id = $1
       ORDER BY uf.created_at DESC`,
      [userId],
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});




router.get("/users", requireRole(["admin", "moderator"]), async (req, res) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = "";
    const params = [];

    if (role) {
      params.push(role);
      whereClause += `WHERE role = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      whereClause += `${whereClause ? " AND" : "WHERE"} (username ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM users ${whereClause}`,
      params,
    );
    const totalCount = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, email, username, role, avatar_url, is_banned, created_at,
        (SELECT COUNT(*) FROM clothes WHERE owner_id = users.id) as clothes_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = users.id) as posts_count
       FROM users ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ message: "Internal error" });
  }
});




router.get("/users/search", async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ users: [] });
  }
  try {
    const result = await pool.query(
      `SELECT id, username, avatar_url
       FROM users
       WHERE username ILIKE $1 AND is_banned = FALSE
       ORDER BY username
       LIMIT 20`,
      [`%${q.trim()}%`],
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});




router.get(
  "/users/:id",
  requireRole(["admin", "moderator"]),
  async (req, res) => {
    try {
      const userId = req.params.id;
      const result = await pool.query(
        `SELECT id, email, username, role, avatar_url, is_banned, ban_until, ban_reason, created_at,
        (SELECT COUNT(*) FROM clothes WHERE owner_id = $1) as clothes_count,
        (SELECT COUNT(*) FROM outfits WHERE owner_id = $1) as outfits_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = $1) as posts_count
       FROM users WHERE id = $1`,
        [userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ user: result.rows[0] });
    } catch (err) {
      res.status(500).json({ message: "Internal error" });
    }
  },
);




router.put("/users/:id/role", requireRole(["admin"]), async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    if (!["user", "moderator", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const result = await pool.query(
      "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, username, role",
      [role, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});




router.post(
  "/users/:id/ban",
  requireRole(["admin", "moderator"]),
  async (req, res) => {
    try {
      const userId = req.params.id;
      const { banType, banUntil, reason } = req.body;
      const moderatorId = req.user.id;

      if (!["permanent", "temporary", "period"].includes(banType)) {
        return res.status(400).json({ message: "Invalid ban type" });
      }

      
      const userResult = await pool.query(
        "SELECT role FROM users WHERE id = $1",
        [userId],
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      if (userResult.rows[0].role === "admin") {
        return res.status(403).json({ message: "Cannot ban admin users" });
      }

      
      await pool.query(
        `INSERT INTO bans(user_id, moderator_id, ban_type, ban_until, reason)
       VALUES ($1, $2, $3, $4, $5)`,
        [userId, moderatorId, banType, banUntil || null, reason],
      );

      
      await pool.query(
        `UPDATE users SET is_banned = TRUE, ban_until = $1, ban_reason = $2 WHERE id = $3`,
        [banUntil || null, reason, userId],
      );

      res.json({ message: "User banned successfully" });
    } catch (err) {
      console.error("Ban error:", err);
      res.status(500).json({ message: "Internal error" });
    }
  },
);




router.post(
  "/users/:id/unban",
  requireRole(["admin", "moderator"]),
  async (req, res) => {
    try {
      const userId = req.params.id;
      const moderatorId = req.user.id;

      
      await pool.query(
        `UPDATE users SET is_banned = FALSE, ban_until = NULL, ban_reason = NULL WHERE id = $1`,
        [userId],
      );

      
      await pool.query(
        `UPDATE bans SET lifted_at = CURRENT_TIMESTAMP, lifted_by = $1
       WHERE user_id = $2 AND lifted_at IS NULL`,
        [moderatorId, userId],
      );

      res.json({ message: "User unbanned successfully" });
    } catch (err) {
      res.status(500).json({ message: "Internal error" });
    }
  },
);




router.delete("/users/:id", requireRole(["admin"]), async (req, res) => {
  try {
    const userId = req.params.id;

    
    const userResult = await pool.query(
      "SELECT role FROM users WHERE id = $1",
      [userId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    if (userResult.rows[0].role === "admin") {
      return res.status(403).json({ message: "Cannot delete admin users" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Internal error" });
  }
});

// POST /auth/verify-email
router.post("/verify-email", async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: "Email and code required" });

  try {
    // Ищем pending регистрацию с правильным кодом
    const pending = await pool.query(
      "SELECT * FROM pending_registrations WHERE email=$1 AND code=$2 AND expires_at > NOW() LIMIT 1",
      [email, code]
    );

    if (pending.rows.length === 0) {
      return res.status(400).json({ message: "Неверный или устаревший код" });
    }

    const { username, password_hash } = pending.rows[0];

    // Финальная проверка — вдруг за это время кто-то занял email/username
    const conflict = await pool.query(
      "SELECT email, username FROM users WHERE email=$1 OR username=$2",
      [email, username]
    );
    if (conflict.rows.length > 0) {
      await pool.query("DELETE FROM pending_registrations WHERE email=$1", [email]);
      if (conflict.rows[0].email === email) return res.status(409).json({ message: "Email already exists" });
      return res.status(409).json({ message: "Username already exists" });
    }

    // Создаём аккаунт только сейчас
    const userResult = await pool.query(
      `INSERT INTO users(email, username, password_hash, role, is_email_verified)
       VALUES ($1,$2,$3,'user',TRUE)
       RETURNING id, email, username, role, avatar_url, created_at`,
      [email, username, password_hash]
    );

    // Удаляем pending запись
    await pool.query("DELETE FROM pending_registrations WHERE email=$1", [email]);

    const user = userResult.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
        clothesCount: 0,
        outfitsCount: 0,
        postsCount: 0,
      },
    });
  } catch (err) {
    console.error("Verify email error:", err.message, err.code);
    res.status(500).json({ message: "Internal error" });
  }
});




// POST /auth/resend-verification
router.post("/resend-verification", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email required" });

  try {
    // Проверяем что pending запись существует
    const pending = await pool.query(
      "SELECT 1 FROM pending_registrations WHERE email=$1 LIMIT 1",
      [email]
    );
    if (pending.rows.length === 0) return res.status(404).json({ message: "Регистрация не найдена. Начните заново." });

    // Rate limit: не чаще раза в минуту
    const recent = await pool.query(
      "SELECT 1 FROM pending_registrations WHERE email=$1 AND created_at > NOW() - INTERVAL '1 minute' LIMIT 1",
      [email]
    );
    if (recent.rows.length > 0) return res.status(429).json({ message: "Подождите минуту перед повторной отправкой" });

    const code = generateCode();
    await pool.query(
      "UPDATE pending_registrations SET code=$1, expires_at=NOW() + INTERVAL '15 minutes', created_at=NOW() WHERE email=$2",
      [code, email]
    );
    res.json({ message: "Code resent" });
    sendVerificationEmail(email, code).catch(err => console.error("Resend mail error:", err.message));
  } catch (err) {
    console.error("Resend error:", err.message);
    res.status(500).json({ message: "Internal error" });
  }
});




// POST /auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email required" });

  try {
    const userResult = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    // Не сообщаем найден ли пользователь — защита от перебора
    if (userResult.rows.length === 0) return res.json({ message: "If this email is registered, a code has been sent" });

    const recent = await pool.query(
      "SELECT 1 FROM email_codes WHERE email=$1 AND type='password_reset' AND created_at > NOW() - INTERVAL '1 minute' LIMIT 1",
      [email]
    );
    if (recent.rows.length > 0) return res.status(429).json({ message: "Подождите минуту перед повторной отправкой" });

    await pool.query("UPDATE email_codes SET used=TRUE WHERE email=$1 AND type='password_reset'", [email]);
    const code = generateCode();
    await pool.query(
      "INSERT INTO email_codes(email, code, type, expires_at) VALUES ($1,$2,'password_reset', NOW() + INTERVAL '15 minutes')",
      [email, code]
    );

    res.json({ message: "If this email is registered, a code has been sent" });
    sendPasswordResetEmail(email, code).catch(err => console.error("Failed to send reset email:", err));
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ message: "Internal error" });
  }
});




// POST /auth/reset-password
router.post("/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ message: "All fields required" });
  if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  try {
    // Находим активный код (не используем значение code ещё)
    const activeCode = await pool.query(
      `SELECT * FROM email_codes
       WHERE email=$1 AND type='password_reset' AND used=FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (activeCode.rows.length === 0) return res.status(400).json({ message: "Неверный или устаревший код" });

    const row = activeCode.rows[0];

    // Блокируем после 5 неудачных попыток
    if (row.attempts >= 5) {
      await pool.query("UPDATE email_codes SET used=TRUE WHERE id=$1", [row.id]);
      return res.status(400).json({ message: "Слишком много попыток. Запросите новый код." });
    }

    if (row.code !== code) {
      await pool.query("UPDATE email_codes SET attempts=attempts+1 WHERE id=$1", [row.id]);
      const left = 4 - row.attempts;
      return res.status(400).json({ message: `Неверный код. Осталось попыток: ${left}` });
    }

    await pool.query("UPDATE email_codes SET used=TRUE WHERE id=$1", [row.id]);
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query("UPDATE users SET password_hash=$1 WHERE email=$2", [hashedPassword, email]);

    res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Internal error" });
  }
});


module.exports = router;
module.exports.requireRole = requireRole;
