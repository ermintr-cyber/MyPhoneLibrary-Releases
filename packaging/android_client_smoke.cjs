// Android WebViews expose a page socket, not Chromium's browser CDP endpoint.
const { _android } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

(async () => {
  const [device] = await _android.devices();
  assert(device, 'No Android emulator connected');
  device.setDefaultTimeout(30000);
  let page;
  let view;
  try {
    const attach = async () => {
      view = await device.webView({ pkg: 'com.myphonelibrary.app' }, { timeout: 60000 });
      return view.page();
    };
    page = await attach();
    console.log('Attached to Android WebView');
    page.setDefaultTimeout(30000);
    await page.locator('#password').fill('Android-test-password');
    await page.locator('#remember-me').check();
    await page.locator('#login-submit').click();
    await page.locator('#application').waitFor({ state: 'visible' });
    await page.waitForFunction('typeof db !== "undefined" && db !== null');
    console.log('Signed in to disposable collection');
    assert(await page.evaluate('BUNDLED_ANDROID_UI'), 'APK must use its packaged frontend');
    const installedUi = await page.evaluate('UI_VERSION');
    assert.equal(installedUi, readFileSync(path.join(__dirname, '../android/VERSION'), 'utf8').trim());
    await page.evaluate('settingsPanel()');
    const save = page.locator('[data-action=save-settings]');
    await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox();
    const nav = await page.locator('.mobile-primary-nav').boundingBox();
    assert(bounds && nav && bounds.y + bounds.height <= nav.y + 1, 'Save is covered by bottom navigation');
    await page.screenshot({ path: 'release/android-settings.png' });
    console.log('Save is visible above navigation');
    // Touch passes through the native wrapper, unlike DOM-only scroll tests.
    await page.evaluate("$('panel-body').scrollTop=300");
    const before = await page.evaluate("$('panel-body').scrollTop");
    assert(before > 0, 'Settings must have scrollable content');
    await page.evaluate('window.__reloadProbe=123');
    const size = (await device.shell('wm size')).toString().match(/\d+/g).map(Number);
    const [width, height] = size.slice(-2);
    await device.shell(`input swipe ${Math.floor(width/2)} ${Math.floor(height*.45)} ${Math.floor(width/2)} ${Math.floor(height*.8)} 1000`);
    await page.waitForTimeout(1200);
    assert(await page.evaluate("$('panel-body').scrollTop") < before, 'Settings cannot scroll toward the top');
    assert.equal(await page.evaluate('window.__reloadProbe'), 123, 'Scrolling caused a page reload');
    console.log('Native settings scrolling passed');
    const update = await fetch(process.env.ANDROID_TEST_CONTROL + '/simulate-windows-update', { method: 'POST' });
    assert.equal(update.status, 204);
    await page.evaluate('checkConnection()');
    assert.equal(await page.evaluate('versionMismatch'), false);
    assert.equal(await page.evaluate('window.__reloadProbe'), 123, 'Windows update reloaded Android UI');
    await page.reload();
    await page.locator('#application').waitFor({ state: 'visible' });
    await page.waitForFunction('typeof db !== "undefined" && db !== null');
    assert.equal(await page.evaluate('UI_VERSION'), installedUi, 'Windows update replaced APK frontend');
    console.log('Packaged UI retained after Windows update and page reload');
    await page.evaluate("settingsTab='about';settingsPanel()");
    assert.equal(await page.locator('[data-action=install-update]').count(), 0);
    assert.equal(await page.locator('#update-file').count(), 0);
    await page.screenshot({ path: 'release/android-about.png' });
    await device.shell('input keyevent 3');
    // Wait for device discovery to discard the old process before reattaching.
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Old WebView did not close')), 30000);
      view.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await device.shell('am force-stop com.myphonelibrary.app');
    await closed;
    console.log('Old app process closed; restarting');
    await device.shell('am start -n com.myphonelibrary.app/.MainActivity');
    page = await attach();
    await page.locator('#application').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.locator('#login').isVisible(), false, 'Remembered login was lost');
    assert.equal(await page.evaluate('UI_VERSION'), installedUi);
    console.log('PASS: APK UI isolation, native scrolling, reachable Save, Android-only updates, persistent login.');
  } catch (error) {
    if (page && !page.isClosed()) console.error('Visible login error:', await page.locator('#login-error').textContent().catch(() => 'unavailable'));
    if (page && !page.isClosed()) await page.screenshot({ path: 'release/android-failure.png' }).catch(() => {});
    throw error;
  } finally {
    await device.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
