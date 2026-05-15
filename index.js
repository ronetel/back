const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const { Pool } = require('pg')

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

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
