const pool = require('../config/db');

class Firm {
  static async create({
    firm_name,
    firm_type,
    establishment_date,
    registering_advocate_name,
    bar_enrollment_number,
    enrollment_date,
    state_bar_council,
    email,
    mobile,
    landline = null,
    office_address = null,
    city = null,
    district = null,
    state = null,
    pin_code = null,
    pan_number = null,
    gst_number = null,
    approval_status = 'PENDING',
    admin_user_id = null,
    is_active = true,
  }, db = pool) {
    const result = await db.query(
      `INSERT INTO firms (
        firm_name, firm_type, establishment_date,
        registering_advocate_name, bar_enrollment_number, enrollment_date, state_bar_council,
        email, mobile, landline,
        office_address, city, district, state, pin_code,
        pan_number, gst_number,
        approval_status, admin_user_id, is_active,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        firm_name, firm_type, establishment_date,
        registering_advocate_name, bar_enrollment_number, enrollment_date, state_bar_council,
        email, mobile, landline,
        office_address, city, district, state, pin_code,
        pan_number, gst_number,
        approval_status, admin_user_id, is_active !== false,
      ]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM firms WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await pool.query('SELECT * FROM firms WHERE email = $1', [email]);
    return result.rows[0];
  }

  static async findByAdminUserId(adminUserId) {
    const result = await pool.query('SELECT * FROM firms WHERE admin_user_id = $1', [adminUserId]);
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
    const query = `UPDATE firms SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findAllPending() {
    const result = await pool.query(
      "SELECT * FROM firms WHERE approval_status = 'PENDING' ORDER BY created_at DESC"
    );
    return result.rows;
  }

  static async findAllApproved() {
    const result = await pool.query(
      "SELECT * FROM firms WHERE approval_status = 'APPROVED' ORDER BY created_at DESC"
    );
    return result.rows;
  }

  /**
   * Enable/disable an entire firm.
   * When disabling: sets firm.is_active=false, disables all member users, clears their sessions.
   * When enabling: sets firm.is_active=true only (members stay as-is until re-enabled individually).
   */
  static async setActive(firmId, isActive) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const firmResult = await client.query(
        `UPDATE firms SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        [!!isActive, firmId]
      );
      const firm = firmResult.rows[0];
      if (!firm) {
        await client.query('ROLLBACK');
        return null;
      }

      if (!isActive) {
        const members = await client.query(
          `SELECT user_id FROM firm_users WHERE firm_id = $1
           UNION
           SELECT admin_user_id AS user_id FROM firms WHERE id = $1 AND admin_user_id IS NOT NULL`,
          [firmId]
        );
        const userIds = [...new Set(members.rows.map((r) => r.user_id).filter(Boolean))];
        if (userIds.length) {
          await client.query(
            `UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
            [userIds]
          );
          await client.query(
            `DELETE FROM user_sessions WHERE user_id = ANY($1::int[])`,
            [userIds]
          );
        }
      } else {
        // Re-enable all firm members when the firm itself is re-enabled
        const members = await client.query(
          `SELECT user_id FROM firm_users WHERE firm_id = $1
           UNION
           SELECT admin_user_id AS user_id FROM firms WHERE id = $1 AND admin_user_id IS NOT NULL`,
          [firmId]
        );
        const userIds = [...new Set(members.rows.map((r) => r.user_id).filter(Boolean))];
        if (userIds.length) {
          await client.query(
            `UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
            [userIds]
          );
        }
      }

      await client.query('COMMIT');
      return firm;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = Firm;

