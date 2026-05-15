const express = require("express");
const router = express.Router();
const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const pool = require("../db");
const auth = require("../middleware/auth_mw");
const { removeBackground } = require("@imgly/background-removal-node");

async function removeBg(imageBuffer) {
  try {
    const blob = new Blob([imageBuffer], { type: "image/jpeg" });
    const result = await removeBackground(blob);
    const arrayBuffer = await result.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.warn("Background removal failed:", err.message);
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

    
    const [original, noBgBuffer] = await Promise.all([
      uploadBufferToCloudinary(req.file.buffer, {
        resource_type: "image",
        folder: "wardrobe/clothes",
      }),
      removeBg(req.file.buffer),
    ]);
    const imageUrl = original.secure_url;

    
    let processedImageUrl = null;
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

    
    const [original, noBgBuffer] = await Promise.all([
      uploadBufferToCloudinary(req.file.buffer, {
        resource_type: "image",
        folder: "wardrobe/clothes",
      }),
      removeBg(req.file.buffer),
    ]);
    const imageUrl = original.secure_url;

    
    let processedImageUrl = null;
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
