const express = require('express')
const router = express.Router()
const axios = require('axios')
const auth = require('../middleware/auth_mw')
const pool = require('../db')
require('dotenv').config()

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY

const OW_CONDITION_MAP = {
  Clear: 'sunny',
  Clouds: 'cloudy',
  Rain: 'rainy',
  Drizzle: 'rainy',
  Thunderstorm: 'rainy',
  Snow: 'snowy',
  Mist: 'cloudy',
  Fog: 'cloudy',
  Haze: 'cloudy',
  Dust: 'cloudy',
  Sand: 'cloudy',
  Ash: 'cloudy',
  Squall: 'windy',
  Tornado: 'windy',
}

router.get('/current', async (req, res) => {
  try {
    const { lat, lon } = req.query

    if (!lat || !lon) {
      return res.status(400).json({ message: 'Latitude and longitude required' })
    }

    const cacheResult = await pool.query(
      `SELECT * FROM weather_cache
       WHERE ABS(lat - $1) < 0.01 AND ABS(lng - $2) < 0.01
       AND fetched_at > NOW() - INTERVAL '10 minutes'`,
      [lat, lon]
    )

    if (cacheResult.rows.length > 0) {
      return res.json({ weather: cacheResult.rows[0].data })
    }

    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
    )

    const weatherData = response.data

    await pool.query(
      `INSERT INTO weather_cache(lat, lng, data) VALUES ($1, $2, $3)`,
      [lat, lon, JSON.stringify(weatherData)]
    )

    res.json({ weather: weatherData })
  } catch (err) {
    console.error('Weather API error:', err.response?.data || err.message)
    res.status(500).json({ message: 'Failed to fetch weather data' })
  }
})

