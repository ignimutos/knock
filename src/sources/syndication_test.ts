import { assertEquals, assertRejects } from '@std/assert'
import type { SyndicationSourceConfig } from '../config/schema.ts'
import { parseSyndicationSource } from './syndication.ts'

Deno.test('syndication: RSS 默认输出扩展 unified 字段', async () => {
  const xml = `
<rss>
  <channel>
    <title> Example Blog </title>
    <link> https://example.com </link>
    <description> Feed Summary </description>
    <generator>Knock</generator>
    <language>en-us</language>
    <pubDate>2026-01-01T00:00:00Z</pubDate>
    <item>
      <guid>g-1</guid>
      <title> Example 1.80 </title>
      <link> https://example.com/post </link>
      <description> release note </description>
      <pubDate>2026-01-02T03:04:05Z</pubDate>
    </item>
  </channel>
</rss>
`

  const parsed = await parseSyndicationSource(xml)

  assertEquals(parsed.format, 'rss')
  assertEquals(parsed.feed.title, 'Example Blog')
  assertEquals(parsed.feed.link, 'https://example.com/')
  assertEquals(parsed.feed.description, 'Feed Summary')
  assertEquals(parsed.feed.generator, 'Knock')
  assertEquals(parsed.feed.language, 'en-us')
  assertEquals(parsed.feed.published, '2026-01-01 00:00:00')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, 'g-1')
  assertEquals(parsed.entries[0].mapped.title, 'Example 1.80')
  assertEquals(parsed.entries[0].mapped.link, 'https://example.com/post')
  assertEquals(parsed.entries[0].mapped.description, 'release note')
  assertEquals(parsed.entries[0].mapped.content, 'release note')
  assertEquals(parsed.entries[0].mapped.published, '2026-01-02 03:04:05')
  assertEquals(parsed.entries[0].mapped.updated, '2026-01-02 03:04:05')
})

Deno.test('syndication: Atom 默认字段支持 content 与 updated 回退', async () => {
  const xml = `
<feed xmlns="http://www.w3.org/2005/Atom">
  <title> Releases </title>
  <updated>2026-03-25T00:00:00Z</updated>
  <entry>
    <id>e-1</id>
    <title> v1.0.0 </title>
    <link href="https://example.com/r/1" />
    <summary> first </summary>
    <updated>2026-03-26T00:00:00Z</updated>
  </entry>
</feed>`

  const parsed = await parseSyndicationSource(xml)

  assertEquals(parsed.feed.published, '2026-03-25 00:00:00')
  assertEquals(parsed.entries[0].mapped.description, 'first')
  assertEquals(parsed.entries[0].mapped.content, 'first')
  assertEquals(parsed.entries[0].mapped.published, '2026-03-26 00:00:00')
  assertEquals(parsed.entries[0].mapped.updated, '2026-03-26 00:00:00')
})

Deno.test('syndication: JSON Feed 默认字段支持 content 与 updated 回退', async () => {
  const payload = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: ' Example Feed ',
    home_page_url: 'https://example.com',
    description: ' Feed Summary ',
    items: [
      {
        id: 'j-1',
        title: ' Example Item ',
        url: 'https://example.com/posts/1',
        summary: ' summary text ',
        content_text: ' body text ',
        date_published: '2026-03-20T00:00:00Z',
      },
    ],
  })

  const parsed = await parseSyndicationSource(payload)

  assertEquals(parsed.format, 'json')
  assertEquals(parsed.feed.title, 'Example Feed')
  assertEquals(parsed.entries[0].mapped.description, 'summary text')
  assertEquals(parsed.entries[0].mapped.content, 'body text')
  assertEquals(parsed.entries[0].mapped.published, '2026-03-20 00:00:00')
  assertEquals(parsed.entries[0].mapped.updated, '2026-03-20 00:00:00')
})

Deno.test('syndication: 显式 entry mapping 不应用默认 date format 与 fallback', async () => {
  const payload = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    items: [
      {
        id: 'j-1',
        summary: 'summary text',
        content_text: 'body text',
        date_published: '2026-03-20T00:00:00Z',
      },
    ],
  })

  const parsed = await parseSyndicationSource(payload, {
    entry: {
      id: '{{ id }}',
      description: '{{ description }}',
      content: '{{ content }}',
      published: '{{ published }}',
      updated: '{{ updated }}',
    },
  })

  assertEquals(parsed.entries[0].mapped.description, 'summary text')
  assertEquals(parsed.entries[0].mapped.content, 'body text')
  assertEquals(parsed.entries[0].mapped.published, '2026-03-20T00:00:00Z')
  assertEquals(parsed.entries[0].mapped.updated, '')
})

