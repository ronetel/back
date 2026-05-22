const nodemailer = require('nodemailer')
require('dotenv').config()

// Если есть RESEND_API_KEY — используем Resend (HTTP, работает на Render)
// Иначе — nodemailer SMTP (для локальной разработки)
const useResend = !!process.env.RESEND_API_KEY

let resendClient = null
if (useResend) {
  const { Resend } = require('resend')
  resendClient = new Resend(process.env.RESEND_API_KEY)
}

// Google app passwords отображаются с пробелами — убираем их
const smtpPass = (process.env.SMTP_PASS || '').replace(/\s/g, '')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  family: 4,
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
})

async function verifySmtp() {
  if (useResend) {
    console.log('Email: using Resend API (HTTPS) — SMTP not needed')
    return
  }
  try {
    await transporter.verify()
    console.log(`SMTP OK: connected to ${process.env.SMTP_HOST || 'smtp.gmail.com'} as ${process.env.SMTP_USER}`)
  } catch (err) {
    console.error(`SMTP FAILED: ${err.message}`)
    console.error('Email sending will not work. Check SMTP_USER, SMTP_PASS in .env')
  }
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function sendMail(to, subject, html) {
  if (useResend) {
    const from = process.env.RESEND_FROM || 'Wardrobe <onboarding@resend.dev>'
    const { error } = await resendClient.emails.send({ from, to, subject, html })
    if (error) throw new Error(error.message)
    return
  }
  await transporter.sendMail({
    from: `Wardrobe <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  })
}

async function sendVerificationEmail(email, code) {
  await sendMail(
    email,
    'Подтверждение регистрации — Wardrobe',
    `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px">
        <h2 style="color:#333;margin-bottom:8px">Добро пожаловать в Wardrobe!</h2>
        <p style="color:#555;margin-bottom:24px">Для завершения регистрации введите код подтверждения:</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#6750A4">${code}</span>
        </div>
        <p style="color:#999;font-size:13px">Код действителен 15 минут. Если вы не регистрировались — просто проигнорируйте это письмо.</p>
      </div>
    `
  )
}

async function sendPasswordResetEmail(email, code) {
  await sendMail(
    email,
    'Сброс пароля — Wardrobe',
    `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px">
        <h2 style="color:#333;margin-bottom:8px">Сброс пароля</h2>
        <p style="color:#555;margin-bottom:24px">Введите этот код для сброса пароля:</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#6750A4">${code}</span>
        </div>
        <p style="color:#999;font-size:13px">Код действителен 15 минут. Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.</p>
      </div>
    `
  )
}

module.exports = { generateCode, sendVerificationEmail, sendPasswordResetEmail, verifySmtp }
