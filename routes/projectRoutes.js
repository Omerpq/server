const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const NodeGeocoder = require("node-geocoder");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, // Adjust if using production SSL
});

// Configure node-geocoder with OpenStreetMap provider
const geocoderOptions = {
  provider: "openstreetmap",
};
const geocoder = NodeGeocoder(geocoderOptions);

// --------------------------
// PROJECT ENDPOINTS
// --------------------------

// Create a new project (includes company_id, floor, customer_name, site_worker_id, and lat/long)
router.post("/", async (req, res) => {
  try {
    const {
      job_id,
      quotation_number,
      address,
      manager_id,
      duty_staff,
      site_worker_id,
      driver_id,
      company_id,
      floor,
      customer_name,
      hours_required,
      start_date,
      planned_end_date,
      status,
      key_code,
    } = req.body;

    if (!job_id) {
      return res.status(400).json({ error: "job_id is required" });
    }

    // Geocode the address to get latitude and longitude
    let latitude = null;
    let longitude = null;
    if (address && address.trim()) {
      try {
        const geoRes = await geocoder.geocode(address);
        if (geoRes && geoRes.length > 0) {
          latitude = geoRes[0].latitude;
          longitude = geoRes[0].longitude;
        }
      } catch (geoError) {
        console.error("Geocoding error:", geoError);
        // Proceed without coordinates if geocoding fails
      }
    }

    const result = await pool.query(
      `INSERT INTO projects (
          job_id,
          quotation_number,
          address,
          manager_id,
          duty_staff,
          site_worker_id,
          driver_id,
          company_id,
          floor,
          customer_name,
          hours_required,
          start_date,
          planned_end_date,
          status,
          key_code,
          latitude,
          longitude
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, 'Planned'), $15, $16, $17
       )
       RETURNING *`,
      [
        job_id,
        quotation_number,
        address,
        manager_id,
        duty_staff,
        site_worker_id,
        driver_id,
        company_id,
        floor,
        customer_name,
        hours_required,
        start_date,
        planned_end_date,
        status,
        key_code,
        latitude,
        longitude,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: "Failed to create project", details: error.message });
  }
});

// --------------------------
// COMPANIES ENDPOINTS (MOVED UP)
// --------------------------
router.get("/companies", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM companies ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

router.post("/companies", async (req, res) => {
  try {
    const { name, address, contact_email, contact_phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }
    const result = await pool.query(
      `INSERT INTO companies (name, address, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, address, contact_email, contact_phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating company:", error);
    res.status(500).json({ error: "Failed to create company", details: error.message });
  }
});

router.put("/companies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, contact_email, contact_phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }
    const result = await pool.query(
      `UPDATE companies
       SET name = $1, address = $2, contact_email = $3, contact_phone = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, address, contact_email, contact_phone, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating company:", error);
    res.status(500).json({ error: "Failed to update company", details: error.message });
  }
});

router.delete("/companies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const refResult = await pool.query("SELECT COUNT(*) AS count FROM projects WHERE company_id = $1", [id]);
    const count = parseInt(refResult.rows[0].count, 10);
    console.log(`Company ${id} is referenced by ${count} projects`);
    if (count > 0) {
      return res.status(400).json({ error: "This company has associated projects and cannot be deleted." });
    }
    const result = await pool.query("DELETE FROM companies WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Company not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error deleting company:", error);
    res.status(500).json({ error: "Failed to delete company", details: error.message });
  }
});

