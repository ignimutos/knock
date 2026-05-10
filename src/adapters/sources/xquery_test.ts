import { assertEquals, assertThrows } from '../../testing/assert.ts'
import { parseXquerySource } from './xquery.ts'
import { test } from '../../testing/test_api.ts'

// risk-id: R13
// layer: contract

test('[contract] R13 xquery: 原生表达式映射应产出 entry.id', () => {
  const xml = `<root><ul><li data-id="1"><a href="/a">Hello</a></li></ul></root>`

  const parsed = parseXquerySource(xml, {
    locate: '//li',
    feed: {
      title: 'string(/root/ul/li/a)',
    },
    entry: {
      id: 'string(@data-id)',
      title: 'string(a)',
      link: 'string(a/@href)',
    },
  })

  assertEquals(parsed.feed.mapped.title, 'Hello')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, '1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
  assertEquals(parsed.entries[0].mapped.link, '/a')
})

test('[contract] xquery: 原生表达式支持 HTML 提取', () => {
  const html =
    '<!doctype html><html><body><ul><li data-id="1"><a href="/a">Hello</a><img src="/img"></li></ul></body></html>'

  const parsed = parseXquerySource(html, {
    locate: '//li',
    feed: {
      title: 'string(//a)',
    },
    entry: {
      id: 'string(@data-id)',
      title: 'string(a)',
      link: 'string(a/@href)',
      image: 'string(img/@src)',
    },
  })

  assertEquals(parsed.feed.mapped.title, 'Hello')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, '1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
  assertEquals(parsed.entries[0].mapped.link, '/a')
  assertEquals(parsed.entries[0].mapped.image, '/img')
})

test('[contract] xquery: 大写 DOCTYPE HTML 也应按 HTML 处理', () => {
  const html =
    '<!DOCTYPE html><HTML><BODY><ul><li data-id="1"><a href="/a">Hello</a></li></ul></BODY></HTML>'

  const parsed = parseXquerySource(html, {
    locate: '//li',
    entry: {
      id: 'string(@data-id)',
      title: 'string(a)',
    },
  })

  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, '1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
})

test('[contract] xquery: HTML 前置注释时也应按 HTML 处理', () => {
  const html =
    '<!-- comment --><html><body><ul><li data-id="1"><a href="/a">Hello</a></li></ul></body></html>'

  const parsed = parseXquerySource(html, {
    locate: '//li',
    entry: {
      id: 'string(@data-id)',
      title: 'string(a)',
    },
  })

  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, '1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
})

