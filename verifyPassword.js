const bcrypt = require('bcrypt');

// Replace this with the hash you copied from pgAdmin
const storedHash = '$2b$10$XJypgCPbMrt8RW.pVc8SWe7LmZ92E7uZRjLm75pfbwBCI0CfXKdFe';

// The plain text password you want to verify
const plainTextPassword = 'testpassword';

bcrypt.compare(plainTextPassword, storedHash, (err, isMatch) => {
  if (err) {
    console.error('Error comparing password:', err);
  } else {
    console.log('Password match:', isMatch);
  }
});
