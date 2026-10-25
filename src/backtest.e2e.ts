/// <reference types="node" />
/// <reference types="bun" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright';
import { extractEntry, parseZipDirectory } from './history-zip';
import { startTestSite } from './e2e-site';

// ============================================================================
// Browser check of the backtest ("As of") feature: the selector (grey while live, amber in a
// backtest), the snapshots of the site, the banner, a ticker missing from the archive, a backup made in the app with the
// custom levels in it, the data manager, an import of that backup, read-only custom levels, back to live.
// Run: `bun run test:e2e`.
// ============================================================================

const SPOT = 700.5;
async function main(): Promise<void> {
    const site = await startTestSite({
        latest: '2026-09-30',
        snapshots: [
            { id: '2026-09-28', tickers: ['QQQ'], spot: SPOT - 1 },
            { id: '2026-09-29', tickers: ['SPY'], spot: SPOT },
            { id: '2026-09-30', tickers: ['SPY', 'QQQ'], spot: SPOT + 1 },
        ],
    });
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const selector = page.locator('[data-asof-select] > button');
    const banner = page.locator('[data-backtest-banner]');
    const option = (id: string) => page.locator(`[data-asof-option="${id}"]`);
    const openMenu = async () => { await selector.click(); await page.locator('[role=listbox]').waitFor(); };
    const pick = async (id: string) => { await openMenu(); await option(id).click(); await page.waitForTimeout(1500); };
    const levelsKey = 'gex.customLevels.v1.SPY';
    const dec = new TextDecoder();
    const zipNames = (bytes: Buffer) => parseZipDirectory(new Uint8Array(bytes)).map((e) => e.name);

    try {
        await page.goto(site.url);
        await page.getByText('💾').first().click(); // CACHE provider
        const ticker = page.locator('input[role=combobox]');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(2500);

        // ---- live: grey, informational, "As of <date of the latest cache file>" ----
        assert.equal(await page.locator('[data-asof-select]').getAttribute('data-asof-select'), 'live');
        assert.equal((await selector.innerText()).replace('▾', '').trim(), 'As of 2026-09-30', 'grey text is the date of api/latest.json');
        assert.equal(await banner.count(), 0, 'no banner while live');
        await openMenu();
        assert.equal(await option('2026-09-29').count(), 1);
        assert.equal(await option('2026-09-30').count(), 1);
        await page.keyboard.press('Escape');

        // custom levels of the user, saved before the backtest
        await page.evaluate((k) => localStorage.setItem(k, JSON.stringify([{ id: 'u1', name: 'My level', price: 777, color: '#fb7185' }])), levelsKey);

        // ---- a backup made in the app: tickers remembered, custom levels inside, the same zip layout as the CI backup ----
        await openMenu();
        await page.getByText('Create backup...').click();
        const mode = (m: string) => page.locator(`[data-backup-mode="${m}"]`);
        assert.equal(await mode('preset').isChecked(), true, 'the preset of required tickers is the default');
        assert.ok((await page.locator('[role=dialog]').innerText()).includes('SPX, NDX, DJX, RUT, IWM, NVDA, AAPL, MSFT, AMZN, GOOGL, TSM, META, AVGO, MU, GOOG, SPY, QQQ, DIA'), 'the preset lists its tickers');
        const tickers = page.locator('[data-backup-tickers]');
        await tickers.fill('SPY');
        assert.equal(await mode('custom').isChecked(), true, 'typing tickers selects the chosen-tickers option');
        const [download] = await Promise.all([page.waitForEvent('download'), tickers.press('Enter')]);
        const backupName = download.suggestedFilename();
        assert.match(backupName, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/, 'backup is named after its id');
        const backupId = backupName.replace('.zip', '');
        const backupPath = await download.path();
        const backupBytes = readFileSync(backupPath);
        assert.deepEqual(zipNames(backupBytes), [`${backupId}/SPY.json`, `${backupId}/custom-levels.json`, `${backupId}/manifest.json`]);
        const entries = parseZipDirectory(new Uint8Array(backupBytes));
        const levelsEntry = entries.find((e) => e.name.endsWith('custom-levels.json'))!;
        const levels = JSON.parse(dec.decode(extractEntry(new Uint8Array(backupBytes), levelsEntry, (d) => new Uint8Array(inflateRawSync(d)))));
        assert.deepEqual(levels, { version: 1, levels: { SPY: [{ id: 'u1', name: 'My level', price: 777, color: '#fb7185' }] } });
        await page.locator('[data-backtest-toast=ok]').waitFor();
        // the dialog remembers the tickers
        await openMenu();
        await page.getByText('Create backup...').click();
        assert.equal(await page.locator('[data-backup-tickers]').inputValue(), 'SPY', 'the tickers of the last backup are preselected');
        assert.equal(await page.locator('[data-backup-mode="custom"]').isChecked(), true, 'and so is the choice');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-backup-tickers]').count(), 0, 'Esc cancels');

        // ---- opening a snapshot opens its ticker: a single-ticker backup opens that ticker, with two or more the stored one ----
        await pick('2026-09-28');
        assert.equal(await ticker.inputValue(), 'QQQ', 'a single-ticker snapshot opens its ticker, not the stored SPY');
        await pick('2026-09-30');
        assert.equal(await ticker.inputValue(), 'SPY', 'two tickers: the stored ticker (SPY) is opened');
        await banner.getByRole('button').click();
        await page.waitForTimeout(1500);
        assert.equal(await ticker.inputValue(), 'SPY', 'back to latest keeps the ticker that was open before');

        // ---- backtest on a site snapshot: amber, banner, the data of that day ----
        await pick('2026-09-29');
        assert.equal(await page.locator('[data-asof-select]').getAttribute('data-asof-select'), 'backtest');
        assert.ok((await banner.innerText()).includes('2026-09-29'), 'banner names the day');
        assert.ok((await page.locator('body').innerText()).includes('700.5'), 'the spot of the snapshot is shown');
        // a ticker that is not in that day's archive is an error message, not a silent fallback
        await ticker.fill('QQQ');
        await ticker.press('Enter');
        await page.waitForTimeout(1200);
        assert.ok((await page.locator('body').innerText()).includes('is not in the archive of 2026-09-29'), 'missing ticker shows the error');
        await ticker.fill('SPY');
        await ticker.press('Enter');
        await page.waitForTimeout(1200);

        // the Chart and GEX tabs open in backtest mode too
        for (const tab of ['GEX', 'Chart']) {
            await page.getByRole('button', { name: tab }).first().click();
            await page.waitForTimeout(1200);
            assert.equal(await banner.count(), 1, `banner stays on the ${tab} tab`);
            // layout guard: the banner row must not push the page into a scroll or the footer out of the window
            const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, view: window.innerHeight, footerBottom: Math.round(document.querySelector('footer')?.getBoundingClientRect().bottom ?? -1) }));
            assert.ok(fit.scroll <= fit.view + 1, `${tab} tab with the banner scrolls the page (${fit.scroll} > ${fit.view})`);
            assert.ok(fit.footerBottom > 0 && fit.footerBottom <= fit.view + 1, `${tab} tab: footer is not in the window with the banner (bottom ${fit.footerBottom}, window ${fit.view})`);
        }
        // the candles stop at the archived day (the cache file of the chart has candles up to the real latest day)
        const lastBar = await page.locator('[data-last-bar]').getAttribute('data-last-bar');
        assert.ok(lastBar && lastBar <= '2026-09-29', `Chart candles end at the archived day, last bar ${lastBar}`);
        assert.ok(lastBar === '2026-09-29' || lastBar === '2026-09-28' || lastBar === '2026-09-25', `the last candle is the last trading day on or before the archived day (${lastBar})`);

        // ---- the data manager: the site day is kept in the browser, the backup is listed as local ----
        await openMenu();
        await page.getByText('Backtest data...').click();
        const rows = page.locator('[data-backtest-row]');
        assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-backtest-row'))), [backupId, '2026-09-30', '2026-09-29', '2026-09-28'].sort((a, b) => (a < b ? 1 : -1)), 'newest first');
        const held = (id: string) => page.locator(`label:has([data-backtest-row="${id}"])`).innerText().then((t) => /\d (KB|MB)/.test(t));
        assert.equal(await held('2026-09-29'), true, 'the opened site day is kept in the browser');
        assert.equal(await held('2026-09-30'), true, 'every site day that was opened is kept');
        // download two as ONE zip that holds both snapshots
        await page.locator('[data-backtest-row="2026-09-29"]').check();
        await page.locator('[data-backtest-row="2026-09-30"]').check();
        const [bundle] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backtest-download]').click()]);
        assert.equal(bundle.suggestedFilename(), 'gex-history-2026-09-29_2026-09-30.zip');
        const bundleNames = zipNames(readFileSync(await bundle.path()));
        assert.ok(bundleNames.includes('2026-09-29/SPY.json') && bundleNames.includes('2026-09-30/QQQ.json'), 'the bundle holds both days');
        // remove everything older than a date: the day before it goes, that day stays
        await page.locator('[data-backtest-older]').fill('2026-09-30');
        // asks first: imported days cannot be fetched again
        page.once('dialog', (d) => { assert.ok(d.message().includes('2026-09-30'), `the question names the date: ${d.message()}`); void d.accept(); });
        await page.getByRole('button', { name: 'Remove', exact: true }).click();
        await page.waitForTimeout(500);
        assert.equal(await held('2026-09-29'), false, 'the older day is no longer held in the browser (it is still on the site)');
        assert.equal(await held('2026-09-28'), false, 'and so is the one before it');
        assert.equal(await held('2026-09-30'), true, 'the day itself stays');
        assert.equal(await held(backupId), true, 'the backup, a later day, stays');
        assert.equal(await banner.count(), 1, 'the open snapshot is on the site, so the mode is not dropped')
        await page.keyboard.press('Escape');

        // ---- import: remove the backup from the browser, then bring it back from its file ----
        await page.keyboard.press('Escape');
        await openMenu();
        await page.getByText('Backtest data...').click();
        await page.locator(`[data-backtest-row="${backupId}"]`).check();
        page.once('dialog', (d) => void d.accept());
        await page.getByRole('button', { name: 'Remove selected' }).click();
        await page.waitForTimeout(400);
        assert.equal(await page.locator(`[data-backtest-row="${backupId}"]`).count(), 0, 'backup removed');
        await page.keyboard.press('Escape');
        await page.locator('[data-asof-import]').setInputFiles(backupPath);
        await page.locator('[data-backtest-toast=ok]').waitFor();
        await openMenu();
        assert.equal(await option(backupId).count(), 1, 'the imported backup is listed');
        assert.ok((await option(backupId).innerText()).includes('local'), 'marked local');
        await page.keyboard.press('Escape');
        // a file that is not an archive is refused with a reason
        await page.locator('[data-asof-import]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
        await page.locator('[data-backtest-toast=error]').waitFor();
        assert.ok((await page.locator('[data-backtest-toast=error]').innerText()).includes('broken.zip'));

        // ---- the custom levels of a snapshot replace the user's own and cannot be edited ----
        await page.evaluate((k) => localStorage.setItem(k, JSON.stringify([{ id: 'u2', name: 'Changed later', price: 111 }])), levelsKey);
        await pick(backupId);
        await page.getByRole('button', { name: 'GEX' }).first().click();
        await page.waitForTimeout(1200);
        const body = await page.locator('body').innerText();
        assert.ok(body.includes('My level') && !body.includes('Changed later'), "the snapshot's own custom levels are shown");
        const box = (await page.locator('.recharts-wrapper').first().boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 5 });
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45, { button: 'right' });
        await page.waitForTimeout(300);
        assert.equal(await page.locator('input[aria-label^="Level name"]').count(), 0, 'the level editor does not open in a backtest');
        assert.equal(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]')[0].name, levelsKey), 'Changed later', 'the user\'s own levels are untouched');

        // ---- back to live ----
        await banner.getByRole('button').click();
        await page.waitForTimeout(1500);
        assert.equal(await banner.count(), 0);
        assert.equal(await page.locator('[data-asof-select]').getAttribute('data-asof-select'), 'live');
        assert.ok((await page.locator('body').innerText()).includes('Changed later'), 'own custom levels are back');
        // the preset of required tickers as the backup: every ticker this test site has, the others are reported as left out
        await openMenu();
        await page.getByText('Create backup...').click();
        await mode('preset').check();
        const [presetDownload] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
        const presetNames = zipNames(readFileSync((await presetDownload.path())!));
        assert.ok(presetNames.some((n) => n.endsWith('/SPY.json')) && presetNames.some((n) => n.endsWith('/QQQ.json')), 'the preset backup holds the required tickers that exist');
        // wait for THIS toast: an older one can still be on screen when the backup finishes
        await page.locator('[data-backtest-toast]', { hasText: 'Left out' }).waitFor({ timeout: 15000 });

        // the current ticker as the backup: only the ticker on screen (SPY), remembered for next time
        await openMenu();
        await page.getByText('Create backup...').click();
        assert.ok((await page.locator('[role=dialog]').innerText()).includes('Current ticker: SPY'), 'the dialog names the ticker on screen');
        await mode('current').check();
        const [currentDownload] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
        const currentNames = zipNames(readFileSync((await currentDownload.path())!));
        assert.deepEqual(currentNames.filter((n) => n.endsWith('.json') && !n.endsWith('manifest.json') && !n.endsWith('custom-levels.json')).map((n) => n.split('/')[1]), ['SPY.json'], 'the backup holds the current ticker only');
        await page.locator('[data-backtest-toast]', { hasText: 'saved' }).waitFor({ timeout: 15000 });
        await openMenu();
        await page.getByText('Create backup...').click();
        assert.equal(await mode('current').isChecked(), true, 'the choice is remembered');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Chart' }).first().click();
        await page.waitForTimeout(1500);
        const liveLast = await page.locator('[data-last-bar]').getAttribute('data-last-bar');
        assert.ok(liveLast && liveLast > '2026-09-29', `live Chart candles go past the archived day (${liveLast})`);

        // ---- a phone: the selector is hidden in the top bar, the same controls are in the settings menu ----
        await page.setViewportSize({ width: 390, height: 800 });
        await page.waitForTimeout(500);
        assert.equal(await page.locator('[data-asof-select] > button').isVisible(), false, 'the top bar selector is hidden on a phone');
        await page.locator('button[aria-label="Settings"]').click();
        const mobile = page.locator('[data-asof-mobile]');
        assert.equal(await mobile.isVisible(), true, 'the settings menu has the backtest block on a phone');
        await mobile.locator('select').selectOption('2026-09-30');
        await page.waitForTimeout(1500);
        assert.equal(await banner.count(), 1, 'a snapshot chosen on a phone opens the backtest');
        await mobile.locator('select').selectOption('');
        await page.waitForTimeout(1200);
        assert.equal(await banner.count(), 0, 'and Latest goes back');

        assert.deepEqual(errors, [], 'no page errors');
        console.log('backtest e2e: ok');
    } finally {
        await browser.close();
        site.close();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});