test('[contract] xquery: HTML 文档中的属性与文本提取应保持现有语义', () => {
  const html =
    '<!doctype html><html><body><article data-id="a1"><a href="/post">Hello</a></article></body></html>'

  const parsed = parseXquerySource(html, {
    locate: '//article',
    feed: {
      title: 'string(//a)',
    },
    entry: {
      id: 'string(@data-id)',
      title: 'string(a)',
      link: 'string(a/@href)',
    },
  })

  assertEquals(parsed.feed.mapped.title, 'Hello')
  assertEquals(parsed.entries[0].mapped.id, 'a1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
  assertEquals(parsed.entries[0].mapped.link, '/post')
})

test('[contract] xquery: XHTML 文档应按 XML 处理并保留 namespace 语义', () => {
  const xhtml = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <ul>
      <li data-id="1"><a href="/a">Hello</a></li>
    </ul>
  </body>
</html>`

  const parsed = parseXquerySource(xhtml, {
    locate: '//xh:li',
    namespaces: {
      xh: 'http://www.w3.org/1999/xhtml',
    },
    feed: {
      title: 'string(/xh:html/xh:body/xh:ul/xh:li/xh:a)',
    },
    entry: {
      id: 'string(@data-id)',
      title: 'string(xh:a)',
      link: 'string(xh:a/@href)',
    },
  })

  assertEquals(parsed.feed.mapped.title, 'Hello')
  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, '1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
  assertEquals(parsed.entries[0].mapped.link, '/a')
})

test('[contract] xquery: 原生表达式可直接生成常量字段', () => {
  const xml = `<root><title>Hello</title><ul><li data-id="1"><a href="/a">Hello</a></li></ul></root>`

  const parsed = parseXquerySource(xml, {
    locate: '//li',
    feed: {
      title: 'string(/root/title)',
      summary: "'Hello world'",
    },
    entry: {
      id: 'string(@data-id)',
    },
  })

  assertEquals(parsed.feed.mapped.summary, 'Hello world')
})

test('[contract] xquery: template 前缀不再受支持', () => {
  const xml = `<root><ul><li data-id="1"><a href="/a">Hello</a></li></ul></root>`

  assertThrows(
    () =>
      parseXquerySource(xml, {
        locate: '//li',
        entry: {
          id: 'string(@data-id)',
          description: "template:{{ entry.id | match_regex: '^1$' }}",
        },
      }),
    Error,
  )
})

test('[contract] xquery: literal 前缀不再受支持', () => {
  const xml = `<root><ul><li data-id="1"><a href="/a">Hello</a></li></ul></root>`

  assertThrows(
    () =>
      parseXquerySource(xml, {
        locate: '//li',
        entry: {
          id: 'string(@data-id)',
          description: 'literal:hello',
        },
      }),
    Error,
  )
})

test('[contract] xquery: xquery 前缀不再受支持', () => {
  const xml = `<root><ul><li data-id="1"><a href="/a">Hello</a></li></ul></root>`

  assertThrows(
    () =>
      parseXquerySource(xml, {
        locate: '//li',
        entry: {
          id: 'xquery:string(@data-id)',
        },
      }),
    Error,
  )
})

test('[contract] xquery: locate 缺省时应以 document 作为 entry 上下文执行一次', () => {
  const xml = `<root data-id="doc-1"><title>Hello</title></root>`

  const parsed = parseXquerySource(xml, {
    entry: {
      id: 'string(/root/@data-id)',
      title: 'string(/root/title)',
    },
  })

  assertEquals(parsed.entries.length, 1)
  assertEquals(parsed.entries[0].mapped.id, 'doc-1')
  assertEquals(parsed.entries[0].mapped.title, 'Hello')
})

test('[contract] xquery: feed 支持脚本字符串返回 map', () => {
  const xml = `<root><title>Hello</title><ul><li data-id="1"><a>Hello</a></li></ul></root>`

  const parsed = parseXquerySource(xml, {
    feed: `map {
      "title": string(/root/title),
      "description": "from-script"
    }`,
    entry: {
      id: 'string(/root/ul/li/@data-id)',
    },
  })

  assertEquals(parsed.feed.mapped.title, 'Hello')
  assertEquals(parsed.feed.mapped.description, 'from-script')
})

test('[contract] xquery: entry 支持脚本字符串并按 locate 节点执行', () => {
  const xml = `<root><ul><li data-id="1"><a>One</a></li><li data-id="2"><a>Two</a></li></ul></root>`

  const parsed = parseXquerySource(xml, {
    locate: '//li',
    entry: `map {
      "id": string(@data-id),
      "title": string(a)
    }`,
  })

  assertEquals(parsed.entries.length, 2)
  assertEquals(parsed.entries[0].mapped.id, '1')
  assertEquals(parsed.entries[0].mapped.title, 'One')
  assertEquals(parsed.entries[1].mapped.id, '2')
  assertEquals(parsed.entries[1].mapped.title, 'Two')
})

test('[contract] xquery: entry 脚本返回缺少 id 时应报错', () => {
  const xml = `<root><ul><li data-id="1"><a>One</a></li></ul></root>`

  assertThrows(
    () =>
      parseXquerySource(xml, {
        locate: '//li',
        entry: `map {
          "title": string(a)
        }`,
      }),
    Error,
    'xquery.entry.id 必填',
  )
})

test('[contract] xquery: 脚本模式不使用 namespaces', () => {
  const xhtml = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <ul>
      <li data-id="1"><a href="/a">Hello</a></li>
    </ul>
  </body>
</html>`

  assertThrows(
    () =>
      parseXquerySource(xhtml, {
        locate: '//xh:li',
        namespaces: {
          xh: 'http://www.w3.org/1999/xhtml',
        },
        entry: `map {
          "id": string(@data-id),
          "title": string(xh:a)
        }`,
      }),
    Error,
  )
})
export const testMeta = [
  {
    title: '__file__',
    layer: 'contract',
    risks: ['R13'],
  },
  {
    title: '[contract] R13 xquery: 原生表达式映射应产出 entry.id',
    layer: 'contract',
    risks: ['R13'],
  },
] as const
