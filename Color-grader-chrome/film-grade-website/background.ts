import { Storage } from "@plasmohq/storage"

const storage = new Storage({
  area: "sync"
})

// Track tabs that have the content script loaded
const tabsWithContentScript = new Set<number>();

// Initialize default settings when the extension is installed
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    console.log("Extension installed");
    
    // Initialize settings with default values
    await chrome.storage.sync.set({
      isEnabled: true,
      preset: "none",
      enableGrain: false,
      enableVignette: false
    });
  }
});

// Listen for tab updates to inject the content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act if the tab has completed loading and has a URL
  if (changeInfo.status === "complete" && tab.url && tab.url.startsWith("http")) {
    // Don't re-inject if the script is already loaded in this tab
    if (!tabsWithContentScript.has(tabId)) {
      tabsWithContentScript.add(tabId);
      
      // Inject the content script
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["contents/imageProcessor.js"]
      })
      .catch(err => console.error("Failed to inject content script:", err));
    }
  }
});

// Clean up the set when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabsWithContentScript.delete(tabId);
});

// Handle image proxying to bypass CORS
const proxyImage = async (imageUrl: string): Promise<{ success: boolean, dataUrl?: string, error?: string }> => {
  try {
    console.log("Proxying image:", imageUrl);
    // Fetch the image with no-cors mode to get the binary data
    const response = await fetch(imageUrl, { 
      method: 'GET',
      // Don't set mode to no-cors here - background scripts have permission to make cross-origin requests
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    // Get the image data as blob
    const blob = await response.blob();
    
    // Convert blob to data URL using FileReader
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          success: true,
          dataUrl: reader.result as string
        });
      };
      reader.onerror = () => {
        resolve({
          success: false,
          error: 'Failed to convert image to data URL'
        });
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Proxy image error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
};

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle proxy image request
  if (message.action === 'proxyImage' && message.imageUrl) {
    console.log("Received proxy request for:", message.imageUrl);
    proxyImage(message.imageUrl)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message || 'Unknown error occurred'
        });
      });
    return true; // Indicates async response
  }
  
  return false; // Not handled
});

// Setup context menu
const setupContextMenu = async () => {
  // Remove existing context menus
  chrome.contextMenus.removeAll();
  
  // Add the main menu item
  chrome.contextMenus.create({
    id: "film-grade-toggle",
    title: "Toggle Film Grade",
    contexts: ["page"]
  });
  
  // Get current settings to show correct state
  const isEnabled = await storage.get("isEnabled") as boolean ?? true;
  
  chrome.contextMenus.create({
    id: "film-grade-enable",
    title: isEnabled ? "✓ Enabled" : "Enable",
    contexts: ["page"],
    parentId: "film-grade-toggle"
  });
  
  chrome.contextMenus.create({
    id: "film-grade-disable",
    title: !isEnabled ? "✓ Disabled" : "Disable",
    contexts: ["page"],
    parentId: "film-grade-toggle"
  });
  
  // Add a separator
  chrome.contextMenus.create({
    id: "film-grade-separator",
    type: "separator",
    contexts: ["page"],
    parentId: "film-grade-toggle"
  });
  
  // Add refresh option
  chrome.contextMenus.create({
    id: "film-grade-refresh",
    title: "Refresh Filter",
    contexts: ["page"],
    parentId: "film-grade-toggle"
  });
};

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  
  if (info.menuItemId === "film-grade-enable") {
    await storage.set("isEnabled", true);
    
    // Update UI
    chrome.contextMenus.update("film-grade-enable", {
      title: "✓ Enabled"
    });
    chrome.contextMenus.update("film-grade-disable", {
      title: "Disable"
    });
    
    // Send message to content script
    chrome.tabs.sendMessage(tab.id, {
      action: "applyFilter",
      isEnabled: true,
      preset: await storage.get("preset") || "none",
      enableGrain: await storage.get("enableGrain") || false,
      enableVignette: await storage.get("enableVignette") || false
    });
  } 
  
  else if (info.menuItemId === "film-grade-disable") {
    await storage.set("isEnabled", false);
    
    // Update UI
    chrome.contextMenus.update("film-grade-enable", {
      title: "Enable"
    });
    chrome.contextMenus.update("film-grade-disable", {
      title: "✓ Disabled"
    });
    
    // Send message to content script
    chrome.tabs.sendMessage(tab.id, {
      action: "applyFilter",
      isEnabled: false,
      preset: await storage.get("preset") || "none",
      enableGrain: await storage.get("enableGrain") || false,
      enableVignette: await storage.get("enableVignette") || false
    });
  }
  
  else if (info.menuItemId === "film-grade-refresh") {
    // Send refresh message to content script
    chrome.tabs.sendMessage(tab.id, {
      action: "refresh"
    });
  }
});

// Initialize context menu when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});

// Setup default settings if not already set
const initializeSettings = async () => {
  const isEnabled = await storage.get("isEnabled");
  if (isEnabled === undefined) {
    await storage.set("isEnabled", true);
  }
  
  const preset = await storage.get("preset");
  if (preset === undefined) {
    await storage.set("preset", "none");
  }
  
  const enableGrain = await storage.get("enableGrain");
  if (enableGrain === undefined) {
    await storage.set("enableGrain", false);
  }
  
  const enableVignette = await storage.get("enableVignette");
  if (enableVignette === undefined) {
    await storage.set("enableVignette", false);
  }
  
  // Re-setup context menu to reflect current settings
  setupContextMenu();
};

// Initialize settings
initializeSettings(); 