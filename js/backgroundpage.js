/* 
  This script page is the background script. autoentry.js is the autojoin button and other page
  modifications
*/

/* Keep-alive helper: keeps SW alive while doing long work */
const keepAlive = (() => {
  let timerId = 0;
  let refs = 0;
  const ping = () => chrome.runtime.getPlatformInfo(() => {});
  return {
    acquire() {
      refs++;
      if (!timerId) {
        ping();
        timerId = setInterval(ping, 20_000);
      }
    },
    release() {
      refs = Math.max(0, refs - 1);
      if (refs === 0 && timerId) {
        clearInterval(timerId);
        timerId = 0;
      }
    },
  };
})();

const runWithKeepAlive = async (fn) => {
  keepAlive.acquire();
  try {
    return await fn();
  } finally {
    keepAlive.release();
  }
};

/* Offscreen document utils (DOMParser and Audio live there) */
let creating;
const setupOffscreenDocument = async (path) => {
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER', 'AUDIO_PLAYBACK'],
      justification: 'Parsing HTML and playing audio alerts',
    });
    await creating;
    creating = null;
  }
};

const parseHTML = async (data) => {
  await setupOffscreenDocument('html/offscreen.html');
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        task: 'parse',
        target: 'offscreen',
        data,
      },
      (res) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (res?.error) return reject(new Error(res.error));
        resolve(res);
      }
    );
  });
};

const playAudio = async (volume) => {
  await setupOffscreenDocument('html/offscreen.html');
  chrome.runtime.sendMessage({
    task: 'audio',
    target: 'offscreen',
    data: volume,
  });
};

/* Variables declaration */
let arr = [];
let settings;
let link = 'https://www.steamgifts.com/giveaways/search?page=';
let pages = 1;
let pagestemp = pages;
let token = '';
let mylevel = 0;
let timepassed = 0;
let timetopass = 100;
let justLaunched = true;
let thisVersion = 20170929;
let totalWishlistGAcnt = 0;
let useWishlistPriorityForMainBG = false;
let currPoints = 0;

/* Steam key redeem response codes */
const steamKeyRedeemResponses = {
  0: 'NoDetail',
  1: 'AVSFailure',
  2: 'InsufficientFunds',
  3: 'ContactSupport',
  4: 'Timeout',
  5: 'InvalidPackage',
  6: 'InvalidPaymentMethod',
  7: 'InvalidData',
  8: 'OthersInProgress',
  9: 'AlreadyPurchased',
  10: 'WrongPrice',
  11: 'FraudCheckFailed',
  12: 'CancelledByUser',
  13: 'RestrictedCountry',
  14: 'BadActivationCode',
  15: 'DuplicateActivationCode',
  16: 'UseOtherPaymentMethod',
  17: 'UseOtherFunctionSource',
  18: 'InvalidShippingAddress',
  19: 'RegionNotSupported',
  20: 'AcctIsBlocked',
  21: 'AcctNotVerified',
  22: 'InvalidAccount',
  23: 'StoreBillingCountryMismatch',
  24: 'DoesNotOwnRequiredApp',
  25: 'CanceledByNewTransaction',
  26: 'ForceCanceledPending',
  27: 'FailCurrencyTransProvider',
  28: 'FailedCyberCafe',
  29: 'NeedsPreApproval',
  30: 'PreApprovalDenied',
  31: 'WalletCurrencyMismatch',
  32: 'EmailNotValidated',
  33: 'ExpiredCard',
  34: 'TransactionExpired',
  35: 'WouldExceedMaxWallet',
  36: 'MustLoginPS3AppForPurchase',
  37: 'CannotShipToPOBox',
  38: 'InsufficientInventory',
  39: 'CannotGiftShippedGoods',
  40: 'CannotShipInternationally',
  41: 'BillingAgreementCancelled',
  42: 'InvalidCoupon',
  43: 'ExpiredCoupon',
  44: 'AccountLocked',
  45: 'OtherAbortableInProgress',
  46: 'ExceededSteamLimit',
  47: 'OverlappingPackagesInCart',
  48: 'NoWallet',
  49: 'NoCachedPaymentMethod',
  50: 'CannotRedeemCodeFromClient',
  51: 'PurchaseAmountNoSupportedByProvider',
  52: 'OverlappingPackagesInPendingTransaction',
  53: 'RateLimited',
  54: 'OwnsExcludedApp',
  55: 'CreditCardBinMismatchesType',
  56: 'CartValueTooHigh',
  57: 'BillingAgreementAlreadyExists',
  58: 'POSACodeNotActivated',
  59: 'CannotShipToCountry',
  60: 'HungTransactionCancelled',
  61: 'PaypalInternalError',
  62: 'UnknownGlobalCollectError',
  63: 'InvalidTaxAddress',
  64: 'PhysicalProductLimitExceeded',
  65: 'PurchaseCannotBeReplayed',
  66: 'DelayedCompletion',
  67: 'BundleTypeCannotBeGifted',
};

