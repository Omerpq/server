require("dotenv").config();

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const express = require("express");
const app = express();
app.use(express.json()); // Parse JSON bodies
const cors = require("cors");
app.use(cors());

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { Pool } = require("pg");

// Require emailService functions (including notification functions)
const {
  sendResetEmail,
  sendAccountInfoEmail,
  sendStockRequestNotification,
} = require("./emailService");

// PostgreSQL Connection for local development
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Ensure .env has the correct connection string
  ssl: false, // Disable SSL for local development
});

// Helper function to trim and limit a string to a maximum length (default 50)
const trimAndLimit = (value, maxLength = 50) => {
  const trimmed = value.toString().trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

// -----------------------
// Auth Routes & Endpoints
// -----------------------
const authRoutes = require("./authRoutes");
app.use("/api/auth", authRoutes);

app.post("/api/auth/create-admin", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, role, status, password) VALUES ($1, $2, 'Administrator', 'Active', $3) RETURNING id, name, email, role, status",
      [name, email, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Error creating admin:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }
    // Generate JWT Token
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  console.log("Forgot password request received for email:", email);

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = result.rows[0];
    const token = crypto.randomBytes(20).toString("hex");
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour expiration

    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3",
      [user.id, token, expiresAt]
    );

    const resetLink = `http://localhost:5173/reset-password/${token}`;
    console.log(`Password reset link for ${email}: ${resetLink}`);

    await sendResetEmail(email, resetLink);

    res.json({ message: "Password reset email sent!" });
  } catch (error) {
    console.error("Error in forgot-password:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body;
  console.log("Reset request received with token:", token);
  try {
    const result = await pool.query(
      "SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1",
      [token]
    );
    if (result.rows.length === 0 || new Date(result.rows[0].expires_at) < new Date()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }
    const userId = result.rows[0].user_id;
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, userId]);
    await pool.query("DELETE FROM password_reset_tokens WHERE token = $1", [token]);

    res.json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Error in reset-password:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/send-account-info", async (req, res) => {
  const { email } = req.body;
  console.log("Received send-account-info request for email:", email);
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  try {
    await sendAccountInfoEmail(email, { password: "12345678" });
    console.log(`Account info email successfully sent to: ${email}`);
    res.status(200).json({ message: "Account info email sent" });
  } catch (error) {
    console.error("Error sending account info email:", error);
    res.status(500).json({ error: "Failed to send account info email" });
  }
});

// -----------------------
// User Management Endpoints
// -----------------------
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, role, status FROM users");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/users", async (req, res) => {
  const { name, email, role, status, password } = req.body;
  if (!name || !email || !role || !status || !password) {
    return res.status(400).json({ error: "All fields (name, email, role, status, password) are required" });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, role, status, password) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, status",
      [name, email, role, status, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/users/:id", async (req, res) => {
  const { id } = req.params; 
  const { name, email, role, status } = req.body; 
  if (!name || !email || !role || !status) { 
    return res.status(400).json({ error: "All fields (name, email, role, status) are required" }); 
  } 
  try {
    const result = await pool.query(
      "UPDATE users SET name = $1, email = $2, role = $3, status = $4 WHERE id = $5 RETURNING id, name, email, role, status", 
      [name, email, role, status, id]
    ); 
    if (result.rows.length === 0) { 
      return res.status(404).json({ error: "User not found" }); 
    } 
    res.json(result.rows[0]); 
  } catch (error) { 
    console.error("Error updating user:", error); 
    res.status(500).json({ error: "Server error" }); 
  }
});

app.delete("/api/users/:id", async (req, res) => { 
  const { id } = req.params; 
  try {
    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]); 
    if (result.rows.length === 0) { 
      return res.status(404).json({ error: "User not found" }); 
    }
    res.json({ message: "User deleted", id }); 
  } catch (error) { 
    console.error("Error deleting user:", error); 
    res.status(500).json({ error: "Server error" }); 
  }
});

