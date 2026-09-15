const pool = require('../config/db');

async function getHeaderPromos() {
  const { rows } = await pool.query(`
    SELECT p.id, p.kind, p.badge, p.title, p.subtitle,
           p.cta_label, p.cta_url, p.background_color, p.text_color,
           p.priority, p.starts_at, p.ends_at, p.location,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
               'seat_capacity', s.seat_capacity, 'seats_booked', s.seats_booked
             ) ORDER BY s.starts_at ASC, s.id ASC)
             FROM marketing_promo_slots s WHERE s.promo_id = p.id
           ), '[]'::json) AS slots
    FROM (
      SELECT * FROM marketing_promos
      WHERE status = 'active' AND show_on_header = TRUE
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY priority DESC, id DESC
      LIMIT 8
    ) p
    ORDER BY p.priority DESC, p.id DESC
  `);
  return rows;
}

module.exports = { getHeaderPromos };