/* Auto redeem keys: expect entries = [{ winnerId, xsrfToken }] */
const autoRedeemKeys = async (entries) => {
  const notifySteamCodeResponse = (info) => {
    notify('key', info);
  };

  if (!Array.isArray(entries) || entries.length === 0) return;

  for (const entry of entries) {
    try {
      const formData = new FormData();
      formData.append('do', 'view_key');
      formData.append('winner_id', entry.winnerId);
      formData.append('xsrf_token', entry.xsrfToken);

      const res = await fetch('https://www.steamgifts.com/ajax.php', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        console.error(`Error while trying to fetch a key: HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const dataStr = JSON.stringify(json);

      // Extract key
      const idx = dataStr.indexOf('?key=');
      let key = '';
      if (idx !== -1) {
        const rest = dataStr.substring(idx + 5);
        const end = rest.indexOf('\\');
        key = end !== -1 ? rest.substring(0, end) : rest;
      }

      // Check key format
      if (!/^[a-zA-Z0-9]{4,6}\-[a-zA-Z0-9]{4,6}\-[a-zA-Z0-9]{4,6}$/.test(key)) {
        console.log('[!] Invalid Format!');
        notifySteamCodeResponse(`Invalid Format!\nCode: ${key || '(none)'} was not redeemed!`);
        continue;
      }

      // Check steam login and session
      const storeRes = await fetch('https://store.steampowered.com', { credentials: 'include' });
      const storeHtml = await storeRes.text();

      if (storeHtml.indexOf('playerAvatar') === -1) {
        console.log('[!] Not logged in on Steam! Code was not redeemed!');
        notifySteamCodeResponse(`Not logged in on Steam!\nCode: ${key} was not redeemed!`);
        continue;
      }

      const sessIdx = storeHtml.indexOf('g_sessionID');
      if (sessIdx === -1) {
        console.log('[!] Could not find Steam session ID!');
        notifySteamCodeResponse(`Could not obtain Steam session.\nCode: ${key} was not redeemed!`);
        continue;
      }
      const steamSessionId = storeHtml.substr(sessIdx + 15, 24);

      const regForm = new FormData();
      regForm.append('product_key', key);
      regForm.append('sessionid', steamSessionId);

      const regRes = await fetch('https://store.steampowered.com/account/ajaxregisterkey/', {
        method: 'POST',
        body: regForm,
        credentials: 'include',
      });

      if (!regRes.ok) {
        console.error(`Error registering key on Steam: HTTP ${regRes.status}`);
        notifySteamCodeResponse(`Steam returned HTTP ${regRes.status} when redeeming ${key}`);
        continue;
      }

      const regData = await regRes.json();
      const itemsList = regData?.purchase_receipt_info?.line_items?.map((it) => it.line_item_description) || [];
      const redeemedGames = itemsList.join(', ');
      const detailName = steamKeyRedeemResponses[regData?.purchase_result_details];

      if (regData?.success === 1) {
        const msg = `Steam Code for ${redeemedGames || 'unknown app'} was redeemed successfully!`;
        console.log(msg);
        notifySteamCodeResponse(msg);

        // Mark as received on SteamGifts
        const markForm = new FormData();
        markForm.append('xsrf_token', entry.xsrfToken);
        markForm.append('do', 'received_feedback');
        markForm.append('action', '1');
        markForm.append('winner_id', entry.winnerId);
        const markRes = await fetch('https://www.steamgifts.com/ajax.php', {
          method: 'POST',
          body: markForm,
          credentials: 'include',
        });
        if (!markRes.ok) {
          console.error(`Error while trying to mark giveaway as received: HTTP ${markRes.status}`);
        }
      } else if (detailName !== undefined) {
        if (redeemedGames) {
          const msg = `Steam Code: ${key} for ${redeemedGames} was not redeemed!\nError: ${detailName}`;
          console.log('[!]', msg);
          notifySteamCodeResponse(msg);
        } else {
          const msg = `Steam Code: ${key} was not redeemed!\nError: ${detailName}`;
          console.log('[!]', msg);
          notifySteamCodeResponse(msg);
        }
      } else {
        const msg = `Steam Code: ${key} was not redeemed!\nUnknown Error.`;
        console.log('[!]', msg);
        notifySteamCodeResponse(msg);
      }
    } catch (err) {
      console.error('AutoRedeem error:', err);
      notify('key', `AutoRedeem error: ${String(err)}`);
    }
  }
};

class Giveaway {
  constructor(code, level, appid, odds, cost, timeleft) {
    this.code = code;
    this.level = level;
    this.steamlink = appid;
    this.odds = odds;
    this.cost = cost;
    this.timeleft = timeleft;
    this.showInfo = function () {
      console.log(`
    Giveaway https://www.steamgifts.com/giveaway/${this.code}/ (${this.cost} P) | Level: ${this.level} | Time left: ${this.timeleft} s
    Steam: https://store.steampowered.com/app/${this.steamlink} Odds of winning: ${this.odds}`);
    };
  }
}

const compareLevel = (a, b) => b.level - a.level;
const compareOdds = (a, b) => b.odds - a.odds;

const calculateWinChance = (
  timeLeft,
  timeStart,
  numberOfEntries,
  numberOfCopies,
  timeLoaded
) => {
  const timePassed = timeLoaded - timeStart; // seconds
  const predictionOfEntries = (numberOfEntries / Math.max(1, timePassed)) * Math.max(0, timeLeft);
  const chance = (1 / (numberOfEntries + 1 + predictionOfEntries)) * 100 * numberOfCopies;
  return chance;
};

const notify = async (type, msg) => {
  switch (type) {
    case 'win': {
      await runWithKeepAlive(async () => {
        const response = await fetch('https://www.steamgifts.com/giveaways/won', { credentials: 'include' });
        if (response.ok) {
          const wonPageHtml = await response.text();

          // Parse won page name and entries (offscreen)
          let wonName = 'a giveaway';
          let wonEntries = [];
          try {
            const parsed = await parseHTML({
              items: ['wonName', 'wonEntries'],
              html: wonPageHtml,
            });
            if (parsed?.wonName) wonName = parsed.wonName;
            if (Array.isArray(parsed?.wonEntries)) wonEntries = parsed.wonEntries;
          } catch (e) {
            console.warn('Failed to parse won page:', e);
          }

          chrome.notifications.clear('won_notification', () => {
            const e = {
              type: 'basic',
              title: 'AutoJoin',
              message: `You won ${wonName}! Click here to open Steamgifts.com`,
              iconUrl: chrome.runtime.getURL('media/autologosteam.png'),
            };
            chrome.notifications.create('won_notification', e, () => {
              chrome.storage.sync.get(
                { PlayAudio: true, AudioVolume: 1 },
                (data) => {
                  if (data.PlayAudio === true) {
                    playAudio(data.AudioVolume ?? 1);
                  }
                }
              );
            });
          });

          if (settings?.AutoRedeemKey && wonEntries.length > 0) {
            await runWithKeepAlive(async () => {
              await autoRedeemKeys(wonEntries);
            });
          }
        } else {
          console.error(`Could not fetch /giveaways/won page: HTTP ${response.status}`);
        }
      });
      break;
    }
    case 'points': {
      chrome.notifications.clear('points_notification', () => {
        const e = {
          type: 'basic',
          title: 'AutoJoin',
          message: `You have ${msg} points on Steamgifts.com. Time to spend!`,
          iconUrl: chrome.runtime.getURL('media/autologosteam.png'),
        };
        chrome.notifications.create('points_notification', e);
      });
      break;
    }
    case 'key': {
      chrome.notifications.clear('key_notification', () => {
        const e = {
          type: 'basic',
          title: 'AutoJoin',
          message: msg,
          iconUrl: chrome.runtime.getURL('media/autologosteam.png'),
        };
        chrome.notifications.create('key_notification', e);
      });
      break;
    }
    default:
      console.log('Unknown notification type');
  }
};

/* Scan a page and push giveaways to arr; when last page processed, calls pagesloaded() */
const scanpage = async (html) => {
  const timePageLoaded = Math.round(Date.now() / 1000);

  let result = { giveaways: [], giveawaysWithoutPinned: [] };
  try {
    result = await parseHTML({ items: Object.keys(result), html });
  } catch (e) {
    console.error('parseHTML failed in scanpage:', e);
    result = { giveaways: [], giveawaysWithoutPinned: [] };
  }

  const giveaways =
    settings?.IgnorePinnedBG === true ||
    (useWishlistPriorityForMainBG && pagestemp === pages)
      ? result.giveawaysWithoutPinned
      : result.giveaways;

  if (!Array.isArray(giveaways)) {
    console.error('This should always be an array, something went wrong.');
    console.error('IgnorePinnedBG: ', settings?.IgnorePinnedBG);
    console.error('WishlistPriority: ', useWishlistPriorityForMainBG);
    console.error(`Pages: ${pagestemp} | ${pages}`);
    console.error(giveaways);
  }

  for (const giveaway of giveaways || []) {
    if (giveaway.levelTooHigh) continue;
    if (giveaway.isGroupGA && settings?.IgnoreGroupsBG) continue;

    giveaway.timeLeft = giveaway.timeEnd - timePageLoaded;
    const oddsOfWinning = calculateWinChance(
      giveaway.timeLeft,
      giveaway.timeStart,
      giveaway.numberOfEntries,
      giveaway.numberOfCopies,
      timePageLoaded
    );
    arr.push(
      new Giveaway(
        giveaway.GAcode,
        parseInt(giveaway.GAlevel, 10) || 0,
        giveaway.GAsteamAppID,
        oddsOfWinning,
        parseInt(giveaway.cost, 10) || 0,
        giveaway.timeLeft
      )
    );
  }

  if (pagestemp === pages) {
    totalWishlistGAcnt = arr.length;
  }
  pagestemp--;
  if (
    pagestemp === 0 ||
    (currPoints < (settings?.PointsToPreserve ?? 0) &&
      useWishlistPriorityForMainBG &&
      settings?.IgnorePreserveWishlistOnMainBG &&
      totalWishlistGAcnt !== 0)
  ) {
    pagestemp = 0;
    pagesloaded();
  }
};

/* Called once all pages are parsed. Builds a queue and delegates join to offscreen doc. */
function pagesloaded() {
  let wishlistArr;
  if (useWishlistPriorityForMainBG) {
    wishlistArr = arr.slice(0, totalWishlistGAcnt);
    if (settings?.LevelPriorityBG) {
      wishlistArr.sort(compareLevel);
    } else if (settings?.OddsPriorityBG) {
      wishlistArr.sort(compareOdds);
    }
    arr = arr.slice(totalWishlistGAcnt);
  }

  if (settings?.LevelPriorityBG) {
    arr.sort(compareLevel);
  } else if (settings?.OddsPriorityBG) {
    arr.sort(compareOdds);
  }
  if (useWishlistPriorityForMainBG) {
    arr = wishlistArr.concat(arr);
  }

  const queue = [];

  for (const ga of arr) {
    if (ga.level < (settings?.MinLevelBG ?? 0)) {
      continue;
    }
    if (ga.cost < (settings?.MinCostBG ?? 0)) {
      ga.showInfo();
      console.log(
        `^Skipped, cost: ${ga.cost}, your settings.MinCostBG is ${settings?.MinCostBG}`
      );
      continue;
    }
    if (settings?.MaxCostBG != null && settings.MaxCostBG !== -1 && ga.cost > settings.MaxCostBG) {
      ga.showInfo();
      console.log(
        `^Skipped, cost: ${ga.cost}, your settings.MaxCostBG is ${settings.MaxCostBG}`
      );
      continue;
    }
    if (ga.timeleft > (settings?.MaxTimeLeftBG ?? 0) && settings.MaxTimeLeftBG !== 0) {
      ga.showInfo();
      console.log(
        `^Skipped, timeleft: ${ga.timeleft}, your settings.MaxTimeLeftBG is ${settings.MaxTimeLeftBG}`
      );
      continue;
    }

    ga.showInfo();
    console.log('^Queued');
    queue.push({ code: ga.code });
  }

  if (queue.length === 0) {
    console.log('No eligible giveaways to join in this batch.');
    return;
  }

  setupOffscreenDocument('html/offscreen.html').then(() => {
    chrome.runtime.sendMessage({
      task: 'joinQueue',
      target: 'offscreen',
      data: {
        queue,
        token,
        delaySec: settings?.DelayBG ?? 10,
        jitterMs: 2000,
        pointsToPreserve: settings?.PointsToPreserve ?? 0,
        ignorePreserveWishlistOnMainBG: !!settings?.IgnorePreserveWishlistOnMainBG,
        wishlistCount: useWishlistPriorityForMainBG ? totalWishlistGAcnt : 0,
      },
    });
  });
}

/* Loads settings and runs logic. Uses keepAlive while doing heavy work. */
const settingsloaded = async () => {
  await runWithKeepAlive(async () => {
    if (settings?.IgnoreGroupsBG && settings.PageForBG === 'all') {
      settings.IgnoreGroupsBG = true;
    }
    if (settings?.PageForBG === 'all' && settings.WishlistPriorityForMainBG) {
      useWishlistPriorityForMainBG = true;
    } else {
      useWishlistPriorityForMainBG = false;
    }
    pages = settings?.PagesToLoadBG ?? 1;
    if (pages < 2 && useWishlistPriorityForMainBG) {
      pages = 2;
    }
    timetopass = 10 * (settings?.RepeatHoursBG ?? 0);
    if (justLaunched || settings?.RepeatHoursBG === 0) {
      justLaunched = false;
      timepassed = timetopass;
    } else {
      timepassed += 5;
    }

    let result = { won: false, myPoints: 0, myLevel: 0, token: '' };

    /* If background autojoin is disabled or not enough time passed, only check if won or notify points */
    if (settings?.BackgroundAJ === false || timepassed < timetopass) {
      const res = await fetch(link + 1, { credentials: 'include' });
      const html = await res.text();
      try {
        result = await parseHTML({
          items: Object.keys(result),
          html,
        });
      } catch (e) {
        console.warn('parseHTML failed in simple check:', e);
      }

      if (result.won) {
        await notify('win');
      } else {
        currPoints = result.myPoints;
        if (currPoints >= (settings?.NotifyLimitAmount ?? 0) && settings?.NotifyLimit) {
          console.log(
            `Sending notification about accumulated points: ${currPoints} > ${settings.NotifyLimitAmount}`
          );
          notify('points', currPoints);
        }
        console.log(`Current Points: ${currPoints}`);
      }
      // check level and save if changed
      mylevel = result.myLevel;
      if (settings?.LastKnownLevel !== mylevel) {
        chrome.storage.sync.set({ LastKnownLevel: mylevel });
      }
    } else {
      /* Else check if won first, then start scanning pages */
      timepassed = 0; // reset timepassed
      const searchLink = `https://www.steamgifts.com/giveaways/search?type=${settings?.PageForBG}&level_min=${settings?.MinLevelBG}&level_max=${settings?.LastKnownLevel}&page=`;
      const wishLink = `https://www.steamgifts.com/giveaways/search?type=wishlist&level_min=${settings?.MinLevelBG}&level_max=${settings?.LastKnownLevel}&page=`;
      let linkToUse = useWishlistPriorityForMainBG ? wishLink : searchLink;
      arr.length = 0;

      const res = await fetch(linkToUse + 1, { credentials: 'include' });
      const html = await res.text();
      try {
        result = await parseHTML({
          items: Object.keys(result),
          html,
        });
      } catch (e) {
        console.warn('parseHTML failed in main scan first page:', e);
      }

      currPoints = result.myPoints;
      if (result.won) {
        await notify('win');
      } else if (currPoints >= (settings?.NotifyLimitAmount ?? 0) && settings?.NotifyLimit) {
        console.log(
          `Sending notification about accumulated points: ${currPoints} > ${settings.NotifyLimitAmount}`
        );
        notify('points', currPoints);
      }

      if (pages > 5 || pages < 1) {
        pagestemp = 3;
      } else {
        pagestemp = pages;
      }

      token = result.token || '';
      mylevel = result.myLevel || 0;
      if (settings?.LastKnownLevel !== mylevel) {
        chrome.storage.sync.set({ LastKnownLevel: mylevel });
      }

      if (
        currPoints >= (settings?.PointsToPreserve ?? 0) ||
        (useWishlistPriorityForMainBG && settings?.IgnorePreserveWishlistOnMainBG)
      ) {
        await scanpage(html); // scan page 1 already loaded to get info above
        let i = 0;
        if (useWishlistPriorityForMainBG) {
          linkToUse = searchLink;
          i = 1;
        }
        if (currPoints >= (settings?.PointsToPreserve ?? 0)) {
          for (let n = 2 - i; n <= pages - i; n++) {
            if (n > 3 - i) break; // max 3 pages per run
            try {
              const res = await fetch(linkToUse + n, { credentials: 'include' });
              const newPage = await res.text();
              await scanpage(newPage);
            } catch (e) {
              console.warn('Failed to scan page', n, e);
            }
          }
        }
      }
    }
  });
};

/* Load settings, then call settingsloaded() */
const loadsettings = () => {
  chrome.storage.sync.get(
    {
      PageForBG: 'wishlist',
      RepeatHoursBG: 5,
      DelayBG: 10,
      MaxTimeLeftBG: 0, // seconds
      MinLevelBG: 0,
      MinCostBG: 0,
      MaxCostBG: -1,
      PointsToPreserve: 0,
      WishlistPriorityForMainBG: false,
      IgnorePreserveWishlistOnMainBG: false,
      PagesToLoadBG: 2,
      BackgroundAJ: false,
      LevelPriorityBG: true,
      OddsPriorityBG: false,
      IgnoreGroupsBG: false,
      IgnorePinnedBG: true,
      LastKnownLevel: 10,
      NotifyLimit: false,
      NotifyLimitAmount: 300,
      AutoRedeemKey: false,
      lastLaunchedVersion: thisVersion,
    },
    (data) => {
      settings = data;
      settingsloaded();
    }
  );
};

/* It all begins with the loadsettings call on alarm */
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log(`Alarm fired. ${new Date().toLocaleString()}`);
  if (alarm.name === 'routine') {
    loadsettings();
  }
});