// --------------------------
// DASHBOARD ENDPOINT (Live Data)
// --------------------------
router.get("/dashboard", async (req, res) => {
  try {
    /* 
      Unified classification logic for KPI & Chart:
      - Completed: end_date IS NOT NULL
      - Overdue: planned_end_date < NOW() AND end_date IS NULL
      - Active: end_date IS NULL AND (planned_end_date >= NOW() OR planned_end_date IS NULL)
    */
    const kpiResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE end_date IS NOT NULL) AS completed_projects,
        COUNT(*) FILTER (WHERE planned_end_date < NOW() AND end_date IS NULL) AS overdue_projects,
        COUNT(*) FILTER (
          WHERE end_date IS NULL AND (planned_end_date >= NOW() OR planned_end_date IS NULL)
        ) AS active_projects
      FROM projects;
    `);

    const chartResult = await pool.query(`
      SELECT 
        CASE
          WHEN end_date IS NOT NULL THEN 'Completed'
          WHEN planned_end_date < NOW() AND end_date IS NULL THEN 'Overdue'
          ELSE 'Active'
        END AS status,
        COUNT(*) AS count
      FROM projects
      GROUP BY 1
      ORDER BY 1
    `);

    const pendingResult = await pool.query(`
      SELECT COUNT(*) AS pending_approvals
      FROM request_stock
      WHERE approval_status = 'Pending'
    `);

    const approvedResult = await pool.query(`
      SELECT COUNT(*) AS approved_requests
      FROM request_stock
      WHERE approval_status = 'Approved'
    `);

    const rejectedResult = await pool.query(`
      SELECT COUNT(*) AS rejected_requests
      FROM request_stock
      WHERE approval_status = 'Rejected'
    `);

    const lowInventoryResult = await pool.query(`
      SELECT COUNT(*) AS low_inventory_items
      FROM (
        SELECT item_code, SUM(quantity) AS total_quantity
        FROM inventory
        GROUP BY item_code
        HAVING SUM(quantity) < 3
      ) sub;
    `);

    const hoursResult = await pool.query(`
      SELECT 
        job_id,
        EXTRACT(EPOCH FROM (end_date - start_date))/3600 AS hours_worked,
        (SELECT role FROM users WHERE id = projects.manager_id) AS manager_role,
        (SELECT name FROM users WHERE id = projects.manager_id) AS manager_name
      FROM projects
      WHERE end_date IS NOT NULL;
    `);

    let totalHoursWorked = 0;
    hoursResult.rows.forEach((row) => {
      totalHoursWorked += parseFloat(row.hours_worked);
    });
    const avgCompletionTime =
      hoursResult.rows.length > 0 ? totalHoursWorked / hoursResult.rows.length : 0;

    const locationsResult = await pool.query(`
      SELECT latitude, longitude, customer_name AS name
      FROM projects
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `);

    const dashboardData = {
      active_projects: parseInt(kpiResult.rows[0].active_projects || "0", 10),
      completed_projects: parseInt(kpiResult.rows[0].completed_projects || "0", 10),
      overdue_projects: parseInt(kpiResult.rows[0].overdue_projects || "0", 10),
      pendingApprovals: parseInt(pendingResult.rows[0].pending_approvals || "0", 10),
      approvedRequests: parseInt(approvedResult.rows[0].approved_requests || "0", 10),
      rejectedRequests: parseInt(rejectedResult.rows[0].rejected_requests || "0", 10),
      lowInventoryItems: parseInt(lowInventoryResult.rows[0].low_inventory_items || "0", 10),
      totalHoursWorked: Math.round(totalHoursWorked),
      avgCompletionTime: Math.round(avgCompletionTime),
      projectsStatusData: chartResult.rows.map((row) => ({
        status: row.status,
        count: parseInt(row.count, 10),
      })),
      projectLocations: locationsResult.rows,
      hoursDetails: hoursResult.rows,
    };

    console.log("Sending dashboardData to frontend:", dashboardData);
    res.json(dashboardData);
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ error: "Failed to load dashboard data." });
  }
});

// --------------------------
// NEW: INVENTORY ENDPOINT (Low Inventory Items)
// --------------------------
router.get("/inventory/low", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT item_name, SUM(quantity) AS total_quantity, description
      FROM inventory
      GROUP BY item_name, description
      HAVING SUM(quantity) < 3;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching low inventory items:", error);
    res.status(500).json({ error: "Failed to fetch low inventory items" });
  }
});

// --------------------------
// NEW: Total Hours Details Endpoint (for modal) with duty_staff
// --------------------------
router.get("/dashboard/hours", async (req, res) => {
  try {
    const query = `
      SELECT * FROM (
        SELECT 
          p.job_id AS project,
          'Manager' AS employee_role,
          COALESCE(u.name, 'N/A') AS employee_name,
          EXTRACT(EPOCH FROM (p.end_date - p.start_date))/3600 AS hours_worked,
          p.duty_staff
        FROM projects p
        LEFT JOIN users u ON p.manager_id = u.id
        WHERE p.end_date IS NOT NULL

        UNION ALL

        SELECT 
          p.job_id AS project,
          'Site Worker' AS employee_role,
          COALESCE(sw.name, 'N/A') AS employee_name,
          EXTRACT(EPOCH FROM (p.end_date - p.start_date))/3600 AS hours_worked,
          p.duty_staff
        FROM projects p
        LEFT JOIN users sw ON p.site_worker_id = sw.id
        WHERE p.end_date IS NOT NULL

        UNION ALL

        SELECT 
          p.job_id AS project,
          'Driver' AS employee_role,
          COALESCE(d.name, 'N/A') AS employee_name,
          EXTRACT(EPOCH FROM (p.end_date - p.start_date))/3600 AS hours_worked,
          p.duty_staff
        FROM projects p
        LEFT JOIN users d ON p.driver_id = d.id
        WHERE p.end_date IS NOT NULL
      ) AS combined
      ORDER BY combined.project, combined.employee_role;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching total hours details:", error);
    res.status(500).json({ error: "Failed to fetch total hours details" });
  }
});

