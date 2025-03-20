require("dotenv").config();

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const express = require("express");
const app = express();
const path = require("path");

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
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
    
    // Define default granular permissions for each role.
    const defaultPermissions = {
      Administrator: [
        "canViewUsers", "canCreateUser", "canEditUser", "canDeleteUser", "canAssignUserRoles",
        "canAccessUserManagement", "canAccessProjectManagement", "canAccessInventoryManagement",
        "canCreateProject", "canEditProject", "canDeleteProject", "canManageProjectTeam",
        "canAddStockEntry", "canEditStockEntry", "canDeleteStockEntry", "canRequestStock",
        "canApproveStockRequests", "canDispatchStock", "canEditDispatch", "canConfirmDelivery",
        "canViewDispatches", "canViewProjects"
      ],
      SiteWorker: ["canRequestStock", "canViewStock"],
      Manager: ["canViewProjects", "canEditProject", "canManageProjectTeam"],
      InventoryManager: ["canViewStock", "canAddStockEntry", "canEditStockEntry", "canDeleteStockEntry"],
      Driver: ["canConfirmDelivery", "canViewDispatches"]
    };

    if (!user.permissions || !Array.isArray(user.permissions) || user.permissions.length === 0) {
      user.permissions = defaultPermissions[user.role] || [];
    }
    
    // Generate JWT token including granular permissions.
    const token = jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      permissions: user.permissions
    }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, permissions: user.permissions }
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

    const resetLink = `https://my-app-cpl9.vercel.app/reset-password/${token}`;
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

