const { Resend } = require('resend')
require('dotenv').config()

const resend = new Resend(process.env.RESEND_API_KEY)

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function sendMail(to, subject, html) {
  await resend.emails.send({
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

module.exports = { generateCode, sendVerificationEmail, sendPasswordResetEmail }