// --------------------------
// NEW: Avg. Completion Details Endpoint (for modal)
// --------------------------
router.get("/dashboard/avg-completion", async (req, res) => {
  try {
    const query = `
      SELECT 
        job_id AS project,
        duty_staff,
        EXTRACT(EPOCH FROM (end_date - start_date))/3600 AS hours_worked,
        start_date,
        end_date
      FROM projects
      WHERE end_date IS NOT NULL
      ORDER BY hours_worked ASC;
    `;
    const result = await pool.query(query);
    let total = 0;
    result.rows.forEach(row => {
      total += parseFloat(row.hours_worked);
    });
    const avg = result.rows.length > 0 ? total / result.rows.length : 0;
    res.json({ projects: result.rows, average: Math.round(avg) });
  } catch (error) {
    console.error("Error fetching avg completion details:", error);
    res.status(500).json({ error: "Failed to fetch avg completion details" });
  }
});

// --------------------------
// NEW: Active Projects Endpoint (for modal)
// --------------------------
router.get("/active", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name AS manager_name 
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.end_date IS NULL
        AND (p.planned_end_date >= NOW() OR p.planned_end_date IS NULL)
      ORDER BY p.start_date;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching active projects:", error);
    res.status(500).json({ error: "Failed to fetch active projects" });
  }
});

// --------------------------
// NEW: Completed Projects Endpoint (for modal)
// --------------------------
router.get("/completed", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name AS manager_name,
             EXTRACT(EPOCH FROM (p.end_date - p.start_date))/3600 AS hours_worked
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.end_date IS NOT NULL
      ORDER BY p.end_date DESC;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching completed projects:", error);
    res.status(500).json({ error: "Failed to fetch completed projects" });
  }
});

// --------------------------
// NEW: Overdue Projects Endpoint (for modal)
// --------------------------
router.get("/overdue", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name AS manager_name,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - p.planned_end_date))/(3600*24)) AS days_overdue
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.end_date IS NULL AND p.planned_end_date < NOW()
      ORDER BY p.planned_end_date ASC;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching overdue projects:", error);
    res.status(500).json({ error: "Failed to fetch overdue projects" });
  }
});

// --------------------------
// OTHER PROJECT ENDPOINTS
// --------------------------
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name AS manager_name 
       FROM projects p
       LEFT JOIN users u ON p.manager_id = u.id
       ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

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

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      quotation_number,
      address,
      manager_id,
      duty_staff,
      site_worker_id,
      driver_id,
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
          site_worker_id = $5,
          driver_id = $6,
          hours_required = $7,
          start_date = $8,
          planned_end_date = $9,
          status = $10,
          key_code = $11,
          updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        quotation_number,
        address,
        manager_id,
        duty_staff,
        site_worker_id,
        driver_id,
        hours_required,
        start_date,
        planned_end_date,
        status,
        key_code,
        id,
      ]
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

