// Initialize default settings when the extension is installed
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Set default settings
    await chrome.storage.sync.set({
      preset: 'none',
      enableGrain: false,
      enableVignette: false,
      isEnabled: true
    });
    
    console.log('Film Grade extension installed with default settings');
  }
});

// Keep track of tabs where content script is loaded
const tabsWithContentScript = new Set<number>();

// Handle content script loaded messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'contentScriptLoaded' && sender.tab?.id) {
    console.log(`Film Grade: Content script loaded in tab ${sender.tab.id}`);
    tabsWithContentScript.add(sender.tab.id);
    sendResponse({ success: true });
  }
});

// Handle clicks on the extension icon
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  
  try {
    // Get current settings
    const settings = await chrome.storage.sync.get({
      isEnabled: true
    });
    
    // Toggle enabled state
    const newEnabledState = !settings.isEnabled;
    
    // Update storage
    await chrome.storage.sync.set({
      isEnabled: newEnabledState
    });
    
    // Set icon based on state
    const iconPath = newEnabledState 
      ? '/assets/icon.png' 
      : '/assets/icon-disabled.png';
    
    await chrome.action.setIcon({
      path: iconPath,
      tabId: tab.id
    });
    
    // Refresh the content scripts
    if (tabsWithContentScript.has(tab.id)) {
      // Only try to send a message if we know the content script is loaded
      chrome.tabs.sendMessage(tab.id, {
        action: 'refresh'
      }).catch(err => {
        console.log('Could not send refresh message to tab');
      });
    } else {
      // If content script isn't loaded, try reloading it
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).catch(err => {
        console.error('Failed to inject content script', err);
      });
    }
    
    // Show badge
    chrome.action.setBadgeText({
      text: newEnabledState ? 'ON' : 'OFF',
      tabId: tab.id
    });
    
    // Clear badge after 2 seconds
    setTimeout(() => {
      chrome.action.setBadgeText({
        text: '',
        tabId: tab.id
      });
    }, 2000);
    
  } catch (error) {
    console.error('Error toggling extension state:', error);
  }
});

// Set initial icon state based on settings
const updateIconState = async (tabId: number) => {
  try {
    const settings = await chrome.storage.sync.get({
      isEnabled: true
    });
    
    const iconPath = settings.isEnabled 
      ? '/assets/icon.png' 
      : '/assets/icon-disabled.png';
      
    await chrome.action.setIcon({
      path: iconPath,
      tabId
    });
    
  } catch (error) {
    console.error('Error setting icon state:', error);
  }
};

// Update icon when tab is activated
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateIconState(activeInfo.tabId);
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateIconState(tabId);
  }
});

// Remove tabs from the tracking set when they are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabsWithContentScript.delete(tabId);
}); 