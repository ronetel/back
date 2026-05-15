-- PostgreSQL schema for Wardrobe
CREATE TABLE IF NOT EXISTS clothes (
  id SERIAL PRIMARY KEY,
  image_urls TEXT,
  brand_names TEXT,
  descriptions TEXT,
  event VARCHAR(64),
  type VARCHAR(64),
  time TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outfits (
  id SERIAL PRIMARY KEY,
  date TIMESTAMP,
  event VARCHAR(64),
  outfits INTEGER[]
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password_hash TEXT
);

-- ensure users email unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
