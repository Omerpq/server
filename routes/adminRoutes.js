// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const { Pool } = require("pg");

// Example: using a shared pool or create a new one:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// 1) Admin-only middleware
router.use((req, res, next) => {
  // If you have JWT/session middleware, ensure it sets req.user
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized - Please log in" });
  }
  if (req.user.role !== "Administrator") {
    return res.status(403).json({ error: "Forbidden - Admins only" });
  }
  next();
});

/**
 * GET /api/admin/kpis/assignments
 * Returns all role-kpi assignments for building the admin UI
 */
router.get("/kpis/assignments", (req, res) => {
  console.log("DEBUG: Received GET /kpis/assignments. req.user =", req.user);
  res.json({ message: "Hello from /api/admin/kpis/assignments" });

  try {
    // Always return JSON
    const result = await pool.query(`
      SELECT role, kpi_key, is_enabled
      FROM role_kpi_assignments
      ORDER BY role, kpi_key
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching KPI assignments:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/kpis/assignments
 * Insert or update a single role-kpi assignment.
 * Body: { role: "Inventory Manager", kpi_key: "lowInventoryItems", is_enabled: false }
 */
router.post("/kpis/assignments", async (req, res) => {
  console.log("DEBUG: Received POST /kpis/assignments. req.user =", req.user);
  console.log("DEBUG: POST body =", req.body);

  const { role, kpi_key, is_enabled } = req.body;
  if (!role || !kpi_key) {
    return res.status(400).json({ error: "role and kpi_key are required" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO role_kpi_assignments (role, kpi_key, is_enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (role, kpi_key)
      DO UPDATE SET is_enabled = EXCLUDED.is_enabled
      RETURNING *
      `,
      [role.trim(), kpi_key.trim(), is_enabled === undefined ? true : is_enabled]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating KPI assignment:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /api/admin/kpis/assignments
 * Remove a role-kpi assignment completely (optional).
 */
router.delete("/kpis/assignments", async (req, res) => {
  const { role, kpi_key } = req.body;
  if (!role || !kpi_key) {
    return res.status(400).json({ error: "role and kpi_key are required" });
  }

  try {
    await pool.query(
      "DELETE FROM role_kpi_assignments WHERE role = $1 AND kpi_key = $2",
      [role.trim(), kpi_key.trim()]
    );
    res.json({ message: "Assignment deleted" });
  } catch (error) {
    console.error("Error deleting KPI assignment:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/admin/kpis/assignments/role/:role
 * Returns { enabledKpis: [] } for a specific role.
 */
router.get("/kpis/assignments/role/:role", (req, res) => {
  const { role } = req.params;
  try {
    const result = await pool.query(
      `SELECT kpi_key
       FROM role_kpi_assignments
       WHERE role = $1 AND is_enabled = true`,
      [role.trim()]
    );
    const enabledKpis = result.rows.map((r) => r.kpi_key);
    res.json({ enabledKpis });
  } catch (error) {
    console.error("Error fetching KPI assignments for role:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;