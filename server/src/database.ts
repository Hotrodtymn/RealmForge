import fs = require('node:fs')
import path = require('node:path')
import sqlite = require('node:sqlite')

const dataDirectory = path.resolve(__dirname, '../data')
fs.mkdirSync(dataDirectory, { recursive: true })

const database = new sqlite.DatabaseSync(path.join(dataDirectory, 'realmforge.sqlite'))
database.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    setting TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )
`)

export = database
