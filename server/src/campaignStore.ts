import crypto = require('node:crypto')
import database = require('./database')

namespace campaignStore {
  export interface Campaign {
    id: string
    name: string
    description: string
    setting: string
    createdAt: string
  }

  export interface NewCampaign {
    name: string
    description: string
    setting: string
  }

  const listStatement = database.prepare(
    'SELECT id, name, description, setting, createdAt FROM campaigns ORDER BY createdAt DESC, rowid DESC',
  )
  const insertStatement = database.prepare(
    'INSERT INTO campaigns (id, name, description, setting, createdAt) VALUES (?, ?, ?, ?, ?)',
  )

  export function listCampaigns(): Campaign[] {
    return listStatement.all() as unknown as Campaign[]
  }

  export function createCampaign(input: NewCampaign): Campaign {
    const campaign: Campaign = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      setting: input.setting,
      createdAt: new Date().toISOString(),
    }

    insertStatement.run(
      campaign.id,
      campaign.name,
      campaign.description,
      campaign.setting,
      campaign.createdAt,
    )

    return campaign
  }
}

export = campaignStore
