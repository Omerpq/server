// emailService.js
require('dotenv').config(); // Load environment variables from .env

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.mailtrap.io",
  port: process.env.MAIL_PORT || 2525,
  auth: {
    user: process.env.MAIL_USER || "1bf27ad421e61c",
    pass: process.env.MAIL_PASS || "5a72e954ebf1a0",
  },
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error("Error with email transporter configuration:", error);
  } else {
    console.log("Email transporter is ready to send messages.");
  }
});

async function sendResetEmail(email, resetLink) {
  console.log(`Attempting to send reset email to: ${email}`);
  const mailOptions = {
    from: '"Your App" <no-reply@yourapp.com>',
    to: email,
    subject: "Password Reset Request",
    text: `Reset your password by clicking this link: ${resetLink}`,
    html: `<p>Reset your password by clicking <a href="${resetLink}">here</a>.</p>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Reset email sent successfully:", info.response);
    return info;
  } catch (error) {
    console.error("Error sending reset email:", error.message);
    console.error(error.stack);
    throw error;
  }
}

async function sendAccountInfoEmail(email, userData) {
  console.log(`Attempting to send account info email to: ${email}`);
  const mailOptions = {
    from: '"Your App" <no-reply@yourapp.com>',
    to: email,
    subject: "Your Account Information",
    text: `Your account has been created. You can log in using your email: ${email} and password: ${userData.password}. Please change your password after logging in.`,
    html: `<p>Your account has been created.</p>
           <p><strong>Email:</strong> ${email}</p>
           <p><strong>Password:</strong> ${userData.password}</p>
           <p>Please change your password after logging in.</p>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Account info email sent successfully:", info.response);
    return info;
  } catch (error) {
    console.error("Error sending account info email:", error.message);
    console.error(error.stack);
    throw error;
  }
}

async function sendStockRequestNotification(request, decision, approverEmail, requestorEmail, adminEmail) {
  console.log(`Sending stock request notification for request ID ${request.id} as ${decision}`);
  
  // Filter out any undefined or empty email addresses
  const recipients = [approverEmail, requestorEmail, adminEmail]
    .filter(email => email && email.trim().length > 0)
    .join(", ");
  
  if (!recipients) {
    throw new Error("No recipients defined for notification email");
  }

  const mailOptions = {
    from: '"Your App" <no-reply@yourapp.com>',
    to: recipients,
    subject: `Stock Request ${decision} - Request ID: ${request.id}`,
    text: `The stock request for item ${request.item_code} - ${request.item_name} has been ${decision} by ${request.decision_by}.`,
    html: `<p>The stock request for item <strong>${request.item_code} - ${request.item_name}</strong> has been <strong>${decision}</strong> by ${request.decision_by}.</p>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Notification email sent successfully: ${info.response}`);
    return info;
  } catch (error) {
    console.error("Error sending stock request notification email:", error.message);
    console.error(error.stack);
    throw error;
  }
}

module.exports = { sendResetEmail, sendAccountInfoEmail, sendStockRequestNotification };
