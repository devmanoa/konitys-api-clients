#!/usr/bin/env ts-node
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'

function usage(): void {
  console.error('Usage: npx ts-node scripts/extract-clients-2025-2026.ts <chemin-all.sql> [output.sql]')
  process.exit(1)
}

const infile = process.argv[2]
const outfile = process.argv[3] || 'sql/clients-2025-2026.sql'
if (!infile) usage()

const fullIn = path.resolve(infile)
if (!fs.existsSync(fullIn)) {
  console.error('Fichier non trouvé:', fullIn)
  process.exit(1)
}

const insertRegex = /INSERT\s+INTO\s+`?clients`?\s*\(([^)]+)\)\s*VALUES\s*(.+)$/is

function parseRowsWithRaw(valuesStr: string) {
  const rows: { vals: any[]; raw: string }[] = []
  let i = 0
  const len = valuesStr.length

  while (i < len) {
    while (i < len && /[\s,]/.test(valuesStr[i])) i++
    if (i >= len || valuesStr[i] !== '(') break
    const start = i
    i++ // skip '('
    const vals: any[] = []
    while (i < len) {
      while (i < len && /[ \t]/.test(valuesStr[i])) i++
      if (i >= len) break
      if (valuesStr[i] === ')') { i++; break }

      if (valuesStr[i] === "'") {
        let str = ''
        i++
        while (i < len) {
          if (valuesStr[i] === '\\' && i + 1 < len) { str += valuesStr[i + 1]; i += 2 }
          else if (valuesStr[i] === "'" && i + 1 < len && valuesStr[i + 1] === "'") { str += "'"; i += 2 }
          else if (valuesStr[i] === "'") { i++; break }
          else { str += valuesStr[i]; i++ }
        }
        vals.push(str)
      } else if (valuesStr.slice(i, i + 4).toUpperCase() === 'NULL') {
        vals.push(null)
        i += 4
      } else {
        let num = ''
        while (i < len && valuesStr[i] !== ',' && valuesStr[i] !== ')') { num += valuesStr[i]; i++ }
        const parsed = parseFloat(num.trim())
        vals.push(isNaN(parsed) ? num.trim() : parsed)
      }

      while (i < len && /[ \t]/.test(valuesStr[i])) i++
      if (i < len && valuesStr[i] === ',') i++
    }
    const end = i
    const raw = valuesStr.slice(start, end)
    rows.push({ vals, raw })
  }

  return rows
}

const fullOut = path.resolve(outfile)
fs.mkdirSync(path.dirname(fullOut), { recursive: true })
const outStream = fs.createWriteStream(fullOut, { encoding: 'utf-8' })

const rl = readline.createInterface({ input: fs.createReadStream(fullIn, { encoding: 'utf-8' }) })
let stmt = ''
let foundAny = false
let totalInsertedRows = 0
let processedStatements = 0

rl.on('line', (line) => {
  stmt += line + '\n'
  if (line.trim().endsWith(';')) {
    const m = stmt.match(insertRegex)
    if (m) {
      processedStatements++
      const colsStr = m[1]
      let valuesStr = m[2]
      if (valuesStr.trim().endsWith(';')) valuesStr = valuesStr.trim().slice(0, -1)
      const cols = colsStr.split(',').map(c => c.trim().replace(/`/g, '').replace(/'/g, ''))
      // La colonne de date dans la table clients s'appelle 'created'
      const dateIdx = cols.findIndex(c => c.toLowerCase() === 'created')
      if (dateIdx !== -1) {
        const rows = parseRowsWithRaw(valuesStr)
        const keep: string[] = []
        for (const r of rows) {
          const v = r.vals[dateIdx]
          let year: number | null = null
          if (typeof v === 'string') {
            const mm = v.match(/^(\d{4})-/)
            if (mm) year = parseInt(mm[1], 10)
          }
          if (year === 2025 || year === 2026) {
            keep.push(r.raw)
          }
        }

        if (keep.length > 0) {
          foundAny = true
          totalInsertedRows += keep.length
          outStream.write(`INSERT INTO \`clients\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES\n`)
          outStream.write(keep.join(',\n'))
          outStream.write(';\n\n')
        }
      }
    }
    stmt = ''
  }
})

rl.on('close', () => {
  outStream.end(() => {
    if (!foundAny) {
      console.log('Aucun client 2025/2026 trouvé dans', fullIn)
      try { fs.unlinkSync(fullOut) } catch (e) {}
      process.exit(0)
    }
    console.log(`Fichier généré: ${fullOut} (${totalInsertedRows} clients, ${processedStatements} statements scannés)`)
  })
})
