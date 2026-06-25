/**
 * Recall Options Panel JS
 * Handles storage configurations, excluded domain list, and database purges
 */

const retentionSelect = document.getElementById('retentionSelect');
const blocklistTextarea = document.getElementById('blocklistTextarea');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const dbCountText = document.getElementById('dbCount');
const dbSizeText = document.getElementById('dbSize');
const statusAlert = document.getElementById('statusAlert');

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
 * Approximate the database storage size in MB based on string length
 */
function calculateStorageEstimate(pages) {
  if (!pages || pages.length === 0) return '0.00 MB';
  
  // Convert object list to JSON string and count raw characters
  const jsonString = JSON.stringify(pages);
  const totalBytes = jsonString.length * 2; // JavaScript strings are UTF-16 (2 bytes per character)
  const totalMegabytes = totalBytes / (1024 * 1024);
  
  return totalMegabytes.toFixed(2) + ' MB';
}

/**
 * Loads current database statistics
 */
function loadStats() {
  chrome.runtime.sendMessage({ action: 'getAllPages' }, (pages) => {
    const list = pages || [];
    dbCountText.textContent = `${list.length} PAGES`;
    dbSizeText.textContent = calculateStorageEstimate(list);
  });
}

/**
 * Load configurations from extension local storage
 */
async function loadConfigurations() {
  const settings = await chrome.storage.local.get({
    retentionDays: 30,
    excludedDomains: DEFAULT_EXCLUDED_DOMAINS
  });

  retentionSelect.value = settings.retentionDays;
  blocklistTextarea.value = settings.excludedDomains.join('\n');
}

/**
 * Save configurations to extension local storage
 */
async function saveConfigurations() {
  const retentionDays = retentionSelect.value;
  const rawDomains = blocklistTextarea.value;
  
  // Normalize domain list
  const excludedDomains = rawDomains
    .split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(line => line.length > 0);

  await chrome.storage.local.set({
    retentionDays,
    excludedDomains
  });

  // Visual success feedback
  statusAlert.style.display = 'block';
  statusAlert.textContent = '// CONFIGURATION SAVED SUCCESSFULLY';
  
  setTimeout(() => {
    statusAlert.style.display = 'none';
  }, 2500);

  // Reload statistics
  loadStats();
}

/**
 * Clears all data from IndexedDB
 */
function handleDatabaseClear() {
  const confirmed = confirm(
    'CRITICAL: Are you sure you want to permanently delete all indexed page content? ' +
    'This will wipe your local search index. This action cannot be undone.'
  );

  if (confirmed) {
    chrome.runtime.sendMessage({ action: 'clearAll' }, (success) => {
      if (success) {
        statusAlert.style.display = 'block';
        statusAlert.style.color = 'var(--danger-color)';
        statusAlert.textContent = '// ALL DATA WIPED FROM LOCAL_INDEX';
        
        setTimeout(() => {
          statusAlert.style.display = 'none';
          statusAlert.style.color = '#00ff66';
        }, 3000);

        loadStats();
      } else {
        alert('Error: Failed to wipe the index.');
      }
    });
  }
}

// Event bindings
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadConfigurations();
  
  saveBtn.addEventListener('click', saveConfigurations);
  clearBtn.addEventListener('click', handleDatabaseClear);
});
