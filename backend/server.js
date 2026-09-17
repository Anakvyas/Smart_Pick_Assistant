const express = require("express");

const app = express();


app.get("/", (req, res) => {
  res.json({
    message: "Smart Pick Assistant Backend is running"
  });
});




const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});