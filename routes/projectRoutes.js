// routes/projectRoutes.js

const express = require("express");
const router = express.Router();
const { Pool } = require("pg");

// Create a new pool instance (or import your existing one)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, // Adjust if using production SSL settings
});

// --------------------------
// PROJECT ENDPOINTS
// --------------------------

// Create a new project
router.post("/", async (req, res) => {
  try {
    const {
      job_id,
      quotation_number,
      address,
      manager_id,
      duty_staff,
      hours_required,
      start_date,
      planned_end_date,
      status,
      key_code,
    } = req.body;
    
    if (!job_id) {
      return res.status(400).json({ error: "job_id is required" });
    }
    
    const result = await pool.query(
      `INSERT INTO projects (
          job_id,
          quotation_number,
          address,
          manager_id,
          duty_staff,
          hours_required,
          start_date,
          planned_end_date,
          status,
          key_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'Planned'), $10)
       RETURNING *`,
      [job_id, quotation_number, address, manager_id, duty_staff, hours_required, start_date, planned_end_date, status, key_code]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: "Failed to create project", details: error.message });
  }
});

// Get all projects
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM projects ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Get a specific project by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Update a project by ID
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      quotation_number,
      address,
      manager_id,
      duty_staff,
      hours_required,
      start_date,
      planned_end_date,
      status,
      key_code,
    } = req.body;
    const result = await pool.query(
      `UPDATE projects SET
          quotation_number = $1,
          address = $2,
          manager_id = $3,
          duty_staff = $4,
          hours_required = $5,
          start_date = $6,
          planned_end_date = $7,
          status = $8,
          key_code = $9,
          updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [quotation_number, address, manager_id, duty_staff, hours_required, start_date, planned_end_date, status, key_code, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ error: "Failed to update project", details: error.message });
  }
});

// Delete a project by ID
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM projects WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ error: "Failed to delete project", details: error.message });
  }
});

// --------------------------
// PROJECT FORMS ENDPOINTS
// --------------------------

// Create a new project form
router.post("/forms", async (req, res) => {
  try {
    // Minimal change: Now expect and store "job_id" (instead of "project_id")
    const { job_id, form_type, form_data, attached_files } = req.body;
    if (!job_id) {
      return res.status(400).json({ error: "form_type is required" });
    }
    const normalizedFormType = form_type.trim().toLowerCase();
    const result = await pool.query(
      `INSERT INTO forms (
          job_id,
          form_type,
          form_data,
          attached_files
       ) VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [job_id, normalizedFormType, form_data, attached_files]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating project form:", error);
    res.status(500).json({ error: "Failed to create project form", details: error.message });
  }
});

// Minimal change: Update the GET endpoint to query the "forms" table (which contains filled data)
// instead of "project_forms", since your filled BT form is in "forms" table.
router.get("/forms/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    // Query the forms table (NOT project_forms)
    const result = await pool.query(
      "SELECT * FROM forms WHERE LOWER(TRIM(job_id)) = LOWER(TRIM($1)) ORDER BY created_at DESC",
      [jobId]
    );
    const forms = result.rows.map((f) => ({
      ...f,
      form_type: f.form_type ? f.form_type.trim().toLowerCase() : f.form_type
    }));
    res.json(forms);
  } catch (error) {
    console.error("Error fetching project forms:", error);
    res.status(500).json({ error: "Failed to fetch project forms" });
  }
});


module.exports = router;
