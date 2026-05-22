const axios = require('axios')
require('dotenv').config()

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview',
]

const ANALYSIS_PROMPT = `Ты эксперт по моде и стилю. Проанализируй этот образ одежды и верни JSON-объект.

Верни ТОЛЬКО валидный JSON без markdown-блоков, комментариев и пояснений:
{
  "temp_min": <минимальная комфортная температура в Цельсии, целое число>,
  "temp_max": <максимальная комфортная температура в Цельсии, целое число>,
  "warmth_level": "<cold|cool|moderate|warm|hot>",
  "weather_suitable": ["<sunny|cloudy|rainy|snowy|windy>"],
  "style_tags": ["<casual|formal|sporty|elegant|streetwear|cozy|business|outdoor|beach>"],
  "occasions": ["<casual|workout|formal|meeting|outdoor|night-out|beach|travel>"],
  "season": ["<spring|summer|autumn|winter>"],
  "ai_description": "<одно предложение описание образа на русском языке>"
}

Правила для температуры:
- Лёгкая летняя одежда (майки, шорты): temp_min 20, temp_max 40
- Casual (футболка + джинсы): temp_min 15, temp_max 25
- Осенняя (свитер, лёгкая куртка): temp_min 5, temp_max 15
- Зимняя (пуховик, тёплые вещи): temp_min -20, temp_max 5

Анализируй только то, что видишь на изображении.`

let workingModel = null

async function analyzeOutfitImage(imageUrl, outfitMeta = {}) {
  if (!GROQ_API_KEY) {
    console.warn('GROQ_API_KEY not set — using rule-based fallback')
    return buildRuleBasedTags(outfitMeta)
  }

  const contextHint = buildContextHint(outfitMeta)
  const prompt = contextHint
    ? `${ANALYSIS_PROMPT}\n\nДополнительный контекст: ${contextHint}`
    : ANALYSIS_PROMPT

  const modelsToTry = workingModel ? [workingModel, ...GROQ_MODELS.filter(m => m !== workingModel)] : GROQ_MODELS

  for (const model of modelsToTry) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          max_tokens: 512,
          temperature: 0.1,
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      )

      const text = response.data.choices[0]?.message?.content?.trim()
      if (!text) throw new Error('Empty response from Groq')

      const json = extractJson(text)
      const tags = validateTags(json)

      if (workingModel !== model) {
        workingModel = model
        console.log(`Groq: using model ${model}`)
      }

      return tags
    } catch (err) {
      const status = err.response?.status
      if (status === 429 || status === 404 || status === 400) {
        console.warn(`Groq model ${model} unavailable (${status}), trying next...`)
        if (workingModel === model) workingModel = null
        continue
      }
      console.error(`Groq error with ${model}:`, err.response?.data?.error?.message || err.message)
      break
    }
  }

  console.warn('Groq unavailable — using rule-based fallback')
  return buildRuleBasedTags(outfitMeta)
}

function buildRuleBasedTags(meta) {
  const seasonMap = {
    winter:       { temp_min: -25, temp_max: 2,  warmth: 'cold',     weather: ['snowy', 'cloudy'] },
    autumn:       { temp_min: 5,   temp_max: 15, warmth: 'cool',     weather: ['cloudy', 'rainy'] },
    spring:       { temp_min: 10,  temp_max: 20, warmth: 'moderate', weather: ['sunny', 'cloudy'] },
    summer:       { temp_min: 20,  temp_max: 40, warmth: 'warm',     weather: ['sunny'] },
    'all-season': { temp_min: -5,  temp_max: 30, warmth: 'moderate', weather: ['sunny', 'cloudy'] },
  }

  const eventOccasionMap = {
    casual:      ['casual'],
    workout:     ['workout'],
    formal:      ['formal', 'meeting'],
    meeting:     ['meeting', 'formal'],
    outdoor:     ['outdoor', 'travel'],
    'night-out': ['night-out'],
  }

  const s = seasonMap[meta.season] || seasonMap['all-season']
  const occasions = eventOccasionMap[meta.event] || ['casual']

  return {
    temp_min: s.temp_min,
    temp_max: s.temp_max,
    warmth_level: s.warmth,
    weather_suitable: s.weather,
    style_tags: ['casual'],
    occasions,
    season: meta.season ? [meta.season.replace('all-season', '')] : [],
    ai_description: meta.description || '',
    analyzed_at: new Date().toISOString(),
    source: 'rule-based',
  }
}

function buildContextHint(meta) {
  const parts = []
  if (meta.event) parts.push(`Повод: ${meta.event}`)
  if (meta.season) parts.push(`Сезон: ${meta.season}`)
  if (meta.description) parts.push(`Описание: ${meta.description}`)
  return parts.join(', ')
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON found in response')
  return JSON.parse(match[0])
}

function validateTags(tags) {
  const warmthLevels = ['cold', 'cool', 'moderate', 'warm', 'hot']
  const weatherOptions = ['sunny', 'cloudy', 'rainy', 'snowy', 'windy']
  const styleOptions = ['casual', 'formal', 'sporty', 'elegant', 'streetwear', 'cozy', 'business', 'outdoor', 'beach']
  const occasionOptions = ['casual', 'workout', 'formal', 'meeting', 'outdoor', 'night-out', 'beach', 'travel']
  const seasonOptions = ['spring', 'summer', 'autumn', 'winter']

  return {
    temp_min: typeof tags.temp_min === 'number' ? tags.temp_min : -10,
    temp_max: typeof tags.temp_max === 'number' ? tags.temp_max : 35,
    warmth_level: warmthLevels.includes(tags.warmth_level) ? tags.warmth_level : 'moderate',
    weather_suitable: Array.isArray(tags.weather_suitable)
      ? tags.weather_suitable.filter(w => weatherOptions.includes(w))
      : ['sunny', 'cloudy'],
    style_tags: Array.isArray(tags.style_tags)
      ? tags.style_tags.filter(s => styleOptions.includes(s))
      : ['casual'],
    occasions: Array.isArray(tags.occasions)
      ? tags.occasions.filter(o => occasionOptions.includes(o))
      : ['casual'],
    season: Array.isArray(tags.season)
      ? tags.season.filter(s => seasonOptions.includes(s))
      : [],
    ai_description: typeof tags.ai_description === 'string' ? tags.ai_description : '',
    analyzed_at: new Date().toISOString(),
    source: 'groq',
  }
}

module.exports = { analyzeOutfitImage }
