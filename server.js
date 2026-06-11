const express = require("express");
const multer = require("multer");
const { google } = require("googleapis");
const fs = require("fs");

const app = express();
const upload = multer({ dest: "uploads/" });

const auth = new google.auth.JWT(
  process.env.CLIENT_EMAIL,
  null,
  process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/drive"]
);

const drive = google.drive({
  version: "v3",
  auth
});

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
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

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      fileId: response.data.id
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Drive Upload API Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT);