// -------------------------------------------------
// FORMS Endpoints
// -------------------------------------------------
router.get("/forms/:jobId", async (req, res) => {
  console.log("GET /forms/:jobId called with jobId =", req.params.jobId);
  try {
    const { jobId } = req.params;
    const query = `
      SELECT
        id,
        job_id,
        form_type,
        form_data,
        attached_files,
        created_at
      FROM forms
      WHERE LOWER(TRIM(job_id)) = LOWER(TRIM($1))
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [jobId]);
    const forms = result.rows.map((f) => ({
      ...f,
      form_type: f.form_type ? f.form_type.trim().toLowerCase() : f.form_type,
    }));
    res.json(forms);
  } catch (error) {
    console.error("Error fetching project forms:", error);
    res.status(500).json({ error: "Failed to fetch project forms" });
  }
});

router.get("/by-job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const query = `
      SELECT p.*, u.name AS driver_name
      FROM projects p
      LEFT JOIN users u ON p.driver_id = u.id
      WHERE p.job_id = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [jobId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching project by job_id:", error);
    res.status(500).json({ error: "Failed to fetch project by job_id" });
  }
});

router.get("/forms/:formId/file/:fileIndex", async (req, res) => {
  try {
    const { formId, fileIndex } = req.params;
    const result = await pool.query(
      "SELECT attached_files, form_data FROM forms WHERE id = $1",
      [formId]
    );
    if (result.rows.length === 0) {
      return res.status(404).send("Form not found");
    }
    const { attached_files, form_data } = result.rows[0];
    if (!attached_files || attached_files.length === 0) {
      return res.status(404).send("No files attached to this form");
    }
    const idx = parseInt(fileIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= attached_files.length) {
      return res.status(400).send("Invalid file index");
    }
    const fileData = attached_files[idx];
    let parsedData = form_data;
    if (typeof parsedData === "string") {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (err) {
        console.error("Error parsing form_data:", err);
        parsedData = {};
      }
    }
    let mimeType = "application/octet-stream";
    if (parsedData.filesMetadata && Array.isArray(parsedData.filesMetadata)) {
      const fileMeta = parsedData.filesMetadata[idx];
      if (fileMeta && fileMeta.mimeType) {
        mimeType = fileMeta.mimeType;
      }
    }
    res.set("Content-Type", mimeType);
    res.set("Content-Disposition", "inline");
    return res.send(fileData);
  } catch (error) {
    console.error("Error serving attached file:", error);
    return res.status(500).send("Failed to retrieve attached file");
  }
});

// --------------------------
// NEW: Endpoints for Request Stock Details for KPI Modals
// --------------------------

// Pending Requests
router.get("/request_stock/pending", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM request_stock
      WHERE approval_status = 'Pending'
      ORDER BY request_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    res.status(500).json({ error: "Failed to fetch pending requests" });
  }
});

// Approved Requests
router.get("/request_stock/approved", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM request_stock
      WHERE approval_status = 'Approved'
      ORDER BY request_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching approved requests:", error);
    res.status(500).json({ error: "Failed to fetch approved requests" });
  }
});

// Rejected Requests
router.get("/request_stock/rejected", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM request_stock
      WHERE approval_status = 'Rejected'
      ORDER BY request_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching rejected requests:", error);
    res.status(500).json({ error: "Failed to fetch rejected requests" });
  }
});

// --------------------------
// NEW: Endpoints for Project Modals
// --------------------------

// Active Projects (for modal)
router.get("/active", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name AS manager_name 
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.end_date IS NULL
        AND (p.planned_end_date >= NOW() OR p.planned_end_date IS NULL)
      ORDER BY p.start_date;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching active projects:", error);
    res.status(500).json({ error: "Failed to fetch active projects" });
  }
});

