const express = require("express");
const router = express.Router();
const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
const multer = require("multer");

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 25 * 1024 * 1024 

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Разрешены только изображения (JPEG, PNG, WebP, GIF)'), false)
    }
  },
})
const pool = require("../db");
const auth = require("../middleware/auth_mw");
const axios = require("axios");

async function removeBg(imageBuffer) {
  if (process.env.REMOVE_BG_API_KEY) {
    try {
      const response = await axios.post(
        "https://api.remove.bg/v1.0/removebg",
        { image_file_b64: imageBuffer.toString("base64"), size: "auto" },
        {
          headers: {
            "X-Api-Key": process.env.REMOVE_BG_API_KEY,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 30000,
        }
      );
      return Buffer.from(response.data);
    } catch (err) {
      console.warn("remove.bg API failed:", err.response?.data?.toString() || err.message);
      return null;
    }
  }

  try {
    const { removeBackground } = require("@imgly/background-removal-node");
    const blob = new Blob([imageBuffer], { type: "image/jpeg" });
    const result = await removeBackground(blob);
    const arrayBuffer = await result.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.warn("Local background removal failed:", err.message);
    return null;
  }
}

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});




const uploadBufferToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (result) resolve(result);
      else reject(err);
    });
    stream.end(buffer);
  });




router.get("/get-signature", (req, res) => {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { timestamp },
    process.env.CLOUDINARY_API_SECRET,
  );
  res.json({ timestamp, signature });
});




router.post("/uploadImage", auth, upload.single("file"), async (req, res) => {
  try {
    const {
      name,
      brand_names,
      descriptions,
      event = "casual",
      type,
      category,
      season,
      size,
    } = req.body;

    if (!req.file) return res.status(400).json({ message: "File required" });

    
    const original = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "image",
      folder: "wardrobe/clothes",
    });
    const imageUrl = original.secure_url;

    let processedImageUrl = null;
    const noBgBuffer = await removeBg(req.file.buffer);
    if (noBgBuffer) {
      const processed = await uploadBufferToCloudinary(noBgBuffer, {
        resource_type: "image",
        folder: "wardrobe/clothes_nobg",
        format: "png",
      });
      processedImageUrl = processed.secure_url;
    }

    
    const resolvedType = type || 'top';

    
    const dbRes = await pool.query(
      `INSERT INTO clothes(owner_id, image_urls, processed_image_url, name, category, brand_names, descriptions, type, event, season, size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        req.user.id,
        imageUrl,
        processedImageUrl,
        name || null,
        category || null,
        brand_names || null,
        descriptions || null,
        resolvedType,
        event,
        season || null,
        size || null,
      ],
    );

    res.status(201).json({ cloth: dbRes.rows[0] });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});




router.post("/uploadAvatar", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "File required" });

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "image",
      folder: "wardrobe/avatars",
      transformation: [{ width: 400, height: 400, crop: "fill" }],
    });

    const dbRes = await pool.query(
      `UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING
        id, username, avatar_url, email, role, created_at,
        (SELECT COUNT(*) FROM clothes WHERE owner_id = $2) as clothes_count,
        (SELECT COUNT(*) FROM outfits WHERE owner_id = $2) as outfits_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = $2) as posts_count`,
      [result.secure_url, req.user.id],
    );

    res.json({ user: dbRes.rows[0] });
  } catch (err) {
    console.error("Avatar upload error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});




router.post("/uploadPostImage", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "File required" });

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "image",
      folder: "wardrobe/posts",
      transformation: [{ width: 1200, crop: "limit" }],
    });

    res.json({ imageUrl: result.secure_url });
  } catch (err) {
    console.error("Post image upload error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});





router.post("/processCloth", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "File required" });

    const original = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "image",
      folder: "wardrobe/clothes",
    });
    const imageUrl = original.secure_url;

    let processedImageUrl = null;
    const noBgBuffer = await removeBg(req.file.buffer);
    if (noBgBuffer) {
      const processed = await uploadBufferToCloudinary(noBgBuffer, {
        resource_type: "image",
        folder: "wardrobe/clothes_nobg",
        format: "png",
      });
      processedImageUrl = processed.secure_url;
    }

    res.json({ imageUrl, processedImageUrl });
  } catch (err) {
    console.error("Process cloth error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});




router.post("/uploadCanvas", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "File required" });

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "image",
      folder: "wardrobe/canvas",
      format: "png",
    });

    res.json({ imageUrl: result.secure_url });
  } catch (err) {
    console.error("Canvas upload error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
