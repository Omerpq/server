//const authRoutes = require('./authRoutes'); // Adjust the path if needed

require("dotenv").config();

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const express = require("express");
const app = express();
app.use(express.json()); // Make sure you have middleware to parse JSON

// Import your auth routes
const authRoutes = require("./authRoutes");

app.use("/api/auth", authRoutes);

const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { Pool } = require("pg");

// Require emailService functions
const { sendResetEmail, sendAccountInfoEmail } = require("./emailService");

// Already called express.json() above
app.use(cors());

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// PostgreSQL Connection for local development
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Ensure .env has correct connection string
  ssl: false, // Disable SSL for local development
});

// Temporary endpoint to create an admin user (for development only)
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

// -----------------------
// 1. User Login Endpoint
// -----------------------
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
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

// -----------------------
// 2. Forgot Password Endpoint
// -----------------------
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

    // Store token in DB (update if exists)
    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3",
      [user.id, token, expiresAt]
    );

    const resetLink = `http://localhost:5173/reset-password/${token}`;
    console.log(`Password reset link for ${email}: ${resetLink}`);
    sendResetEmail(email, resetLink);

    res.json({ message: "Password reset email sent!" });
  } catch (error) {
    console.error("Error in forgot-password:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------
// 3. Reset Password Endpoint
// -----------------------
app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body;
  console.log("Reset request received with token:", token);
  console.log("New password received:", password);
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

// -----------------------
// 4. Send Account Info Endpoint
// -----------------------
app.post("/api/auth/send-account-info", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  try {
    await sendAccountInfoEmail(email, { password: "12345678" });
    res.status(200).json({ message: "Account info email sent" });
  } catch (error) {
    console.error("Error sending account info email:", error);
    res.status(500).json({ error: "Failed to send account info email" });
  }
});

// -----------------------
// 5. User Management Endpoints
// -----------------------

// GET /api/users - Retrieve all users
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, role, status FROM users");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/users - Create a new user with duplicate email error handling
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
      // Duplicate email error
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/users/:id - Update an existing user
app.put("/api/users/:id", async (req, res) => {
  const userId = req.params.id;
  const { name, email, role, status, password } = req.body;
  if (!name || !email || !role || !status) {
    return res.status(400).json({ error: "Name, email, role, and status are required" });
  }
  try {
    let query, params;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = "UPDATE users SET name=$1, email=$2, role=$3, status=$4, password=$5 WHERE id=$6 RETURNING id, name, email, role, status";
      params = [name, email, role, status, hashedPassword, userId];
    } else {
      query = "UPDATE users SET name=$1, email=$2, role=$3, status=$4 WHERE id=$5 RETURNING id, name, email, role, status";
      params = [name, email, role, status, userId];
    }
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/users/:id - Delete a user
app.delete("/api/users/:id", async (req, res) => {
  const userId = req.params.id;
  try {
    const result = await pool.query("DELETE FROM users WHERE id=$1 RETURNING id, name, email, role, status", [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------
// 6. Project API Endpoints
// -----------------------

app.get("/api/projects", async (req, res) => {
  try {
    const response = await pool.query("SELECT * FROM projects");
    res.json(response.rows);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const response = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    res.json(response.rows);
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

app.post("/api/projects", async (req, res) => {
  const project = req.body;
  try {
    const response = await pool.query(
      "INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *",
      [project.name, project.description]
    );
    res.json(response.rows[0]);
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  const { id } = req.params;
  const updatedProject = req.body;
  try {
    const response = await pool.query(
      "UPDATE projects SET name = $1, description = $2 WHERE id = $3 RETURNING *",
      [updatedProject.name, updatedProject.description, id]
    );
    res.json(response.rows[0]);
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const response = await pool.query("DELETE FROM projects WHERE id = $1 RETURNING *", [id]);
    res.json(response.rows[0]);
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ error: "Failed to delete project" });
  }
});