// -----------------------
// DRIVERS Endpoint
// -----------------------
app.get("/api/drivers", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name FROM users WHERE TRIM(role) = 'Driver' ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching drivers:", error);
    res.status(500).json({ error: "Failed to fetch drivers" });
  }
});

// -----------------------
// Alerts Endpoint
// -----------------------
app.get("/api/alerts", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM alerts ORDER BY date DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// -----------------------
// Stock Request Endpoints (using request_stock table)
// -----------------------
app.post("/api/request_stock", async (req, res) => {
  const {
    site_worker,
    request_date,
    delivery_location,
    urgency,
    item_code,
    item_name,
    quantity,
    requestor_email,
  } = req.body;

  if (!site_worker || !request_date || !delivery_location || !item_code || !item_name || !quantity || !requestor_email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Define trimmedItemCode to be used later
  const trimmedItemCode = trimAndLimit(item_code);

  try {
    const insertQuery = `
      INSERT INTO request_stock (
        site_worker,
        request_date,
        delivery_location,
        urgency,
        status,
        approval_status,
        item_code,
        item_name,
        quantity,
        requestor_email
      ) VALUES ($1, $2, $3, $4, 'Pending', 'Pending', $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      trimAndLimit(site_worker),
      request_date.toString().trim(),
      trimAndLimit(delivery_location),
      urgency && urgency.toString().trim() !== "" ? trimAndLimit(urgency) : "Normal",
      trimmedItemCode,
      trimAndLimit(item_name),
      parseInt(quantity, 10),
      requestor_email.trim(),
    ];
    const result = await pool.query(insertQuery, values);
    // After inserting a new inventory record, recalc the total quantity for this item.
    const totalRes = await pool.query(
      "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
      [trimmedItemCode]
    );
    if (totalRes.rows.length > 0 && totalRes.rows[0].total_quantity !== null) {
      const totalQuantity = parseInt(totalRes.rows[0].total_quantity, 10);
      // If total quantity is now 3 or more, update low stock alerts as settled.
      if (totalQuantity >= 3) {
        await pool.query(
          `UPDATE alerts
           SET settled = true, settled_time = NOW()
           WHERE type = 'Low Stock Alert' AND message ILIKE $1`,
          [`%${trimmedItemCode}%`]
        );
      }
    }
    res.status(201).json({ message: "Item added successfully", data: result.rows[0] });
  } catch (error) {
    console.error("Error adding inventory:", error);
    res.status(500).json({ error: "Failed to insert inventory", details: error.message });
  }
});

// NEW: GET endpoint for stock requests
app.get("/api/request_stock", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM request_stock ORDER BY request_date DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching stock requests:", error);
    res.status(500).json({ error: "Failed to fetch stock requests", details: error.message });
  }
});

// NEW: PUT endpoint to approve a stock request
app.put("/api/request_stock/:id/approve", async (req, res) => {
  const { id } = req.params;
  const { decision_by, decision_time } = req.body;
  try {
    const result = await pool.query(
      "UPDATE request_stock SET status = 'Approved', approval_status = 'Approved', decision_by = $1, decision_time = $2 WHERE id = $3 RETURNING *",
      [decision_by, decision_time, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Stock request not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error approving stock request:", error);
    res.status(500).json({ error: "Failed to approve stock request", details: error.message });
  }
});

// NEW: PUT endpoint to reject a stock request
app.put("/api/request_stock/:id/reject", async (req, res) => {
  const { id } = req.params;
  const { decision_by, decision_time } = req.body;
  try {
    const result = await pool.query(
      "UPDATE request_stock SET status = 'Rejected', approval_status = 'Rejected', decision_by = $1, decision_time = $2 WHERE id = $3 RETURNING *",
      [decision_by, decision_time, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Stock request not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error rejecting stock request:", error);
    res.status(500).json({ error: "Failed to reject stock request", details: error.message });
  }
});

// -----------------------
// Inventory Management Endpoints
// -----------------------
app.post("/api/inventory", async (req, res) => {
  console.log("Incoming data:", req.body);
  const { itemCode, itemName, quantity, description, stockEntryTime } = req.body;

  let isoStockEntryTime = null;
  if (stockEntryTime) {
    const parsedDate = new Date(stockEntryTime);
    if (isNaN(parsedDate)) {
      return res.status(400).json({ error: "Invalid date format for stockEntryTime" });
    }
    isoStockEntryTime = parsedDate.toISOString();
  }

  if (
    !itemCode ||
    !itemName ||
    !quantity ||
    !description ||
    !itemCode.toString().trim() ||
    !itemName.toString().trim() ||
    !quantity.toString().trim() ||
    !description.toString().trim()
  ) {
    return res.status(400).json({ error: "Missing required fields: item_code, item_name, quantity, and description" });
  }

  const trimmedItemCode = trimAndLimit(itemCode);
  const trimmedItemName = trimAndLimit(itemName);
  const trimmedDescription = trimAndLimit(description);
  const parsedQuantity = parseInt(quantity, 10);

  if (isNaN(parsedQuantity)) {
    return res.status(400).json({ error: "Quantity must be a valid number" });
  }

  try {
    console.log(
      `Adding item: ${trimmedItemCode} - ${trimmedItemName}, Quantity: ${parsedQuantity}, Description: ${trimmedDescription}`
    );
    const result = await pool.query(
      "INSERT INTO inventory (item_code, item_name, quantity, description, stock_entry_time) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [trimmedItemCode, trimmedItemName, parsedQuantity, trimmedDescription, isoStockEntryTime]
    );

    // After inserting a new inventory record, recalc the total quantity for this item.
    const totalRes = await pool.query(
      "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
      [trimmedItemCode]
    );
    if (totalRes.rows.length > 0 && totalRes.rows[0].total_quantity !== null) {
      const totalQuantity = parseInt(totalRes.rows[0].total_quantity, 10);
      if (totalQuantity >= 3) {
        await pool.query(
          `UPDATE alerts
           SET settled = true, settled_time = NOW()
           WHERE type = 'Low Stock Alert' AND message ILIKE $1`,
          [`%${trimmedItemCode}%`]
        );
      }
    }
    res.status(201).json({ message: "Item added successfully", data: result.rows[0] });
  } catch (error) {
    console.error("Error adding inventory:", error);
    res.status(500).json({ error: "Failed to insert inventory", details: error.message });
  }
});

app.get("/api/inventory/details/:itemCode", async (req, res) => {
  const { itemCode } = req.params;
  try {
    const result = await pool.query(
      "SELECT item_code, item_name, description FROM inventory WHERE item_code = $1 ORDER BY stock_entry_time DESC LIMIT 1",
      [itemCode.toString().trim()]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: "Item not found" });
    }
  } catch (error) {
    console.error("Error fetching inventory details:", error);
    res.status(500).json({ error: "Failed to fetch inventory details" });
  }
});

app.get("/api/inventory/item/:itemCode", async (req, res) => {
  const { itemCode } = req.params;
  try {
    const result = await pool.query(
      "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
      [itemCode.toString().trim()]
    );
    if (result.rows.length > 0 && result.rows[0].total_quantity !== null) {
      res.json({ quantity: parseInt(result.rows[0].total_quantity, 10) });
    } else {
      res.status(404).json({ error: "Item not found" });
    }
  } catch (error) {
    console.error("Error fetching inventory item:", error);
    res.status(500).json({ error: "Failed to fetch inventory item" });
  }
});

app.get("/api/inventory", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        MIN(id) AS id, 
        item_code AS item_code, 
        item_name AS item_name, 
        SUM(quantity) AS quantity, 
        description,
        MAX(stock_entry_time) AS latestEntry
      FROM inventory
      GROUP BY item_code, item_name, description
      ORDER BY item_code;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching aggregated inventory:", error);
    res.status(500).json({ error: "Failed to fetch aggregated inventory" });
  }
});

app.get("/api/inventory/lowstock", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM inventory WHERE quantity < 3");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching low stock items:", error);
    res.status(500).json({ error: "Failed to fetch low stock items" });
  }
});

// -----------------------
// Dispatch Management & Delivery Endpoints
// -----------------------
app.post("/api/dispatches", async (req, res) => {
  const { managerId, requestId, driverId, dispatchDate, itemsDispatched, dispatchedQty } = req.body;
  console.log("Request body:", req.body);

  if (!driverId || !dispatchDate || !itemsDispatched || !dispatchedQty) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const validManagerId = parseInt(managerId, 10);
  const validDriverId = parseInt(driverId, 10);
  const validDispatchedQty = parseInt(dispatchedQty, 10);
  const validRequestId = requestId === "" ? null : parseInt(requestId, 10);

  try {
    // 1) Insert dispatch record
    const dispatchResult = await pool.query(
      `
      INSERT INTO dispatches (
        manager_id,
        request_id,
        driver_id,
        dispatch_date,
        items_dispatched,
        dispatched_qty,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'Dispatched')
      RETURNING *
      `,
      [
        validManagerId,
        validRequestId,
        validDriverId,
        dispatchDate,
        itemsDispatched,
        validDispatchedQty,
      ]
    );

    // 2) Check total available stock for the given item code.
    const totalRes = await pool.query(
      "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
      [itemsDispatched]
    );
    const totalAvailable = parseInt(totalRes.rows[0].total_quantity, 10) || 0;
    if (totalAvailable < validDispatchedQty) {
      return res.status(400).json({ error: "Insufficient stock for the requested dispatch quantity." });
    }

    // 3) Deduct the dispatched quantity across inventory rows (ordered by stock_entry_time descending).
    let remaining = validDispatchedQty;
    const inventoryRows = await pool.query(
      "SELECT id, quantity FROM inventory WHERE item_code = $1 ORDER BY stock_entry_time DESC",
      [itemsDispatched]
    );
    for (const row of inventoryRows.rows) {
      if (remaining <= 0) break;
      const deduct = Math.min(row.quantity, remaining);
      await pool.query("UPDATE inventory SET quantity = quantity - $1 WHERE id = $2", [deduct, row.id]);
      remaining -= deduct;
    }

    // 4) Recalculate total remaining stock.
    const newTotalRes = await pool.query(
      "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
      [itemsDispatched]
    );
    const actualRemainingQty = parseInt(newTotalRes.rows[0].total_quantity, 10) || 0;

    // 5) Upsert low stock alert if needed.
    if (actualRemainingQty < 3) {
      await pool.query(
        `INSERT INTO alerts (type, message, date, is_read, settled, settled_time)
         VALUES ($1, $2, NOW(), false, false, NULL)
         ON CONFLICT (type, message) DO UPDATE
           SET date = NOW(), settled = false, settled_time = NULL`,
        [
          "Low Stock Alert",
          `Item ${itemsDispatched} has low stock: ${actualRemainingQty} remaining.`
        ]
      );
    } else {
      await pool.query(
        `UPDATE alerts
         SET settled = true, settled_time = NOW()
         WHERE type = 'Low Stock Alert' AND message ILIKE $1`,
        [`%${itemsDispatched}%`]
      );
    }

    res.status(201).json({
      dispatch: dispatchResult.rows[0],
      updatedInventory: { totalRemaining: actualRemainingQty }
    });
  } catch (error) {
    console.error("Error during dispatch:", error);
    res.status(500).json({ error: "Failed to process dispatch" });
  }
});

app.get("/api/dispatches/delivery", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, rs.delivery_location, rs.item_name AS "itemName", dc.driver_confirmation, dc.site_worker_confirmation
       FROM dispatches d
       LEFT JOIN request_stock rs ON d.request_id = rs.id
       LEFT JOIN delivery_confirmations dc ON d.id = dc.dispatch_id
       WHERE d.status = $1`,
      ["Dispatched"]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching dispatches pending delivery:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/api/dispatches/driver/:driverId", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const result = await pool.query(
      `SELECT d.*, rs.delivery_location, rs.item_name AS "itemName", dc.driver_confirmation, dc.site_worker_confirmation
       FROM dispatches d
       LEFT JOIN request_stock rs ON d.request_id = rs.id
       LEFT JOIN delivery_confirmations dc ON d.id = dc.dispatch_id
       WHERE d.driver_id = $1 AND d.status = $2`,
      [driverId, "Dispatched"]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching driver dispatches:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/delivery/confirm", async (req, res) => {
  const { id, role, confirmationTime } = req.body; // id is the dispatch_id
  if (!id || !role || !confirmationTime) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    if (role.toLowerCase() === "driver") {
      const result = await pool.query(
        `INSERT INTO delivery_confirmations (dispatch_id, driver_confirmation, delivery_status)
         VALUES ($1, $2, 'Driver Confirmed')
         ON CONFLICT (dispatch_id) DO UPDATE
           SET driver_confirmation = $2, delivery_status = 'Driver Confirmed'
         RETURNING *`,
        [id, confirmationTime]
      );
      return res.status(201).json(result.rows[0]);
    } else if (role.toLowerCase() === "siteworker") {
      const result = await pool.query(
        `UPDATE delivery_confirmations
         SET site_worker_confirmation = $1, delivery_status = 'Delivered'
         WHERE dispatch_id = $2
         RETURNING *`,
        [confirmationTime, id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "No matching delivery confirmation record found" });
      }
      return res.status(200).json(result.rows[0]);
    } else {
      return res.status(400).json({ error: "Invalid role" });
    }
  } catch (error) {
    console.error("Error confirming delivery:", error);
    res.status(500).json({ error: "Failed to confirm delivery" });
  }
});

app.get("/api/delivery/history", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM dispatches ORDER BY dispatch_date DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching delivery history:", error);
    res.status(500).json({ error: "Failed to fetch delivery history" });
  }
});

