chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.task) {
    case 'parse': {
      try {
        const data = parse(msg.data);
        sendResponse(data);
      } catch (e) {
        sendResponse({ error: String(e) });
      }
      return; // synchronous response
    }
    case 'audio': {
      try {
        const audio = new Audio(chrome.runtime.getURL('media/audio.mp3'));
        audio.volume = typeof msg.data === 'number' ? msg.data : 1;
        audio.play();
      } catch (e) {
        console.warn('Audio play failed:', e);
      }
      return;
    }
    case 'joinQueue': {
      // fire and forget; progress is reported via runtime.sendMessage
      runJoinQueue(msg.data).catch((err) => {
        chrome.runtime.sendMessage({ task: 'joinError', error: String(err) });
      });
      return;
    }
    case 'fetch':
    case 'checkPermission':
      // not used in offscreen
      return;
    default:
      console.log(`Unknown message type for offscreen document: ${msg.task}`, msg);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterGiveaway(code, token) {
  const formData = new FormData();
  formData.append('xsrf_token', token);
  formData.append('do', 'entry_insert');
  formData.append('code', code);

  const res = await fetch('https://www.steamgifts.com/ajax.php', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    // ignore JSON parse error; leave json as null
  }
  return { ok: res.ok, json };
}

async function runJoinQueue(payload) {
  const {
    queue = [],
    token = '',
    delaySec = 10,
    jitterMs = 2000,
    pointsToPreserve = 0,
    ignorePreserveWishlistOnMainBG = false,
    wishlistCount = 0,
  } = payload || {};

  if (!token || !Array.isArray(queue) || queue.length === 0) {
    chrome.runtime.sendMessage({ task: 'joinDone' });
    return;
  }

  const baseDelay = Math.max(0, delaySec) * 1000;
  for (let i = 0; i < queue.length; i++) {
    const jitter = Math.floor(Math.random() * (Math.max(0, jitterMs) + 1));
    await sleep(baseDelay + jitter);

    const code = queue[i]?.code;
    if (!code) continue;

    try {
      const { ok, json } = await enterGiveaway(code, token);
      chrome.runtime.sendMessage({ task: 'joinProgress', code, ok, json });

      if (!ok) continue;

      // Stop conditions
      if (json?.msg === 'Not Enough Points') break;

      if (typeof json?.points === 'number') {
        // If ignoring preserve for wishlist portion, allow first wishlistCount items regardless
        if (ignorePreserveWishlistOnMainBG && wishlistCount > 0) {
          const inWishlistSegment = i < wishlistCount;
          if (!inWishlistSegment && json.points < pointsToPreserve) break;
        } else {
          if (json.points < pointsToPreserve) break;
        }
      }
    } catch (e) {
      chrome.runtime.sendMessage({ task: 'joinProgress', code, ok: false, error: String(e) });
    }
  }

  chrome.runtime.sendMessage({ task: 'joinDone' });
}

const parse = (data) => {
  const result = {};
  const html = data?.html || '';
  const parser = new DOMParser();
  let dom = parser.parseFromString(html, 'text/html');

  for (const item of data?.items || []) {
    switch (item) {
      case 'won': {
        result.won = !!dom.querySelector('.popup--gift-received');
        break;
      }
      case 'wonName': {
        const name = dom.querySelector('.table__column__heading')?.textContent?.trim();
        result.wonName = name || 'a giveaway';
        break;
      }
      case 'wonEntries': {
        // Extract entries needed for auto-redeem: [{ winnerId, xsrfToken }]
        const entries = [];
        const keyBtns = dom.querySelectorAll('.view_key_btn');
        keyBtns.forEach((keyBtn) => {
          try {
            const form = keyBtn.parentElement?.nextElementSibling?.querySelector('form');
            const winnerId = form?.querySelector('input[name="winner_id"]')?.value;
            const xsrfToken = form?.querySelector('input[name="xsrf_token"]')?.value;
            if (winnerId && xsrfToken) {
              entries.push({ winnerId, xsrfToken });
            }
          } catch (e) {
            // ignore malformed rows
          }
        });
        result.wonEntries = entries;
        break;
      }
      case 'myLevel': {
        const levelTitle = dom.querySelector('a[href="/account"] span:last-child')?.getAttribute('title') || '';
        const lvl = parseInt(levelTitle, 10);
        result.myLevel = Number.isFinite(lvl) ? lvl : 0;
        break;
      }
      case 'myPoints': {
        const txt = dom.querySelector('a[href="/account"] span.nav__points')?.textContent || '';
        const val = parseInt(txt.replace(',', ''), 10);
        result.myPoints = Number.isFinite(val) ? val : 0;
        break;
      }
      case 'token': {
        const tokenEl = dom.querySelector('input[name=xsrf_token]');
        result.token = tokenEl ? tokenEl.value : '';
        break;
      }
      case 'giveawaysWithoutPinned': {
        const withoutPinned = dom.querySelector(':not(.pinned-giveaways__inner-wrap) > .giveaway__row-outer-wrap')?.parentElement;
        dom = withoutPinned || document.createElement('empty');
        // fallthrough to giveaways with restricted dom
      }
      // intentional fallthrough
      case 'giveaways': {
        const gaElements = [...dom.querySelectorAll('.giveaway__row-inner-wrap:not(.is-faded) .giveaway__heading__name')];
        const giveaways = [];

        for (const node of gaElements) {
          try {
            const resultGA = {
              GAcode: '',
              GAlevel: 0,
              GAsteamAppID: '0',
              cost: '0',
              timeEnd: 0,
              timeStart: 0,
              isGroupGA: false,
              levelTooHigh: false,
              numberOfEntries: 100,
              numberOfCopies: 1,
            };

            const ga = node.parentElement?.parentElement?.parentElement;

            // giveaway code
            const href = node?.href || '';
            const t = href.match(/giveaway\/(.+)\//);
            if (t && t[1]) resultGA.GAcode = t[1];

            // if level is too high
            if (ga?.querySelector('.giveaway__column--contributor-level--negative')) {
              resultGA.levelTooHigh = true;
            }

            // level required (only if not too high)
            const lvlPos = ga?.querySelector('.giveaway__column--contributor-level--positive');
            if (lvlPos) {
              const m = lvlPos.innerHTML.match(/(\d+)/);
              if (m && m[1]) resultGA.GAlevel = parseInt(m[1], 10);
            }

            // steam app id
            const s = ga?.querySelector('.giveaway_image_thumbnail')?.style?.backgroundImage;
            if (s !== undefined) {
              const c = s?.match(/.+(?:apps|subs)\/(\d+)\/cap.+/);
              if (s && c && c[1]) {
                resultGA.GAsteamAppID = c[1]; // could be sub ID or app ID
              }
            }

            // how much points to enter giveaway
            const thins = [...(ga?.querySelectorAll('.giveaway__heading__thin') || [])];
            const lastThin = thins.length ? thins[thins.length - 1] : null;
            const costMatch = lastThin?.innerHTML.match(/\d+/);
            if (costMatch && costMatch[0]) resultGA.cost = costMatch[0];

            // when giveaway ends
            const endTs = ga?.querySelector('.fa-clock-o')?.parentElement?.querySelector('span')?.dataset?.timestamp;
            if (endTs) resultGA.timeEnd = parseInt(endTs, 10) || 0;

            // number of entries
            const entriesTxt = ga?.querySelector('.giveaway__links a[href$="/entries"]')?.textContent || '';
            const entriesNum = parseInt(entriesTxt.replace(',', ''), 10);
            if (Number.isFinite(entriesNum)) resultGA.numberOfEntries = entriesNum;

            // if more than one copy there's a text field "(N Copies)"
            const copiesTxt = ga?.querySelector('.giveaway__heading__thin')?.textContent || '';
            const copiesMatch = copiesTxt.replace(',', '').match(/\((\d+) Copies\)/);
            if (copiesMatch && copiesMatch[1]) resultGA.numberOfCopies = parseInt(copiesMatch[1], 10);

            // when giveaway started
            const startTs = ga?.querySelector('.giveaway__username')?.parentElement?.querySelector('span')?.dataset?.timestamp;
            if (startTs) resultGA.timeStart = parseInt(startTs, 10) || 0;

            // group GA?
            resultGA.isGroupGA = !!ga?.querySelector('.giveaway__heading__thin--group');

            giveaways.push(resultGA);
          } catch (e) {
            // Skip malformed item
          }
        }

        result[item] = giveaways;
        break;
      }
      default: {
        console.log(`Unknown item requested while parsing html in offscreen document: ${item}`);
      }
    }
  }

  return result;
};