app.get("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, status, permissions FROM users WHERE id = $1",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = result.rows[0];
    const defaultPermissions = {
      Administrator: [
        "canViewUsers", "canCreateUser", "canEditUser", "canDeleteUser", "canAssignUserRoles",
        "canAccessUserManagement", "canAccessProjectManagement", "canAccessInventoryManagement",
        "canCreateProject", "canEditProject", "canDeleteProject", "canManageProjectTeam",
        "canAddStockEntry", "canEditStockEntry", "canDeleteStockEntry", "canRequestStock",
        "canApproveStockRequests", "canDispatchStock", "canEditDispatch", "canConfirmDelivery",
        "canViewDispatches", "canViewProjects"
      ],
      SiteWorker: ["canRequestStock", "canViewStock"],
      Manager: ["canViewProjects", "canEditProject", "canManageProjectTeam"],
      InventoryManager: ["canViewStock", "canAddStockEntry", "canEditStockEntry", "canDeleteStockEntry"],
      Driver: ["canConfirmDelivery", "canViewDispatches"]
    };
    if (!user.permissions || !Array.isArray(user.permissions) || user.permissions.length === 0) {
      user.permissions = defaultPermissions[user.role] || [];
    }
    res.json(user);
  } catch (error) {
    console.error("Error fetching user by id:", error);
    res.status(500).json({ error: "Server error" });
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
// Stock Request Endpoints (Updated to include pickup fields)
// -----------------------
// >>>>>>>>  MINIMALLY UPDATED POST ROUTE  <<<<<<<<
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
    job_id,
    pickup_requested,
    pickup_datetime,
    request_type, // Expected values: "stock" or "pickup"
  } = req.body;

  // Basic required fields.
  if (!site_worker || !request_date || !requestor_email || !job_id) {
    return res.status(400).json({
      error: "Missing required fields: site_worker, request_date, requestor_email, and job_id",
    });
  }
  // If it's a 'stock' request, require stock-specific fields.
  if (request_type === "stock") {
    if (!delivery_location || !item_code || !item_name || !quantity) {
      return res.status(400).json({
        error: "Missing required fields for stock request (delivery_location, item_code, item_name, quantity).",
      });
    }
  }

  // For both request types, use the provided delivery_location.
  const finalDeliveryLocation = delivery_location && delivery_location.trim()
    ? delivery_location.trim()
    : "";

  let finalItemCode = "";
  let finalItemName = "";
  let finalQuantity = 0;
  let finalUrgency = "Normal";

  if (request_type === "stock") {
    finalItemCode = trimAndLimit(item_code);
    finalItemName = trimAndLimit(item_name);
    finalQuantity = parseInt(quantity, 10) || 0;
    finalUrgency =
      urgency && urgency.toString().trim() !== ""
        ? trimAndLimit(urgency)
        : "Normal";
  }

  // For pickup requests, parse pickup_datetime if provided.
  const finalPickupDatetime =
    pickup_datetime && pickup_datetime.trim() !== ""
      ? pickup_datetime.trim()
      : null;

  // --- Minimal Changes for Status Columns ---
  // For stock requests, we want the "status" column to be "N/A" and the "approval_status" to reflect the actual status.
  // For pickup requests, we want the "approval_status" column to be "N/A" and the "status" column to reflect the actual status.
  let finalStatus = "";
  let finalApprovalStatus = "";
  if (request_type === "stock") {
    finalStatus = "N/A";
    finalApprovalStatus = "Pending";
  } else if (request_type === "pickup") {
    finalStatus = "Pending";
    finalApprovalStatus = "N/A";
  }
  // --- End Minimal Changes ---

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
        requestor_email,
        job_id,
        pickup_requested,
        pickup_datetime,
        request_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const values = [
      trimAndLimit(site_worker),
      request_date.toString().trim(),
      finalDeliveryLocation,
      finalUrgency,
      finalStatus,
      finalApprovalStatus,
      finalItemCode,
      finalItemName,
      finalQuantity,
      requestor_email.trim(),
      job_id.trim(),
      pickup_requested,
      finalPickupDatetime,
      request_type,
    ];

    const result = await pool.query(insertQuery, values);

    // For stock requests, recalc inventory totals & update any low-stock alerts.
    if (request_type === "stock") {
      const totalRes = await pool.query(
        "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
        [finalItemCode]
      );
      if (totalRes.rows.length > 0 && totalRes.rows[0].total_quantity !== null) {
        const totalQuantity = parseInt(totalRes.rows[0].total_quantity, 10);
        if (totalQuantity >= 3) {
          await pool.query(
            `UPDATE alerts
             SET settled = true, settled_time = NOW()
             WHERE type = 'Low Stock Alert' AND message ILIKE $1`,
            [`%${finalItemCode}%`]
          );
        }
      }
    }

    res.status(201).json({
      message: "Request added successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error adding request_stock:", error);
    res.status(500).json({
      error: "Failed to insert request_stock",
      details: error.message,
    });
  }
});
// <<<<<<<<  END OF MINIMALLY UPDATED POST ROUTE  >>>>>>>>>


app.get("/api/request_stock", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM request_stock ORDER BY request_date DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching stock requests:", error);
    res.status(500).json({ error: "Failed to fetch stock requests", details: error.message });
  }
});

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
// Updated Mark-Seen Endpoint for Pickup Requests
// -----------------------
app.put("/api/request_stock/:id/mark-seen", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "UPDATE request_stock SET status = 'Seen by Driver' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Request not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error marking request as seen:", error);
    res.status(500).json({ error: "Failed to mark request as seen", details: error.message });
  }
});


// -----------------------
// NEW: Mount Stock Request Routes
// -----------------------
const requestStockRoutes = require("./routes/requestStockRoutes");
app.use("/api/request_stock", requestStockRoutes);

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
    return res
      .status(400)
      .json({ error: "Missing required fields: item_code, item_name, quantity, and description" });
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

