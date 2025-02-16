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

async function sendResetEmail(email, resetLink) {
  const mailOptions = {
    from: '"Your App" <no-reply@yourapp.com>',
    to: email,
    subject: "Password Reset Request",
    text: `Reset your password by clicking this link: ${resetLink}`,
    html: `<p>Reset your password by clicking <a href="${resetLink}">here</a>.</p>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Reset email sent: ", info.response);
  } catch (error) {
    console.error("Error sending reset email:", error);
  }
}

async function sendAccountInfoEmail(email, userData) {
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
    console.log("Account info email sent: ", info.response);
  } catch (error) {
    console.error("Error sending account info email:", error);
  }
}

module.exports = { sendResetEmail, sendAccountInfoEmail };
