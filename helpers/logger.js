const pool = require('../db')

async function logAction({ action, actorId, actorUsername, targetType, targetId, targetName, details }) {
  try {
    await pool.query(
      `INSERT INTO logs(action, actor_id, actor_username, target_type, target_id, target_name, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        action,
        actorId   || null,
        actorUsername || null,
        targetType || null,
        targetId  || null,
        targetName || null,
        details   || null,
      ]
    )
  } catch (err) {
    console.error('Logger error:', err.message)
  }
}

module.exports = { logAction }