const createAlarm = () => {
  // Create first alarm ASAP, repeat every 30 minutes
  chrome.alarms.get('routine', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('routine', {
        delayInMinutes: 0.5,
        periodInMinutes: 30,
      });
      console.log('Alarm set.');
    }
  });
};
createAlarm();

/* Recreate alarm on install/update and on startup */
chrome.runtime.onInstalled.addListener((updateInfo) => {
  chrome.alarms.clearAll(() => {
    createAlarm();
  });

  if (!updateInfo.previousVersion) return;

  const parseVersion = (version) =>
    Number(
      version
        .split('.')
        .map((v) => v.padStart(3, 0))
        .join('')
        .padEnd(9, 0)
    );
  const prevVersion = parseVersion(updateInfo.previousVersion);

  if (prevVersion < parseVersion('1.5.0')) {
    console.log('Changing settings to prevent mass ban of extension users...');
    chrome.storage.sync.set(
      {
        BackgroundAJ: false,
        IgnorePinnedBG: true,
        RepeatIfOnPage: false,
        RepeatHoursBG: 5,
        RepeatHours: 5,
      },
      () => {
        const e = {
          type: 'basic',
          title: 'Steamgifts Guidelines Update',
          message: 'Your settings were changed. Click here to read more...',
          iconUrl: chrome.runtime.getURL('media/autologosteam.png'),
        };
        chrome.notifications.create('1.5.0 announcement', e);
      }
    );
  }
  if (prevVersion < parseVersion('1.6.2')) {
    console.log('Changing settings of minCost to minCostBG');
    chrome.storage.sync.get(
      {
        MinCost: 0,
      },
      (minCost) => {
        chrome.storage.sync.set(
          {
            MinCost: 0,
            MinCostBG: minCost,
          },
          () => {
            console.log('Migrated successfully minCost option from previous version');
          }
        );
      }
    );
  }
});

