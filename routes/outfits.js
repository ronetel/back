const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth_mw')
const pool = require('../db')
const { analyzeOutfitImage } = require('../services/gemini_service')

async function triggerAnalysis(outfitId, thumbnailUrl, meta = {}) {
  if (!thumbnailUrl) return
  try {
    const tags = await analyzeOutfitImage(thumbnailUrl, meta)
    if (tags) {
      await pool.query('UPDATE outfits SET ai_tags = $1 WHERE id = $2', [JSON.stringify(tags), outfitId])
    }
  } catch (err) {
    console.error(`AI analysis failed for outfit ${outfitId}:`, err.message)
  }
}




router.get('/', auth, async (req, res) => {
  try {
    const { event, season, is_favorite } = req.query
    const page = Math.max(parseInt(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100)
    const userId = req.user.id
    const offset = (page - 1) * limit

    let whereClause = 'WHERE o.owner_id = $1'
    const params = [userId]

    if (event) {
      params.push(event)
      whereClause += ` AND o.event = $${params.length}`
    }

    if (season) {
      params.push(season)
      whereClause += ` AND o.season = $${params.length}`
    }

    if (is_favorite === 'true') {
      whereClause += ` AND o.is_favorite = TRUE`
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM outfits o ${whereClause}`, params)
    const totalCount = parseInt(countResult.rows[0].count)

    params.push(limit, offset)
    const result = await pool.query(
      `SELECT o.*, u.username as owner_username
       FROM outfits o
       JOIN users u ON o.owner_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    
    const outfitsWithClothes = await Promise.all(
      result.rows.map(async (outfit) => {
        if (outfit.clothes_ids && outfit.clothes_ids.length > 0) {
          const clothesResult = await pool.query(
            'SELECT * FROM clothes WHERE id = ANY($1)',
            [outfit.clothes_ids]
          )
          return { ...outfit, clothes: clothesResult.rows }
        }
        return { ...outfit, clothes: [] }
      })
    )

    res.json({
      outfits: outfitsWithClothes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    })
  } catch (err) {
    console.error('Get outfits error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.get('/:id', auth, async (req, res) => {
  try {
    const outfitId = req.params.id
    const userId = req.user.id

    const result = await pool.query(
      `SELECT o.*, u.username as owner_username
       FROM outfits o
       JOIN users u ON o.owner_id = u.id
       WHERE o.id = $1`,
      [outfitId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Outfit not found' })
    }

    const outfit = result.rows[0]

    
    if (outfit.owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' })
    }

    
    if (outfit.clothes_ids && outfit.clothes_ids.length > 0) {
      const clothesResult = await pool.query(
        'SELECT * FROM clothes WHERE id = ANY($1)',
        [outfit.clothes_ids]
      )
      outfit.clothes = clothesResult.rows
    } else {
      outfit.clothes = []
    }

    res.json({ outfit })
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.post('/', auth, async (req, res) => {
  try {
    const { name, description, event = 'casual', season, clothes_ids, thumbnail_url, temp_min, temp_max, where_to_wear } = req.body
    const userId = req.user.id

    if (!name) {
      return res.status(400).json({ message: 'Name is required' })
    }

    
    if (clothes_ids && clothes_ids.length > 0) {
      const clothesResult = await pool.query(
        'SELECT id FROM clothes WHERE id = ANY($1) AND owner_id = $2',
        [clothes_ids, userId]
      )
      if (clothesResult.rows.length !== clothes_ids.length) {
        return res.status(403).json({ message: 'Some clothes do not belong to you' })
      }
    }

    const result = await pool.query(
      `INSERT INTO outfits(owner_id, name, description, event, season, clothes_ids, thumbnail_url, temp_min, temp_max, where_to_wear)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [userId, name, description, event, season, clothes_ids || [], thumbnail_url, temp_min ?? null, temp_max ?? null, where_to_wear || []]
    )

    const outfit = result.rows[0]

    
    if (clothes_ids && clothes_ids.length > 0) {
      const clothesResult = await pool.query(
        'SELECT * FROM clothes WHERE id = ANY($1)',
        [clothes_ids]
      )
      outfit.clothes = clothesResult.rows
    } else {
      outfit.clothes = []
    }

    res.status(201).json({ outfit })

    // async AI analysis — не блокирует ответ
    triggerAnalysis(outfit.id, thumbnail_url, { event, season, description })
  } catch (err) {
    console.error('Create outfit error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.put('/:id', auth, async (req, res) => {
  try {
    const outfitId = req.params.id
    const userId = req.user.id

    
    const outfitResult = await pool.query('SELECT owner_id FROM outfits WHERE id = $1', [outfitId])
    if (outfitResult.rows.length === 0) {
      return res.status(404).json({ message: 'Outfit not found' })
    }

    if (outfitResult.rows[0].owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' })
    }

    const { name, description, event, season, clothes_ids, thumbnail_url, is_favorite, temp_min, temp_max, where_to_wear } = req.body

    
    if (clothes_ids && clothes_ids.length > 0) {
      const clothesResult = await pool.query(
        'SELECT id FROM clothes WHERE id = ANY($1) AND owner_id = $2',
        [clothes_ids, outfitResult.rows[0].owner_id]
      )
      if (clothesResult.rows.length !== clothes_ids.length) {
        return res.status(403).json({ message: 'Some clothes do not belong to the owner' })
      }
    }

    const updates = []
    const values = []
    let paramCount = 1

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`)
      values.push(name)
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`)
      values.push(description)
    }
    if (event !== undefined) {
      updates.push(`event = $${paramCount++}`)
      values.push(event)
    }
    if (season !== undefined) {
      updates.push(`season = $${paramCount++}`)
      values.push(season)
    }
    if (clothes_ids !== undefined) {
      updates.push(`clothes_ids = $${paramCount++}`)
      values.push(clothes_ids)
    }
    if (thumbnail_url !== undefined) {
      updates.push(`thumbnail_url = $${paramCount++}`)
      values.push(thumbnail_url)
    }
    if (is_favorite !== undefined) {
      updates.push(`is_favorite = $${paramCount++}`)
      values.push(is_favorite)
    }
    if (temp_min !== undefined) {
      updates.push(`temp_min = $${paramCount++}`)
      values.push(temp_min)
    }
    if (temp_max !== undefined) {
      updates.push(`temp_max = $${paramCount++}`)
      values.push(temp_max)
    }
    if (where_to_wear !== undefined) {
      updates.push(`where_to_wear = $${paramCount++}`)
      values.push(where_to_wear)
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' })
    }

    values.push(outfitId)
    const query = `UPDATE outfits SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`

    const result = await pool.query(query, values)
    const outfit = result.rows[0]

    
    if (outfit.clothes_ids && outfit.clothes_ids.length > 0) {
      const clothesResult = await pool.query(
        'SELECT * FROM clothes WHERE id = ANY($1)',
        [outfit.clothes_ids]
      )
      outfit.clothes = clothesResult.rows
    } else {
      outfit.clothes = []
    }

    res.json({ outfit })

    // повторный анализ если thumbnail изменился
    if (thumbnail_url) {
      triggerAnalysis(outfit.id, thumbnail_url, {
        event: outfit.event,
        season: outfit.season,
        description: outfit.description,
      })
    }
  } catch (err) {
    console.error('Update outfit error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.post('/:id/analyze', auth, async (req, res) => {
  try {
    const outfitId = req.params.id
    const userId = req.user.id

    const result = await pool.query(
      'SELECT * FROM outfits WHERE id = $1 AND owner_id = $2',
      [outfitId, userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Outfit not found' })
    }

    const outfit = result.rows[0]

    if (!outfit.thumbnail_url) {
      return res.status(400).json({ message: 'Outfit has no thumbnail image' })
    }

    const tags = await analyzeOutfitImage(outfit.thumbnail_url, {
      event: outfit.event,
      season: outfit.season,
      description: outfit.description,
    })

    if (!tags) {
      return res.status(500).json({ message: 'AI analysis failed' })
    }

    await pool.query('UPDATE outfits SET ai_tags = $1 WHERE id = $2', [JSON.stringify(tags), outfitId])

    res.json({ ai_tags: tags })
  } catch (err) {
    console.error('Analyze outfit error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.delete('/:id', auth, async (req, res) => {
  try {
    const outfitId = req.params.id
    const userId = req.user.id

    const outfitResult = await pool.query('SELECT owner_id FROM outfits WHERE id = $1', [outfitId])
    if (outfitResult.rows.length === 0) {
      return res.status(404).json({ message: 'Outfit not found' })
    }

    if (outfitResult.rows[0].owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' })
    }

    await pool.query('DELETE FROM outfits WHERE id = $1', [outfitId])
    res.json({ message: 'Outfit deleted successfully' })
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.post('/generate', auth, async (req, res) => {
  try {
    const { event = 'casual', temp, date } = req.body
    const userId = req.user.id

    
    let season = 'all-season'
    if (temp !== undefined) {
      if (temp < 5) season = 'winter'
      else if (temp < 15) season = 'autumn'
      else if (temp < 25) season = 'spring'
      else season = 'summer'
    }

    
    const topResult = await pool.query(
      `SELECT id FROM clothes
       WHERE owner_id = $1 AND type = 'top' AND event = $2
       ORDER BY RANDOM() LIMIT 1`,
      [userId, event]
    )

    const bottomResult = await pool.query(
      `SELECT id FROM clothes
       WHERE owner_id = $1 AND type = 'bottom' AND event = $2
       ORDER BY RANDOM() LIMIT 1`,
      [userId, event]
    )

    const shoesResult = await pool.query(
      `SELECT id FROM clothes
       WHERE owner_id = $1 AND type = 'shoes' AND event = $2
       ORDER BY RANDOM() LIMIT 1`,
      [userId, event]
    )

    const clothesIds = []
    if (topResult.rows.length > 0) clothesIds.push(topResult.rows[0].id)
    if (bottomResult.rows.length > 0) clothesIds.push(bottomResult.rows[0].id)
    if (shoesResult.rows.length > 0) clothesIds.push(shoesResult.rows[0].id)

    if (clothesIds.length === 0) {
      return res.status(404).json({ message: 'No clothes available for this event' })
    }

    
    if (date) {
      
      await pool.query(
        'DELETE FROM outfit_schedule WHERE owner_id = $1 AND scheduled_date = $2',
        [userId, date]
      )
    }

    res.json({
      clothesIds,
      season,
      event,
      temp,
      message: 'Outfit generated successfully'
    })
  } catch (err) {
    console.error('Generate outfit error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})




router.get('/date/:date', auth, async (req, res) => {
  try {
    const date = req.params.date 
    const userId = req.user.id

    const year = date.slice(0, 4)
    const month = date.slice(4, 6)
    const day = date.slice(6, 8)
    const dateObj = new Date(year, month - 1, day)
    const begin = new Date(dateObj)
    begin.setHours(0, 0, 0, 0)
    const end = new Date(dateObj)
    end.setHours(23, 59, 59, 999)

    const result = await pool.query(
      `SELECT o.*, os.scheduled_date, os.weather_temp, os.weather_condition
       FROM outfits o
       JOIN outfit_schedule os ON o.id = os.outfit_id
       WHERE os.owner_id = $1 AND os.scheduled_date = $2`,
      [userId, begin]
    )

    res.json({ outfits: result.rows })
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' })
  }
})

module.exports = router