router.get('/city/:city', async (req, res) => {
  try {
    const city = req.params.city

    if (!OPENWEATHER_API_KEY) {
      return res.status(500).json({ message: 'Weather API key not configured' })
    }

    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=metric`
    )

    res.json({ weather: response.data })
  } catch (err) {
    console.error('Weather city API error:', err.response?.data || err.message)
    if (err.response?.status === 404) {
      return res.status(404).json({ message: 'City not found' })
    }
    res.status(500).json({ message: 'Failed to fetch weather data' })
  }
})

router.get('/forecast', async (req, res) => {
  try {
    const { lat, lon } = req.query

    if (!lat || !lon) {
      return res.status(400).json({ message: 'Latitude and longitude required' })
    }

    if (!OPENWEATHER_API_KEY) {
      return res.status(500).json({ message: 'Weather API key not configured' })
    }

    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
    )

    res.json({ forecast: response.data })
  } catch (err) {
    console.error('Weather forecast API error:', err.response?.data || err.message)
    res.status(500).json({ message: 'Failed to fetch forecast data' })
  }
})

router.get('/recommend', auth, async (req, res) => {
  try {
    const { lat, lon } = req.query
    const userId = req.user.id

    
    let weatherData = null
    let temp = 20
    let weatherCondition = 'Clear'

    if (lat && lon && OPENWEATHER_API_KEY) {
      try {
        const weatherResponse = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
        )
        weatherData = weatherResponse.data
        temp = weatherData.main.temp
        weatherCondition = weatherData.weather?.[0]?.main || 'Clear'
      } catch (err) {
        console.error('Weather fetch error:', err.message)
      }
    }

    const conditionTag = OW_CONDITION_MAP[weatherCondition] || 'sunny'
    const windSpeed = weatherData?.wind?.speed || 0
    const isWindy = windSpeed > 10

    
    const aiResult = await pool.query(
      `SELECT o.*,
        CASE
          WHEN (o.ai_tags->'weather_suitable')::jsonb ? $3 THEN 2
          ELSE 1
        END as relevance_score
       FROM outfits o
       WHERE o.owner_id = $1
         AND o.ai_tags IS NOT NULL
         AND (o.ai_tags->>'temp_min')::numeric <= $2
         AND (o.ai_tags->>'temp_max')::numeric >= $2
       ORDER BY relevance_score DESC, o.is_favorite DESC, o.created_at DESC
       LIMIT 10`,
      [userId, temp, conditionTag]
    )

    
    let fallbackOutfits = []
    if (aiResult.rows.length < 3) {
      const season = getSeasonFromTemp(temp)
      const fallbackResult = await pool.query(
        `SELECT o.* FROM outfits o
         WHERE o.owner_id = $1
           AND o.ai_tags IS NULL
           AND (o.season = $2 OR o.season = 'all-season' OR o.season IS NULL)
         ORDER BY o.is_favorite DESC, o.created_at DESC
         LIMIT $3`,
        [userId, season, 10 - aiResult.rows.length]
      )
      fallbackOutfits = fallbackResult.rows
    }

    const allOutfits = [...aiResult.rows, ...fallbackOutfits]

    
    const outfitsWithClothes = await Promise.all(
      allOutfits.map(async (outfit) => {
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

    const totalUnanalyzed = await pool.query(
      'SELECT COUNT(*) FROM outfits WHERE owner_id = $1 AND ai_tags IS NULL AND thumbnail_url IS NOT NULL',
      [userId]
    )

    res.json({
      weather: weatherData,
      temp,
      condition: conditionTag,
      recommendations: {
        temp,
        season: getSeasonFromTemp(temp),
        suggestions: getClothingSuggestions(temp, conditionTag, isWindy),
      },
      outfits: outfitsWithClothes,
      unanalyzed_count: parseInt(totalUnanalyzed.rows[0].count),
    })
  } catch (err) {
    console.error('Weather recommend error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

router.post('/analyze-all', auth, async (req, res) => {
  const { analyzeOutfitImage } = require('../services/gemini_service')
  const userId = req.user.id

  try {
    const result = await pool.query(
      `SELECT id, thumbnail_url, event, season, description
       FROM outfits
       WHERE owner_id = $1 AND ai_tags IS NULL AND thumbnail_url IS NOT NULL
       LIMIT 20`,
      [userId]
    )

    res.json({ queued: result.rows.length, message: 'Analysis started in background' })

    
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    for (const outfit of result.rows) {
      try {
        const tags = await analyzeOutfitImage(outfit.thumbnail_url, {
          event: outfit.event,
          season: outfit.season,
          description: outfit.description,
        })
        if (tags) {
          await pool.query('UPDATE outfits SET ai_tags = $1 WHERE id = $2', [JSON.stringify(tags), outfit.id])
          console.log(`Analyzed outfit ${outfit.id}: ${tags.source || 'gemini'}`)
        }
        await delay(2000)
      } catch (err) {
        console.error(`Failed to analyze outfit ${outfit.id}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Analyze-all error:', err)
  }
})

function getSeasonFromTemp(temp) {
  if (temp < 5) return 'winter'
  if (temp < 15) return 'autumn'
  if (temp < 25) return 'spring'
  return 'summer'
}

function getClothingSuggestions(temp, condition, isWindy) {
  const suggestions = []

  if (temp < 0) {
    suggestions.push('Очень холодно! Нужна тёплая зимняя куртка')
    suggestions.push('Шапка и шарф обязательны')
    suggestions.push('Термобельё и тёплая обувь')
  } else if (temp < 10) {
    suggestions.push('Прохладно, возьмите куртку или пальто')
    suggestions.push('Свитер или тёплый лонгслив')
    suggestions.push('Закрытая обувь')
  } else if (temp < 20) {
    suggestions.push('Умеренная температура')
    suggestions.push('Лонгслив или футболка с кардиганом')
    suggestions.push('Джинсы или брюки')
  } else if (temp < 30) {
    suggestions.push('Тепло! Лёгкая одежда')
    suggestions.push('Футболка или рубашка')
    suggestions.push('Шорты или лёгкие брюки')
  } else {
    suggestions.push('Жарко! Максимально лёгкая одежда')
    suggestions.push('Светлые ткани, натуральные материалы')
    suggestions.push('Головной убор от солнца')
  }

  if (condition === 'rainy') suggestions.push('Возьмите зонт или дождевик')
  if (condition === 'snowy') suggestions.push('Водонепроницаемая обувь обязательна')
  if (isWindy) suggestions.push('Ветрено — надевайте ветровку или плотную куртку')

  return suggestions
}

module.exports = router
