// hash.js
const bcrypt = require("bcrypt");

const password = "12345678"; // Choose your new password
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error(err);
  } else {
    console.log("Hashed password:", hash);
  }
});
