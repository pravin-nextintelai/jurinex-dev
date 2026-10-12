const pool = require('../config/db');

class FirmUser {
  static async create({
    firm_id,
    user_id,
    role = 'STAFF'
  }, db = pool) {
    const result = await db.query(
      `INSERT INTO firm_users (
        firm_id, user_id, role, created_at
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      RETURNING *`,
      [firm_id, user_id, role]
    );
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await pool.query(
      `SELECT fu.*, f.firm_name, f.firm_type 
       FROM firm_users fu
       JOIN firms f ON fu.firm_id = f.id
       WHERE fu.user_id = $1`,
      [userId]
    );
    return result.rows[0];
  }

  static async findByFirmId(firmId) {
    const result = await pool.query(
      `SELECT fu.*, u.username, u.email, u.phone, u.is_active, u.auth_type, u.account_type,
              u.is_blocked, u.first_login, u.created_at, u.updated_at, u.last_login_at, u.last_seen_at
       FROM firm_users fu
       JOIN users u ON fu.user_id = u.id
       WHERE fu.firm_id = $1
       ORDER BY fu.created_at DESC`,
      [firmId]
    );
    return result.rows;
  }

  /** Get list of user_ids that belong to this firm (for document-service firm-scoped case visibility) */
  static async getUserIdsByFirmId(firmId) {
    const result = await pool.query(
      'SELECT user_id FROM firm_users WHERE firm_id = $1',
      [firmId]
    );
    return (result.rows || []).map((r) => r.user_id);
  }

  static async findAdminByFirmId(firmId) {
    const result = await pool.query(
      `SELECT fu.*, u.username, u.email, u.phone
       FROM firm_users fu
       JOIN users u ON fu.user_id = u.id
       WHERE fu.firm_id = $1 AND fu.role = 'ADMIN'
       LIMIT 1`,
      [firmId]
    );
    return result.rows[0];
  }

  static async updateRole(userId, firmId, newRole) {
    const result = await pool.query(
      `UPDATE firm_users 
       SET role = $1 
       WHERE user_id = $2 AND firm_id = $3
       RETURNING *`,
      [newRole, userId, firmId]
    );
    return result.rows[0];
  }

  static async delete(userId, firmId) {
    const result = await pool.query(
      'DELETE FROM firm_users WHERE user_id = $1 AND firm_id = $2 RETURNING *',
      [userId, firmId]
    );
    return result.rows[0];
  }
}

module.exports = FirmUser;
