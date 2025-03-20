// routes/requestStockRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // Adjust based on your connection setup

router.get("/overview", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        urgency,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected
      FROM request_stock
      GROUP BY urgency
      ORDER BY urgency;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch stock request overview:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
