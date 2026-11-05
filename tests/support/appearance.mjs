import assert from 'node:assert/strict';

export async function checkAppearance(page, root) {
 const theme=()=>page.locator('html').getAttribute('data-theme');
 const color=(selector,property)=>page.locator(selector).first().evaluate((el,p)=>getComputedStyle(el)[p],property);
 const choose=async value=>{
  await page.locator('#appearance button[data-theme="'+value+'"]').click();
  assert.equal(await page.locator('#appearance button[aria-pressed="true"]').count(),1);
  assert.equal(await page.locator('#appearance button[data-theme="'+value+'"]').getAttribute('aria-pressed'),'true');
 };
 await page.emulateMedia({colorScheme:'dark'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 assert.equal(await theme(),'dark','System follows live OS appearance');
 await page.locator('#settings-open').click();
 await choose('light');
 assert.equal(await theme(),'light');
 await page.emulateMedia({colorScheme:'light'});
 await choose('dark');
 assert.equal(await theme(),'dark','Explicit dark overrides a light system');
 assert.equal(await page.evaluate(()=>localStorage.getItem('ghostpad.appearance')),'dark');
 await page.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(41, 41, 41)');
 assert.equal(await color('body','backgroundColor'),'rgb(41, 41, 41)');
 assert.equal(await color('#settings','backgroundColor'),'rgb(20, 20, 20)');
 assert.equal(await color('#pad','backgroundColor'),'rgb(41, 41, 41)');
 assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'),'#292929');
 await page.screenshot({path:new URL('artifacts/settings-dark.png',root).pathname});
 await page.reload();
 await page.waitForFunction(()=>document.getElementById('status').textContent==='Preview');
 assert.equal(await theme(),'dark','Saved appearance survives reload');
 await page.screenshot({path:new URL('artifacts/phone-dark.png',root).pathname});
 await page.locator('#keyboard-toggle').click();
 assert.equal(await color('#native-input','backgroundColor'),'rgb(20, 20, 20)');
 assert.equal(await color('.native-tools .primary','color'),'rgb(20, 20, 20)');
 assert.equal(await color('.native-tools .primary','backgroundColor'),'rgb(237, 237, 237)');
 await page.screenshot({path:new URL('artifacts/keyboard-dark.png',root).pathname});
 await page.locator('#grid-mode').click();
 assert.equal(await color('#keyboard button','backgroundColor'),'rgb(32, 32, 32)');
 await page.locator('#mod-shift').click();
 assert.equal(await color('#mod-shift','backgroundColor'),'rgb(237, 237, 237)');
 assert.equal(await color('#mod-shift','color'),'rgb(20, 20, 20)');
 await page.screenshot({path:new URL('artifacts/keyboard-grid-dark.png',root).pathname});
 await page.locator('#keyboard-close').click();
 await page.locator('#settings-open').click();
 await choose('system');
 assert.equal(await theme(),'light');
 await page.emulateMedia({colorScheme:'dark'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await choose('light');
 await page.reload();
 assert.equal(await theme(),'light','Explicit light persists against a dark system');
 await page.locator('#settings-open').click();
 await choose('system');
 await page.emulateMedia({colorScheme:'light'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await page.locator('#settings-close').click();
}

export async function checkAppearanceFallbacks(page) {
 await page.evaluate(()=>localStorage.setItem('ghostpad.appearance','invalid'));
 await page.emulateMedia({colorScheme:'dark'});
 await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','Invalid saved values follow system');
 await page.addInitScript(()=>{
  Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}});
 });
 await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','Blocked storage must still follow system');
 await page.locator('#settings-open').click();
 await page.locator('#appearance button[data-theme="light"]').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light','Blocked storage must allow an in-page choice');
}
