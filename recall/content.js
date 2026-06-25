/**
 * Recall Content Script
 * Privacy-first page text extraction
 */

function shouldSkipPage() {
  // Privacy gate: Never index pages with password fields
  if (document.querySelector('input[type="password"]')) {
    return true;
  }
  
  // Skip pages with no body or very short text
  if (!document.body || !document.body.innerText) {
    return true;
  }
  
  // Exclude common search queries or login pages via title/URL check if possible
  const url = window.location.href.toLowerCase();
  if (url.includes('login') || url.includes('signin') || url.includes('signup')) {
    return true;
  }
  
  return false;
}

function extractPageData() {
  if (shouldSkipPage()) {
    return null;
  }

  // Clone document body to clean it up without disturbing the live DOM
  const clone = document.body.cloneNode(true);
  
  // Remove non-content elements to ensure clean text index
  const selectorsToRemove = [
    'script', 'style', 'nav', 'footer', 'header', 
    'aside', 'iframe', 'noscript', 'svg', 'canvas'
  ];
  clone.querySelectorAll(selectorsToRemove.join(',')).forEach(el => el.remove());
  
  const rawText = clone.innerText || '';
  // Normalize whitespace: replace multiple spaces/newlines with a single space
  const cleanText = rawText.replace(/\s+/g, ' ').trim();
  
  // Skip indexing if content is too short (e.g. error pages, blank page, simple redirects)
  if (cleanText.length < 200) {
    return null;
  }
  
  return {
    url: window.location.href,
    title: document.title || window.location.hostname,
    domain: window.location.hostname.replace(/^www\./i, ''),
    text: cleanText.substring(0, 5000), // Cap at 5000 characters to keep DB size small
    timestamp: Date.now()
  };
}

// Listen for messages from the background worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractPage') {
    try {
      const data = extractPageData();
      sendResponse(data);
    } catch (e) {
      console.error('[Recall] Error extracting page data:', e);
      sendResponse(null);
    }
  }
  return true; // Keep message channel open for async response
});
