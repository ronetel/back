const express = require('express')
const router = express.Router()
const pool = require('../db')
const auth = require('../middleware/auth_mw')
const { logAction } = require('../helpers/logger')

const isMod = (role) => ['moderator', 'admin'].includes(role)
const isAdmin = (role) => role === 'admin'

router.get('/posts', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { page = 1, limit = 30, search = '' } = req.query
    const offset = (page - 1) * limit
    const searchParam = `%${search}%`

    const count = await pool.query(
      `SELECT COUNT(*) FROM posts p
       JOIN users u ON p.author_id = u.id
       WHERE u.username ILIKE $1 OR p.content ILIKE $1`,
      [searchParam]
    )

    const result = await pool.query(
      `SELECT p.id, p.content, p.title, p.is_hidden, p.tags, p.image_urls,
              p.created_at, p.report_reason,
              u.id as author_id, u.username, u.avatar_url,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
              (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
       FROM posts p JOIN users u ON p.author_id = u.id
       WHERE u.username ILIKE $1 OR p.content ILIKE $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [searchParam, limit, offset]
    )

    res.json({
      posts: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count.rows[0].count) }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.put('/posts/:id/hide', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { isHidden, reason } = req.body
    const result = await pool.query(
      `UPDATE posts SET is_hidden = $1, report_reason = $2 WHERE id = $3
       RETURNING id, content, is_hidden`,
      [isHidden, reason || null, req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ message: 'Пост не найден' })

    await logAction({
      action: isHidden ? 'HIDE_POST' : 'SHOW_POST',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'post', targetId: result.rows[0].id,
      targetName: `Пост #${result.rows[0].id}`,
      details: reason ? `Причина: ${reason}` : null
    })

    res.json({ post: result.rows[0] })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.put('/posts/:id/content', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { content } = req.body
    const result = await pool.query(
      `UPDATE posts SET content = $1 WHERE id = $2 RETURNING id, content`,
      [content, req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ message: 'Пост не найден' })

    await logAction({
      action: 'EDIT_POST',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'post', targetId: result.rows[0].id,
      targetName: `Пост #${result.rows[0].id}`,
    })

    res.json({ post: result.rows[0] })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.delete('/posts/:id', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const check = await pool.query('SELECT id FROM posts WHERE id = $1', [req.params.id])
    if (!check.rows.length) return res.status(404).json({ message: 'Пост не найден' })

    await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id])

    await logAction({
      action: 'DELETE_POST',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'post', targetId: parseInt(req.params.id),
      targetName: `Пост #${req.params.id}`,
    })

    res.json({ message: 'Пост удалён' })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.get('/comments', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { page = 1, limit = 30, search = '' } = req.query
    const offset = (page - 1) * limit
    const searchParam = `%${search}%`

    const count = await pool.query(
      `SELECT COUNT(*) FROM comments c JOIN users u ON c.author_id = u.id
       WHERE c.content ILIKE $1 OR u.username ILIKE $1`,
      [searchParam]
    )

    const result = await pool.query(
      `SELECT c.id, c.content, c.is_hidden, c.created_at, c.post_id,
              u.id as author_id, u.username, u.avatar_url
       FROM comments c JOIN users u ON c.author_id = u.id
       WHERE c.content ILIKE $1 OR u.username ILIKE $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [searchParam, limit, offset]
    )

    res.json({
      comments: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count.rows[0].count) }
    })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.put('/comments/:id/hide', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { isHidden } = req.body
    const result = await pool.query(
      `UPDATE comments SET is_hidden = $1 WHERE id = $2 RETURNING id, is_hidden`,
      [isHidden, req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ message: 'Комментарий не найден' })

    await logAction({
      action: isHidden ? 'HIDE_COMMENT' : 'SHOW_COMMENT',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'comment', targetId: result.rows[0].id,
      targetName: `Комментарий #${result.rows[0].id}`,
    })

    res.json({ comment: result.rows[0] })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.put('/comments/:id/content', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { content } = req.body
    if (!content?.trim()) return res.status(400).json({ message: 'Контент не может быть пустым' })
    const result = await pool.query(
      `UPDATE comments SET content = $1 WHERE id = $2 RETURNING id, content`,
      [content.trim(), req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ message: 'Комментарий не найден' })

    await logAction({
      action: 'EDIT_COMMENT',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'comment', targetId: result.rows[0].id,
    })

    res.json({ comment: result.rows[0] })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.delete('/comments/:id', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const check = await pool.query('SELECT id FROM comments WHERE id = $1', [req.params.id])
    if (!check.rows.length) return res.status(404).json({ message: 'Комментарий не найден' })

    await pool.query('DELETE FROM comments WHERE id = $1', [req.params.id])

    await logAction({
      action: 'DELETE_COMMENT',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'comment', targetId: parseInt(req.params.id),
      targetName: `Комментарий #${req.params.id}`,
    })

    res.json({ message: 'Комментарий удалён' })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.get('/users', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { page = 1, limit = 30, search = '', role } = req.query
    const offset = (page - 1) * limit
    const searchParam = `%${search}%`

    const conditions = ['(username ILIKE $1 OR email ILIKE $1)']
    const params = [searchParam]

    if (role) { params.push(role); conditions.push(`role = $${params.length}`) }

    const where = `WHERE ${conditions.join(' AND ')}`

    const count = await pool.query(`SELECT COUNT(*) FROM users ${where}`, params)

    params.push(limit, offset)
    const result = await pool.query(
      `SELECT id, email, username, role, avatar_url, is_banned, ban_until, ban_reason,
              created_at,
              (SELECT COUNT(*) FROM clothes WHERE owner_id = users.id) as clothes_count,
              (SELECT COUNT(*) FROM posts WHERE author_id = users.id) as posts_count
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      users: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count.rows[0].count) }
    })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.post('/users/:id/ban', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const { banUntil, reason } = req.body  

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Укажите причину блокировки' })
    }

    const userResult = await pool.query('SELECT username, role FROM users WHERE id = $1', [req.params.id])
    if (!userResult.rows.length) return res.status(404).json({ message: 'Пользователь не найден' })
    if (userResult.rows[0].role === 'admin') {
      return res.status(403).json({ message: 'Нельзя заблокировать администратора' })
    }

    const banType = banUntil ? 'temporary' : 'permanent'

    await pool.query(
      `INSERT INTO bans(user_id, moderator_id, ban_type, ban_until, reason) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, req.user.id, banType, banUntil || null, reason.trim()]
    )

    await pool.query(
      `UPDATE users SET is_banned = TRUE, ban_until = $1, ban_reason = $2 WHERE id = $3`,
      [banUntil || null, reason.trim(), req.params.id]
    )

    await logAction({
      action: 'BAN_USER',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'user', targetId: parseInt(req.params.id),
      targetName: userResult.rows[0].username,
      details: `Причина: ${reason.trim()}. До: ${banUntil ? new Date(banUntil).toLocaleString('ru') : 'навсегда'}`
    })

    res.json({ message: 'Пользователь заблокирован' })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.post('/users/:id/unban', auth, async (req, res) => {
  if (!isMod(req.user.role)) return res.status(403).json({ message: 'Недостаточно прав' })
  try {
    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id])
    if (!userResult.rows.length) return res.status(404).json({ message: 'Пользователь не найден' })

    await pool.query(
      `UPDATE users SET is_banned = FALSE, ban_until = NULL, ban_reason = NULL WHERE id = $1`,
      [req.params.id]
    )
    await pool.query(
      `UPDATE bans SET lifted_at = NOW(), lifted_by = $1 WHERE user_id = $2 AND lifted_at IS NULL`,
      [req.user.id, req.params.id]
    )

    await logAction({
      action: 'UNBAN_USER',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'user', targetId: parseInt(req.params.id),
      targetName: userResult.rows[0].username,
    })

    res.json({ message: 'Пользователь разблокирован' })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.put('/users/:id/role', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ message: 'Требуются права администратора' })
  try {
    const { role } = req.body
    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Недопустимая роль' })
    }

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
      [role, req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ message: 'Пользователь не найден' })

    const roleLabels = { user: 'Пользователь', moderator: 'Модератор', admin: 'Администратор' }

    await logAction({
      action: 'CHANGE_ROLE',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'user', targetId: result.rows[0].id,
      targetName: result.rows[0].username,
      details: `Новая роль: ${roleLabels[role]}`
    })

    res.json({ user: result.rows[0] })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.delete('/users/:id', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ message: 'Требуются права администратора' })
  try {
    const userResult = await pool.query('SELECT username, role FROM users WHERE id = $1', [req.params.id])
    if (!userResult.rows.length) return res.status(404).json({ message: 'Пользователь не найден' })
    if (userResult.rows[0].role === 'admin') {
      return res.status(403).json({ message: 'Нельзя удалить администратора' })
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id])

    await logAction({
      action: 'DELETE_USER',
      actorId: req.user.id, actorUsername: req.user.username,
      targetType: 'user', targetId: parseInt(req.params.id),
      targetName: userResult.rows[0].username,
    })

    res.json({ message: 'Аккаунт удалён' })
  } catch (err) {
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

router.get('/logs', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ message: 'Требуются права администратора' })
  try {
    const { page = 1, limit = 50, action, actor, search, from, to } = req.query
    const offset = (page - 1) * limit

    const conditions = []
    const params = []

    if (action) { params.push(action); conditions.push(`action = $${params.length}`) }
    if (actor) { params.push(`%${actor}%`); conditions.push(`actor_username ILIKE $${params.length}`) }
    if (search) {
      params.push(`%${search}%`)
      const n = params.length
      conditions.push(`(details ILIKE $${n} OR target_name ILIKE $${n} OR actor_username ILIKE $${n} OR action ILIKE $${n})`)
    }
    if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`) }
    if (to)   { params.push(to);   conditions.push(`created_at <= $${params.length}`) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query(`SELECT COUNT(*) FROM logs ${where}`, params)
    const total = parseInt(countResult.rows[0].count)

    params.push(limit, offset)
    const result = await pool.query(
      `SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    
    const actionsResult = await pool.query(`SELECT DISTINCT action FROM logs ORDER BY action`)

    res.json({
      logs: result.rows,
      actionTypes: actionsResult.rows.map(r => r.action),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Ошибка сервера' })
  }
})

module.exports = router
