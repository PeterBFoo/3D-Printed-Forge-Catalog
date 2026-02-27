const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

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
fs.mkdirSync(path.join(OUTPUT, "pages"), { recursive: true });

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
    const meta = metadata[rel] || {};

    const title = meta.title || path.basename(file, path.extname(file));
    const category = meta.category || rel.split("/")[0] || "Sin categoría";
    const tags = meta.tags || [];

    const imageRel = rel.replace(path.extname(rel), ".webp");
    const pageRel = rel.replace(path.extname(rel), ".html");

    const imageOut = path.join(OUTPUT, "images", imageRel);
    const thumbOut = path.join(OUTPUT, "thumbs", imageRel);
    const pageOut = path.join(OUTPUT, "pages", pageRel);

    fs.mkdirSync(path.dirname(imageOut), { recursive: true });
    fs.mkdirSync(path.dirname(thumbOut), { recursive: true });
    fs.mkdirSync(path.dirname(pageOut), { recursive: true });

    try {
        // Imagen optimizada (peso enorme → reducido)
        await sharp(file)
            .resize({ width: 1600, withoutEnlargement: true })
            .webp({ quality: 75 })
            .toFile(imageOut);

        // Miniatura ligera (para catálogo rápido)
        await sharp(file)
            .resize({ width: 300, withoutEnlargement: true })
            .webp({ quality: 60 })
            .toFile(thumbOut);
    } catch (err) {
        console.log("Error procesando:", file);
        return null;
    }

    const thumbWeb = `thumbs/${encodeURI(rel.replace(path.extname(rel), ".webp"))}`;
    const imageWeb = path.join(OUTPUT, "images", rel.replace(path.extname(rel), ".webp"));
    const pageWeb = path.join(OUTPUT, "pages", rel.replace(path.extname(rel), ".html"));

    // Calcular rutas relativas desde la página actual
    const pageDir = path.dirname(pageOut); // directorio de la página individual
    const relImage = path.relative(pageDir, imageOut).replace(/\\/g, "/");
    const relIndex = path.relative(pageDir, path.join(OUTPUT, "index.html")).replace(/\\/g, "/");

    // Obtener la ruta relativa desde SOURCE (para informar al usuario dónde está el archivo en disco)
    const discoRelPath = path.relative(SOURCE, file).replace(/\\/g, "/");

    const pageHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body{background:#0e0e0e;color:#eee;font-family:sans-serif;text-align:center;padding:20px}
img{max-width:95%;border-radius:12px}
.meta{color:#aaa}
a{color:#8cf}
</style>
</head>
<body>
<h1>${title}</h1>
<div class="meta">Categoría: ${category}</div>
<div class="meta">Ruta disco duro: ${discoRelPath}</div>
<br>
<img src="${encodeURI(relImage)}" loading="lazy">
<br><br>
<a href="${encodeURI(relIndex)}">Volver al catálogo</a>
</body>
</html>`;

    fs.writeFileSync(pageOut, pageHTML);

    return {
        title,
        category,
        tags,
        page: pageWeb,
        thumb: thumbWeb
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

    const indexHTML = `<!DOCTYPE html>
<html>

<head>
  <meta charset="utf-8">
  <title>Catálogo de Minis</title>
  <style>
    body {
      background: #0e0e0e;
      color: #eee;
      font-family: sans-serif;
      padding: 30px;
    }

    input,
    select {
      padding: 10px;
      margin: 5px;
      font-size: 16px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }

    .card {
      background: #1b1b1b;
      border-radius: 10px;
      padding: 10px;
    }

    img {
      width: 100%;
      border-radius: 8px;
    }

    .small {
      color: #aaa;
      font-size: 12px;
    }

    a {
      text-decoration: none;
      color: white;
    }

    #pagination button {
      margin: 2px;
      padding: 5px 10px;
    }
  </style>
</head>

<body>
  <h1>Catálogo de Minis</h1>

  <input id="search" placeholder="Buscar por nombre o tags">
  <select id="category">
    <option value="">Todas las categorías</option>
  </select>

  <div class="grid" id="grid"></div>
  <div id="pagination" style="margin-top:20px;text-align:center"></div>

  <script>
    let DATA = [];
    let currentPage = 1;
    const pageSize = 50; // elementos por página

    // Cargar datos
    fetch("index.json")
      .then(r => r.json())
      .then(d => {
        DATA = d;

        // Crear opciones de categoría
        const cats = [...new Set(DATA.map(i => i.category))].sort();
        const sel = document.getElementById("category");
        cats.forEach(c => {
          const o = document.createElement("option");
          o.value = c;
          o.textContent = c;
          sel.appendChild(o);
        });

        render();
      });

    // Listeners
    document.getElementById("search").addEventListener("input", () => { currentPage = 1; render(); });
    document.getElementById("category").addEventListener("change", () => { currentPage = 1; render(); });

    // Función de renderizado con paginación
    function render() {
      const q = document.getElementById("search").value.toLowerCase();
      const cat = document.getElementById("category").value;
      const grid = document.getElementById("grid");
      const pagination = document.getElementById("pagination");
      grid.innerHTML = "";
      pagination.innerHTML = "";

      // Filtrado
      const filtered = DATA.filter(i =>
        (!cat || i.category === cat) &&
        (i.title.toLowerCase().includes(q) ||
          i.tags.join(" ").toLowerCase().includes(q))
      );

      const totalPages = Math.ceil(filtered.length / pageSize);
      if (currentPage > totalPages) currentPage = 1;

      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize;
      const pageItems = filtered.slice(start, end);

      // Render de miniaturas
      pageItems.forEach(i => {
        const div = document.createElement("div");
        div.className = "card";
        let pageUrl = i.page.replace("site/", "");
        div.innerHTML = \`
      <a href="\${pageUrl}">
        <img src="\${i.thumb}" loading="lazy">
        <div>\${i.title}</div>
        <div class="small">${i.category}</div>
      </a>
    \`;
        grid.appendChild(div);
      });

      // Botones de paginación
      for (let p = 1; p <= totalPages; p++) {
        const btn = document.createElement("button");
        btn.textContent = p;
        btn.disabled = p === currentPage;
        btn.addEventListener("click", () => { currentPage = p; render(); });
        pagination.appendChild(btn);
      }
    }
  </script>
</body>

</html>`;

    fs.writeFileSync(path.join(OUTPUT, "index.html"), indexHTML);

    console.log("Sitio generado correctamente en /site");
})();