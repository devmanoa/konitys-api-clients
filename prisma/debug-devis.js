const fs = require('fs');

const devisSql = fs.readFileSync('../devis.sql', 'utf-8');
const clientsSql = fs.readFileSync('../clients.sql', 'utf-8');

// Get first 10 client IDs from clients.sql
const cColMatch = clientsSql.match(/INSERT INTO `clients` \(([^)]+)\) VALUES/);
const cCols = cColMatch[1].split(',').map(c => c.trim().replace(/`/g, ''));
console.log('Client columns[0]:', cCols[0]); // should be 'id'

const cStart = clientsSql.indexOf('VALUES', cColMatch.index) + 6;
const cIds = [];
const cRegex = /\((\d+),/g;
let m;
const cAfter = clientsSql.substring(cStart);
while ((m = cRegex.exec(cAfter)) && cIds.length < 10) cIds.push(m[1]);
console.log('First 10 client IDs:', cIds);

// Get devis columns
const dColMatch = devisSql.match(/INSERT INTO `devis` \(([^)]+)\) VALUES/);
const dCols = dColMatch[1].split(',').map(c => c.trim().replace(/`/g, ''));
const clientIdIdx = dCols.indexOf('client_id');
console.log('client_id index in devis:', clientIdIdx);

// Use the migration parser to get actual devis data
function parseMySqlInserts(sql, tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const colRegex = new RegExp('INSERT INTO `' + escaped + '` \\(([^)]+)\\) VALUES');
  const colMatch = sql.match(colRegex);
  if (!colMatch) return [];
  const columns = colMatch[1].split(',').map(c => c.trim().replace(/`/g, ''));

  const rows = [];
  const valuesStart = sql.indexOf('VALUES', colMatch.index);
  const sqlAfterValues = sql.substring(valuesStart);

  const valueRegex = /\((\d+,\s*(?:'(?:[^'\\]|\\.)*'|NULL|[\d.eE+-]+)(?:,\s*(?:'(?:[^'\\]|\\.)*'|NULL|[\d.eE+-]+))*)\)/g;
  let match;

  while ((match = valueRegex.exec(sqlAfterValues)) !== null) {
    const raw = match[1];
    const values = [];
    let i = 0;

    while (i < raw.length) {
      while (i < raw.length && (raw[i] === ' ' || raw[i] === ',' || raw[i] === '\t' || raw[i] === '\n')) i++;
      if (i >= raw.length) break;

      if (raw[i] === "'") {
        i++;
        let str = '';
        while (i < raw.length) {
          if (raw[i] === '\\' && i + 1 < raw.length) { str += raw[i + 1]; i += 2; }
          else if (raw[i] === "'") { i++; break; }
          else { str += raw[i]; i++; }
        }
        values.push(str);
      } else if (raw.substring(i, i + 4) === 'NULL') {
        values.push(null);
        i += 4;
      } else {
        let num = '';
        while (i < raw.length && raw[i] !== ',' && raw[i] !== ')') { num += raw[i]; i++; }
        const trimmed = num.trim();
        values.push(trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10));
      }
    }

    if (values.length === columns.length) {
      const row = {};
      columns.forEach((col, idx) => { row[col] = values[idx]; });
      rows.push(row);
    }
  }

  return rows;
}

const devisRows = parseMySqlInserts(devisSql, 'devis');
console.log('\nTotal devis parsed:', devisRows.length);

// Show first 10 devis client_ids
const devisClientIds = devisRows.slice(0, 10).map(r => ({ id: r.id, client_id: r.client_id }));
console.log('First 10 devis (id, client_id):', JSON.stringify(devisClientIds));

// Get unique client_ids from devis
const uniqueClientIds = [...new Set(devisRows.map(r => String(r.client_id)))];
console.log('\nUnique client_ids in devis:', uniqueClientIds.length);
console.log('Sample:', uniqueClientIds.slice(0, 20));

// Check overlap with client IDs
const clientIdSet = new Set(cIds);
const overlap = uniqueClientIds.filter(id => clientIdSet.has(id));
console.log('\nOverlap (first 10 client IDs):', overlap.length);

// Load ALL client ids
const allClientIds = [];
const cRegex2 = /\((\d+),/g;
let m2;
const cAfter2 = clientsSql.substring(cStart);
while ((m2 = cRegex2.exec(cAfter2))) allClientIds.push(m2[1]);
console.log('\nTotal client IDs in clients.sql:', allClientIds.length);
const allClientIdSet = new Set(allClientIds);
const fullOverlap = uniqueClientIds.filter(id => allClientIdSet.has(id));
console.log('Devis client_ids that match a client ID:', fullOverlap.length, '/', uniqueClientIds.length);
console.log('Sample matching:', fullOverlap.slice(0, 10));
console.log('Sample NOT matching:', uniqueClientIds.filter(id => !allClientIdSet.has(id)).slice(0, 10));