// Completed Projects (for modal)
router.get("/completed", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name AS manager_name,
             EXTRACT(EPOCH FROM (p.end_date - p.start_date))/3600 AS hours_worked
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.end_date IS NOT NULL
      ORDER BY p.end_date DESC;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching completed projects:", error);
    res.status(500).json({ error: "Failed to fetch completed projects" });
  }
});

// Overdue Projects (for modal)
router.get("/overdue", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name AS manager_name,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - p.planned_end_date))/(3600*24)) AS days_overdue
      FROM projects p
      LEFT JOIN users u ON p.manager_id = u.id
      WHERE p.end_date IS NULL AND p.planned_end_date < NOW()
      ORDER BY p.planned_end_date ASC;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching overdue projects:", error);
    res.status(500).json({ error: "Failed to fetch overdue projects" });
  }
});

// --------------------------
// OTHER PROJECT ENDPOINTS
// --------------------------
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name AS manager_name 
       FROM projects p
       LEFT JOIN users u ON p.manager_id = u.id
       ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

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

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      quotation_number,
      address,
      manager_id,
      duty_staff,
      site_worker_id,
      driver_id,
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
          site_worker_id = $5,
          driver_id = $6,
          hours_required = $7,
          start_date = $8,
          planned_end_date = $9,
          status = $10,
          key_code = $11,
          updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        quotation_number,
        address,
        manager_id,
        duty_staff,
        site_worker_id,
        driver_id,
        hours_required,
        start_date,
        planned_end_date,
        status,
        key_code,
        id,
      ]
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

// -------------------------------------------------
// FORMS Endpoints
// -------------------------------------------------
router.get("/forms/:jobId", async (req, res) => {
  console.log("GET /forms/:jobId called with jobId =", req.params.jobId);
  try {
    const { jobId } = req.params;
    const query = `
      SELECT
        id,
        job_id,
        form_type,
        form_data,
        attached_files,
        created_at
      FROM forms
      WHERE LOWER(TRIM(job_id)) = LOWER(TRIM($1))
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [jobId]);
    const forms = result.rows.map((f) => ({
      ...f,
      form_type: f.form_type ? f.form_type.trim().toLowerCase() : f.form_type,
    }));
    res.json(forms);
  } catch (error) {
    console.error("Error fetching project forms:", error);
    res.status(500).json({ error: "Failed to fetch project forms" });
  }
});

router.get("/by-job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const query = `
      SELECT p.*, u.name AS driver_name
      FROM projects p
      LEFT JOIN users u ON p.driver_id = u.id
      WHERE p.job_id = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [jobId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching project by job_id:", error);
    res.status(500).json({ error: "Failed to fetch project by job_id" });
  }
});

router.get("/forms/:formId/file/:fileIndex", async (req, res) => {
  try {
    const { formId, fileIndex } = req.params;
    const result = await pool.query(
      "SELECT attached_files, form_data FROM forms WHERE id = $1",
      [formId]
    );
    if (result.rows.length === 0) {
      return res.status(404).send("Form not found");
    }
    const { attached_files, form_data } = result.rows[0];
    if (!attached_files || attached_files.length === 0) {
      return res.status(404).send("No files attached to this form");
    }
    const idx = parseInt(fileIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= attached_files.length) {
      return res.status(400).send("Invalid file index");
    }
    const fileData = attached_files[idx];
    let parsedData = form_data;
    if (typeof parsedData === "string") {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (err) {
        console.error("Error parsing form_data:", err);
        parsedData = {};
      }
    }
    let mimeType = "application/octet-stream"; // fallback
    if (parsedData.filesMetadata && Array.isArray(parsedData.filesMetadata)) {
      const fileMeta = parsedData.filesMetadata[idx];
      if (fileMeta && fileMeta.mimeType) {
        mimeType = fileMeta.mimeType;
      }
    }
    res.set("Content-Type", mimeType);
    res.set("Content-Disposition", "inline");
    return res.send(fileData);
  } catch (error) {
    console.error("Error serving attached file:", error);
    return res.status(500).send("Failed to retrieve attached file");
  }
});

module.exports = router;
