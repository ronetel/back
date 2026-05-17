const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth_mw')
const validateId = require('../middleware/validate_id')
const pool = require('../db')




router.get('/', async (req, res) => {
  try {
    const { type, event, color, material, season, owner_id } = req.query
    const page = Math.max(parseInt(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200)
    const offset = (page - 1) * limit

    let whereClause = ''
    const params = []

    if (type) {
      params.push(type)
      whereClause += `${whereClause ? ' AND' : 'WHERE'} type = $${params.length}`
    }

    if (event) {
      params.push(event)
      whereClause += `${whereClause ? ' AND' : 'WHERE'} event = $${params.length}`
    }

    if (color) {
      params.push(color)
      whereClause += `${whereClause ? ' AND' : 'WHERE'} color = $${params.length}`
    }

    if (material) {
      params.push(material)
      whereClause += `${whereClause ? ' AND' : 'WHERE'} material = $${params.length}`
    }

    if (season) {
      params.push(season)
      whereClause += `${whereClause ? ' AND' : 'WHERE'} season = $${params.length}`
    }

    if (owner_id) {
      params.push(owner_id)
      whereClause += `${whereClause ? ' AND' : 'WHERE'} owner_id = $${params.length}`
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM clothes ${whereClause}`, params)
    const totalCount = parseInt(countResult.rows[0].count)

    params.push(limit, offset)
    const result = await pool.query(
      `SELECT c.*, u.username as owner_username
       FROM clothes c
       LEFT JOIN users u ON c.owner_id = u.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      clothes: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    })
  } catch (err) {
    console.error('Get clothes error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.get('/:id', validateId, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.username as owner_username
       FROM clothes c
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.id = $1`,
      [req.params.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Cloth not found' })
    }

    res.json({ cloth: result.rows[0] })
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.get('/user/me', auth, async (req, res) => {
  try {
    const { type, event, color, material, season, is_favorite } = req.query
    const page = Math.max(parseInt(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200)
    const userId = req.user.id
    const offset = (page - 1) * limit

    let whereClause = 'WHERE owner_id = $1'
    const params = [userId]

    if (type) {
      params.push(type)
      whereClause += ` AND type = $${params.length}`
    }

    if (event) {
      params.push(event)
      whereClause += ` AND event = $${params.length}`
    }

    if (color) {
      params.push(color)
      whereClause += ` AND color = $${params.length}`
    }

    if (material) {
      params.push(material)
      whereClause += ` AND material = $${params.length}`
    }

    if (season) {
      params.push(season)
      whereClause += ` AND season = $${params.length}`
    }

    if (is_favorite === 'true') {
      whereClause += ` AND is_favorite = TRUE`
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM clothes ${whereClause}`, params)
    const totalCount = parseInt(countResult.rows[0].count)

    params.push(limit, offset)
    const result = await pool.query(
      `SELECT * FROM clothes ${whereClause} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      clothes: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    })
  } catch (err) {
    console.error('Get my clothes error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.get('/type/:type/event/:event', async (req, res) => {
  try {
    const { type, event } = req.params
    const page = Math.max(parseInt(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200)
    const offset = (page - 1) * limit

    let query = 'SELECT * FROM clothes WHERE 1=1'
    const params = []

    if (type && type !== 'all' && type !== 'null') {
      params.push(type)
      query += ` AND type = $${params.length}`
    }

    if (event && event !== 'all' && event !== 'null') {
      params.push(event)
      query += ` AND event = $${params.length}`
    }

    query += ' ORDER BY created_at DESC'

    params.push(limit, offset)
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`

    const result = await pool.query(query, params)
    res.json({ clothes: result.rows })
  } catch (err) {
    console.error('Get clothes by type/event error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.post('/', auth, async (req, res) => {
  try {
    const {
      image_urls,
      processed_image_url,
      name,
      category,
      brand_names,
      descriptions,
      type,
      event = 'casual',
      season,
      size
    } = req.body

    if (!image_urls) {
      return res.status(400).json({ message: 'Image URL is required' })
    }

    const resolvedType = type || 'top'

    const result = await pool.query(
      `INSERT INTO clothes(owner_id, image_urls, processed_image_url, name, category, brand_names, descriptions, type, event, season, size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [req.user.id, image_urls, processed_image_url || null, name || null, category || null, brand_names || null, descriptions || null, resolvedType, event, season || null, size || null]
    )

    res.status(201).json({ cloth: result.rows[0] })
  } catch (err) {
    console.error('Create cloth error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.put('/:id', auth, validateId, async (req, res) => {
  try {
    const clothId = req.params.id
    const userId = req.user.id

    
    const clothResult = await pool.query('SELECT owner_id FROM clothes WHERE id = $1', [clothId])
    if (clothResult.rows.length === 0) {
      return res.status(404).json({ message: 'Cloth not found' })
    }

    
    if (clothResult.rows[0].owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' })
    }

    const {
      name,
      category,
      brand_names,
      descriptions,
      type,
      event,
      season,
      size,
      is_favorite
    } = req.body

    const updates = []
    const values = []
    let paramCount = 1

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`)
      values.push(name)
    }
    if (category !== undefined) {
      updates.push(`category = $${paramCount++}`)
      values.push(category)
    }
    if (brand_names !== undefined) {
      updates.push(`brand_names = $${paramCount++}`)
      values.push(brand_names)
    }
    if (descriptions !== undefined) {
      updates.push(`descriptions = $${paramCount++}`)
      values.push(descriptions)
    }
    if (type !== undefined) {
      updates.push(`type = $${paramCount++}`)
      values.push(type)
    }
    if (event !== undefined) {
      updates.push(`event = $${paramCount++}`)
      values.push(event)
    }
    if (season !== undefined) {
      updates.push(`season = $${paramCount++}`)
      values.push(season)
    }
    if (size !== undefined) {
      updates.push(`size = $${paramCount++}`)
      values.push(size)
    }
    if (is_favorite !== undefined) {
      updates.push(`is_favorite = $${paramCount++}`)
      values.push(is_favorite)
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' })
    }

    values.push(clothId)
    const query = `UPDATE clothes SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`

    const result = await pool.query(query, values)
    res.json({ cloth: result.rows[0] })
  } catch (err) {
    console.error('Update cloth error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.delete('/:id', auth, validateId, async (req, res) => {
  try {
    const clothId = req.params.id
    const userId = req.user.id

    
    const clothResult = await pool.query('SELECT owner_id FROM clothes WHERE id = $1', [clothId])
    if (clothResult.rows.length === 0) {
      return res.status(404).json({ message: 'Cloth not found' })
    }

    
    if (clothResult.rows[0].owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' })
    }

    await pool.query('DELETE FROM clothes WHERE id = $1', [clothId])
    res.json({ message: 'Cloth deleted successfully' })
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.get('/stats/me', auth, async (req, res) => {
  try {
    const userId = req.user.id

    const typeStats = await pool.query(
      `SELECT type, COUNT(*) as count FROM clothes WHERE owner_id = $1 GROUP BY type`,
      [userId]
    )

    const eventStats = await pool.query(
      `SELECT event, COUNT(*) as count FROM clothes WHERE owner_id = $1 GROUP BY event`,
      [userId]
    )

    const colorStats = await pool.query(
      `SELECT color, COUNT(*) as count FROM clothes WHERE owner_id = $1 AND color IS NOT NULL GROUP BY color`,
      [userId]
    )

    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM clothes WHERE owner_id = $1',
      [userId]
    )

    res.json({
      total: parseInt(totalResult.rows[0].total),
      byType: typeStats.rows,
      byEvent: eventStats.rows,
      byColor: colorStats.rows
    })
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' })
  }
})

module.exports = router
