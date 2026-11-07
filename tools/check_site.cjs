const { chromium } = require(process.env.VELT_NODE_PACKAGES ? `${process.env.VELT_NODE_PACKAGES}/playwright` : 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../work/qa');
fs.mkdirSync(output, {recursive:true});
const base = process.env.VELT_TEST_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.VELT_BROWSER_CHANNEL || 'msedge'});
  const context = await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const results = [];
  const check = async (name, fn) => { await fn(); results.push(name); };
  try {
    await page.goto(base);
    await check('Home has twenty usable chapters', async () => {
      assert.equal(await page.locator('.chapter-grid li').count(),20);
      assert.equal(await page.locator('main').count(),1);
      assert.match(await page.title(),/Цена величия/);
    });
    await page.screenshot({path:path.join(output,'home-desktop.png'),fullPage:true});
    await check('Keyboard focus is visible', async () => {
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.skip').evaluate(el => el===document.activeElement),true);
      assert.notEqual(await page.locator('.skip').evaluate(el => getComputedStyle(el).outlineStyle),'none');
    });
    await page.getByRole('button',{name:'Настроить оформление'}).click();
    await check('Dialog traps focus and restores it on Escape', async () => {
      assert.equal(await page.locator('#appearance').evaluate(el=>el.open),true);
      for (let i=0;i<18;i++) { await page.keyboard.press('Tab'); assert.equal(await page.locator('#appearance').evaluate(el=>el.contains(document.activeElement)),true); }
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'Настроить оформление'}).evaluate(el=>el===document.activeElement),true);
    });
    await page.getByRole('link',{name:'Начать читать'}).click();
    await check('New manuscript begins in chapter one', async () => {
      assert.match(page.url(),/chapter-1\.html/);
      assert.match(await page.locator('.prose p').first().textContent(),/больше не работает/);
    });
    await page.getByRole('button',{name:'Настроить оформление'}).click();
    await page.getByRole('button',{name:'Ночная',exact:true}).click();
    await page.getByRole('button',{name:/Лаконичный/}).click();
    await page.getByRole('button',{name:'Увеличить размер текста'}).click();
    await page.locator('#line-height').selectOption('2');
    await page.locator('#line-width').selectOption('54');
    await page.keyboard.press('Escape');
    await check('Night and clear styles change real text appearance', async () => {
      assert.equal(await page.locator('html').getAttribute('data-theme'),'night');
      assert.equal(await page.locator('html').getAttribute('data-style'),'clear');
      assert.match(await page.locator('.prose').evaluate(el=>getComputedStyle(el).fontFamily),/Segoe/);
      assert.equal(await page.locator('.prose').evaluate(el=>getComputedStyle(el).lineHeight),'44px');
    });
    await page.screenshot({path:path.join(output,'reader-night-desktop.png'),fullPage:false});
    await page.evaluate(()=>scrollTo(0,1500));
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForTimeout(200);
    await check('Settings and paragraph position survive reload', async () => {
      assert.equal(await page.locator('html').getAttribute('data-theme'),'night');
      assert.equal(await page.locator('html').getAttribute('data-style'),'clear');
      assert.ok(Math.abs(await page.evaluate(()=>scrollY)-1500)<10);
    });
    await page.getByRole('button',{name:'Поставить закладку',exact:true}).click();
    await page.getByRole('button',{name:'Открыть оглавление',exact:true}).click();
    await check('Bookmarks and empty search work', async () => {
      assert.equal(await page.locator('#bookmark-list a').count(),1);
      await page.locator('#chapter-filter').fill('глава-которой-нет');
      assert.equal(await page.locator('#toc-empty').isVisible(),true);
      assert.equal(await page.locator('#toc-list li:visible').count(),0);
      await page.locator('#chapter-filter').fill('контрольный');
      assert.equal(await page.locator('#toc-list li:visible').count(),1);
      await page.locator('#chapter-filter').fill('');
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Читать без панелей'}).click();
    await check('Focus reading has a reachable exit',async()=> {
      assert.equal(await page.locator('.masthead').isVisible(),false);
      await page.getByRole('button',{name:'Вернуть панели · Esc'}).click();
      assert.equal(await page.locator('.masthead').isVisible(),true);
    });
    await check('All chapters fit mobile tablet and desktop, including maximum text size',async()=> {
      for (const width of [360,768,1440]) {
        await page.setViewportSize({width,height:900});
        for (const n of [1,12,16,20]) {
          await page.goto(`${base}chapter-${n}.html`);
          const sizes = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
          assert.ok(sizes.scroll<=sizes.width,JSON.stringify({n,...sizes}));
        }
      }
      await page.setViewportSize({width:360,height:800});
      await page.goto(base);
      await page.screenshot({path:path.join(output,'home-mobile-night.png'),fullPage:true});
      await page.goto(`${base}chapter-1.html`);
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:path.join(output,'reader-mobile-night.png'),fullPage:false});
      await page.getByRole('button',{name:'Настроить оформление'}).click();
      const more = page.getByRole('button',{name:'Увеличить размер текста'});
      while (!(await more.isDisabled())) await more.click();
      await page.locator('#line-width').selectOption('74');
      assert.ok(await page.locator('.style-choice').evaluateAll(items=>items.every(el=>el.scrollWidth<=el.clientWidth)));
      await page.screenshot({path:path.join(output,'settings-mobile.png')});
      await page.keyboard.press('Escape');
      await page.locator('.prose').evaluate(el=> { const p=document.createElement('p');p.textContent='Оченьдлинноесловобезпробелов'.repeat(15);el.append(p); });
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    });
    await check('First and last chapter navigation is honest',async()=>{
      await page.goto(`${base}chapter-20.html`);
      assert.equal(await page.locator('.part-end').isVisible(),true);
      assert.equal(await page.locator('a[rel="next"]').count(),0);
      await page.goto(base);
      assert.match(await page.locator('#resume').getAttribute('href'),/chapter-20/);
    });
    await check('Every published chapter renders without a script exception',async()=>{
      for(let n=1;n<=20;n++) {
        const response=await page.goto(`${base}chapter-${n}.html`);
        assert.equal(response.status(),200);
        assert.ok(await page.locator('.prose p').count()>20);
      }
      assert.deepEqual(errors,[]);
    });
    await check('Themes meet WCAG text contrast',async()=>{
      await page.goto(base);
      for (const theme of ['paper','light','night']) {
        const pairs = await page.evaluate(theme=>{
          document.documentElement.dataset.theme=theme;
          const s=getComputedStyle(document.documentElement);
          return ['--ink','--muted','--accent'].map(v=>[v,s.getPropertyValue(v).trim(),s.getPropertyValue('--bg').trim()]);
        },theme);
        const lum = value => {
          const hex = value.length===4 ? '#'+value.slice(1).split('').map(x=>x+x).join('') : value;
          const rgb=hex.replace('#','').match(/.{2}/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
          return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
        };
        for (const [token,a,b] of pairs) {const l=[lum(a),lum(b)].sort((a,b)=>b-a);assert.ok((l[0]+.05)/(l[1]+.05)>=4.5,`${theme} ${token}`);}
      }
    });
    const reduced = await browser.newContext({reducedMotion:'reduce',colorScheme:'dark',viewport:{width:360,height:800}});
    const rp=await reduced.newPage();
    await rp.goto(base);
    await check('System night and reduced motion are respected',async()=>{
      assert.equal(await rp.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 25, 26)');
      assert.equal(await rp.locator('.button').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    });
    await reduced.close();
    for(const raw of ['broken-json','null','[]','{"positions":[],"bookmarks":null,"size":999,"theme":"invalid"}']) {
      const bad=await browser.newContext();
      await bad.addInitScript(value=>localStorage.setItem('velt-price-reader-2026-11',value),raw);
      const bp=await bad.newPage();
      await bp.goto(`${base}chapter-1.html`);
      assert.ok(await bp.locator('.prose p').count()>20);
      assert.equal(await bp.locator('html').getAttribute('data-theme'),'auto');
      await bad.close();
    }
    results.push('Malformed stored data does not interrupt reading');
    const blocked=await browser.newContext();
    await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError')}}));
    const bp=await blocked.newPage();
    await bp.goto(base);
    assert.equal(await bp.locator('#notice').isVisible(),true);
    await bp.getByRole('button',{name:'Включить ночную тему'}).click();
    assert.equal(await bp.locator('html').getAttribute('data-theme'),'night');
    results.push('Disabled storage shows a readable explanation and appearance still works');
    await blocked.close();
    const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:360,height:800}});
    const np=await nojs.newPage();
    await np.goto(`${base}chapter-1.html`);
    assert.ok(await np.locator('.prose p').count()>20);
    await np.locator('a[rel="next"]').click();
    assert.match(np.url(),/chapter-2/);
    results.push('The novel and chapter links work without JavaScript');
    await nojs.close();
    fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({passed:results,scriptErrors:errors},null,2));
    console.log(JSON.stringify({checks:results.length,passed:results,scriptErrors:errors},null,2));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
