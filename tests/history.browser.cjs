const {chromium} = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless:true, channel:process.env.BROWSER_CHANNEL || 'msedge'});
  try {
    const page = await browser.newPage({viewport:{width:480,height:400}});
    const errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.addInitScript(() => {
      let seq=0;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
      window.__TAURI_INTERNALS__={
        metadata:{currentWindow:{label:'island'},currentWebview:{label:'island'}},
        transformCallback:()=>++seq, unregisterCallback(){},
        invoke:async(cmd)=>{
          if(cmd==='plugin:event|listen')return ++seq;
          if(cmd==='poll_notifications')return [];
          if(cmd==='get_fullscreen_state')return false;
          if(cmd==='get_listener_status')return {available:true,reason:null,message:''};
          return null;
        },
      };
      if (!localStorage.getItem('dynamic-island.water-history.v1')) {
        const key=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        const days={};
        const now=new Date();
        for(let i=0;i<90;i++) {const day=new Date(now);day.setDate(day.getDate()-i);days[key(day)]=(i*7+3)%13;}
        const start=new Date(now);start.setDate(start.getDate()-89);
        localStorage.setItem('dynamic-island.water-history.v1',JSON.stringify({version:1,trackingSince:key(start),days}));
        localStorage.setItem('dynamic-island.water-reminder.stats.v1',JSON.stringify({date:key(now),count:7}));
        localStorage.setItem('dynamic-island.water-reminder.v2',JSON.stringify({enabled:true,startTime:'00:00',endTime:'00:00',intervalMinutes:1,durationSeconds:30,confirmHoldSeconds:0,confirmMethod:'hold',soundEnabled:false,showPopup:true}));
      }
    });
    await page.goto('http://127.0.0.1:1420/');
    await page.getByRole('button',{name:'打开喝水提醒设置'}).click();
    await page.getByRole('button',{name:'查看喝水记录'}).click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('button[id^="water-day-"]').count(),90);
    await page.locator('#water-day-89').hover();
    assert.match(await page.locator('#water-history-detail').innerText(), /喝水 7 次/);
    await page.screenshot({path:path.resolve(__dirname,'../../history-heatmap.png')});
    assert.equal(await page.locator('#water-history-chart').evaluate(el=>el.scrollHeight>el.clientHeight), false, 'all seven calendar rows must fit');
    const heatmap = page.getByRole('tab',{name:'贡献图'});
    await heatmap.focus(); await heatmap.press('ArrowRight');
    assert.equal(await page.getByRole('tab',{name:'趋势图'}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('svg[aria-label="近 90 天每日喝水次数趋势"] rect').count(),90);
    await page.locator('svg[aria-label="近 90 天每日喝水次数趋势"] rect').last().hover();
    assert.match(await page.locator('#water-history-detail').innerText(), /喝水 7 次/);
    await page.screenshot({path:path.resolve(__dirname,'../../history-trend.png')});
    assert.equal(await page.locator('#water-history-chart').evaluate(el=>el.scrollWidth>el.clientWidth), false);
    await page.getByRole('button',{name:'关闭喝水记录'}).click();
    // Drive a real reminder through the production hook, then confirm it.
    const later=await page.evaluate(()=>Date.now()+61_000);
    await page.clock.setFixedTime(later);
    await page.getByText('该喝水了',{exact:true}).waitFor();
    // The wall-clock jump affects motion's timing; dispatch the production
    // confirmation event independently of the animation's transient position.
    await page.getByText('该喝水了',{exact:true}).dispatchEvent('pointerdown',{isPrimary:true,button:0,pointerId:1,pointerType:'mouse'});
    await page.waitForFunction(()=>{
      const legacy=JSON.parse(localStorage.getItem('dynamic-island.water-reminder.stats.v1'));
      return legacy.count===8 && JSON.parse(localStorage.getItem('dynamic-island.water-history.v1')).days[legacy.date]===8;
    });
    await page.reload();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('dynamic-island.water-reminder.stats.v1')).count),8);
    assert.deepEqual(errors,[]);
    console.log('Passed: 90 cells, hover counts, keyboard tabs, trend points, confirmation persistence and reload.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