app.get("/api/delivery/delayed", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.* FROM dispatches d
      LEFT JOIN (
        SELECT DISTINCT dispatch_id FROM delivery_confirmations
      ) dc ON d.id = dc.dispatch_id
      WHERE dc.dispatch_id IS NULL
        AND d.dispatch_date < NOW() - INTERVAL '24 hours'
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching delayed deliveries:", error);
    res.status(500).json({ error: "Failed to fetch delayed deliveries" });
  }
});

// -----------------------
// Notification Endpoint
// -----------------------
app.post("/api/notify", async (req, res) => {
  console.log("Received notification payload:", req.body);
  res.json({ message: "Notification received" });
});

// -----------------------
// New Form Endpoints (Unified "forms" table)
// -----------------------
app.get("/api/forms", async (req, res) => {
  const { job_id, form_type } = req.query;
  if (!job_id || !form_type) {
    return res.status(400).json({ error: "job_id and form_type are required" });
  }
  try {
    const result = await pool.query(
      "SELECT * FROM forms WHERE job_id = $1 AND form_type = $2 LIMIT 1",
      [job_id, form_type]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: "Form not found" });
    }
  } catch (error) {
    console.error("Error fetching form:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/forms", async (req, res) => {
  const { job_id, form_type, form_data } = req.body;
  if (!job_id || !form_type || !form_data) {
    return res.status(400).json({ error: "job_id, form_type, and form_data are required" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO forms (job_id, form_type, form_data, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
      [job_id, form_type, form_data]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating form:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/forms/:id", async (req, res) => {
  const { id } = req.params;
  const { form_data } = req.body;
  if (!form_data) {
    return res.status(400).json({ error: "form_data is required" });
  }
  try {
    const result = await pool.query(
      "UPDATE forms SET form_data = $1 WHERE id = $2 RETURNING *",
      [form_data, id]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: "Form not found" });
    }
  } catch (error) {
    console.error("Error updating form:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------
// Project API Endpoints
// -----------------------
const projectRoutes = require("./routes/projectRoutes");
app.use("/api/projects", projectRoutes);

// -----------------------
// Start Server
// -----------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
