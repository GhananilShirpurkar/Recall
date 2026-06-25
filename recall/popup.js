/**
 * Recall Popup Script
 * Coordinates MiniSearch local index, real-time search, filters, and rendering
 */

let searchIndex = null;
let allPages = [];
let debounceTimer = null;

// DOM Elements
const searchInput = document.getElementById('searchInput');
const timeFilter = document.getElementById('timeFilter');
const domainFilter = document.getElementById('domainFilter');
const resultsContainer = document.getElementById('results');
const statsContainer = document.getElementById('stats');

/**
 * Escapes raw HTML to prevent XSS injection in search results
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Request all saved pages from the background service worker
 */
function fetchAllPages() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getAllPages' }, (response) => {
      resolve(response || []);
    });
  });
}

/**
 * Initialize MiniSearch index and add all pages
 */
function buildSearchIndex(pages) {
  const MiniSearch = window.MiniSearch;
  if (!MiniSearch) {
    console.error('MiniSearch library not loaded!');
    return null;
  }

  const index = new MiniSearch({
    fields: ['title', 'text', 'domain'],
    storeFields: ['title', 'url', 'domain', 'timestamp', 'text'],
    searchOptions: {
      boost: { title: 2.5, domain: 1.8, text: 1.0 },
      fuzzy: 0.25,
      prefix: true
    }
  });

  // Assign internal numeric IDs for MiniSearch
  const indexedDocs = pages.map((page, idx) => ({
    id: idx,
    title: page.title || '',
    text: page.text || '',
    domain: page.domain || '',
    url: page.url,
    timestamp: page.timestamp
  }));

  index.addAll(indexedDocs);
  return index;
}

/**
 * Determine if a page fits within the selected time window
 */
function matchesTimeFilter(timestamp, filterType) {
  const now = Date.now();
  const date = new Date(timestamp);
  
  if (filterType === 'today') {
    const todayMidnight = new Date().setHours(0, 0, 0, 0);
    return timestamp >= todayMidnight;
  } else if (filterType === 'week') {
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    return timestamp >= sevenDaysAgo;
  } else if (filterType === 'month') {
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    return timestamp >= thirtyDaysAgo;
  }
  return true; // "all"
}

/**
 * Extracts a matching text snippet, escaping HTML and highlighting query terms
 */
/**
 * Extracts a matching text snippet, escaping HTML and highlighting query terms
 */
function generateHighlightSnippet(text, termsRegex, terms) {
  if (!text) return '';
  
  const cleanText = text;
  const escapedText = escapeHtml(cleanText);
  
  if (!termsRegex || !terms || terms.length === 0) {
    return escapedText.substring(0, 140) + (escapedText.length > 140 ? '...' : '');
  }

  const lowerText = cleanText.toLowerCase();
  
  // Find first occurrence of any query term
  let matchIndex = -1;
  let matchedTermLength = 0;
  
  for (const term of terms) {
    const idx = lowerText.indexOf(term);
    if (idx !== -1) {
      if (matchIndex === -1 || idx < matchIndex) {
        matchIndex = idx;
        matchedTermLength = term.length;
      }
    }
  }

  // Fallback to start of text if no query term matches the excerpt directly
  if (matchIndex === -1) {
    return escapedText.substring(0, 140) + (escapedText.length > 140 ? '...' : '');
  }

  // Extract sliding window context around matching term
  const contextLengthBefore = 50;
  const contextLengthAfter = 100;
  
  const start = Math.max(0, matchIndex - contextLengthBefore);
  const end = Math.min(cleanText.length, matchIndex + matchedTermLength + contextLengthAfter);
  
  const snippet = cleanText.substring(start, end);
  let escapedSnippet = escapeHtml(snippet);

  // Safely inject <mark> highlight tags using precompiled query regex
  escapedSnippet = escapedSnippet.replace(termsRegex, '<mark class="hud-highlight">$1</mark>');

  const prefix = start > 0 ? '...' : '';
  const suffix = end < cleanText.length ? '...' : '';
  
  return prefix + escapedSnippet + suffix;
}

/**
 * Renders the results list in the popup
 */
let currentMode = 'flat'; // 'flat' or 'journey'

/**
 * Renders the results list in the popup
 */
function renderResults(results, termsRegex, terms) {
  resultsContainer.innerHTML = '';

  if (results.length === 0) {
    resultsContainer.innerHTML = '<div class="hud-message">// NO MATCHING PAGES FOUND IN LOCAL_INDEX</div>';
    return;
  }

  if (currentMode === 'flat') {
    renderFlatList(results, termsRegex, terms);
  } else {
    renderJourneyList(results, termsRegex, terms);
  }
}

/**
 * Flat list card rendering
 */
