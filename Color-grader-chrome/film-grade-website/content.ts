// Main content script entry point
console.log('Film Grade: Content script loaded directly');

// Import the main content script functionality
import './contents/index';

// Also import our early-start image processor to ensure it loads first
import './contents/imageProcessor.document_start';

// This adds a marker to ensure the content script is loaded
document.documentElement.dataset.filmGradeLoaded = 'true';

// Send a message to the background script to confirm the content script is loaded
try {
  chrome.runtime.sendMessage({ 
    action: 'contentScriptLoaded',
    url: window.location.href
  }).catch(err => {
    console.log('Film Grade: Error sending content script loaded message', err);
  });
} catch (error) {
  console.error('Film Grade: Error in content script initialization', error);
}

// This file is a direct entry point for the content script
// It should be automatically detected by Plasmo and registered in the manifest 