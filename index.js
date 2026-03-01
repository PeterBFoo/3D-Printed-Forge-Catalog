const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const crypto = require("crypto");

const seenHashes = new Set();

const SOURCE = "/Volumes/Expansion"; // tu HDD
const OUTPUT = "site"; // mejor en disco interno
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const BATCH_SIZE = 8; // MUY IMPORTANTE para HDD (no subir a 8)

const metadata = fs.existsSync("metadata.json")
  ? JSON.parse(fs.readFileSync("metadata.json"))
  : {};

// Crear estructura de salida
fs.rmSync(OUTPUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUTPUT, "images"), { recursive: true });
fs.mkdirSync(path.join(OUTPUT, "thumbs"), { recursive: true });

function isSystemFolder(name) {
  return name.startsWith(".") ||
    name === "System Volume Information" ||
    name === "$RECYCLE.BIN";
}

// Escáner robusto para HDD + macOS (/Volumes)
function walk(dir, fileList = []) {
  let entries;

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Ignorar carpetas protegidas del sistema (EPERM/EACCES)
    if (err.code === "EPERM" || err.code === "EACCES") {
      return fileList;
    }
    throw err;
  }

  for (const entry of entries) {
    if (isSystemFolder(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    try {
      if (entry.isDirectory()) {
        walk(fullPath, fileList);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXT.includes(ext)) {
          fileList.push(fullPath);
        }
      }
    } catch {
      // Ignorar archivos corruptos o inaccesibles
      continue;
    }
  }

  return fileList;
}

async function processImage(file) {
  const rel = path.relative(SOURCE, file).replace(/\\/g, "/");

  // 🔹 Calcular hash del archivo para detectar duplicados reales
  let hash;
  try {
    const buffer = fs.readFileSync(file);
    hash = crypto.createHash("sha1").update(buffer).digest("hex");
  } catch {
    return null;
  }

  // 🔹 Si ya vimos este hash, es duplicado → ignorar
  if (seenHashes.has(hash)) {
    console.log("Duplicada ignorada:", rel);
    return null;
  }

  seenHashes.add(hash);

  const meta = metadata[rel] || {};
  const title = meta.title || path.basename(file, path.extname(file));
  const category = meta.category || rel.split("/")[0] || "Sin categoría";
  const tags = meta.tags || [];
  const diskPath = rel;

  const imageRel = rel.replace(path.extname(rel), ".webp");

  const imageOut = path.join(OUTPUT, "images", imageRel);
  const thumbOut = path.join(OUTPUT, "thumbs", imageRel);

  fs.mkdirSync(path.dirname(imageOut), { recursive: true });
  fs.mkdirSync(path.dirname(thumbOut), { recursive: true });

  try {
    await sharp(file)
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(imageOut);

    await sharp(file)
      .resize({ width: 600, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(thumbOut);
  } catch (err) {
    console.log("Error procesando:", file);
    return null;
  }

  const encodedRel = encodeURI(imageRel);

  return {
    title,
    category,
    tags,
    image: `images/${encodedRel}`,
    thumb: `thumbs/${encodedRel}`,
    diskPath
  };
}

// Procesamiento por lotes (clave para HDD)
async function processInBatches(files, batchSize) {
  const results = [];

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    console.log(`Procesando ${Math.min(i + batchSize, files.length)} / ${files.length}`);

    const processed = await Promise.all(batch.map(processImage));
    results.push(...processed.filter(Boolean));
  }

  return results;
}

(async () => {
  console.log("Escaneando HDD (esto puede tardar la primera vez)...");
  const files = walk(SOURCE);

  console.log(`Imágenes encontradas: ${files.length}`);
  console.log("Optimizando imágenes (modo HDD seguro)...");

  const items = await processInBatches(files, BATCH_SIZE);

  fs.writeFileSync(
    path.join(OUTPUT, "index.json"),
    JSON.stringify(items)
  );

  const templatePath = path.join(__dirname, "templates", "index.html");
  const indexHTML = fs.readFileSync(templatePath, "utf-8");

  fs.writeFileSync(path.join(OUTPUT, "index.html"), indexHTML);

  console.log("Sitio generado correctamente en /site");
})();