Deno.test('syndication: Atom entry mapping 支持读取 feed', async () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><entry><id>e-1</id><title>v1.0.0</title><link href="https://example.com/r/1" /><summary>first</summary><published>2026-03-24T00:00:00Z</published></entry></feed>`

  const parsed = await parseSyndicationSource(xml, {
    feed: {
      title: '{{ title }}',
    },
    entry: {
      id: '{{ id }}',
      title: '{{ title }}',
      description: '{{ feed.title }}',
    },
  })

  assertEquals(parsed.format, 'atom')
  assertEquals(parsed.feed.title, 'Releases')
  assertEquals(parsed.entries[0].mapped.id, 'e-1')
  assertEquals(parsed.entries[0].mapped.title, 'v1.0.0')
  assertEquals(parsed.entries[0].mapped.description, 'Releases')
})

Deno.test('syndication: feed mapping 不可反向读取 entry', async () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><entry><id>e-1</id><title>v1.0.0</title></entry></feed>`

  const parsed = await parseSyndicationSource(xml, {
    feed: {
      title: '{{ entry.title }}',
    },
    entry: {
      id: '{{ id }}',
    },
  })

  assertEquals(parsed.feed.title, '')
})

Deno.test('syndication: 共享 runtime filter 可用于映射', async () => {
  const xml = `
<rss>
  <channel>
    <title>Example Blog</title>
    <item>
      <guid>g-1</guid>
      <title>Example 1.80</title>
      <link>https://example.com/post</link>
      <description>release note</description>
    </item>
  </channel>
</rss>
`

  const parsed = await parseSyndicationSource(xml, {
    entry: {
      description: "{{ title | match_regex: '^example 1\\.80$', 'i' }}",
    },
  })

  assertEquals(parsed.entries[0].mapped.description, 'true')
})

Deno.test('syndication: 共享 runtime filter 支持反转匹配映射', async () => {
  const xml = `
<rss>
  <channel>
    <title>Example Blog</title>
    <item>
      <guid>g-1</guid>
      <title>Example 1.80</title>
      <link>https://example.com/post</link>
      <description>release note</description>
    </item>
  </channel>
</rss>
`

  const parsed = await parseSyndicationSource(xml, {
    entry: {
      description: "{{ title | match_regex: '^example 1\\.80$', 'i', true }}",
    },
  })

  assertEquals(parsed.entries[0].mapped.description, 'false')
})

Deno.test('syndication: 自定义字段支持无序引用', async () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><entry><id>e-1</id><title>v1.0.0</title><summary>first</summary></entry></feed>`

  const mapping = {
    entry: {
      id: '{{ id }}',
      title: '{{ title }}',
      description: '{{ plain_summary }}',
      plain_summary: 'first',
      content: '{{ content }}',
    },
  } as unknown as SyndicationSourceConfig

  const parsed = await parseSyndicationSource(xml, mapping)

  assertEquals(parsed.entries[0].mapped.content, '')
  assertEquals(parsed.entries[0].mapped.description, 'first')
})

Deno.test('syndication: 自定义字段循环依赖时报错', async () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>e-1</id><title>v1.0.0</title></entry></feed>`

  const mapping = {
    entry: {
      id: '{{ id }}',
      title: '{{ title }}',
      description: '{{ a }}',
      a: '{{ b }}',
      b: '{{ a }}',
    },
  } as unknown as SyndicationSourceConfig

  await assertRejects(async () => await parseSyndicationSource(xml, mapping), Error, '存在循环依赖')
})

Deno.test('syndication: 非法 match_fuzzy mode 会报错', async () => {
  const xml = `
<rss>
  <channel>
    <item>
      <guid>g-1</guid>
      <title>Example 1.80</title>
    </item>
  </channel>
</rss>
`

  await assertRejects(
    async () =>
      await parseSyndicationSource(xml, {
        entry: {
          description: "{{ title | match_fuzzy: 'Ex', 'middle' }}",
        },
      }),
    Error,
  )
})

Deno.test('syndication: Atom summary 实体展开超过默认限制时仍可解析', async () => {
  const repeatedHtml = '&lt;p&gt;release&lt;/p&gt;'.repeat(1001)
  const xml = `
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Releases</title>
  <entry>
    <id>e-entity-limit</id>
    <title>v1.0.0</title>
    <link href="https://example.com/r/1" />
    <summary>${repeatedHtml}</summary>
    <published>2026-03-24T00:00:00Z</published>
  </entry>
</feed>`

  const parsed = await parseSyndicationSource(xml)

  assertEquals(parsed.format, 'atom')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, 'e-entity-limit')
  assertEquals(parsed.entries[0].mapped.title, 'v1.0.0')
})
