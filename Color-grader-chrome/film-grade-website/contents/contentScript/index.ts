import type { PlasmoContentScript } from "plasmo"
import { initializeProcessor, findMediaElements } from '../imageProcessor'

// Export to make it a Plasmo content script
export const config: PlasmoContentScript = {
  matches: ["<all_urls>"],
  all_frames: true
}

console.log('Film Grade: Content script loaded properly')

// This adds a marker to ensure the content script is loaded
document.documentElement.dataset.filmGradeLoaded = 'true'

// Get the current filter settings from storage
const getFilterSettings = async () => {
  try {
    const result = await chrome.storage.sync.get({
      preset: 'none',
      enableGrain: false,
      enableVignette: false,
      isEnabled: true
    })
    
    console.log('Film Grade: Retrieved settings', result)
    return result
  } catch (error) {
    console.error('Error getting filter settings:', error)
    return {
      preset: 'none',
      enableGrain: false,
      enableVignette: false,
      isEnabled: true
    }
  }
}

// Initialize when the page loads
const init = async () => {
  // Add debug logging
  console.log('Film Grade: Content script loaded and initialized')
  
  // Check if we can find media elements
  const mediaElements = findMediaElements()
  console.log(`Film Grade: Found ${mediaElements.length} media elements on the page`, mediaElements)
  
  const settings = await getFilterSettings()
  
  // Only apply if extension is enabled
  if (settings.isEnabled && settings.preset !== 'none') {
    // Apply the filter
    console.log(`Film Grade: Applying preset ${settings.preset} with grain=${settings.enableGrain}, vignette=${settings.enableVignette}`)
    initializeProcessor(settings.preset, settings.enableGrain, settings.enableVignette)
    
    // Log info
    console.log(`Film Grade activated with preset: ${settings.preset}`)
  } else {
    console.log('Film Grade: Not applying effects because either isEnabled=false or preset=none')
  }
}

// Run initialization
console.log('Film Grade: Content script initializing')
init()

// Listen for setting changes
chrome.storage.onChanged.addListener((changes) => {
  console.log('Film Grade: Storage changes detected', changes)
  
  const relevantChanges = [
    'preset', 
    'enableGrain', 
    'enableVignette', 
    'isEnabled'
  ].some(key => key in changes)
  
  if (relevantChanges) {
    console.log('Film Grade: Relevant settings changed, reinitializing')
    init()
  }
})

// Listen for direct messages (e.g. from the popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Film Grade: Received message', message)
  
  if (message.action === 'ping') {
    console.log('Film Grade: Received ping message')
    sendResponse({ success: true, message: 'Content script is active' })
    return true
  }
  
  if (message.action === 'refresh') {
    console.log('Film Grade: Refresh action requested')
    init()
      .then(() => {
        console.log('Film Grade: Refresh completed successfully')
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('Film Grade: Refresh failed', error)
        sendResponse({ success: false, error: error.message })
      })
    
    // Return true to indicate async response
    return true
  }
  
  if (message.action === 'applyFilter') {
    console.log('Film Grade: Direct apply filter requested')
    initializeProcessor(message.preset, message.enableGrain, message.enableVignette)
      .then(() => {
        console.log('Film Grade: Direct filter application successful')
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('Film Grade: Direct filter application failed', error)
        sendResponse({ success: false, error: error.message })
      })
    
    // Return true to indicate async response
    return true
  }
}) 