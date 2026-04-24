import { assertEquals } from '@std/assert'
import { chromium } from 'npm:playwright'
import { withBrowserSmokeApp } from './browser_harness.ts'

async function launchChromium() {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      throw new Error('缺少 Playwright Chromium；请先运行 deno task playwright:install')
    }
    throw error
  }
}

Deno.test(
  '[contract] browser smoke: Reader、Config 与 Playground 页面应完成基础 hydration',
  async () => {
    await withBrowserSmokeApp(async ({ baseUrl }) => {
      const browser = await launchChromium()
      const page = await browser.newPage()

      try {
        await page.goto(baseUrl)
        await page.waitForSelector('.reader-home-panel a[href="/reader"]')
        assertEquals(await page.locator('.card-grid a[href="/config"]').count(), 1)
        assertEquals(await page.locator('.card-grid a[href="/xquery"]').count(), 1)
        assertEquals(await page.locator('.card-grid a[href="/syndication"]').count(), 1)

        await page.goto(`${baseUrl}/reader`)
        await page.waitForSelector('#reader-entry-list')
        await page.locator('#reader-manager-refresh').click()
        await page.waitForSelector('#reader-manager-message:not([hidden])')
        assertEquals(await page.locator('#reader-manager-message').textContent(), 'Reader 已刷新')
        await page.locator('button[data-entry-index="1"]').click()
        await page.waitForSelector('button[data-entry-index="1"][aria-expanded="true"]')
        assertEquals(
          await page.locator('button[data-entry-index="1"]').getAttribute('aria-expanded'),
          'true',
        )

        await page.goto(`${baseUrl}/config`)
        await page.waitForSelector('#config-delivery-create')
        await page.locator('#config-delivery-create').click()
        await page.waitForSelector('#config-delivery-title')
        assertEquals(
          (await page.locator('#config-delivery-title').textContent())?.includes('新建 delivery'),
          true,
        )

        await page.goto(`${baseUrl}/xquery`)
        await page.waitForSelector('#xq-form')
        await page.locator('label:has(input[name="feed-mode"][value="script"]) span').click()
        await page.waitForSelector('[data-mode-group="feed-script"]:not([hidden])')
        assertEquals(await page.locator('#feed-script').isVisible(), true)

        await page.goto(`${baseUrl}/syndication`)
        await page.waitForSelector('#syn-fill-defaults')
        await page.locator('#syn-fill-defaults').click()
        assertEquals(await page.locator('#syn-entry-id').inputValue(), '{{ id }}')
        assertEquals(await page.locator('#syn-feed-title').inputValue(), '{{ title }}')
      } finally {
        await browser.close()
      }
    })
  },
)
