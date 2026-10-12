//       if (fields[key] !== undefined) {







const pool = require('../config/db');

class User {
  static async create({
    username,
    email,
    password,
    google_uid = null,
    auth_type = 'manual',
    profile_image = null,
    firebase_uid = null,
    role = 'user',
    is_blocked = false,
    razorpay_customer_id = null,
    account_type = 'SOLO',
    approval_status = 'APPROVED',
    first_login = true,
    is_active = true,
    phone = null,
    location = null,
    domain_role = 'OTHER',
    role_id = null
  }, db = pool) {
    const result = await db.query(
      `INSERT INTO users (
        username, email, password, google_uid,
        auth_type, profile_image, firebase_uid,
        role, is_blocked, razorpay_customer_id,
        account_type, approval_status, first_login, is_active,
        phone, location, domain_role, role_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [username, email, password, google_uid, auth_type, profile_image, firebase_uid, role, is_blocked, razorpay_customer_id, account_type, approval_status, first_login, is_active, phone, location, domain_role, role_id]
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async findByGoogleUid(google_uid) {
    const result = await pool.query('SELECT * FROM users WHERE google_uid = $1', [google_uid]);
    return result.rows[0];
  }

  static async findByFirebaseUid(firebase_uid) {
    const result = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [firebase_uid]);
    return result.rows[0];
  }

  static async update(id, fields) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const key in fields) {
      if (fields[key] !== undefined) {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(fields[key]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `UPDATE users SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async delete(id) {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
  }

  static async findAllActive() {
    const result = await pool.query(
      'SELECT id, username, email, role, is_blocked, created_at, updated_at FROM users WHERE is_blocked = false ORDER BY id ASC'
    );
    return result.rows;
  }

  static async findAll() {
    const result = await pool.query(
      'SELECT id, username, email, role, is_blocked, created_at, updated_at FROM users ORDER BY id ASC'
    );
    return result.rows;
  }

  static async touchLogin(id) {
    const result = await pool.query(
      `
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP,
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    return result.rows[0];
  }

  static async touchSeen(id) {
    const result = await pool.query(
      `
        UPDATE users
        SET last_seen_at = CURRENT_TIMESTAMP,
            last_login_at = COALESCE(last_login_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    return result.rows[0];
  }
}

module.exports = User;
