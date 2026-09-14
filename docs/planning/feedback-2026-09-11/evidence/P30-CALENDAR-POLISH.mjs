// Run the frontend on 127.0.0.1:5178, then run this file with node.
// All API requests are fulfilled here; no backend or database is used.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../snp-analyzer/frontend/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const evidence = fileURLToPath(new URL('.', import.meta.url));
const distribution = {'2026-09-14':2,'2026-09-11':3,'2026-09-08':1,'2026-09-04':1,'2026-09-01':2,'2026-08-31':9,'2026-08-25':5,'2026-07-24':2};
const sessions = Object.entries(distribution).flatMap(([date,count]) => Array.from({length:count},(_,i)=>({
  session_id:`mock-${date}-${i}`, raw_filename:`plate_${date.replaceAll('-','')}_${i+1}.pcrd`,
  instrument:i%2?'QuantStudio 5':'CFX Opus', num_wells:i%2?384:96, num_cycles:40, uploaded_at:`${date} 04:00:00`,
})));

// Measure rendered sRGB colors, compositing translucent token backgrounds.
function auditCalendar(root) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  const rgba = color => {
    ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1);
    const [r,g,b,a] = ctx.getImageData(0,0,1,1).data;
    return [r,g,b,a/255];
  };
  const over = (front, back) => front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3]));
  const background = el => {
    const color = rgba(getComputedStyle(el).backgroundColor);
    if (color[3] === 1) return color.slice(0,3);
    return over(color, el.parentElement ? background(el.parentElement) : [255,255,255]);
  };
  const luminance = rgb => rgb.slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
    .reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const ratio = (a,b) => {
    const x=luminance(a), y=luminance(b);
    return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
  };
  const text = [], ui = [], overflow = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const style = getComputedStyle(el), bg=background(el);
    const label = el.getAttribute('aria-label') || el.textContent.trim().slice(0,60) || el.tagName;
    if ([...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim())) {
      text.push({label,ratio:ratio(over(rgba(style.color),bg),bg)});
    }
    if (el.matches('button:not(:disabled)')) {
      const border = rgba(style.borderTopColor);
      if (border[3] && parseFloat(style.borderTopWidth)>0) {
        ui.push({label:`border: ${label}`,ratio:Math.min(ratio(over(border,bg),bg),ratio(over(border,background(el.parentElement)),background(el.parentElement)))});
      }
      if (el.getAttribute('aria-selected')==='true') ui.push({label:`selection: ${label}`,ratio:ratio(rgba(style.getPropertyValue('--color-text')),bg)});
      if (el.matches(':focus-visible')) ui.push({label:`focus: ${label}`,ratio:ratio(rgba(style.outlineColor),background(el.parentElement))});
      if (el.scrollWidth>el.clientWidth+1) overflow.push(label);
    }
    if (el.classList.contains('bg-primary')) ui.push({label:`marker: ${label}`,ratio:ratio(bg,background(el.parentElement))});
    if (el.tagName.toLowerCase()==='svg') ui.push({label:`icon: ${label}`,ratio:ratio(rgba(style.color),bg)});
  }
  return {minimumText:Math.min(...text.map(v=>v.ratio)),minimumUI:Math.min(...ui.map(v=>v.ratio)),
    failures:[...text.filter(v=>v.ratio<4.5),...ui.filter(v=>v.ratio<3)],overflow};
}

