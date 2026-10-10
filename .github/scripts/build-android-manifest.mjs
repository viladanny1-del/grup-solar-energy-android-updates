import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'viladanny1-del/grup-solar-energy-android-updates';
const DOWNLOAD_BASE = 'https://grup-solar-energy-eirl.netlify.app/updates/android/';

export function validateManifest(release, rawManifest) {
  if (release.draft || release.prerelease) throw new Error('Se requiere un lanzamiento estable y publicado.');
  const manifestAsset = release.assets?.find(asset => asset.name === 'android.json');
  if (!manifestAsset) throw new Error('El lanzamiento no contiene android.json.');
  if (manifestAsset.digest) {
    const actual = `sha256:${createHash('sha256').update(rawManifest).digest('hex')}`;
    if (actual !== manifestAsset.digest) throw new Error('La integridad de android.json no coincide con GitHub.');
  }
  const manifest = JSON.parse(rawManifest);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || release.tag_name !== `v${manifest.version}`) {
    throw new Error('La versión del manifiesto no coincide con la etiqueta del lanzamiento.');
  }
  if (!Number.isInteger(manifest.versionCode) || manifest.versionCode < 1 || manifest.versionCode > 2147483647) {
    throw new Error('versionCode debe ser un entero positivo de Android.');
  }
  const apkName = `SolarEnergy-Android-${manifest.version}.apk`;
  if (manifest.apkUrl !== `${DOWNLOAD_BASE}${apkName}`) throw new Error('La APK debe usar la ruta de Android de Netlify.');
  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('La APK necesita un SHA-256 válido.');
  if (typeof manifest.notes !== 'string') throw new Error('El manifiesto necesita las notas del lanzamiento.');
  const apkAsset = release.assets.find(asset => asset.name === apkName);
  if (!apkAsset || !Number.isSafeInteger(apkAsset.size) || apkAsset.size < 1) throw new Error('Falta la APK del lanzamiento.');
  if (apkAsset.digest?.toLowerCase() !== `sha256:${manifest.sha256.toLowerCase()}`) {
    throw new Error('El SHA-256 del manifiesto no coincide con la APK publicada.');
  }
  return manifest;
}

async function readText(url, headers = {}, allowMissing = false) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Error HTTP ${response.status} al consultar ${new URL(url).pathname}.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 65536) throw new Error('La respuesta JSON supera el tamaño permitido.');
  return text;
}

export async function buildManifest(outputDirectory = '_site') {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'solar-energy-android-updates' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  // Siempre se consulta latest; ninguna versión queda fijada en este archivo.
  const latest = await readText(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, headers, true);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(`${outputDirectory}/.nojekyll`, '');
  if (latest === null) {
    await writeFile(`${outputDirectory}/index.html`, '<!doctype html><html lang="es"><meta charset="utf-8"><title>Actualizaciones Solar Energy Android</title><h1>Solar Energy Android</h1><p>El centro de actualizaciones está preparado. Todavía no se ha publicado una APK en este repositorio.</p></html>');
    console.log('GitHub Pages preparado; esperando la primera APK del centro de mando.');
    return null;
  }
  const release = JSON.parse(latest);
  const asset = release.assets?.find(item => item.name === 'android.json');
  if (!asset) throw new Error('El último lanzamiento estable no contiene android.json.');
  const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/android.json`;
  if (asset.browser_download_url !== expectedUrl) throw new Error('La dirección de android.json no pertenece al lanzamiento.');
  // La descarga pública no recibe credenciales de GitHub.
  const rawManifest = await readText(asset.browser_download_url);
  const manifest = validateManifest(release, rawManifest);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(`${outputDirectory}/android.json`, rawManifest);
  await writeFile(`${outputDirectory}/.nojekyll`, '');
  console.log(`Android ${manifest.version}, código ${manifest.versionCode}: manifiesto validado para GitHub Pages.`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildManifest(process.argv[2] || '_site');
}