chrome.runtime.onStartup.addListener(createAlarm);

/* Creating a new tab if notification is clicked */
chrome.notifications.onClicked.addListener((notificationId) => {
  let url;
  switch (notificationId) {
    case '1.5.0 announcement':
      url = 'http://steamcommunity.com/groups/autojoin#announcements/detail/1485483400577229657';
      break;
    case 'points_notification':
      url = 'https://www.steamgifts.com/';
      break;
    default:
      url = 'https://www.steamgifts.com/giveaways/won';
  }
  chrome.windows.getCurrent((currentWindow) => {
    if (currentWindow) {
      chrome.tabs.create({ url });
    } else {
      chrome.windows.create({ url, type: 'normal', focused: true });
    }
  });
});

/* Background messaging handlers */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.task === 'checkPermission') {
    // Check if we have "*://steamcommunity.com/profiles/*" permission, ask for them if not
    console.log('Got a request for "*://steamcommunity.com/profiles/*" permission');
    chrome.permissions.contains(
      {
        origins: ['*://steamcommunity.com/profiles/*'],
      },
      (result) => {
        if (result) {
          console.log('We already have permission');
          if (sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { granted: 'true' });
          sendResponse?.({ granted: 'true' });
        } else if (request.ask === 'true') {
          // We don't have permission, try to request them if ask is 'true'
          chrome.permissions.request(
            {
              origins: ['*://steamcommunity.com/profiles/*'],
            },
            (granted) => {
              if (granted) {
                console.log('Permission granted');
                if (sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { granted: 'true' });
              } else {
                console.log('Permission declined');
                if (sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { granted: 'false' });
              }
            }
          );
        } else {
          sendResponse?.({ granted: 'false' });
        }
      }
    );
    return true; // async sendResponse
  }

  if (request.task === 'fetch') {
    // Fetch in background script to bypass CORS (content scripts can't do it anymore)
    fetchHelper(request.url).then(sendResponse);
    return true; // async
  }

  // Progress events from offscreen join runner (logging only)
  if (request.task === 'joinProgress') {
    const { code, ok, json, error } = request;
    if (error) console.error('Join error:', code, error);
    else if (ok) console.log('^Entered', code);
    else console.error('Join failed:', code, json);
  }
  if (request.task === 'joinDone') {
    console.log('Join batch done.');
  }
  if (request.task === 'joinError') {
    console.error('Join queue fatal error:', request.error);
  }
});

const fetchHelper = async (url) => {
  // Helper until https://crbug.com/40753031 is implemented
  const result = {
    status: null,
    text: '',
  };

  if (url.includes('steamcommunity.com')) {
    const havePermissions = await chrome.permissions.contains({
      origins: ['*://steamcommunity.com/profiles/*'],
    });

    if (!havePermissions) {
      console.log('Disabling settings that require optional permission which is not granted.');

      chrome.storage.sync.set({
        PriorityWishlist: false,
        HideNonTradingCards: false,
        HideDlc: false,
      });

      result.status = 403;
      return result;
    }
  }

  const res = await fetch(url, { credentials: 'include' });
  result.status = res.status;
  if (res.ok) {
    const text = await res.text();
    result.text = text;
  }
  return result;
};