const results = [];
const browser = await chromium.launch({headless:true});
try {
  for (const width of [1440,768,390,320]) for (const theme of ['light','dark']) for (const lang of ['ko','en']) {
    const page = await browser.newPage({viewport:{width,height:1100},timezoneId:'Asia/Seoul'});
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-09-14T05:00:00Z'));
    await page.addInitScript(({theme,lang})=>{
      localStorage.setItem('snp-analyzer-dark-mode',String(theme==='dark'));
      localStorage.setItem('snp-analyzer-language',JSON.stringify({state:{language:lang},version:0}));
    },{theme,lang});
    await page.route('**/api/**',route=>{
      const path=new URL(route.request().url()).pathname;
      const data=path==='/api/auth/config'?{auth_mode:'local'}:
        path==='/api/auth/me'?{user:{id:'mock-user',username:'researcher',display_name:'Researcher',role:'admin'}}:
        path==='/api/sessions'?sessions:path==='/api/projects'?{projects:[]}:
        path==='/api/version'?{version:'1.2.0',commit:'mock',built_at:null}:[];
      return route.fulfill({status:path.startsWith('/api/sessions/')?404:200,json:path.startsWith('/api/sessions/')?{detail:'Session not found'}:data});
    });
    await page.goto('http://127.0.0.1:5178/?tab=project');
    await page.getByRole('button',{name:lang==='ko'?'달력':'Calendar',exact:true}).click();
    const grid=page.getByRole('grid');
    const root=grid.locator('..');
    const day=n=>grid.locator('button:not(:disabled)').nth(n-1);
    const prev=page.getByRole('button',{name:lang==='ko'?'이전 달':'Previous month',exact:true});
    const next=page.getByRole('button',{name:lang==='ko'?'다음 달':'Next month',exact:true});
    const check=async (state,capture=true)=>{
      await expect(grid).toBeVisible();
      await page.mouse.move(0,0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const contrast=await root.evaluate(auditCalendar);
      expect(Number.isFinite(contrast.minimumText)).toBe(true);
      expect(Number.isFinite(contrast.minimumUI)).toBe(true);
      expect(contrast.failures,`${width}/${theme}/${lang}/${state} contrast`).toEqual([]);
      expect(contrast.overflow,`${width}/${theme}/${lang}/${state} button overflow`).toEqual([]);
      results.push({width,theme,lang,state,...contrast});
      // Core matrix + one narrow English example per theme, without redundant images.
      if(capture && ((width>=768 && lang==='ko') || (width===390 && lang==='en' && state==='dense'))) {
        await page.screenshot({path:`${evidence}P30-CALENDAR-POLISH-after-${state}-${width}-${theme}-${lang}.png`,fullPage:true});
      }
    };
    await check('default');
    await expect(day(14)).toHaveAttribute('aria-current','date');
    await day(14).focus();
    await page.keyboard.press('ArrowRight'); await expect(day(15)).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(day(22)).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(day(21)).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(day(14)).toBeFocused();
    await expect(page.getByTestId('calendar-day-sessions')).toHaveCount(0);
    await page.keyboard.press('Enter'); await expect(day(14)).toHaveAttribute('aria-selected','true');
    await check('selected');
    await day(15).focus(); await page.keyboard.press('Space');
    await expect(day(15)).toHaveAttribute('aria-selected','true');
    await expect(day(14)).toHaveAttribute('aria-selected','false');
    await expect(day(14)).toHaveAttribute('aria-current','date');
    await check('empty-day',false);
    await prev.click(); await day(31).click();
    const files=page.getByTestId('calendar-day-sessions').getByRole('button');
    await expect(files).toHaveCount(9);
    await check('dense');
    await day(31).focus();
    for(let i=0;i<9;i++) await page.keyboard.press('Tab');
    await expect(files.last()).toBeFocused();
    const lastIsInside=await files.last().evaluate(el=>{
      const list=el.closest('ul').getBoundingClientRect(),item=el.getBoundingClientRect();
      return item.top>=list.top && item.bottom<=list.bottom;
    });
    expect(lastIsInside).toBe(true);
    await check('last-file-focus',false);
    await next.click(); await next.click();
    await check('empty');
    await page.getByRole('button',{name:lang==='ko'?'오늘':'Today',exact:true}).click();
    await expect(day(14)).toHaveAttribute('aria-current','date');
    await prev.click(); await day(31).click();
    await files.last().focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({hasText:lang==='ko'?/이 항목이 더 이상 존재하지 않습니다/:/no longer exists/i})).toBeVisible();
    await check('open-failure',false);
    expect(errors).toEqual([]);
    await page.close();
    console.log(`${width} ${theme} ${lang}: layout, contrast, keyboard, 9 files, empty month, recovery passed`);
  }
} finally { await browser.close(); }
await writeFile(`${evidence}P30-CALENDAR-POLISH-checks.json`,JSON.stringify({distribution,timezone:'Asia/Seoul',fixedToday:'2026-09-14',results},null,2)+'\n');
