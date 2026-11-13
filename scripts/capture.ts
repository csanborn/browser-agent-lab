// Captures the README screenshots and demo GIF from the running app.
// Start the app first (npm run dev), then: npm run capture
// Works in both modes: with an API key the preset runs on Claude, without one the scripted agent plays it.
import { writeFile } from 'node:fs/promises';
import gifenc from 'gifenc';
import { chromium, type Page } from 'playwright';
import { PNG } from 'pngjs';

// gifenc ships CommonJS, so its functions come off the default export.
const { GIFEncoder, applyPalette, quantize } = gifenc;
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const PRESET = process.env.PRESET ?? 'Change my newsletter to monthly';
const out = (name: string) => new URL(`../docs/${name}`, import.meta.url);

async function startPreset(page: Page): Promise<void> {
  await page.goto(APP);
  await page.locator('.preset', { hasText: PRESET }).click();
  await page.getByRole('button', { name: 'Run task' }).click();
}

async function stills(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await startPreset(page);
  await page.getByRole('heading', { name: /Approve step/ }).waitFor({ timeout: 240_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('approval.png').pathname });
  await page.keyboard.press('a');
  await page.locator('.report').waitFor({ timeout: 240_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('run.png').pathname });
  await page.getByRole('tab', { name: 'Metrics' }).click();
  await page.locator('.tile').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('metrics.png').pathname });
  await browser.close();
}

async function gif(): Promise<void> {
  const width = 1200;
  const height = 750;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await startPreset(page);
  const encoder = GIFEncoder();
  let approved = false;
  let doneFrames = 0;
  let approvalFrames = 0;
  for (let frame = 0; frame < 600 && doneFrames < 8; frame += 1) {
    const png = PNG.sync.read(await page.screenshot());
    const palette = quantize(png.data, 128);
    encoder.writeFrame(applyPalette(png.data, palette), width, height, { palette, delay: 450 });
    if (!approved && (await page.getByRole('heading', { name: /Approve step/ }).count())) {
      approvalFrames += 1;
      if (approvalFrames >= 5) {
        await page.keyboard.press('a');
        approved = true;
      }
    }
    if (await page.locator('.report').count()) doneFrames += 1;
    await page.waitForTimeout(350);
  }
  encoder.finish();
  await writeFile(out('demo.gif'), encoder.bytes());
  await browser.close();
}

await stills();
await gif();
console.log('Wrote docs/approval.png, docs/run.png, docs/metrics.png and docs/demo.gif');
