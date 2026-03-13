#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';

// juntar todos los archivos .sql de la carpeta 'sql' en un único archivo
defaults();

function defaults() {
  const folder = path.resolve('sql');
  const outFile = path.join(folder, 'all.sql');

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error('Le dossier "sql" n\'existe pas ou n\'est pas un dossier.');
    process.exit(1);
  }

  const files = fs.readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .map((f) => path.join(folder, f))
    .filter((p) => fs.statSync(p).isFile());

  if (files.length === 0) {
    console.error('Aucun fichier .sql trouvé dans le dossier sql.');
    process.exit(1);
  }

  const outStream = fs.createWriteStream(outFile, { encoding: 'utf-8' });
  for (const f of files) {
    outStream.write('-- file: ' + path.basename(f) + '\n');
    const content = fs.readFileSync(f, 'utf-8');
    outStream.write(content.trim() + '\n\n');
  }
  outStream.end(() => {
    console.log(`Fichier concaténé créé : ${outFile} (${files.length} sources)`);
  });
}
