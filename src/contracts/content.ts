export const FEED_FIELD_KEYS = [
  'title',
  'link',
  'description',
  'generator',
  'language',
  'published',
] as const
export const ENTRY_FIELD_KEYS = [
  'id',
  'title',
  'link',
  'description',
  'content',
  'published',
  'updated',
] as const

export type UnifiedFeedField = (typeof FEED_FIELD_KEYS)[number]
export type UnifiedEntryField = (typeof ENTRY_FIELD_KEYS)[number]

export interface UnifiedFeedFields {
  title: string
  link: string
  description: string
  generator: string
  language: string
  published: string
}

export interface UnifiedEntryFields {
  id: string
  title: string
  link: string
  description: string
  content: string
  published: string
  updated: string
}