app.get("/api/inventory/levels", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        item_name,
        SUM(quantity) AS quantity,
        description
      FROM inventory
      GROUP BY item_name, description
      ORDER BY item_name;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching aggregated inventory levels:", error);
    res.status(500).json({ error: "Failed to fetch aggregated inventory levels" });
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
      [validManagerId, validRequestId, validDriverId, dispatchDate, itemsDispatched, validDispatchedQty]
    );

    const totalRes = await pool.query(
      "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
      [itemsDispatched]
    );
    const totalAvailable = parseInt(totalRes.rows[0].total_quantity, 10) || 0;
    if (totalAvailable < validDispatchedQty) {
      return res.status(400).json({ error: "Insufficient stock for the requested dispatch quantity." });
    }

    let remaining = validDispatchedQty;
    const inventoryRows = await pool.query(
      "SELECT id, quantity FROM inventory WHERE item_code = $1 ORDER BY stock_entry_time DESC",
      [itemsDispatched]
    );
    for (const row of inventoryRows.rows) {
      if (remaining <= 0) break;
      const deduct = Math.min(row.quantity, remaining);
      await pool.query("UPDATE inventory SET quantity = quantity - $1 WHERE id = $2", [
        deduct,
        row.id,
      ]);
      remaining -= deduct;
    }

    const newTotalRes = await pool.query(
      "SELECT SUM(quantity) as total_quantity FROM inventory WHERE item_code = $1",
      [itemsDispatched]
    );
    const actualRemainingQty = parseInt(newTotalRes.rows[0].total_quantity, 10) || 0;

    if (actualRemainingQty < 3) {
      await pool.query(
        `UPDATE alerts
         SET settled = false, settled_time = NULL, date = NOW()
         WHERE type = 'Low Stock Alert' AND message ILIKE $1`,
        [`%${itemsDispatched}%`]
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
      updatedInventory: { totalRemaining: actualRemainingQty },
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
  const { id, role, confirmationTime } = req.body;
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
      let result = await pool.query(
        `UPDATE delivery_confirmations
         SET site_worker_confirmation = $1, delivery_status = 'Delivered'
         WHERE dispatch_id = $2
         RETURNING *`,
        [confirmationTime, id]
      );
      if (result.rowCount === 0) {
        result = await pool.query(
          `INSERT INTO delivery_confirmations (dispatch_id, site_worker_confirmation, delivery_status)
           VALUES ($1, $2, 'Delivered')
           RETURNING *`,
          [id, confirmationTime]
        );
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
  const { job_id, form_type, form_data, attached_files } = req.body;
  if (!job_id || !form_type || !form_data) {
    return res.status(400).json({ error: "job_id, form_type, and form_data are required" });
  }

  let attachedFilesBytea = null;
  if (attached_files && Array.isArray(attached_files) && attached_files.length > 0) {
    attachedFilesBytea = attached_files.map((b64) => Buffer.from(b64, "base64"));
  }

  try {
    const result = await pool.query(
      `INSERT INTO forms (job_id, form_type, form_data, attached_files, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [job_id, form_type, form_data, attachedFilesBytea]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating form:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/forms/:id", async (req, res) => {
  const { id } = req.params;
  const { form_data, attached_files } = req.body;
  if (!form_data) {
    return res.status(400).json({ error: "form_data is required" });
  }

  let attachedFilesBytea = null;
  if (attached_files && Array.isArray(attached_files) && attached_files.length > 0) {
    attachedFilesBytea = attached_files.map((b64) => Buffer.from(b64, "base64"));
  }

  try {
    const result = await pool.query(
      `UPDATE forms
         SET form_data = $1,
             attached_files = $2
       WHERE id = $3
       RETURNING *`,
      [form_data, attachedFilesBytea, id]
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

app.put("/api/users/:id/permissions", async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;

  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: "permissions must be an array" });
  }

  try {
    const result = await pool.query(
      "UPDATE users SET permissions = $1::jsonb WHERE id = $2 RETURNING id, name, email, role, status, permissions",
      [JSON.stringify(permissions), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating permissions:", error);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});

// -----------------------
// Static File Serving & Catch-All Routes
// -----------------------
if (process.env.NODE_ENV === "production") {
  app.use(express.static("build"));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "build", "index.html"));
  });
} else {
  // Optionally add a catch-all for API endpoints in development.
}

// -----------------------
// Start Server
// -----------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
