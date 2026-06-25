/**
 * Recall Background Service Worker
 * Manages IndexedDB, page extraction triggers, storage limits, and settings
 */

const DB_NAME = 'RecallDB';
const DB_VERSION = 1;
const STORE_NAME = 'pages';

// Default blocklist of domains (search engines, feeds, common private spaces)
const DEFAULT_EXCLUDED_DOMAINS = [
  'google.com',
  'duckduckgo.com',
  'bing.com',
  'yahoo.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'linkedin.com',
  'github.com/notifications',
  'localhost',
  '127.0.0.1'
];

/**
 * Open IndexedDB database connection
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('domain', 'domain');
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save page data to IndexedDB
 */
async function savePage(pageData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(pageData);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Retrieve a single page from IndexedDB
 */
async function getPage(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(url);
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Retrieve all pages from IndexedDB
 */
async function getAllPages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result || []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Delete a page from IndexedDB
 */
async function deletePage(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(url);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Get total number of pages in the index
 */
async function getPageCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.count();
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Purge pages older than retentionDays
 */
async function purgeOldPages(retentionDays) {
  if (retentionDays === 'never' || !retentionDays) return;
  
  const days = parseInt(retentionDays, 10);
  if (isNaN(days)) return;

  const db = await openDB();
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(cutoff);

    const req = index.openCursor(range);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Clear the entire database
 */
async function clearAllData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// Set up daily purging alarm
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('daily-purge', { periodInMinutes: 1440 });
  
  // Set default configurations if not set
  const settings = await chrome.storage.local.get(['retentionDays', 'excludedDomains']);
  if (settings.retentionDays === undefined) {
    await chrome.storage.local.set({ retentionDays: 30 });
  }
  if (settings.excludedDomains === undefined) {
    await chrome.storage.local.set({ excludedDomains: DEFAULT_EXCLUDED_DOMAINS });
  }
});

// Listen for purging alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily-purge') {
    const settings = await chrome.storage.local.get({ retentionDays: 30 });
    if (settings.retentionDays !== 'never') {
      try {
        await purgeOldPages(settings.retentionDays);
      } catch (err) {
        console.error('[Recall] Auto purge failed:', err);
      }
    }
  }
});

/**
 * Passive Indexing Pipeline (chrome.webNavigation)
 */
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only index main frame (not sub-iframes)
  if (details.frameId !== 0) return;

  const urlString = details.url;
  // Skip system pages, empty tabs, chrome:// pages
  if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
    return;
  }

  const hostname = new URL(urlString).hostname.replace(/^www\./i, '');
  
  // Fetch user excluded domains
  const settings = await chrome.storage.local.get({ excludedDomains: DEFAULT_EXCLUDED_DOMAINS });
  const isExcluded = settings.excludedDomains.some(domain => {
    const cleanDomain = domain.trim().toLowerCase();
    if (!cleanDomain) return false;
    return hostname === cleanDomain || hostname.endsWith('.' + cleanDomain);
  });

  if (isExcluded) {
    return;
  }

  // Request content from page content script
  try {
    const pageData = await chrome.tabs.sendMessage(details.tabId, { action: 'extractPage' });
    if (!pageData) return;

    // Deduplication check: compare content and update timestamp only if identical
    const existing = await getPage(pageData.url);
    if (existing) {
      const isIdentical = existing.text === pageData.text && existing.title === pageData.title;
      if (isIdentical) {
        // If identical and visited less than 12 hours ago, skip writing to avoid disk cycles
        const twelveHours = 12 * 60 * 60 * 1000;
        if (Date.now() - existing.timestamp < twelveHours) {
          return;
        }
        // Refresh timestamp
        existing.timestamp = Date.now();
        await savePage(existing);
      } else {
        // Content changed: update text, title and timestamp
        await savePage(pageData);
      }
    } else {
      // Brand new page
      await savePage(pageData);
    }
  } catch (err) {
    // Silence errors since tabs might be closed or content script hasn't loaded fully
  }
}, { url: [{ schemes: ['http', 'https'] }] });

/**
 * Delete all pages matching a specific domain from IndexedDB
 */
async function deletePagesByDomain(domain) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('domain');
    const range = IDBKeyRange.only(domain);
    const req = index.openCursor(range);
    
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Handle Message Passing between background, popup, and options page
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getAllPages') {
    getAllPages().then(sendResponse).catch(() => sendResponse([]));
    return true;
  }
  
  if (message.action === 'getPageCount') {
    getPageCount().then(sendResponse).catch(() => sendResponse(0));
    return true;
  }
  
  if (message.action === 'deletePage') {
    deletePage(message.url).then(() => sendResponse(true)).catch(() => sendResponse(false));
    return true;
  }

  if (message.action === 'excludeDomain') {
    chrome.storage.local.get({ excludedDomains: DEFAULT_EXCLUDED_DOMAINS }, async (settings) => {
      const list = settings.excludedDomains || [];
      const lowerDomain = message.domain.toLowerCase().trim();
      if (!list.includes(lowerDomain)) {
        list.push(lowerDomain);
        await chrome.storage.local.set({ excludedDomains: list });
      }
      try {
        await deletePagesByDomain(lowerDomain);
        sendResponse(true);
      } catch (err) {
        console.error('[Recall] Exclude domain db deletion failed:', err);
        sendResponse(false);
      }
    });
    return true;
  }
  
  if (message.action === 'clearAll') {
    clearAllData().then(() => sendResponse(true)).catch(() => sendResponse(false));
    return true;
  }
});

/**
 * Perform a fast, native relevance-scored query over pages index
 */
async function searchPagesNative(query) {
  const pages = await getAllPages();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return [];
  
  const results = [];
  pages.forEach(p => {
    let score = 0;
    const titleLower = (p.title || '').toLowerCase();
    const urlLower = (p.url || '').toLowerCase();
    const textLower = (p.text || '').toLowerCase();
    
    terms.forEach(term => {
      // Check title match (boost 3)
      if (titleLower.includes(term)) {
        score += 3;
      }
      // Check URL match (boost 2)
      if (urlLower.includes(term)) {
        score += 2;
      }
      // Check body text match (boost 1)
      if (textLower.includes(term)) {
        score += 1;
      }
    });
    
    if (score > 0) {
      results.push({ page: p, score: score });
    }
  });
  
  // Sort by score descending, then timestamp descending
  results.sort((a, b) => b.score - a.score || b.page.timestamp - a.page.timestamp);
  return results.map(r => r.page);
}

/**
 * Omnibox Address Bar Search Integration
 */
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const cleanQuery = text.trim();
  if (!cleanQuery) return;

  try {
    const matchedPages = await searchPagesNative(cleanQuery);
    const suggestions = matchedPages.slice(0, 5).map(page => {
      // Escape special characters for Chrome Omnibox markup parser safety
      const escapeXml = (str) => (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
        
      const title = escapeXml(page.title || 'Untitled Page');
      const domain = escapeXml(page.domain || '');
      const url = escapeXml(page.url || '');
      
      return {
        content: page.url,
        description: `${title} <dim>(${domain})</dim> - <url>${url}</url>`
      };
    });
    suggest(suggestions);
  } catch (err) {
    console.error('[Recall] Omnibox search failed:', err);
  }
});

chrome.omnibox.onInputEntered.addListener((url) => {
  if (!url || !url.startsWith('http')) return;
  
  chrome.tabs.query({}, (tabs) => {
    const matchingTab = tabs.find(t => t.url === url);
    if (matchingTab) {
      chrome.tabs.update(matchingTab.id, { active: true });
      chrome.windows.update(matchingTab.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: url, active: true });
    }
  });
});

