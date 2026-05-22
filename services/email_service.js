const nodemailer = require('nodemailer')
const axios = require('axios')
require('dotenv').config()

const useGmailOAuth = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN)
const useResend = !useGmailOAuth && !!process.env.RESEND_API_KEY

let resendClient = null
if (useResend) {
  const { Resend } = require('resend')
  resendClient = new Resend(process.env.RESEND_API_KEY)
}

const smtpPass = (process.env.SMTP_PASS || '').replace(/\s/g, '')
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  family: 4,
  auth: { user: process.env.SMTP_USER, pass: smtpPass },
})

async function getGmailAccessToken() {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })
  return res.data.access_token
}

async function sendViaGmailApi(to, subject, html) {
  const accessToken = await getGmailAccessToken()
  const from = process.env.SMTP_USER
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
  const mime = [
    `From: Wardrobe <${from}>`,
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n')

  const raw = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/[/]/g, '_').replace(/=+$/, '')

  await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  )
}

async function verifySmtp() {
  if (useGmailOAuth) {
    try {
      await getGmailAccessToken()
      console.log(`Email: Gmail OAuth2 OK (sending as ${process.env.SMTP_USER})`)
    } catch (err) {
      console.error(`Email: Gmail OAuth2 FAILED: ${err.message}`)
    }
    return
  }
  if (useResend) {
    console.log('Email: Resend API (HTTPS)')
    return
  }
  try {
    await transporter.verify()
    console.log(`SMTP OK: ${process.env.SMTP_HOST} as ${process.env.SMTP_USER}`)
  } catch (err) {
    console.error(`SMTP FAILED: ${err.message}`)
  }
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function sendMail(to, subject, html) {
  if (useGmailOAuth) {
    await sendViaGmailApi(to, subject, html)
    return
  }
  if (useResend) {
    const from = process.env.RESEND_FROM || 'Wardrobe <onboarding@resend.dev>'
    const { error } = await resendClient.emails.send({ from, to, subject, html })
    if (error) throw new Error(error.message)
    return
  }
  await transporter.sendMail({ from: `Wardrobe <${process.env.SMTP_USER}>`, to, subject, html })
}

async function sendVerificationEmail(email, code) {
  await sendMail(email, 'Подтверждение регистрации — Wardrobe', `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px">
      <h2 style="color:#333;margin-bottom:8px">Добро пожаловать в Wardrobe!</h2>
      <p style="color:#555;margin-bottom:24px">Для завершения регистрации введите код подтверждения:</p>
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#6750A4">${code}</span>
      </div>
      <p style="color:#999;font-size:13px">Код действителен 15 минут.</p>
    </div>
  `)
}

async function sendPasswordResetEmail(email, code) {
  await sendMail(email, 'Сброс пароля — Wardrobe', `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px">
      <h2 style="color:#333;margin-bottom:8px">Сброс пароля</h2>
      <p style="color:#555;margin-bottom:24px">Введите этот код для сброса пароля:</p>
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#6750A4">${code}</span>
      </div>
      <p style="color:#999;font-size:13px">Код действителен 15 минут.</p>
    </div>
  `)
}

module.exports = { generateCode, sendVerificationEmail, sendPasswordResetEmail, verifySmtp }
