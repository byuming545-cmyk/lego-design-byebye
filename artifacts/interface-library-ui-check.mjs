import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', error => errors.push(error.message));
await page.goto('http://127.0.0.1:3001/#/interface-library', { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: '接口与拼接库' }).waitFor({ timeout: 30000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'artifacts/interface-library/overview.png', fullPage: false });

await page.getByRole('button', { name: '规则', exact: true }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /BAR_CLIP/ }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'artifacts/interface-library/rule-detail.png', fullPage: false });

await page.getByRole('button', { name: '接口', exact: true }).click();
await page.waitForTimeout(700);
await page.getByPlaceholder('零件 / 来源 / 家族').fill('30374');
await page.waitForTimeout(700);
await page.getByRole('button', { name: /30374/ }).first().click();
await page.waitForTimeout(1800);
await page.screenshot({ path: 'artifacts/interface-library/interface-detail.png', fullPage: false });
await page.getByLabel('类型').selectOption('insufficient-evidence');
await page.getByLabel('说明').fill('界面复核：来源参数与朝向已核对，建议由人工确认夹持保持力。');
await page.getByRole('button', { name: /保存为人工观察/ }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'artifacts/interface-library/interface-feedback.png', fullPage: false });

await page.getByRole('button', { name: '案例', exact: true }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /3673.*32000/ }).first().click();
await page.waitForTimeout(2200);
await page.screenshot({ path: 'artifacts/interface-library/case-detail.png', fullPage: false });

await page.getByRole('button', { name: '新零件对比', exact: true }).click();
await page.waitForTimeout(500);
await page.getByLabel('目标零件（可选）').fill('48729b');
await page.getByRole('button', { name: /运行正式对比/ }).click();
await page.waitForTimeout(1600);
await page.screenshot({ path: 'artifacts/interface-library/compare.png', fullPage: false });

await page.getByRole('button', { name: '复核', exact: true }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: 'artifacts/interface-library/review.png', fullPage: false });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto('http://127.0.0.1:3001/#/interface-library', { waitUntil: 'networkidle' });
await mobile.getByRole('heading', { name: '接口与拼接库' }).waitFor({ timeout: 30000 });
await mobile.waitForTimeout(800);
await mobile.screenshot({ path: 'artifacts/interface-library/mobile-overview.png', fullPage: false });
console.log(JSON.stringify({ errors: errors.slice(0, 20), title: await page.title() }));
await browser.close();