function renderFlatList(results, termsRegex, terms) {
  results.forEach((item, index) => {
    const card = createResultCard(item, termsRegex, terms);
    card.style.animationDelay = `${index * 25}ms`;
    resultsContainer.appendChild(card);
  });
}

/**
 * Chronological Domain Journey rendering
 */
function renderJourneyList(results, termsRegex, terms) {
  // Sort results by timestamp descending
  const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);
  const journeys = groupIntoJourneys(sorted);

  journeys.forEach((journey, journeyIdx) => {
    const journeyEl = document.createElement('div');
    journeyEl.className = 'journey-group';
    journeyEl.style.animationDelay = `${journeyIdx * 35}ms`;

    const relativeTime = getRelativeTime(journey.timestamp);
    
    journeyEl.innerHTML = `
      <div class="journey-indicator"></div>
      <div class="journey-header">
        <span class="journey-title">${escapeHtml(journey.domain)}</span>
        <span class="journey-time">${relativeTime}</span>
      </div>
    `;

    journey.pages.forEach(item => {
      const card = createResultCard(item, termsRegex, terms);
      journeyEl.appendChild(card);
    });

    resultsContainer.appendChild(journeyEl);
  });
}

/**
 * Group pages from same domain within 30 minutes into a unified Journey
 */
function groupIntoJourneys(pages) {
  const journeys = [];
  let currentJourney = null;

  pages.forEach(page => {
    if (!currentJourney) {
      currentJourney = {
        domain: page.domain,
        timestamp: page.timestamp,
        pages: [page]
      };
    } else {
      const lastPage = currentJourney.pages[currentJourney.pages.length - 1];
      const timeDiff = Math.abs(lastPage.timestamp - page.timestamp);
      const thirtyMins = 30 * 60 * 1000;

      if (page.domain === currentJourney.domain && timeDiff <= thirtyMins) {
        currentJourney.pages.push(page);
      } else {
        journeys.push(currentJourney);
        currentJourney = {
          domain: page.domain,
          timestamp: page.timestamp,
          pages: [page]
        };
      }
    }
  });

  if (currentJourney) {
    journeys.push(currentJourney);
  }
  return journeys;
}

/**
 * Format timestamp into relative display string
 */
function getRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins}M AGO`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.floor(hours / 24);
  return `${days}D AGO`;
}

/**
 * Factory for building single result card elements
 */
function createResultCard(item, termsRegex, terms) {
  const dateStr = new Date(item.timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const card = document.createElement('div');
  card.className = 'result-card';
  
  const titleEscaped = escapeHtml(item.title || 'Untitled Page');
  const domainEscaped = escapeHtml(item.domain || '');
  const snippetHtml = generateHighlightSnippet(item.text, termsRegex, terms);

  card.innerHTML = `
    <div class="card-header">
      <span class="card-domain">${domainEscaped}</span>
      <div class="header-right">
        <span class="card-date">${dateStr}</span>
        <button class="view-reader-btn" title="Read local offline snapshot">VIEW</button>
        <button class="exclude-btn" data-domain="${domainEscaped}" title="Never index this domain & delete its records">EXCLUDE</button>
      </div>
    </div>
    <h3 class="card-title">
      <a href="${escapeHtml(item.url)}" title="${titleEscaped}">
        ${titleEscaped}
      </a>
    </h3>
    <p class="card-snippet">${snippetHtml}</p>
  `;

  // Focus existing tab or launch a new tab on card click
  card.addEventListener('click', (e) => {
    if (e.target.closest('.exclude-btn') || e.target.closest('.view-reader-btn')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    handlePageActivation(item.url);
  });

  // Open the slide-in Offline Excerpt Viewer
  card.querySelector('.view-reader-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openOfflineReader(item, termsRegex);
  });

  // Arm and trigger domain blocklist exclusion
  card.querySelector('.exclude-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const domainToExclude = e.target.dataset.domain;
    
    if (e.target.classList.contains('armed')) {
      chrome.runtime.sendMessage({ action: 'excludeDomain', domain: domainToExclude }, (success) => {
        if (success) {
          allPages = allPages.filter(p => p.domain.toLowerCase() !== domainToExclude.toLowerCase());
          if (allPages.length > 0) {
            searchIndex = buildSearchIndex(allPages);
          } else {
            searchIndex = null;
          }
          
          statsContainer.textContent = `EXCLUDED & WIPED: ${domainToExclude.toUpperCase()}`;
          setTimeout(() => {
            statsContainer.textContent = `${allPages.length} PAGES INDEXED`;
          }, 2500);

          executeSearch();
        }
      });
    } else {
      resultsContainer.querySelectorAll('.exclude-btn.armed').forEach(other => {
        other.textContent = 'EXCLUDE';
        other.classList.remove('armed');
      });

      e.target.textContent = 'SURE?';
      e.target.classList.add('armed');
      
      setTimeout(() => {
        if (e.target) {
          e.target.textContent = 'EXCLUDE';
          e.target.classList.remove('armed');
        }
      }, 3000);
    }
  });

  return card;
}

/**
 * Populates and reveals the Offline Excerpt Reader Overlay
 */
function openOfflineReader(item, termsRegex) {
  const offlineReader = document.getElementById('offlineReader');
  const readerDomain = document.getElementById('readerDomain');
  const readerDate = document.getElementById('readerDate');
  const readerTitle = document.getElementById('readerTitle');
  const readerContent = document.getElementById('readerContent');

  const dateStr = new Date(item.timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  readerDomain.textContent = item.domain || '';
  readerDate.textContent = dateStr;
  readerTitle.textContent = item.title || 'Untitled Page';
  
  // Clean raw HTML tags and inject word highlight markers
  let textBody = item.text || 'No text content cached offline for this page.';
  let contentHtml = escapeHtml(textBody);
  if (termsRegex) {
    contentHtml = contentHtml.replace(termsRegex, '<mark class="hud-highlight">$1</mark>');
  }
  
  readerContent.innerHTML = contentHtml;
  offlineReader.classList.add('active');
}

/**
 * Filter pages list or query searchIndex
 */
function executeSearch() {
  const query = searchInput.value.trim();
  const timeVal = timeFilter.value;
  const domainVal = domainFilter.value.trim().toLowerCase();

  let filtered = [];

  if (!query) {
    filtered = [...allPages].sort((a, b) => b.timestamp - a.timestamp);
  } else if (searchIndex) {
    const searchResults = searchIndex.search(query, {
      filter: (doc) => true
    });
    filtered = searchResults;
  } else {
    filtered = [];
  }

  const finalResults = filtered.filter(item => {
    const timeMatch = matchesTimeFilter(item.timestamp, timeVal);
    const domainMatch = !domainVal || (item.domain && item.domain.toLowerCase().includes(domainVal));
    return timeMatch && domainMatch;
  });

  const terms = query ? query.toLowerCase().split(/\s+/).filter(t => t.length > 1) : [];
  let termsRegex = null;
  if (terms.length > 0) {
    const escapedTerms = terms.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    termsRegex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
  }

  const sliceLimit = finalResults.slice(0, 15);
  renderResults(sliceLimit, termsRegex, terms);
}

/**
 * Debounce query searches
 */
function triggerSearchDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    executeSearch();
  }, 60);
}

// Initializer
document.addEventListener('DOMContentLoaded', async () => {
  statsContainer.textContent = 'BUILDING SEARCH_INDEX...';
  
  allPages = await fetchAllPages();
  statsContainer.textContent = `${allPages.length} PAGES INDEXED`;

  if (allPages.length > 0) {
    searchIndex = buildSearchIndex(allPages);
  }

  executeSearch();

  // Event Listeners
  searchInput.addEventListener('input', triggerSearchDebounced);
  timeFilter.addEventListener('change', executeSearch);
  domainFilter.addEventListener('input', executeSearch);

  // Toggle modes buttons
  const flatModeBtn = document.getElementById('flatModeBtn');
  const journeyModeBtn = document.getElementById('journeyModeBtn');

  flatModeBtn.addEventListener('click', () => {
    if (currentMode !== 'flat') {
      currentMode = 'flat';
      flatModeBtn.classList.add('active');
      journeyModeBtn.classList.remove('active');
      executeSearch();
    }
  });

  journeyModeBtn.addEventListener('click', () => {
    if (currentMode !== 'journey') {
      currentMode = 'journey';
      journeyModeBtn.classList.add('active');
      flatModeBtn.classList.remove('active');
      executeSearch();
    }
  });

  // Offline Reader controls
  const offlineReader = document.getElementById('offlineReader');
  const closeReaderBtn = document.getElementById('closeReaderBtn');
  closeReaderBtn.addEventListener('click', () => {
    offlineReader.classList.remove('active');
  });

  searchInput.focus();
});

/**
 * Focuses existing tab if already open, or creates a new active tab in foreground
 */
async function handlePageActivation(url) {
  try {
    const tabs = await chrome.tabs.query({});
    const matchingTab = tabs.find(t => t.url === url);

    if (matchingTab) {
      await chrome.tabs.update(matchingTab.id, { active: true });
      await chrome.windows.update(matchingTab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: url, active: true });
    }
    window.close();
  } catch (err) {
    console.error('[Recall] Tab activation failed, falling back to window.open:', err);
    window.open(url, '_blank');
  }
}

