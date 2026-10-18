#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const chunks = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
]

function packageIconSet(iconSetPath, outputPath) {
  const body = []
  for (const [type, filename] of chunks) {
    const image = fs.readFileSync(path.join(iconSetPath, filename))
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(image.length + header.length, 4)
    body.push(header, image)
  }
  const contents = Buffer.concat(body)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(contents.length + header.length, 4)
  fs.writeFileSync(outputPath, Buffer.concat([header, contents]))
}

if (process.argv.length !== 3) {
  throw new Error('Usage: package-icons.cjs ICON_OUTPUT_DIRECTORY')
}

const iconDirectory = path.resolve(process.argv[2])
for (const name of ['RealmForge', 'RealmForgeStop']) {
  packageIconSet(path.join(iconDirectory, `${name}.iconset`), path.join(iconDirectory, `${name}.icns`))
}
