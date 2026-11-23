#!/usr/bin/env node
/**
 * Regenerate the dependency license inventory used by docs/THIRD_PARTY_LICENSES.md.
 *
 * Reads package-lock.json only (no network, no install): prints direct
 * dependencies with their resolved version/license, then the transitive
 * license distribution. Run from the repository root:
 *
 *   node scripts/license-report.js
 */

'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const packages = lock.packages || {}

const licenseOf = (entry, name) => {
  const license = entry && entry.license
  if (Array.isArray(license)) return license.join(' OR ')
  if (license) return license
  // A few packages ship a LICENSE file without a package.json license field.
  // Record that the field is absent rather than guessing a legal identifier.
  if (entry && entry.link) return 'PRIVATE (workspace)'
  try {
    const dir = path.join(root, 'node_modules', name)
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : []
    if (files.some((file) => /^licen[cs]e/i.test(file))) return 'UNKNOWN (LICENSE file present, type not declared)'
  } catch {
    // Fall through to the explicit unknown marker.
  }
  return 'UNKNOWN'
}

const manifests = [
  ['root', ''],
  ['client', 'client'],
  ['server', 'server'],
  ['shared', 'shared'],
]

const direct = new Map()
for (const [label, dir] of manifests) {
  const manifest = packages[dir]
  if (!manifest) continue
  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) }
  for (const [name, range] of Object.entries(dependencies)) {
    const resolved = packages[`node_modules/${name}`]
    direct.set(`${label}|${name}`, {
      workspace: label,
      name,
      range,
      version: resolved ? resolved.version : 'not installed',
      license: licenseOf(resolved, name),
    })
  }
}

const distribution = {}
for (const [name, entry] of Object.entries(packages)) {
  const license = licenseOf(entry, name)
  distribution[license] = (distribution[license] || 0) + 1
}

console.log('## Direct dependencies')
console.log('workspace | package | declared range | resolved version | license')
console.log('---|---|---|---|---')
for (const row of direct.values()) {
  console.log(`${row.workspace} | ${row.name} | ${row.range} | ${row.version} | ${row.license}`)
}

console.log('\n## Transitive license distribution')
console.log('license | package count')
console.log('---|---')
for (const [license, count] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
  console.log(`${license} | ${count}`)
}
