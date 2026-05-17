const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const dotenv = require('dotenv')
const { Pool } = require('pg')

dotenv.config()

const app = express()

// Render и другие облачные платформы работают за прокси
app.set('trust proxy', 1)

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

// CORS — разрешаем только мобильный клиент и localhost для разработки
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:8000',
      'http://localhost:3000',
      'https://back-200y.onrender.com',
    ]
    // Мобильное приложение не имеет origin (null) — разрешаем
    if (!origin || allowed.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
}))

// Rate limiting — глобально: 200 запросов / 15 мин с одного IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Слишком много запросов, подождите немного' },
})

// Строгий лимит для auth эндпоинтов: 10 попыток / 15 мин
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Слишком много попыток, попробуйте через 15 минут' },
})

app.use(globalLimiter)
app.use('/auth/login', authLimiter)
app.use('/auth/register', authLimiter)
app.use('/auth/forgot-password', authLimiter)

app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))

const port = process.env.PORT || 8000


const pool = new Pool({ connectionString: process.env.DATABASE_URL })


app.locals.pool = pool


app.get('/', (req, res) => res.json({
  status: 'ok',
  service: 'Wardrobe API',
  version: '1.0.0'
}))



const authRouter = require('./routes/auth')
const clothesRouter = require('./routes/clothes')
const outfitsRouter = require('./routes/outfits')
const uploadRouter = require('./routes/upload')
const postsRouter = require('./routes/posts')


const adminRouter = require('./routes/admin')
const weatherRouter = require('./routes/weather')


app.use('/auth', authRouter)
app.use('/clothes', clothesRouter)
app.use('/outfits', outfitsRouter)
app.use('/upload', uploadRouter)
app.use('/posts', postsRouter)
app.use('/admin', adminRouter)
app.use('/weather', weatherRouter)


app.use((err, req, res, next) => {
  console.error('Error:', err)
  res.status(500).json({ message: 'Internal server error' })
})


app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint not found' })
})

async function runMigrations() {
  const fs = require('fs')
  const path = require('path')
  const migrationsDir = path.join(__dirname, 'sql', 'migrations')
  if (!fs.existsSync(migrationsDir)) return

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    try {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      await pool.query(sql)
      console.log(`Migration applied: ${file}`)
    } catch (err) {
      console.error(`Migration error in ${file}:`, err.message)
    }
  }
}

app.listen(port, async () => {
  console.log(`Wardrobe backend listening on port ${port}`)
  console.log(`Database URL: ${process.env.DATABASE_URL ? 'configured' : 'NOT SET'}`)
  console.log(`Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'NOT SET'}`)
  console.log(`OpenWeather API: ${process.env.OPENWEATHER_API_KEY ? 'configured' : 'NOT SET'}`)
  console.log(`Gemini API: ${process.env.GEMINI_API_KEY ? 'configured' : 'NOT SET'}`)
  console.log(`Groq API: ${process.env.GROQ_API_KEY ? 'configured' : 'NOT SET (rule-based fallback will be used)'}`)
  console.log(`SMTP: ${process.env.SMTP_USER ? `configured (${process.env.SMTP_USER})` : 'NOT SET — emails will not be sent!'}`)
  await runMigrations()
})


process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully')
  pool.end()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully')
  pool.end()
  process.exit(0)
})
