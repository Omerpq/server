// authRoutes.js
const express = require("express");
const router = express.Router();
const { sendAccountInfoEmail } = require("./emailService");

// Example route for sending account info email
router.post("/send-account-info", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  try {
    // For demonstration, sending default password info. Adjust as needed.
    await sendAccountInfoEmail(email, { password: "12345678" });
    res.status(200).json({ message: "Account info email sent" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to send account info email" });
  }
});

module.exports = router;
