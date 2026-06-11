const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { google } = require("googleapis");

const app = express();
const upload = multer({ dest: "uploads/" });

// ===== Google Auth FIXED =====
const auth = new google.auth.JWT(
  process.env.CLIENT_EMAIL,
  null,
  process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/drive.file"]
);

const drive = google.drive({
  version: "v3",
  auth
});

// ===== HOME ROUTE =====
app.get("/", (req, res) => {
  res.send("🚀 Drive Upload API Running");
});

// ===== UPLOAD ROUTE =====
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const response = await drive.files.create({
      requestBody: {
        name: req.file.originalname,
        parents: [process.env.FOLDER_ID]
      },
      media: {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path)
      }
    });

    // delete temp file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      fileId: response.data.id,
      message: "Uploaded to Google Drive"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
