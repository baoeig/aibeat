import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:39002';
const OUT = process.env.FOCUSED_QA_DIR || '/data/mhc/.work/2026-09-09-skill-user-stories/main-sweep/qa';
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) {
    failures.push({ name, detail });
    console.error(`FAIL: ${name}`, detail);
  }
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));

try {
  console.log('--- Running Focused Every-Step Multi-Viewport Bilingual QA ---');
  for (const lang of ['cn', 'en']) {
    const prefix = lang === 'cn' ? '/cn' : '';
    for (const theme of ['light', 'dark']) {
      for (const width of [320, 390, 1440]) {
        const testId = `${lang}-${theme}-${width}`;
        const page = await browser.newPage();
        await page.setViewport({ width, height: 1000 });
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.evaluateOnNewDocument(t => {
          localStorage.setItem('theme', t);
          localStorage.setItem('isDarkMode', String(t === 'dark'));
        }, theme);

        await page.goto(BASE + (prefix || '/'), { waitUntil: 'networkidle2' });
        await page.waitForSelector('.aibeat-home[data-downloads-ready="true"]');

        // 1. Initial default state audit
        const initialAudit = await page.evaluate(() => {
          const home = document.querySelector('.aibeat-home');
          const skillsSec = home.querySelector('.aibeat-home-skills');
          const skillsRect = skillsSec.getBoundingClientRect();
          const examples = home.querySelectorAll('.aibeat-home-skills-example');
          const agentEx = home.querySelector('.aibeat-home-skills-example--agent');
          const riskEx = home.querySelector('.aibeat-home-skills-example--risk');

          const getCardState = (card) => {
            const r = card.getBoundingClientRect();
            const img = card.querySelector('.aibeat-home-evidence-img');
            const link = card.querySelector('.aibeat-home-image-link');
            return {
              id: card.id,
              tabIndex: card.tabIndex,
              rendered: r.height > 0 && r.width > 0,
              cardHeight: r.height,
              imgNatural: img ? { width: img.naturalWidth, height: img.naturalHeight } : null,
              linkTarget: link ? link.getAttribute('target') : null,
              linkHeight: link ? link.getBoundingClientRect().height : 0
            };
          };

          const agentCards = [...agentEx.querySelectorAll('.aibeat-home-evidence-card')].map(getCardState);
          const riskCards = [...riskEx.querySelectorAll('.aibeat-home-evidence-card')].map(getCardState);

          const modes = [...skillsSec.querySelectorAll('.aibeat-home-skills-modes .aibeat-home-mode-link')].map(m => ({
            href: m.getAttribute('href'),
            text: m.textContent.trim(),
            height: m.getBoundingClientRect().height
          }));

          const agentPipeline = [...agentEx.querySelectorAll('.aibeat-home-step-pipeline .aibeat-home-pipeline-step')].map(p => ({
            href: p.getAttribute('href'),
            text: p.textContent.trim(),
            height: p.getBoundingClientRect().height
          }));

          const riskPipeline = [...riskEx.querySelectorAll('.aibeat-home-step-pipeline .aibeat-home-pipeline-step')].map(p => ({
            href: p.getAttribute('href'),
            text: p.textContent.trim(),
            height: p.getBoundingClientRect().height
          }));

          const suggestions = [...home.querySelectorAll('.aibeat-home-skills-suggestions .aibeat-home-suggestion-item')].map(item => ({
            badge: item.querySelector('.aibeat-home-suggestion-badge')?.textContent.trim(),
            text: item.querySelector('.aibeat-home-suggestion-text')?.textContent.trim()
          }));

          const visibleInteractives = [...skillsSec.querySelectorAll('a, button, summary')].filter(n => {
            const r = n.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          const smallInteractives = visibleInteractives.filter(n => n.getBoundingClientRect().height < 43.5).map(n => n.className + ':' + n.textContent.trim());

          const overflowing = [...skillsSec.querySelectorAll('*')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.left < -1 || r.right > innerWidth + 1;
          }).map(el => el.className + ':' + el.tagName);

          return {
            skillsHeight: skillsRect.height,
            exampleCount: examples.length,
            agentCards,
            riskCards,
            modes,
            agentPipeline,
            riskPipeline,
            suggestions,
            smallInteractives,
            overflowing,
            bodyOverflow: document.documentElement.scrollWidth > innerWidth + 1
          };
        });

        // Verify height is significantly less than old 8750px (at 1440 it is ~3330px vs 8750px; on mobile it is 3300-4710px vs >12000px)
        const maxExpectedHeight = width === 1440 ? 4000 : 5500;
        check(`${testId}:skills-height-reduced`, initialAudit.skillsHeight < maxExpectedHeight, { height: initialAudit.skillsHeight, max: maxExpectedHeight });
        check(`${testId}:examples-count`, initialAudit.exampleCount === 2, initialAudit.exampleCount);
        check(`${testId}:no-overflow`, !initialAudit.bodyOverflow && initialAudit.overflowing.length === 0, initialAudit.overflowing);
        check(`${testId}:small-interactives`, initialAudit.smallInteractives.length === 0, initialAudit.smallInteractives);

        // Verify modes links (Step-by-step & View all screenshots)
        check(`${testId}:modes-count`, initialAudit.modes.length === 2 && initialAudit.modes.every(m => m.height >= 43.5), initialAudit.modes);

        // Verify default 1 frame per story
        check(`${testId}:agent-default-frame`, initialAudit.agentCards.length === 3 && initialAudit.agentCards[0].rendered && !initialAudit.agentCards[1].rendered && !initialAudit.agentCards[2].rendered, initialAudit.agentCards);
        check(`${testId}:agent-card-tabIndex`, initialAudit.agentCards.every(c => c.tabIndex === -1), initialAudit.agentCards);
        check(`${testId}:agent-default-link`, initialAudit.agentCards[0].linkHeight >= 43.5 && initialAudit.agentCards[0].linkTarget === '_blank', initialAudit.agentCards[0]);

        check(`${testId}:risk-default-frame`, initialAudit.riskCards.length === 5 && initialAudit.riskCards[0].rendered && !initialAudit.riskCards[1].rendered && !initialAudit.riskCards[2].rendered && !initialAudit.riskCards[3].rendered && !initialAudit.riskCards[4].rendered, initialAudit.riskCards);
        check(`${testId}:risk-card-tabIndex`, initialAudit.riskCards.every(c => c.tabIndex === -1), initialAudit.riskCards);
        check(`${testId}:risk-default-link`, initialAudit.riskCards[0].linkHeight >= 43.5 && initialAudit.riskCards[0].linkTarget === '_blank', initialAudit.riskCards[0]);

        // Verify natural dimensions of all images
        check(`${testId}:agent-images-natural`, initialAudit.agentCards.every(c => c.imgNatural && c.imgNatural.width === 1280 && c.imgNatural.height === 960), initialAudit.agentCards);
        check(`${testId}:risk-images-natural`, initialAudit.riskCards.every(c => c.imgNatural && c.imgNatural.width === 1280 && c.imgNatural.height === 960), initialAudit.riskCards);

        // Verify suggestions
        check(`${testId}:suggestions-count`, initialAudit.suggestions.length === 4 && initialAudit.suggestions.every(s => s.badge && s.text), initialAudit.suggestions);

        // 2. Test Story B steps (3 steps click & verification)
        for (let i = 1; i <= 3; i++) {
          const stepHref = `#story-b-step-${i}`;
          await page.evaluate(sel => document.querySelector(sel).click(), `.aibeat-home-skills-example--agent a[href="${stepHref}"]`);
          await wait(50);

          const stepState = await page.evaluate((idx, href) => {
            const agentEx = document.querySelector('.aibeat-home-skills-example--agent');
            const cards = [...agentEx.querySelectorAll('.aibeat-home-evidence-card')].map(c => c.getBoundingClientRect().height > 0);
            const targetCard = document.getElementById(href.slice(1));
            const targetLink = targetCard?.querySelector('.aibeat-home-image-link');
            const targetLinkRect = targetLink?.getBoundingClientRect();
            return {
              hash: window.location.hash,
              cardsVisible: cards,
              targetRendered: targetCard && targetCard.getBoundingClientRect().height > 0,
              linkHeight: targetLinkRect ? targetLinkRect.height : 0,
              linkTarget: targetLink ? targetLink.getAttribute('target') : null
            };
          }, i, stepHref);

          check(`${testId}:agent-step-${i}-hash`, stepState.hash === stepHref, stepState.hash);
          check(`${testId}:agent-step-${i}-visible`, stepState.cardsVisible[i - 1] === true && stepState.cardsVisible.filter(v => v).length === 1, stepState.cardsVisible);
          check(`${testId}:agent-step-${i}-link`, stepState.linkHeight >= 43.5 && stepState.linkTarget === '_blank', stepState);
        }

        // 3. Test Story A steps (5 steps click & verification)
        for (let i = 1; i <= 5; i++) {
          const stepHref = `#story-a-step-${i}`;
          await page.evaluate(sel => document.querySelector(sel).click(), `.aibeat-home-skills-example--risk a[href="${stepHref}"]`);
          await wait(50);

          const stepState = await page.evaluate((idx, href) => {
            const riskEx = document.querySelector('.aibeat-home-skills-example--risk');
            const cards = [...riskEx.querySelectorAll('.aibeat-home-evidence-card')].map(c => c.getBoundingClientRect().height > 0);
            const targetCard = document.getElementById(href.slice(1));
            const targetLink = targetCard?.querySelector('.aibeat-home-image-link');
            const targetLinkRect = targetLink?.getBoundingClientRect();
            return {
              hash: window.location.hash,
              cardsVisible: cards,
              targetRendered: targetCard && targetCard.getBoundingClientRect().height > 0,
              linkHeight: targetLinkRect ? targetLinkRect.height : 0,
              linkTarget: targetLink ? targetLink.getAttribute('target') : null
            };
          }, i, stepHref);

          check(`${testId}:risk-step-${i}-hash`, stepState.hash === stepHref, stepState.hash);
          check(`${testId}:risk-step-${i}-visible`, stepState.cardsVisible[i - 1] === true && stepState.cardsVisible.filter(v => v).length === 1, stepState.cardsVisible);
          check(`${testId}:risk-step-${i}-link`, stepState.linkHeight >= 43.5 && stepState.linkTarget === '_blank', stepState);
        }

        // 4. Test "查看全部截图 / View all screenshots" mode
        await page.evaluate(sel => document.querySelector(sel).click(), '.aibeat-home-skills-modes a[href="#skills-all-steps"]');
        await wait(60);

        const allModeState = await page.evaluate(() => {
          const home = document.querySelector('.aibeat-home');
          const allCards = [...home.querySelectorAll('.aibeat-home-skills-example .aibeat-home-evidence-card')].map(c => {
            const r = c.getBoundingClientRect();
            const link = c.querySelector('.aibeat-home-image-link');
            const img = c.querySelector('.aibeat-home-evidence-img');
            return {
              id: c.id,
              rendered: r.height > 0 && r.width > 0,
              linkHeight: link ? link.getBoundingClientRect().height : 0,
              imgComplete: img ? img.complete : false
            };
          });

          return {
            hash: window.location.hash,
            cardCount: allCards.length,
            allRendered: allCards.every(c => c.rendered),
            allLinksPass: allCards.every(c => c.linkHeight >= 43.5),
            allCards
          };
        });

        check(`${testId}:all-mode-hash`, allModeState.hash === '#skills-all-steps', allModeState.hash);
        check(`${testId}:all-mode-8-rendered`, allModeState.cardCount === 8 && allModeState.allRendered, allModeState);
        check(`${testId}:all-mode-links-min-height`, allModeState.allLinksPass, allModeState);

        // Click any step to restore step-by-step mode
        await page.evaluate(sel => document.querySelector(sel).click(), '.aibeat-home-skills-example--agent a[href="#story-b-step-1"]');
        await wait(50);
        const restoredState = await page.evaluate(() => {
          const agentCards = [...document.querySelectorAll('.aibeat-home-skills-example--agent .aibeat-home-evidence-card')].map(c => c.getBoundingClientRect().height > 0);
          return {
            hash: window.location.hash,
            agentVisibleCount: agentCards.filter(v => v).length,
            step1Visible: agentCards[0]
          };
        });
        check(`${testId}:restore-step-mode`, restoredState.hash === '#story-b-step-1' && restoredState.agentVisibleCount === 1 && restoredState.step1Visible, restoredState);

        // Viewport screenshot (clean viewport, no sticky header mid-element artifacts)
        if (width === 390 || width === 1440) {
          await page.evaluate(() => {
            document.getElementById('skills').scrollIntoView({ behavior: 'instant' });
          });
          await wait(100);
          await page.screenshot({
            path: path.join(OUT, `viewport-skills-${testId}.png`),
            fullPage: false
          });
        }

        await page.close();
      }
    }
  }

  // 5. Keyboard accessibility check
  console.log('--- Keyboard Accessibility Check ---');
  const kp = await browser.newPage();
  await kp.setViewport({ width: 1440, height: 900 });
  await kp.goto(BASE + '/cn', { waitUntil: 'networkidle2' });
  await kp.waitForSelector('.aibeat-home[data-downloads-ready="true"]');

  // Focus step 2 link via keyboard and activate it with Enter
  const step2Link = await kp.$('.aibeat-home-skills-example--agent a[href="#story-b-step-2"]');
  await step2Link.focus();
  await kp.keyboard.press('Enter');
  await wait(100);
  const step2Hash = await kp.evaluate(() => window.location.hash);
  check('keyboard:enter-step-2', step2Hash === '#story-b-step-2', step2Hash);

  // Focus image link
  const imgLink = await kp.$('#story-b-step-2 .aibeat-home-image-link');
  await imgLink.focus();
  const focusedImgHref = await kp.evaluate(() => document.activeElement.getAttribute('href'));
  check('keyboard:focus-image-link', focusedImgHref === '/images/story-b3-advice-history-view.png', focusedImgHref);

  await kp.close();

  // 6. No-JS Fallback Check on CN and EN at 390 (mobile) and 1440 (desktop)
  console.log('--- No-JS Fallback Check ---');
  for (const lang of ['cn', 'en']) {
    const prefix = lang === 'cn' ? '/cn' : '';
    for (const width of [390, 1440]) {
      const nojsTestId = `nojs-${lang}-${width}`;
      const nojs = await browser.newPage();
      await nojs.setJavaScriptEnabled(false);
      await nojs.setViewport({ width, height: 1000, isMobile: width < 768, hasTouch: width < 768 });
      await nojs.goto(BASE + (prefix || '/'), { waitUntil: 'networkidle2' });

      const nojsAudit = await nojs.evaluate(() => {
        const home = document.querySelector('.aibeat-home');
        const stepLinks = [...home.querySelectorAll('.aibeat-home-step-pipeline a.aibeat-home-pipeline-step')].map(a => ({
          href: a.getAttribute('href'),
          text: a.textContent.trim()
        }));
        const modeLinks = [...home.querySelectorAll('.aibeat-home-skills-modes a.aibeat-home-mode-link')].map(a => a.getAttribute('href'));
        const images = [...home.querySelectorAll('.aibeat-home-skills-example .aibeat-home-evidence-img')].map(img => ({
          src: img.getAttribute('src'),
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        }));
        const suggestions = home.querySelectorAll('.aibeat-home-skills-suggestions .aibeat-home-suggestion-item').length;
        const allStepsWrapper = !!document.getElementById('skills-all-steps');

        return {
          stepLinksCount: stepLinks.length,
          stepHrefs: stepLinks.map(l => l.href),
          modeLinks,
          allStepsWrapper,
          imagesCount: images.length,
          imagesOk: images.every(i => i.naturalWidth === 1280 && i.naturalHeight === 960),
          suggestions
        };
      });

      check(`${nojsTestId}:step-links-count`, nojsAudit.stepLinksCount === 8, nojsAudit.stepLinksCount);
      check(`${nojsTestId}:step-hrefs-valid`, nojsAudit.stepHrefs.every(h => h.startsWith('#story-')), nojsAudit.stepHrefs);
      check(`${nojsTestId}:all-mode-link`, nojsAudit.modeLinks.includes('#skills-all-steps') && nojsAudit.allStepsWrapper, nojsAudit);
      check(`${nojsTestId}:images`, nojsAudit.imagesCount === 8 && nojsAudit.imagesOk, nojsAudit);
      check(`${nojsTestId}:suggestions`, nojsAudit.suggestions === 4, nojsAudit.suggestions);

      await nojs.screenshot({ path: path.join(OUT, `${nojsTestId}.png`), fullPage: false });
      await nojs.close();
    }
  }

} catch (err) {
  failures.push({ name: 'exception', detail: err.stack });
} finally {
  await browser.close();
}

console.log(`Focused QA Completed. Total failures: ${failures.length}`);
fs.writeFileSync(path.join(OUT, 'focused-qa-report.json'), JSON.stringify({ baseUrl: BASE, failures }, null, 2));
if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
} else {
  console.log('ALL FOCUSED CHECKS PASSED!');
}
