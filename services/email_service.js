const nodemailer = require('nodemailer')
const dns = require('dns').promises
require('dotenv').config()

// Транспортер создаётся лениво с явным резолвингом IPv4
// Без этого Node.js выбирает IPv6 адрес smtp.gmail.com который блокируется на Render
let _transporter = null

async function getTransporter() {
  if (_transporter) return _transporter

  const smtpHostname = process.env.SMTP_HOST || 'smtp.gmail.com'
  let resolvedHost = smtpHostname

  try {
    const addresses = await dns.resolve4(smtpHostname)
    if (addresses.length > 0) {
      resolvedHost = addresses[0]
      console.log(`SMTP: ${smtpHostname} → ${resolvedHost} (IPv4)`)
    }
  } catch (e) {
    console.warn('SMTP: не удалось резолвить IPv4, используем hostname:', e.message)
  }

  _transporter = nodemailer.createTransport({
    host: resolvedHost,
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      // Указываем оригинальный hostname для проверки TLS сертификата
      servername: smtpHostname,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
  })

  return _transporter
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function sendVerificationEmail(email, code) {
  const transporter = await getTransporter()
  await transporter.sendMail({
    from: `"Wardrobe" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Подтверждение регистрации — Wardrobe',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px">
        <h2 style="color:#333;margin-bottom:8px">Добро пожаловать в Wardrobe!</h2>
        <p style="color:#555;margin-bottom:24px">Для завершения регистрации введите код подтверждения:</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#6750A4">${code}</span>
        </div>
        <p style="color:#999;font-size:13px">Код действителен 15 минут. Если вы не регистрировались — просто проигнорируйте это письмо.</p>
      </div>
    `,
  })
}

async function sendPasswordResetEmail(email, code) {
  const transporter = await getTransporter()
  await transporter.sendMail({
    from: `"Wardrobe" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Сброс пароля — Wardrobe',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px">
        <h2 style="color:#333;margin-bottom:8px">Сброс пароля</h2>
        <p style="color:#555;margin-bottom:24px">Введите этот код для сброса пароля:</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#6750A4">${code}</span>
        </div>
        <p style="color:#999;font-size:13px">Код действителен 15 минут. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.</p>
      </div>
    `,
  })
}

module.exports = { generateCode, sendVerificationEmail, sendPasswordResetEmail }
