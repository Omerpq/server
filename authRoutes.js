const express = require("express");
const router = express.Router();
const { sendAccountInfoEmail } = require("./emailService");
const validator = require("validator"); // Ensure you've installed the validator package

// Example route for sending account info email
router.post("/send-account-info", async (req, res) => {
  const { email } = req.body;

  // Validate the email format
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  try {
    console.log(`Attempting to send account info email to: ${email}`);
    
    // For demonstration, sending default password info. Adjust as needed.
    await sendAccountInfoEmail(email, { password: "12345678" });
    
    console.log(`Email successfully sent to: ${email}`);
    res.status(200).json({ message: "Account info email sent" });
  } catch (error) {
    // Log the error with the message and stack for better debugging
    console.error("Error sending account info email:", error.message);
    console.error(error.stack);
    
    res.status(500).json({ error: "Failed to send account info email" });
  }
});

module.exports = router;
